  // utils/audioService.js
  import * as mm from 'music-metadata';
  import path from 'path';
  import fs from 'fs';
import { normalizeAudioType } from '../utils/mediaTypes.js';
import { getUploadConstraints } from '../utils/uploadConstraints.js';

  // Keep browser MIME aliases and worker extensions on one canonical set.
  const CONTAINER_TYPES = {
    aac: 'aac',
    adts: 'aac',
    mpeg: 'mp3',
    'mpeg-4': 'm4a',
    mp4: 'm4a',
    ogg: 'ogg',
    wave: 'wav',
    wav: 'wav',
  };

  function validSoundTypes() {
    return [
      ...new Set(
        getUploadConstraints().audio.allowedTypes
          .map(normalizeAudioType)
          .filter(Boolean),
      ),
    ];
  }

  export class AudioService {
    async analyzeFile(filePath) {
      try {
        const metadata = await mm.parseFile(filePath);
        
        if (!metadata.format) {
          throw new Error('Invalid audio file format');
        }

        return {
          duration: Math.floor(metadata.format.duration || 0),
          codec: metadata.format.codec,
          sampleRate: metadata.format.sampleRate,
          bitrate: metadata.format.bitrate,
          format: metadata.format.container,
          channels: metadata.format.numberOfChannels,
          tags: metadata.common
        };
      } catch (error) {
        console.error('Error analyzing audio file:', error);
        throw new Error(`Failed to analyze audio file: ${error.message}`);
      }
    }

    async validateAudio(filePath) {
      try {
        // Check file size first
        const stats = await fs.promises.stat(filePath);
        const constraints = getUploadConstraints().audio;
        if (stats.size > constraints.maxBytes) {
          return {
            isValid: false,
            error: `Audio file exceeds the ${constraints.maxBytes / (1024 * 1024)} MiB limit`
          };
        }

        // Analyze file metadata
        const metadata = await this.analyzeFile(filePath);
        const detectedType = this.getDetectedFileType(metadata);
        if (!validSoundTypes().includes(detectedType)) {
          if (!detectedType || detectedType === 'unknown') {
            return {
              isValid: false,
              error: 'Invalid audio file structure',
            };
          }
          return {
            isValid: false,
            error: `Unsupported audio format. Allowed formats: ${validSoundTypes().join(', ')}`,
          };
        }
        
        // Check duration
        if (metadata.duration > constraints.maxDurationSeconds) {
          return {
            isValid: false,
            error: `Audio duration exceeds maximum allowed length of ${constraints.maxDurationSeconds / 60} minutes`
          };
        }
    
        // Additional validation for audio integrity
        if (!metadata.sampleRate || !metadata.channels) {
          return {
            isValid: false,
            error: 'Invalid audio file structure'
          };
        }
    
        return {
          isValid: true,
          metadata: this.normalizeMetadata(metadata, filePath, detectedType)
        };
      } catch (error) {
        return {
          isValid: false,
          error: `Failed to validate audio file: ${error.message}`
        };
      }
    }

    getFileType(filePath) {
      const extension = normalizeAudioType(
        path.extname(filePath).toLowerCase().substring(1)
      );
      return validSoundTypes().includes(extension) ? extension : 'other';
    }

    getDetectedFileType(metadata) {
      const container = String(metadata?.format || '').trim().toLowerCase();
      if (container.includes('m4a') || container.includes('mp4') || container.includes('isom')) return 'm4a';
      if (container.includes('adts') || container.includes('aac')) return 'aac';
      if (container.includes('mpeg')) return 'mp3';
      if (container.includes('wave') || container === 'wav') return 'wav';
      if (container.includes('ogg')) return 'ogg';
      return CONTAINER_TYPES[container] || normalizeAudioType(container);
    }

    normalizeMetadata(metadata, filePath, detectedType = null) {
      const soundType = detectedType || this.getDetectedFileType(metadata) || this.getFileType(filePath);

      return {
        duration: metadata.duration,
        format: soundType,
        sampleRate: metadata.sampleRate,
        bitrate: metadata.bitrate,
        channels: metadata.channels,
        title: metadata.tags?.title,
        artist: metadata.tags?.artist,
        album: metadata.tags?.album,
        year: metadata.tags?.year
      };
    }
  }

  export const audioService = new AudioService();
