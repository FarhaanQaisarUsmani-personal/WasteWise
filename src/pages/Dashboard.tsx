import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, addDoc, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { handleFirestoreError, OperationType } from '../firestoreError';
import { ArrowLeft, Receipt, ShoppingBag, TrendingUp, UploadCloud, Loader2, Sun, Moon, Apple, X, User as UserIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { processImage, ProcessResult } from '../services/testImageProcessor';
import { uploadImageToStorage } from '../services/storageService';
import { useTheme } from '../components/ThemeProvider';
import Logo from '../components/Logo';

interface ReceiptData {
  id: string;
  type: 'receipt';
  items: string[];
  createdAt: string;
  imageUrl?: string;
}

interface FoodScanData {
  id: string;
  type: 'food';
  item: string;
  condition: string;
  suggestions: string[];
  createdAt: string;
  imageUrl?: string;
}

type ActivityData = ReceiptData | FoodScanData;

export default function Dashboard() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityData | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [timeFilter, setTimeFilter] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('weekly');
  const [showAllActivity, setShowAllActivity] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      if (auth.currentUser) {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setDisplayName(userSnap.data().displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'User');
        } else {
          setDisplayName(auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'User');
        }
      }
    };
    fetchProfile();
  }, []);

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
        alert(res.data.message || 'Could not detect food or a receipt.');
      } else {
        if (auth.currentUser) {
          const userId = auth.currentUser.uid;
          const now = new Date().toISOString();
          try {
            const imageUrl = await uploadImageToStorage(base64Data, userId);
            
            if (res.type === 'receipt') {
              await addDoc(collection(db, 'receipts'), {
                userId,
                items: res.data.items || [],
                createdAt: now,
                imageUrl: imageUrl || null
              });
            } else if (res.type === 'food') {
              await addDoc(collection(db, 'food_scans'), {
                userId,
                item: res.data.item || 'Unknown',
                condition: res.data.ripeness || 'Unknown',
                suggestions: res.data.advice ? [res.data.advice.recipe, res.data.advice.preservation] : [],
                createdAt: now,
                imageUrl: imageUrl || null
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

  const now = new Date();
  const filteredActivities = activities.filter(activity => {
    const activityDate = new Date(activity.createdAt);
    const diffTime = Math.abs(now.getTime() - activityDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    switch (timeFilter) {
      case 'daily': return diffDays <= 1;
      case 'weekly': return diffDays <= 7;
      case 'monthly': return diffDays <= 30;
      case 'yearly': return diffDays <= 365;
      default: return true;
    }
  });

  const pieData = [
    { name: 'Receipts', value: filteredActivities.filter(a => a.type === 'receipt').length, color: '#10b981' }, // emerald-500
    { name: 'Food Scans', value: filteredActivities.filter(a => a.type === 'food').length, color: '#3b82f6' }, // blue-500
  ].filter(d => d.value > 0);

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
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-[#617953] rounded-2xl flex items-center justify-center text-[#d4d9c6] shadow-md">
                <Logo size={40} />
              </div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => navigate('/profile')}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full shadow-sm transition-colors font-medium"
            >
              <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/50 rounded-full flex items-center justify-center text-emerald-700 dark:text-emerald-400 overflow-hidden">
                {auth.currentUser?.photoURL ? (
                  <img src={auth.currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon size={16} />
                )}
              </div>
              <span className="hidden sm:inline">{displayName}</span>
            </button>
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

        {/* Analytics Section */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 mb-12">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Activity Breakdown</h2>
            <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
              {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTimeFilter(filter)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                    timeFilter === filter
                      ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          
          <div className="h-[300px] w-full">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                No activity in this period
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Recent Activity</h2>
          {activities.length > 4 && (
            <button
              onClick={() => setShowAllActivity(!showAllActivity)}
              className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
            >
              {showAllActivity ? 'Show Less' : 'Show More'}
            </button>
          )}
        </div>

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
            {activities.slice(0, showAllActivity ? undefined : 4).map((activity) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setSelectedActivity(activity)}
                className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 hover:shadow-md transition-all flex flex-col cursor-pointer"
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
                  {activity.imageUrl && (
                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 shrink-0">
                      <img src={activity.imageUrl} alt="Scan thumbnail" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}
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

      {/* Activity Details Modal */}
      {selectedActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-zinc-200 dark:border-zinc-800"
          >
            <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                {selectedActivity.type === 'receipt' ? <Receipt size={24} className="text-emerald-500" /> : <Apple size={24} className="text-blue-500" />}
                {selectedActivity.type === 'receipt' ? 'Receipt Details' : 'Food Scan Details'}
              </h2>
              <button 
                onClick={() => setSelectedActivity(null)}
                className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                <X size={20} className="text-zinc-700 dark:text-zinc-300" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex flex-col md:flex-row gap-8">
                {/* Image Section */}
                <div className="w-full md:w-1/2">
                  {selectedActivity.imageUrl ? (
                    <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 aspect-[3/4] relative">
                      <img 
                        src={selectedActivity.imageUrl} 
                        alt="Original scan" 
                        className="w-full h-full object-contain absolute inset-0"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 aspect-[3/4] flex flex-col items-center justify-center text-zinc-400">
                      <Receipt size={48} className="mb-4 opacity-50" />
                      <p>No image saved</p>
                    </div>
                  )}
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-4 text-center">
                    Scanned on {new Date(selectedActivity.createdAt).toLocaleString()}
                  </p>
                </div>

                {/* Details Section */}
                <div className="w-full md:w-1/2">
                  {selectedActivity.type === 'receipt' ? (
                    <div>
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
                        Found {selectedActivity.items?.length || 0} Items
                      </h3>
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 max-h-[60vh] overflow-y-auto">
                        <ul className="space-y-3">
                          {selectedActivity.items?.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-3 text-zinc-700 dark:text-zinc-300">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 shrink-0" />
                              <span className="leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-5 border border-zinc-200 dark:border-zinc-700">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold mb-1">Detected Item</p>
                        <p className="text-xl text-zinc-900 dark:text-zinc-100 capitalize font-bold">{selectedActivity.item}</p>
                      </div>
                      
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-5 border border-zinc-200 dark:border-zinc-700">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold mb-1">Condition</p>
                        <p className="text-lg text-zinc-900 dark:text-zinc-100 capitalize font-medium">{selectedActivity.condition}</p>
                      </div>

                      {selectedActivity.suggestions && selectedActivity.suggestions.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-zinc-900 dark:text-white mb-3">Usage Suggestions</h4>
                          <ul className="space-y-3">
                            {selectedActivity.suggestions.map((sug, idx) => (
                              <li key={idx} className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/30 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                                <span className="leading-relaxed">{sug}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
