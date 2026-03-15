import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(import.meta.env.GEMINI_API_KEY || '');

function getModel() {
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

export async function estimateCO2Impact(item: string): Promise<number> {
  const model = getModel();
  const prompt =
    `You are a food waste environmental impact calculator. ` +
    `For the food item "${item}", estimate the CO2 equivalent (in kg) wasted ` +
    `when a typical household portion is thrown away. ` +
    `Consider production, transportation, and decomposition emissions. ` +
    `Return ONLY valid JSON: {"co2Impact": <number>}. No other text.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const parsed = JSON.parse(text);
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

  const prompt =
    `You are a creative chef helping reduce food waste. ` +
    `The user has these ingredients: ${ingredientList}. ` +
    `Suggest ONE simple recipe using some or all of these ingredients. ` +
    `Prioritize ingredients that are aging or overripe to reduce waste. ` +
    `Return ONLY valid JSON: ` +
    `{"recipeName": string, "ingredients": string[], "instructions": string, "prepTime": string}. ` +
    `Keep instructions concise (2-4 sentences). No other text.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const parsed = JSON.parse(text);
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

  const prompt =
    `You are a food freshness expert. ` +
    `Today is ${today}. A "${item}" was scanned and its condition is "${condition}". ` +
    `Estimate the date this item will expire or become unsafe to eat. ` +
    `Return ONLY valid JSON: {"expiryDate": "YYYY-MM-DD"}. No other text.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const parsed = JSON.parse(text);
  if (typeof parsed.expiryDate === 'string') {
    return parsed.expiryDate;
  }
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 3);
  return fallback.toISOString().split('T')[0];
}
