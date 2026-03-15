import { db } from "../firebase"
import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy
} from "firebase/firestore"

export async function createUser(user) {

  const userRef = doc(db, "users", user.uid)

  await setDoc(userRef, {
    displayName: user.displayName || "",
    email: user.email || "",
    uid: user.uid,
    createdAt: serverTimestamp()
  }, { merge: true })

}

export async function addInventoryItem(userId, item) {

  const inventoryRef = collection(db, "users", userId, "inventory")

  await addDoc(inventoryRef, {
    name: item.name,
    freshness: item.freshness,
    quantity: item.quantity || 1,
    expiryDate: item.expiryDate || null,
    imageUrl: item.imageUrl || null,
    createdAt: serverTimestamp()
  })

}

export async function getInventory(userId) {

  const inventoryRef = collection(db, "users", userId, "inventory")

  const snapshot = await getDocs(inventoryRef)

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))

}

export function listenToInventory(userId, callback) {

  const inventoryRef = collection(db, "users", userId, "inventory")

  return onSnapshot(inventoryRef, snapshot => {

    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))

    callback(items)

  })

}


export async function getWasteLogs(userId) {

  const wasteRef = collection(db, "users", userId, "wasteLogs")

  const snapshot = await getDocs(wasteRef)

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))

}

export async function addReceipt(userId, receipt) {

  await addDoc(collection(db, 'receipts'), {
    userId,
    items: receipt.items || [],
    createdAt: receipt.createdAt || new Date().toISOString(),
    imageUrl: receipt.imageUrl || null
  })

}

export async function addReceiptItemsAsFoodScans(userId, receiptData) {

  const createdAt = receiptData.createdAt || new Date().toISOString()
  const imageUrl = receiptData.imageUrl || null
  const rawItems = Array.isArray(receiptData.items) ? receiptData.items : []

  const uniqueItems = []
  const seen = new Set()

  for (const value of rawItems) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    uniqueItems.push(normalized)
  }

  if (uniqueItems.length === 0) {
    return
  }

  await Promise.all(
    uniqueItems.map((itemName) =>
      addDoc(collection(db, 'food_scans'), {
        userId,
        item: itemName,
        condition: 'Unknown',
        suggestions: [],
        etaRange: null,
        repurposingActions: [],
        createdAt,
        imageUrl,
        source: 'receipt',
        importedFromReceipt: true
      })
    )
  )

}

export async function addFoodScan(userId, foodScan) {

  const docRef = await addDoc(collection(db, 'food_scans'), {
    userId,
    item: foodScan.item || 'Unknown',
    condition: foodScan.condition || 'Unknown',
    salvageStatus: foodScan.salvageStatus || null,
    salvageable: typeof foodScan.salvageable === 'boolean' ? foodScan.salvageable : null,
    suggestions: foodScan.suggestions || [],
    etaRange: foodScan.etaRange || null,
    repurposingActions: foodScan.repurposingActions || [],
    createdAt: foodScan.createdAt || new Date().toISOString(),
    imageUrl: foodScan.imageUrl || null
  })

  return docRef

}

export function listenToReceipts(userId, callback) {

  const qReceipts = query(
    collection(db, 'receipts'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  )

  return onSnapshot(qReceipts, snapshot => {
    const receipts = snapshot.docs.map(doc => ({
      id: doc.id,
      type: 'receipt',
      ...doc.data()
    }))
    callback(receipts)
  })

}

export function listenToFoodScans(userId, callback) {

  const qFood = query(
    collection(db, 'food_scans'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  )

  return onSnapshot(qFood, snapshot => {
    const foodScans = snapshot.docs.map(doc => ({
      id: doc.id,
      type: 'food',
      ...doc.data()
    }))
    callback(foodScans)
  })

}

export function listenToWasteLogs(userId, callback) {

  const qWaste = query(
    collection(db, 'waste_logs'),
    where('userId', '==', userId),
    orderBy('timestamp', 'desc')
  )

  return onSnapshot(qWaste, snapshot => {
    const wasteLogs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    callback(wasteLogs)
  }, () => {
    // waste_logs collection may not exist yet — silently ignore
  })

}

export async function addWasteLog(wasteLog) {

  await addDoc(collection(db, 'waste_logs'), {
    userId: wasteLog.userId,
    item: wasteLog.item,
    co2Impact: wasteLog.co2Impact,
    timestamp: wasteLog.timestamp
  })

}