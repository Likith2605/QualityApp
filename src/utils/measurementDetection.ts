/**
 * Measurement Detection Utility
 * 
 * This module provides OCR-based measurement detection from PDF drawings.
 * Currently uses placeholder data - integrate with Tesseract or similar OCR for production.
 * 
 * Future enhancements:
 * - Tesseract React Native integration
 * - Google Vision API integration
 * - PDF text extraction with position tracking
 * - Measurement line/arrow detection
 */

export interface DetectedMeasurement {
  id: number;
  dimNo: number;
  description: string;
  nominal: number;
  tolUpper: number;
  tolLower: number;
  position: {
    x: number;
    y: number;
  };
  sampleCount: number;
  samples: number[];
}

export interface OCRConfig {
  /**
   * OCR engine to use
   * 'tesseract' | 'google-vision' | 'aws-textract'
   */
  engine: 'tesseract' | 'google-vision' | 'aws-textract' | 'placeholder';

  /**
   * PDF page to analyze (1-indexed)
   */
  pageNumber: number;

  /**
   * Scale factor for the PDF page rendering
   */
  scale: number;
}

/**
 * Detect measurements from a PDF page using OCR
 * @param pdfUri URI of the PDF file
 * @param config OCR configuration
 * @returns Detected measurements with positions
 */
export async function detectMeasurementsFromPDF(
  pdfUri: string,
  config: OCRConfig
): Promise<DetectedMeasurement[]> {
  // TODO: Implement actual OCR integration
  // For now, return placeholder measurements based on dimensions

  console.log(`OCR detection called for ${pdfUri} using ${config.engine}`);

  // Placeholder: Return measurements based on common dimension patterns
  const placeholderMeasurements: DetectedMeasurement[] = [
    {
      id: 1,
      dimNo: 1,
      description: 'Overall Length',
      nominal: 100,
      tolUpper: 0.5,
      tolLower: -0.5,
      position: { x: 100, y: 150 },
      sampleCount: 5,
      samples: [95, 101, 98, 102, 99],
    },
    {
      id: 2,
      dimNo: 2,
      description: 'Width',
      nominal: 50,
      tolUpper: 0.2,
      tolLower: -0.2,
      position: { x: 200, y: 300 },
      sampleCount: 5,
      samples: [48, 52, 50, 51, 49],
    },
    {
      id: 3,
      dimNo: 3,
      description: 'Hole Diameter',
      nominal: 20,
      tolUpper: 0.1,
      tolLower: -0.1,
      position: { x: 300, y: 100 },
      sampleCount: 5,
      samples: [19.8, 20.1, 20.0, 19.9, 20.2],
    },
  ];

  // Simulate OCR processing time
  await new Promise(resolve => setTimeout(resolve, 1500));

  return placeholderMeasurements;
}

/**
 * Extract text positions from a PDF page
 * @param pdfUri URI of the PDF file
 * @param pageNumber Page number to extract (1-indexed)
 * @returns Text items with positions
 */
export async function extractTextPositionsFromPDF(
  pdfUri: string,
  pageNumber: number
): Promise<{ text: string; x: number; y: number; width: number; height: number }[]> {
  // TODO: Implement actual PDF text extraction
  // For now, return empty array - integrate with PDF library for production

  console.log(`Text extraction called for ${pdfUri}, page ${pageNumber}`);

  return [];
}

/**
 * Parse measurement text from OCR results
 * @param ocrText Raw OCR text
 * @returns Parsed measurement data
 */
export function parseMeasurementText(ocrText: string): {
  nominal: number;
  tolUpper: number;
  tolLower: number;
} | null {
  // Try to parse common measurement patterns
  const patterns = [
    /dim\s*(\d+)\s*[\:\|]\s*([\d.]+)\s*\+\-?\s*([\d.]+)/i,
    /(\d+(?:\.\d+)?)\s*[\+\-]\s*(\d+(?:\.\d+)?)\s*\/(\d+(?:\.\d+)?)/,
    /(\d+(?:\.\d+)?)\s*[xX]\s*([\d.]+)/,
  ];

  for (const pattern of patterns) {
    const match = ocrText.match(pattern);
    if (match) {
      // Try to extract nominal and tolerances
      const nominal = parseFloat(match[1] || match[2] || '0');
      const tolUpper = parseFloat(match[3] || '0.1');
      const tolLower = parseFloat(match[4] || '0.1');

      if (!isNaN(nominal)) {
        return { nominal, tolUpper: isNaN(tolUpper) ? 0.1 : tolUpper, tolLower: isNaN(tolLower) ? -0.1 : tolLower };
      }
    }
  }

  return null;
}

/**
 * Get sample measurements for a dimension
 * @param nominal Base measurement value
 * @param tolerance Tolerance range
 * @param count Number of samples
 * @returns Random samples within tolerance
 */
export function generateSampleMeasurements(
  nominal: number,
  tolerance: number,
  count: number = 5
): number[] {
  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    const variation = (Math.random() - 0.5) * tolerance * 2;
    samples.push(Number((nominal + variation).toFixed(3)));
  }
  return samples;
}

export default {
  detectMeasurementsFromPDF,
  extractTextPositionsFromPDF,
  parseMeasurementText,
  generateSampleMeasurements,
};