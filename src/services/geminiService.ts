import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || '');

function getModel() {
  // Use generationConfig to force JSON output
  return genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: "application/json",
    }
  });
}

/**
 * Helper to safely parse JSON even if the model 
 * somehow sneaks in markdown backticks.
 */
function safeParseJSON(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

export async function estimateCO2Impact(item: string): Promise<number> {
  const model = getModel();
  const prompt = `Estimate the CO2 equivalent (in kg) for one household portion of "${item}". 
                  Return JSON: {"co2Impact": number}`;

  const result = await model.generateContent(prompt);
  const parsed = safeParseJSON(result.response.text());
  return typeof parsed.co2Impact === 'number' ? parsed.co2Impact : 0.1;
}

export interface Recipe {
  recipeName: string;
  ingredients: string[];
  instructions: string;
  prepTime: string;
}

export async function generateRecipe(
  ingredients: { name: string; condition: string }[]
): Promise<Recipe> {
  const model = getModel();
  const ingredientList = ingredients
    .map((i) => `${i.name} (${i.condition})`)
    .join(', ');

  const prompt = `User has: ${ingredientList}. Suggest ONE simple recipe to reduce waste. 
                  Return JSON: {"recipeName": string, "ingredients": string[], "instructions": string, "prepTime": string}`;

  const result = await model.generateContent(prompt);
  const parsed = safeParseJSON(result.response.text());
  
  return {
    recipeName: parsed.recipeName || 'Recipe',
    ingredients: parsed.ingredients || [],
    instructions: parsed.instructions || '',
    prepTime: parsed.prepTime || '15 min',
  };
}

export async function estimateExpiry(
  item: string,
  condition: string
): Promise<string> {
  const model = getModel();
  const today = new Date().toISOString().split('T')[0];

  const prompt = `Today is ${today}. Item "${item}" condition is "${condition}". 
                  Estimate expiry date. Return JSON: {"expiryDate": "YYYY-MM-DD"}`;

  const result = await model.generateContent(prompt);
  const parsed = safeParseJSON(result.response.text());
  
  if (typeof parsed.expiryDate === 'string') {
    return parsed.expiryDate;
  }
  
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 3);
  return fallback.toISOString().split('T')[0];
}