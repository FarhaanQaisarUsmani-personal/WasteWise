import { GoogleGenAI, Type } from '@google/genai';
import { collection, addDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { handleFirestoreError, OperationType } from '../firestoreError';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function processReceiptImage(base64Data: string, mimeType: string) {
  if (!auth.currentUser) throw new Error("User not authenticated");

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
          text: "Extract the store name, date, total amount, and a list of items from this receipt. For each item, provide the name, price, and a general category (e.g., Groceries, Electronics, Clothing, Utilities, etc.)."
        }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          storeName: { type: Type.STRING, description: "Name of the store" },
          date: { type: Type.STRING, description: "Date of the receipt in YYYY-MM-DD format" },
          total: { type: Type.NUMBER, description: "Total amount of the receipt" },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                price: { type: Type.NUMBER },
                category: { type: Type.STRING }
              },
              required: ["name"]
            }
          }
        },
        required: ["items"]
      }
    }
  });

  const jsonStr = response.text?.trim() || "{}";
  const parsedData = JSON.parse(jsonStr);

  try {
    await addDoc(collection(db, 'receipts'), {
      userId: auth.currentUser.uid,
      storeName: parsedData.storeName || 'Unknown Store',
      date: parsedData.date ? new Date(parsedData.date).toISOString() : new Date().toISOString(),
      total: parsedData.total || 0,
      items: parsedData.items || [],
      createdAt: new Date().toISOString()
    });
  } catch (dbError) {
    handleFirestoreError(dbError, OperationType.CREATE, 'receipts');
  }
}
