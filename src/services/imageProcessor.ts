import { GoogleGenAI } from '@google/genai';
import { auth } from '../firebase';

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

/**
 * PHASE 1: VISION GATEWAY
 * Currently handles both receipts and food identification.
 * FUTURE: Swap the 'food' logic for a local YOLOv8 API call.
 */
async function runVision(base64Data: string, mimeType: string) {
  try {
    // @google/genai uses ai.models.generateContent directly
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          parts: [
            { text: `Analyze this image and classify it as one of: 'receipt', 'food', or 'unknown'.

If it's a receipt (grocery store receipt, invoice, etc.), extract the list of purchased items as an array of strings.

If it's food (fruit, vegetable, etc.), identify the main food item and estimate its ripeness level (e.g., 'fresh', 'ripe', 'overripe', 'rotten').

If neither, classify as 'unknown'.

Respond ONLY with valid JSON in this exact format:
{
  "type": "receipt" | "food" | "unknown",
  "items": ["item1", "item2"]  // only for receipts
  "item": "food name",         // only for food
  "ripeness": "ripeness level" // only for food
}` },
            { inlineData: { data: base64Data, mimeType } }
          ]
        }
      ],
      config: { responseMimeType: 'application/json' }
    });
    
    const text = response.text || '{}';
    console.log('Gemini response:', text); // Debug log
    return JSON.parse(text);
  } catch (error) {
    console.error('Error in runVision:', error);
    return { type: 'unknown' };
  }
}

/**
 * PHASE 2: REASONING & ENRICHMENT
 * Gemini provides the logic based on the vision result.
 * FUTURE: Integrate Yellowcake here for real-world CO2 and expiration data.
 */
async function getLogicAdvice(item: string, condition: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [`User has ${condition} ${item}. Provide 1 recipe suggestion, 1 preservation tip, estimated CO2 impact in kg, and expiry reasoning. Respond in JSON: { "recipe": "string", "preservation": "string", "co2Impact": number, "expiryReasoning": "string" }`],
      config: { responseMimeType: 'application/json' }
    });

    const text = response.text || '{}';
    console.log('Advice response:', text); // Debug log
    return JSON.parse(text);
  } catch (error) {
    console.error('Error in getLogicAdvice:', error);
    return {
      recipe: "Unable to generate recipe",
      preservation: "Store properly",
      co2Impact: 0,
      expiryReasoning: "Check regularly"
    };
  }
}

export async function processImage(base64Data: string, mimeType: string): Promise<ProcessResult> {
  if (!auth.currentUser) throw new Error("Unauthorized");

  try {
    // Step 1: Vision Analysis
    const vision = await runVision(base64Data, mimeType);

    if (vision.type === 'unknown') {
      return { type: 'unknown', data: { message: "Could not detect food or receipt." } };
    }

    // Step 2: Reasoning & Decoration
    let advice;
    const target = vision.item || (vision.items && vision.items[0]);
    if (target) {
      advice = await getLogicAdvice(target, vision.ripeness || "fresh");
    }

    return {
      type: vision.type,
      data: { ...vision, advice }
    };
  } catch (error) {
    console.error('Error in processImage:', error);
    return { type: 'unknown', data: { message: "Failed to process image. Check API key and try again." } };
  }
}