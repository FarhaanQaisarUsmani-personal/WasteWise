import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, addDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { handleFirestoreError, OperationType } from '../firestoreError';
import { ArrowLeft, Receipt, ShoppingBag, TrendingUp, UploadCloud, Loader2, Sun, Moon, Apple } from 'lucide-react';
import { motion } from 'motion/react';
import { processImage } from '../services/imageProcessor';
import { useTheme } from '../components/ThemeProvider';
import Logo from '../components/Logo';

interface ReceiptData {
  id: string;
  type: 'receipt';
  items: string[];
  createdAt: string;
}

interface FoodScanData {
  id: string;
  type: 'food';
  item: string;
  condition: string;
  suggestions: string[];
  createdAt: string;
}

type ActivityData = ReceiptData | FoodScanData;

export default function Dashboard() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    const qReceipts = query(
      collection(db, 'receipts'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );

    const qFood = query(
      collection(db, 'food_scans'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );

    let receiptsData: ReceiptData[] = [];
    let foodData: FoodScanData[] = [];

    const updateActivities = () => {
      const combined = [...receiptsData, ...foodData].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setActivities(combined);
      setLoading(false);
    };

    const unsubReceipts = onSnapshot(qReceipts, (snapshot) => {
      receiptsData = snapshot.docs.map(doc => ({ id: doc.id, type: 'receipt', ...doc.data() } as ReceiptData));
      updateActivities();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'receipts');
      setLoading(false);
    });

    const unsubFood = onSnapshot(qFood, (snapshot) => {
      foodData = snapshot.docs.map(doc => ({ id: doc.id, type: 'food', ...doc.data() } as FoodScanData));
      updateActivities();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'food_scans');
      setLoading(false);
    });

    return () => {
      unsubReceipts();
      unsubFood();
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await processImage(base64Data, file.type);
      if (res.type === 'unknown') {
        alert(res.message || 'Could not detect food or a receipt.');
      } else {
        if (auth.currentUser) {
          const userId = auth.currentUser.uid;
          const now = new Date().toISOString();
          try {
            if (res.type === 'receipt') {
              await addDoc(collection(db, 'receipts'), {
                userId,
                items: res.items || [],
                createdAt: now
              });
            } else if (res.type === 'food') {
              await addDoc(collection(db, 'food_scans'), {
                userId,
                item: res.item || 'Unknown',
                condition: res.condition || 'Unknown',
                suggestions: res.suggestions || [],
                createdAt: now
              });
            }
          } catch (saveErr) {
            console.error("Error saving upload to Firestore:", saveErr);
            alert("Processed successfully, but failed to save to dashboard.");
          }
        }
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Failed to process the uploaded image. Please try again.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const totalReceipts = activities.filter(a => a.type === 'receipt').length;
  const totalFoodScans = activities.filter(a => a.type === 'food').length;
  const totalItems = activities.reduce((sum, a) => {
    if (a.type === 'receipt') return sum + (a.items?.length || 0);
    return sum + 1; // food scan counts as 1 item
  }, 0);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 transition-colors duration-300">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-3 bg-white dark:bg-zinc-900 rounded-full shadow-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeft size={24} className="text-zinc-700 dark:text-zinc-300" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#6b8059] rounded-xl flex items-center justify-center text-[#d4d9c6] shadow-md">
                <Logo size={24} />
              </div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={toggleTheme}
              className="p-3 bg-white dark:bg-zinc-900 rounded-full shadow-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {theme === 'dark' ? <Sun size={24} className="text-zinc-300" /> : <Moon size={24} className="text-zinc-700" />}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*,application/pdf"
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-medium hover:bg-zinc-800 dark:hover:bg-white transition-colors disabled:opacity-70"
            >
              {isUploading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <UploadCloud size={20} />
              )}
              <span>{isUploading ? 'Processing...' : 'Upload Image'}</span>
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 flex items-center gap-4 transition-colors">
            <div className="bg-emerald-100 dark:bg-emerald-900/50 p-4 rounded-2xl">
              <Receipt size={28} className="text-emerald-700 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">Receipts Scanned</p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">{totalReceipts}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 flex items-center gap-4 transition-colors">
            <div className="bg-blue-100 dark:bg-blue-900/50 p-4 rounded-2xl">
              <Apple size={28} className="text-blue-700 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">Food Scans</p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">{totalFoodScans}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 flex items-center gap-4 transition-colors">
            <div className="bg-purple-100 dark:bg-purple-900/50 p-4 rounded-2xl">
              <ShoppingBag size={28} className="text-purple-700 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">Total Food Items</p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">{totalItems}</p>
            </div>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-6">Recent Activity</h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 border-dashed transition-colors">
            <Receipt size={64} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <h3 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2">No activity yet</h3>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6">Scan your first receipt or food item to start tracking.</p>
            <button
              onClick={() => navigate('/scan')}
              className="px-6 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-medium hover:bg-zinc-800 dark:hover:bg-white transition-colors"
            >
              Scan Now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activities.map((activity) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 hover:shadow-md transition-all flex flex-col"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-zinc-900 dark:text-white flex items-center gap-2">
                      {activity.type === 'receipt' ? <Receipt size={18} className="text-emerald-500" /> : <Apple size={18} className="text-blue-500" />}
                      {activity.type === 'receipt' ? 'Grocery Receipt' : 'Food Scan'}
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      {new Date(activity.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex-1">
                  {activity.type === 'receipt' ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        {activity.items?.length || 0} items found:
                      </p>
                      {activity.items?.slice(0, 4).map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
                          <span className="truncate">{item}</span>
                        </div>
                      ))}
                      {(activity.items?.length || 0) > 4 && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 pt-2 border-t border-zinc-100 dark:border-zinc-800 mt-2">
                          + {(activity.items?.length || 0) - 4} more items
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold mb-1">Item</p>
                        <p className="text-zinc-900 dark:text-zinc-200 capitalize font-medium">{activity.item}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold mb-1">Condition</p>
                        <p className="text-zinc-900 dark:text-zinc-200 capitalize">{activity.condition}</p>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
