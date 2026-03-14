export interface ProcessResult {
  type: 'receipt' | 'food' | 'unknown';
  items?: string[];
  item?: string;
  condition?: string;
  suggestions?: string[];
  message?: string;
  confidence?: number;
  conditionConfidence?: number;
  topPredictions?: Array<{
    label: string;
    confidence: number;
  }>;
}

export async function processImage(base64Data: string, mimeType: string): Promise<ProcessResult> {
  let response: Response;

  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Data,
        mimeType,
      }),
    });
  } catch (error) {
    console.error('Analyzer request failed:', error);
    throw new Error('The local model API is not running. Start the app with npm run dev and scan again.');
  }

  let responseData: ProcessResult | { detail?: string } = { type: 'unknown' };
  try {
    responseData = await response.json();
  } catch (error) {
    console.error('Failed to parse analyzer response:', error);
  }

  if (!response.ok) {
    const detail = 'detail' in responseData ? responseData.detail : undefined;
    throw new Error(detail || 'The local analyzer could not process the image.');
  }

  const parsedResult = responseData as ProcessResult;

  return {
    type: parsedResult.type ?? 'unknown',
    items: parsedResult.items,
    item: parsedResult.item,
    condition: parsedResult.condition,
    suggestions: parsedResult.suggestions,
    message: parsedResult.message,
    confidence: parsedResult.confidence,
    conditionConfidence: parsedResult.conditionConfidence,
    topPredictions: parsedResult.topPredictions,
  };
}
