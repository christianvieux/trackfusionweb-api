// utils/imageService.js
import sharp from 'sharp';
import fs from 'fs/promises';
import { getUploadConstraints } from '../utils/uploadConstraints.js';

const FORMAT_ALIASES = { jpg: 'jpeg', heic: 'heif' };
export const TRACK_ARTWORK_MAX_DIMENSION = 1200;
export const TRACK_ARTWORK_QUALITY = 82;

function normalizedAllowedFormats() {
  return new Set(
    getUploadConstraints().image.allowedTypes.map((type) => {
      const format = type.replace(/^image\//, '');
      return FORMAT_ALIASES[format] || format;
    }),
  );
}

export class ImageService {
  async analyzeFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      
      // Check file size first
      const constraints = getUploadConstraints().image;
      if (stats.size > constraints.maxBytes) {
        throw new Error(`Image file exceeds the ${constraints.maxBytes / (1024 * 1024)} MiB limit`);
      }

      const metadata = await sharp(filePath, {
        limitInputPixels: constraints.maxPixels,
      }).metadata();
      
      if (!metadata) {
        throw new Error('Invalid image file format');
      }

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        space: metadata.space,
        channels: metadata.channels,
        depth: metadata.depth,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
        size: stats.size
      };
    } catch (error) {
      console.error('Error analyzing image file:', error);
      throw new Error(`Failed to analyze image file: ${error.message}`);
    }
  }

  async validateImage(filePath, options = {}) {
    const constraints = getUploadConstraints().image;
    const {
      minWidth = constraints.minWidth,
      minHeight = constraints.minHeight,
      maxDimension = constraints.maxDimension,
      maxPixels = constraints.maxPixels,
      aspectRatio = null
    } = options;

    try {
      const metadata = await this.analyzeFile(filePath);
      const fileType = FORMAT_ALIASES[metadata.format] || metadata.format;
      if (!normalizedAllowedFormats().has(fileType)) {
        throw new Error('Unsupported image format');
      }

      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image dimensions');
      }

      // Validate dimensions
      if (metadata.width < minWidth || metadata.height < minHeight) {
        throw new Error(`Image dimensions too small. Minimum size is ${minWidth}x${minHeight} pixels`);
      }

      const decodedPixels = metadata.width * metadata.height;
      if (
        metadata.width > maxDimension ||
        metadata.height > maxDimension ||
        decodedPixels > maxPixels
      ) {
        throw new Error(`Image dimensions exceed the safe ${maxPixels} pixel limit`);
      }

      // Validate aspect ratio if specified
      if (aspectRatio) {
        const imageRatio = metadata.width / metadata.height;
        const tolerance = 0.1; // 10% tolerance for aspect ratio
        
        if (Math.abs(imageRatio - aspectRatio) > tolerance) {
          throw new Error('Image does not match required aspect ratio');
        }
      }

      return {
        isValid: true,
        metadata,
        fileType
      };
    } catch (error) {
      return {
        isValid: false,
        error: error.message
      };
    }
  }

  async normalizeImage(filePath, options = {}) {
    const {
      targetWidth = 800,
      targetHeight = 800,
      quality = 80,
      format = 'jpeg'
    } = options;

    try {
      let image = sharp(filePath, {
        limitInputPixels: getUploadConstraints().image.maxPixels,
      });
      const metadata = await image.metadata();

      // Resize image while maintaining aspect ratio
      image = image.resize(targetWidth, targetHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

      // Convert format if necessary
      if (format) {
        image = image[format]({
          quality,
          chromaSubsampling: '4:4:4'
        });
      }

      return {
        processor: image,
        metadata: {
          originalFormat: metadata.format,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          targetFormat: format,
          targetWidth,
          targetHeight
        }
      };
    } catch (error) {
      console.error('Error normalizing image:', error);
      throw new Error(`Failed to normalize image: ${error.message}`);
    }
  }

  async processForProfile(filePath, outputPath) {
    try {
      const { processor } = await this.normalizeImage(filePath, {
        targetWidth: 400,
        targetHeight: 400,
        quality: 85,
        format: 'jpeg'
      });

      await processor.toFile(outputPath);

      return {
        success: true,
        path: outputPath
      };
    } catch (error) {
      console.error('Error processing profile image:', error);
      throw new Error(`Failed to process profile image: ${error.message}`);
    }
  }

  async processForTrackArtwork(filePath, outputPath) {
    try {
      const output = await sharp(filePath, {
        limitInputPixels: getUploadConstraints().image.maxPixels,
      })
        .rotate()
        .resize(TRACK_ARTWORK_MAX_DIMENSION, TRACK_ARTWORK_MAX_DIMENSION, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: TRACK_ARTWORK_QUALITY })
        .toFile(outputPath);

      return {
        success: true,
        path: outputPath,
        width: output.width,
        height: output.height,
        size: output.size,
        format: output.format,
      };
    } catch (error) {
      console.error("Error processing track artwork:", error);
      throw new Error(`Failed to process track artwork: ${error.message}`);
    }
  }
}

export const imageService = new ImageService();
