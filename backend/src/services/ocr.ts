import { createVisionClient } from '../config/googleVisionClient.js';
import vision from '@google-cloud/vision';

let visionClient: vision.ImageAnnotatorClient | null = null;

try {
  // Only instantiate if credentials are present; this allows local dev without GCP config.
  visionClient = createVisionClient();
} catch (error) {
  visionClient = null;
  console.warn('[OCR] Google Vision client not initialized:', (error as Error).message);
}

/**
 * Extract full text from an image buffer using Google Cloud Vision.
 * Throws if the Vision client is unavailable.
 */
export async function extractTextFromImage(buffer: Buffer): Promise<string> {
  if (!visionClient) {
    throw new Error('Google Cloud Vision is not configured');
  }

  const [result] = await visionClient.documentTextDetection({ image: { content: buffer } });

  const fullText = result.fullTextAnnotation?.text;
  if (!fullText) {
    return '';
  }

  return fullText;
}

/**
 * Reduce large OCR payloads to a short excerpt for previews/logging.
 */
export function getShortExcerpt(text: string, maxLength = 280): string {
  if (!text) {
    return '';
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}
