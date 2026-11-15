// services/uploadQueue.js
import path from "path";
import Queue from 'bull';
import { audioService } from "../services/audioService.js";
import { imageService } from "../services/imageService.js";
import { s3Service } from "../services/s3Service.js";
import { deleteTrackFromDatabase, uploadTrackToDatabase, updateTrackOnDatabase } from "../controllers/trackController.js";
import { updateUserOnDatabase, getUserById } from '../controllers/userController.js';
import { cleanupFiles } from '../utils/cleanup.js';
import { isFinalJobAttempt } from './uploadJobPolicy.js';
import { getUploadConstraints } from '../utils/uploadConstraints.js';
import { safeUploadFailure } from '../utils/trackUploadRequest.js';
import { logDiagnostic } from '../utils/apiErrors.js';


const trackUploadQueue = new Queue('file-processing', process.env.REDIS_URL);
const profilePictureUploadQueue = new Queue('profile-picture-processing', process.env.REDIS_URL);


trackUploadQueue.process("track", async (job) => {
  const tempFiles = [];
  let uploadedTrack;
  let finalizedTrack;
  let finalizedCover;
  let processedCoverPath;
  let completed = false;
  let shouldCleanupStaging = false;
  const {
    userId,
    trackUrl,
    imageUrl,
    name,
    artist,
    description,
    is_private,
    category,
    genre = [],
    mood = [],
    bpm,
    referenceId,
  } = job.data;

  try {
    const constraints = getUploadConstraints();
    const [trackMetadata, imageMetadata] = await Promise.all([
      s3Service.getMetadata(trackUrl.key),
      imageUrl ? s3Service.getMetadata(imageUrl.key) : null,
    ]);
    if (!trackMetadata.exists) throw new Error('Upload file not found');
    if (!trackMetadata.contentLength) throw new Error('Invalid audio file structure: file is empty');
    if (trackMetadata.contentLength > constraints.audio.maxBytes) {
      throw new Error(`Audio file exceeds the ${constraints.audio.maxBytes / (1024 * 1024)} MiB limit`);
    }
    if (imageUrl && !imageMetadata?.exists) throw new Error('Upload image file not found');
    if (imageMetadata && !imageMetadata.contentLength) throw new Error('Invalid image file: file is empty');
    if (imageMetadata?.contentLength > constraints.image.maxBytes) {
      throw new Error(`Image file exceeds the ${constraints.image.maxBytes / (1024 * 1024)} MiB limit`);
    }

    // Download track file from S3
    job.progress("Downloading track file...");
    const trackDownloadResult = await s3Service.downloadToTemp(trackUrl.key);
    tempFiles.push(trackDownloadResult.filePath);

    // Check if audio is valid
    job.progress("Validating audio...");
    const validation = await audioService.validateAudio(trackDownloadResult.filePath);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Download image file from s3 (if provided)
    job.progress("Downloading artwork...");
    if (imageUrl) {
      let imageDownloadResult = null;
      imageDownloadResult = await s3Service.downloadToTemp(imageUrl.key)
      tempFiles.push(imageDownloadResult?.filePath);

      // Check if image is valid
      job.progress("Validating image...");
      const validation = await imageService.validateImage(imageDownloadResult.filePath);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      processedCoverPath = path.join(
        path.dirname(imageDownloadResult.filePath),
        `${path.basename(imageDownloadResult.filePath)}.normalized.webp`,
      );
      tempFiles.push(processedCoverPath);
      await imageService.processForTrackArtwork(
        imageDownloadResult.filePath,
        processedCoverPath,
      );
    }

    // Analyze the audio file
    job.progress("Analyzing audio...");
    const metadata = await audioService.analyzeFile(tempFiles[0]);
    const normalizedMetadata = audioService.normalizeMetadata(
      metadata,
      tempFiles[0]
    );

    job.progress("Processing metadata...");

    // Format genre and mood arrays
    const formattedGenre = Array.isArray(genre) ? genre.join(",") : genre;
    const formattedMood = Array.isArray(mood) ? mood.join(",") : mood;

    // Prepare track data according to database schema
    const enrichedTrackData = {
      name,
      artist: artist || null,
      description: description || null,
      is_private: is_private || false,
      category: category || null,
      genre: formattedGenre,
      mood: formattedMood,
      length: normalizedMetadata.duration || 0,
      bpm: bpm || null,
      creator_id: userId,
      sound_type: normalizedMetadata.format || "unknown",
      url: trackUrl.key,
      image_url: imageUrl?.key,
    };

    job.progress("Saving to database...");
    // Create database record
    uploadedTrack = await uploadTrackToDatabase(enrichedTrackData);

    
    // Move the track file to its final location
    job.progress("Finalizing upload...");
    try {
      if (imageUrl) {
        finalizedCover = await s3Service.uploadProcessedCover(
          processedCoverPath,
          userId,
          uploadedTrack.id
        );
      }
      finalizedTrack = await s3Service.finalizeTrackUpload(
        trackUrl.key,
        userId,
        uploadedTrack.id
      );
      await updateTrackOnDatabase(uploadedTrack.id, {
        url: finalizedTrack.url,
        image_url: finalizedCover?.url || null,
      });
    } catch (moveError) {
      console.error('Failed to move files to final location:', moveError);
      throw new Error(`File movement failed: ${moveError.message}`);
    }

    job.progress("Upload complete!");

    completed = true;
    return {
      ...uploadedTrack,
      url: finalizedTrack.url,
      image_url: finalizedCover
        ? await s3Service.generateSecureUrl(finalizedCover.key)
        : null,
    };
  } catch (error) {
    const failure = safeUploadFailure(error.message);
    shouldCleanupStaging = failure.permanent;
    if (failure.permanent) job.discard();
    await job.update({
      ...job.data,
      failure: { code: failure.code, error: failure.error },
    }).catch(() => {});
    if (uploadedTrack) {
      await deleteTrackFromDatabase(uploadedTrack.id).catch(() => {});
    }
    await Promise.allSettled([
      finalizedTrack?.key ? s3Service.deleteFile(finalizedTrack.key) : null,
      finalizedCover?.key ? s3Service.deleteFile(finalizedCover.key) : null,
    ]);
    logDiagnostic(error, {
      code: failure.code,
      referenceId,
      context: 'track upload worker',
      jobId: job.id,
    });
    throw error; // Propagate error to trigger job failure
  } finally {
    // Cleanup temp files
    await cleanupFiles(tempFiles);
    // Preserve staging objects for intermediate attempts. Delete them only
    // after success or after Bull has exhausted the configured retries.
    if (completed || shouldCleanupStaging || isFinalJobAttempt(job)) {
      await Promise.allSettled([
        trackUrl ? s3Service.deleteFile(trackUrl.key) : null,
        imageUrl ? s3Service.deleteFile(imageUrl.key) : null,
      ]);
    }
  }
});

