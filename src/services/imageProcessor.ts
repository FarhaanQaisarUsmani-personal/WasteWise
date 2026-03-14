import { GoogleGenAI, Type } from '@google/genai';
import { collection, addDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { handleFirestoreError, OperationType } from '../firestoreError';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ProcessResult {
  type: 'receipt' | 'food' | 'unknown';
  items?: string[];
  item?: string;
  condition?: string;
  suggestions?: string[];
  message?: string;
}

export async function processImage(base64Data: string, mimeType: string): Promise<ProcessResult> {
  if (!auth.currentUser) throw new Error("User not authenticated");

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

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
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
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: "'receipt', 'food', or 'unknown'" },
          items: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of food items if type is receipt"
          },
          item: { type: Type.STRING, description: "Name of the food if type is food" },
          condition: { type: Type.STRING, description: "Condition of the food if type is food" },
          suggestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Suggestions for using the food if it is spoiling"
          },
          message: { type: Type.STRING, description: "Error message if type is unknown" }
        },
        required: ["type"]
      }
    }
  });

  const jsonStr = response.text?.trim() || "{}";
  const parsedData = JSON.parse(jsonStr) as ProcessResult;

  try {
    if (parsedData.type === 'receipt') {
      await addDoc(collection(db, 'receipts'), {
        userId: auth.currentUser.uid,
        items: parsedData.items || [],
        createdAt: new Date().toISOString()
      });
    } else if (parsedData.type === 'food') {
      await addDoc(collection(db, 'food_scans'), {
        userId: auth.currentUser.uid,
        item: parsedData.item || 'Unknown Food',
        condition: parsedData.condition || 'Unknown',
        suggestions: parsedData.suggestions || [],
        createdAt: new Date().toISOString()
      });
    }
  } catch (dbError) {
    handleFirestoreError(dbError, OperationType.CREATE, parsedData.type === 'receipt' ? 'receipts' : 'food_scans');
  }

  return parsedData;
}
