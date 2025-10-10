/**
 * OCR service using Google Cloud Vision API
 */

/**
 * Extract text from image using Google Cloud Vision
 * @param imageBuffer - Image file buffer
 * @returns Extracted text
 */
export async function extractTextFromImage(imageBuffer: Buffer): Promise<string> {
  try {
    // Check if Google Cloud credentials are configured
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.warn('Google Cloud Vision not configured, using mock OCR');
      return 'MOCK OCR: Bill Amount $125.00 Due Date: Dec 31, 2024 Patient Account';
    }

    // Import Vision API client
    const vision = await import('@google-cloud/vision');
    const client = new vision.ImageAnnotatorClient();

    // Perform text detection
    const [result] = await client.textDetection({
      image: { content: imageBuffer }
    });

    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return '';
    }

    // First annotation contains the full text
    const fullText = detections[0].description || '';

    return fullText.trim();
  } catch (error) {
    console.error('OCR error:', error);
    throw new Error('Failed to extract text from image');
  }
}

/**
 * Extract short excerpt from OCR text (first few lines)
 * @param text - Full OCR text
 * @param maxLength - Maximum length (default 500)
 * @returns Short excerpt
 */
export function getShortExcerpt(text: string, maxLength: number = 500): string {
  if (!text) return '';

  // Take first N characters or first few lines
  const lines = text.split('\n').slice(0, 10);
  const excerpt = lines.join('\n');

  return excerpt.substring(0, maxLength);
}
