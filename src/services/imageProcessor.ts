import { GoogleGenAI } from '@google/genai'; // Correct for version 1.29.0
import { auth } from '../firebase';

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

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
  // @google/genai uses ai.models.generateContent directly
  const response = await ai.models.generateContent({
    model: 'gemini-1.5-flash',
    contents: [
      {
        parts: [
          { text: "Classify this image as 'receipt', 'food', or 'unknown'. If 'receipt', list items. If 'food', name the item and ripeness. Return JSON: { \"type\": \"receipt\"|\"food\"|\"unknown\", \"item\": \"\", \"ripeness\": \"\", \"items\": [] }" },
          { inlineData: { data: base64Data, mimeType } }
        ]
      }
    ],
    config: { responseMimeType: 'application/json' }
  });
  
  return JSON.parse(response.text || '{}');
}

/**
 * PHASE 2: REASONING & ENRICHMENT
 * Gemini provides the logic based on the vision result.
 * FUTURE: Integrate Yellowcake here for real-world CO2 and expiration data.
 */
async function getLogicAdvice(item: string, condition: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-1.5-flash',
    contents: [`User has ${condition} ${item}. Provide 1 recipe, 1 preservation tip, CO2 impact (kg), and expiry reasoning in JSON.`],
    config: { responseMimeType: 'application/json' }
  });

  return JSON.parse(response.text || '{}');
}

export async function processImage(base64Data: string, mimeType: string): Promise<ProcessResult> {
  if (!auth.currentUser) throw new Error("Unauthorized");

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
}