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

// Mock data pools
const mockReceipts = [
  { items: ["Apple", "Banana", "Milk", "Bread"] },
  { items: ["Orange", "Cheese", "Tomato", "Chicken"] },
  { items: ["Carrot", "Potato", "Eggs", "Rice"] },
  { items: ["Strawberry", "Yogurt", "Pasta", "Beef"] }
];

const mockFoods = [
  { item: "Apple", ripeness: "fresh", confidence: 0.92 },
  { item: "Banana", ripeness: "ripe", confidence: 0.88 },
  { item: "Tomato", ripeness: "overripe", confidence: 0.75 },
  { item: "Orange", ripeness: "fresh", confidence: 0.95 }
];

const mockAdvice = [
  {
    recipe: "Make a fresh fruit salad with yogurt dressing",
    preservation: "Store in refrigerator crisper drawer",
    co2Impact: 0.5,
    expiryReasoning: "Fresh produce lasts 5-7 days in fridge"
  },
  {
    recipe: "Bake banana bread or make smoothies",
    preservation: "Keep at room temperature until ripe, then refrigerate",
    co2Impact: 0.3,
    expiryReasoning: "Ripe bananas last 2-3 days, brown spots indicate ripeness"
  },
  {
    recipe: "Use in pasta sauce or fresh salsa",
    preservation: "Store stem-side down at room temperature",
    co2Impact: 0.4,
    expiryReasoning: "Tomatoes last 5-7 days at room temperature"
  },
  {
    recipe: "Make orange juice or add to salads",
    preservation: "Store in refrigerator for up to 2 weeks",
    co2Impact: 0.6,
    expiryReasoning: "Oranges last 2-3 weeks in cool storage"
  }
];

/**
 * PHASE 1: VISION GATEWAY (MOCK)
 * Simulates vision analysis without API calls
 */
async function runVision(base64Data: string, mimeType: string) {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

  // Randomly choose type (weighted towards success for testing)
  const rand = Math.random();
  let type: 'receipt' | 'food' | 'unknown';
  let data: any = {};

  if (rand < 0.1) {
    type = 'unknown';
  } else if (rand < 0.55) {
    type = 'receipt';
    data = mockReceipts[Math.floor(Math.random() * mockReceipts.length)];
  } else {
    type = 'food';
    data = mockFoods[Math.floor(Math.random() * mockFoods.length)];
  }

  console.log('Mock vision result:', { type, ...data }); // Debug log
  return { type, ...data };
}

/**
 * PHASE 2: REASONING & ENRICHMENT (MOCK)
 * Simulates advice generation without API calls
 */
async function getLogicAdvice(item: string, condition: string) {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

  // Find matching advice or use random
  const foodIndex = mockFoods.findIndex(f => f.item.toLowerCase() === item.toLowerCase());
  const advice = foodIndex >= 0 ? mockAdvice[foodIndex] : mockAdvice[Math.floor(Math.random() * mockAdvice.length)];

  console.log('Mock advice result:', advice); // Debug log
  return advice;
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
    console.error('Error in mock processImage:', error);
    return { type: 'unknown', data: { message: "Failed to process image. Try again." } };
  }
}