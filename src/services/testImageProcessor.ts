import { GoogleGenAI, Type } from '@google/genai';
import { auth } from '../firebase';

export interface ProcessResult {
  type: 'receipt' | 'food' | 'unknown';
  data: {
    items?: string[];        // Extraction for Receipts
    item?: string;          // Detection for Food (YOLOv8 Slot)
    ripeness?: string;      // State for Food (YOLOv8 Slot)
    confidence?: number;    // Accuracy for Food (YOLOv8 Slot)
    advice?: {              // Reasoning Layer
      recipe: string;
      preservation: string;
      co2Impact: number;
      expiryReasoning: string;
    };
    message?: string;       // Feedback for Unknown
  };
}

export async function processImage(base64Data: string, mimeType: string): Promise<ProcessResult> {
  if (!auth.currentUser) throw new Error("User not authenticated");

  // Check if API key is set
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your-api-key-here') {
    console.warn('Test service - No valid Gemini API key found, falling back to mock response');
    return getMockResponse(base64Data, mimeType);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `You are the image analysis AI for the WasteWise application. Your job is to analyze images captured from a phone camera and determine whether the image contains a grocery receipt or food.
Always follow this process:
Step 1: Classify the Image
Analyze the image and determine which category it belongs to:
Receipt
A printed or digital grocery receipt showing purchased items.
Contains store name, item list, prices, totals, or transaction details.
Food Item
A fruit, vegetable, packaged food, cooked food, or ingredient.
The image may show fresh food, spoiled food, or food in a kitchen environment.
Unknown
If the image does not clearly show a receipt or food item.
Return the classification first.

Step 2: If the Image is a Receipt
Extract all identifiable food-related items listed on the receipt.
Rules:
Ignore prices, totals, taxes, and store information.
Focus only on food products.
Clean the item names (remove codes, numbers, abbreviations if possible).
If multiple quantities appear, list the item once.
Return:
A structured list of detected food items.

Step 3: If the Image is Food
Identify the food item in the image.
If possible:
Name the food
Detect if it appears fresh, ripe, or overripe/spoiling
If the food appears close to spoiling:
Suggest ways the user can use it instead of wasting it.

Step 4: If the Image is Unknown
Return:
type: unknown
message: Could not detect food or a receipt. Please try scanning again.

Behavioral Rules
Prioritize accuracy over guessing.
If unsure between receipt and food, choose unknown.
Do not invent items not visible in the image.
Always return structured JSON-style responses.`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: prompt
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });
    console.log('Test service - API call successful, response received');
  } catch (apiError) {
    console.error('Test service - API call failed:', apiError);
    return {
      type: 'unknown',
      data: { message: 'API call failed. Check your API key and quota.' }
    };
  }

  let jsonStr = response.text?.trim() || "{}";
  console.log('Test service - Raw Gemini response:', jsonStr);
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```\n?/, '').replace(/```\n?$/, '').trim();
  }

  let parsedData: any;
  try {
    parsedData = JSON.parse(jsonStr);
    console.log('Test service - Parsed Gemini response:', parsedData);
  } catch (e) {
    console.error("Failed to parse JSON from Gemini:", jsonStr);
    parsedData = { type: 'unknown', message: 'Failed to process image format.' };
  }

  // Convert to the nested data structure expected by the app
  const result: ProcessResult = {
    type: parsedData.type,
    data: {}
  };

  if (parsedData.type === 'receipt') {
    result.data.items = parsedData.items || [];
  } else if (parsedData.type === 'food') {
    result.data.item = parsedData.item;
    result.data.ripeness = parsedData.condition;
    result.data.confidence = 0.9;
    // For now, skip advice generation to keep it simple
  } else if (parsedData.type === 'unknown') {
    result.data.message = parsedData.message;
  }

  return result;
}

// Mock fallback for when API key is invalid or API fails
function getMockResponse(base64Data: string, mimeType: string): ProcessResult {
  console.log('Using mock response due to API issues');

  // Simple mock logic - alternate between receipt and food
  const mockResults: ProcessResult[] = [
    {
      type: 'receipt',
      data: {
        items: ['Apple', 'Banana', 'Milk', 'Bread'],
        confidence: 0.9
      }
    },
    {
      type: 'food',
      data: {
        item: 'Apple',
        ripeness: 'fresh',
        confidence: 0.85
      }
    },
    {
      type: 'food',
      data: {
        item: 'Banana',
        ripeness: 'ripe',
        confidence: 0.92
      }
    }
  ];

  // Use base64 length as a simple hash to choose different responses
  const index = base64Data.length % mockResults.length;
  return mockResults[index];
}