profilePictureUploadQueue.process("profile-picture", async (job) => {
  const { userId, imageUrl, referenceId } = job.data;
  const tempFiles = [];
  let finalizedImage;
  let completed = false;
  let shouldCleanupStaging = false;

  try {
    const constraints = getUploadConstraints().image;
    const metadata = await s3Service.getMetadata(imageUrl.key);
    if (!metadata.exists) throw new Error('Upload image file not found');
    if (!metadata.contentLength) throw new Error('Invalid image file: file is empty');
    if (metadata.contentLength > constraints.maxBytes) {
      throw new Error(`Image file exceeds the ${constraints.maxBytes / (1024 * 1024)} MiB limit`);
    }

    // Download image file from s3
    job.progress("Downloading image file...");
    const { filePath } = await s3Service.downloadToTemp(imageUrl.key);
    tempFiles.push(filePath);

    // Validate and process the image
    job.progress("Processing image...");
    const { isValid, error } = await imageService.validateImage(filePath);
    if (!isValid) {
      throw new Error(error);
    }
    // Move the image file to its final location
    job.progress("Finalizing upload...");
    finalizedImage = await s3Service.finalizeProfilePictureUpload(
      imageUrl.key,
      userId
    );

    // Commit the new reference before best-effort cleanup of the old object.
    const userInfo = await getUserById(userId);
    const oldProfilePictureUrl = userInfo.profile_picture_url;
    await updateUserOnDatabase(userId, { profile_picture_url: finalizedImage.url });

    if (oldProfilePictureUrl) {
      const oldKey = s3Service.getKeyFromPublicUrl(oldProfilePictureUrl);
      await s3Service.deleteFile(oldKey).catch((error) => {
        console.error("Unable to delete previous profile picture", {
          code: error.code || "STORAGE_DELETE_FAILED",
        });
      });
    }

    job.progress("Upload complete!");
    completed = true;
    return s3Service.generateSecureUrl(finalizedImage.key);
  } catch (error) {
    const failure = safeUploadFailure(error.message);
    shouldCleanupStaging = failure.permanent;
    if (failure.permanent) job.discard();
    await job.update({
      ...job.data,
      failure: { code: failure.code, error: failure.error },
    }).catch(() => {});
    if (finalizedImage?.key) {
      await s3Service.deleteFile(finalizedImage.key).catch(() => {});
    }
    logDiagnostic(error, {
      code: failure.code,
      referenceId,
      context: 'profile image upload worker',
      jobId: job.id,
    });
    throw error; // Propagate error to trigger job failure
  } finally {
    // Cleanup temp files
    await cleanupFiles(tempFiles);
    if (completed || shouldCleanupStaging || isFinalJobAttempt(job)) {
      await s3Service.deleteFile(imageUrl.key).catch(() => {});
    }
  }
});


export { trackUploadQueue, profilePictureUploadQueue };
