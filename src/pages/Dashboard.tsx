import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, addDoc, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { handleFirestoreError, OperationType } from '../firestoreError';
import { ArrowLeft, Receipt, ShoppingBag, TrendingUp, UploadCloud, Loader2, Sun, Moon, Apple, X, User as UserIcon, Trash2, AlertTriangle, Leaf } from 'lucide-react';
import { motion } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { processImage } from '../services/imageProcessor';
import { uploadImageToStorage } from '../services/storageService';
import { estimateCO2Impact } from '../services/geminiService';
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
  estimatedExpiry?: string;
}

interface WasteLog {
  id: string;
  userId: string;
  item: string;
  co2Impact: number;
  timestamp: string;
}

type ActivityData = ReceiptData | FoodScanData;

const glass = 'bg-white/60 dark:bg-zinc-900/50 backdrop-blur-xl border border-white/30 dark:border-zinc-700/30';
const glassInner = 'bg-white/40 dark:bg-zinc-800/40 backdrop-blur-sm border border-white/20 dark:border-zinc-700/20';

export default function Dashboard() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [wasteLogs, setWasteLogs] = useState<WasteLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [wastingItemId, setWastingItemId] = useState<string | null>(null);
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

    const qWaste = query(
      collection(db, 'waste_logs'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('timestamp', 'desc')
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
      receiptsData = snapshot.docs.map(d => ({ id: d.id, type: 'receipt', ...d.data() } as ReceiptData));
      updateActivities();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'receipts');
      setLoading(false);
    });

    const unsubFood = onSnapshot(qFood, (snapshot) => {
      foodData = snapshot.docs.map(d => ({ id: d.id, type: 'food', ...d.data() } as FoodScanData));
      updateActivities();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'food_scans');
      setLoading(false);
    });

    const unsubWaste = onSnapshot(qWaste, (snapshot) => {
      setWasteLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as WasteLog)));
    }, () => {
      // waste_logs collection may not exist yet — silently ignore
    });

    return () => {
      unsubReceipts();
      unsubFood();
      unsubWaste();
    };
  }, []);

  const handleMarkAsWasted = async (activity: FoodScanData, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser || wastingItemId) return;

    setWastingItemId(activity.id);
    try {
      const co2 = await estimateCO2Impact(activity.item);
      await addDoc(collection(db, 'waste_logs'), {
        userId: auth.currentUser.uid,
        item: activity.item,
        co2Impact: co2,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to log waste:', err);
    } finally {
      setWastingItemId(null);
    }
  };

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
            const imageUrl = await uploadImageToStorage(base64Data, userId);

            if (res.type === 'receipt') {
              await addDoc(collection(db, 'receipts'), {
                userId,
                items: res.items || [],
                createdAt: now,
                imageUrl: imageUrl || null
              });
            } else if (res.type === 'food') {
              await addDoc(collection(db, 'food_scans'), {
                userId,
                item: res.item || 'Unknown',
                condition: res.condition || 'Unknown',
                suggestions: res.suggestions || [],
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
    return sum + 1;
  }, 0);
  const totalCO2 = wasteLogs.reduce((sum, w) => sum + (w.co2Impact || 0), 0);

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
    { name: 'Receipts', value: filteredActivities.filter(a => a.type === 'receipt').length, color: '#10b981' },
    { name: 'Food Scans', value: filteredActivities.filter(a => a.type === 'food').length, color: '#3b82f6' },
  ].filter(d => d.value > 0);

  // CO2 bar chart data — aggregate by day (last 7 entries)
  const wasteByDay = wasteLogs.reduce<Record<string, number>>((acc, log) => {
    const day = new Date(log.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    acc[day] = (acc[day] || 0) + log.co2Impact;
    return acc;
  }, {});
  const co2ChartData = Object.entries(wasteByDay)
    .map(([date, co2]) => ({ date, co2: Math.round(Number(co2) * 100) / 100 }))
    .slice(-7);

  // Expiry alerts — food scans with estimatedExpiry within 3 days
  const expiryAlerts = activities
    .filter((a): a is FoodScanData => a.type === 'food' && !!a.estimatedExpiry)
    .filter(a => {
      const expiry = new Date(a.estimatedExpiry!);
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysLeft >= 0 && daysLeft <= 3;
    })
    .map(a => {
      const expiry = new Date(a.estimatedExpiry!);
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      let label = '';
      if (daysLeft === 0) label = 'expires today';
      else if (daysLeft === 1) label = 'expires tomorrow';
      else label = `expires in ${daysLeft} days`;
      return { ...a, daysLeft, label };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Check if a food item is already wasted
  const wastedItemTimestamps = new Set(wasteLogs.map(w => w.item));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 transition-colors duration-300 relative overflow-hidden">
      {/* Background blobs */}
      <div className="fixed -top-40 -right-40 w-96 h-96 bg-emerald-200/30 dark:bg-emerald-900/15 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed -bottom-40 -left-40 w-96 h-96 bg-teal-200/30 dark:bg-teal-900/15 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed top-1/2 right-1/4 w-72 h-72 bg-blue-200/20 dark:bg-blue-900/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className={`p-3 ${glass} rounded-full shadow-lg hover:shadow-xl transition-all`}
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
              className={`flex items-center gap-2 px-4 py-2 ${glass} text-zinc-700 dark:text-zinc-300 hover:shadow-lg rounded-full shadow-md transition-all font-medium`}
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
              className={`p-3 ${glass} rounded-full shadow-md hover:shadow-lg transition-all`}
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
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors disabled:opacity-70 shadow-lg"
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

        {/* Expiry Alerts */}
        {expiryAlerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${glass} rounded-3xl p-5 mb-8 shadow-lg`}
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-amber-500/20 p-2 rounded-xl border border-amber-500/20">
                <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Expiry Alerts</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {expiryAlerts.map(alert => (
                <div
                  key={alert.id}
                  className={`${glassInner} rounded-2xl p-4 flex items-center gap-3 ${
                    alert.daysLeft === 0
                      ? 'border-red-500/40 bg-red-500/10'
                      : alert.daysLeft === 1
                        ? 'border-amber-500/40 bg-amber-500/10'
                        : ''
                  }`}
                >
                  <AlertTriangle
                    size={16}
                    className={
                      alert.daysLeft === 0
                        ? 'text-red-500'
                        : alert.daysLeft === 1
                          ? 'text-amber-500'
                          : 'text-yellow-500'
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white capitalize truncate">{alert.item}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{alert.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className={`${glass} p-5 rounded-3xl shadow-lg flex items-center gap-4`}
          >
            <div className="bg-emerald-500/20 p-3 rounded-2xl border border-emerald-500/20">
              <Receipt size={24} className="text-emerald-700 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Receipts</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">{totalReceipts}</p>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className={`${glass} p-5 rounded-3xl shadow-lg flex items-center gap-4`}
          >
            <div className="bg-blue-500/20 p-3 rounded-2xl border border-blue-500/20">
              <Apple size={24} className="text-blue-700 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Food Scans</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">{totalFoodScans}</p>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className={`${glass} p-5 rounded-3xl shadow-lg flex items-center gap-4`}
          >
            <div className="bg-purple-500/20 p-3 rounded-2xl border border-purple-500/20">
              <ShoppingBag size={24} className="text-purple-700 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Total Items</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">{totalItems}</p>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className={`${glass} p-5 rounded-3xl shadow-lg flex items-center gap-4`}
          >
            <div className="bg-red-500/20 p-3 rounded-2xl border border-red-500/20">
              <Leaf size={24} className="text-red-700 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">CO2 Wasted</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">{totalCO2.toFixed(2)}<span className="text-sm font-normal text-zinc-500 ml-1">kg</span></p>
            </div>
          </motion.div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Activity Breakdown */}
          <div className={`${glass} p-6 rounded-3xl shadow-lg`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Activity Breakdown</h2>
              <div className={`flex ${glassInner} p-1 rounded-xl`}>
                {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setTimeFilter(filter)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                      timeFilter === filter
                        ? 'bg-white/70 dark:bg-zinc-600/70 text-zinc-900 dark:text-white shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[250px] w-full">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)' }}
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

          {/* CO2 Waste Impact Chart */}
          <div className={`${glass} p-6 rounded-3xl shadow-lg`}>
            <div className="flex items-center gap-2 mb-6">
              <div className="bg-red-500/20 p-2 rounded-xl border border-red-500/20">
                <Leaf size={18} className="text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">CO2 Waste Impact</h2>
            </div>

            <div className="h-[250px] w-full">
              {co2ChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={co2ChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#999" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#999" unit="kg" />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)' }}
                      formatter={(value: number) => [`${value} kg`, 'CO2']}
                    />
                    <Bar dataKey="co2" fill="#ef4444" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 dark:text-zinc-400 gap-2">
                  <Leaf size={32} className="opacity-30" />
                  <p className="text-sm">No waste logged yet</p>
                  <p className="text-xs text-zinc-400">Mark food items as wasted to track CO2 impact</p>
                </div>
              )}
            </div>

            {/* Recent waste items */}
            {wasteLogs.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/20 dark:border-zinc-700/20">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-2">Recent waste</p>
                <div className="space-y-2">
                  {wasteLogs.slice(0, 3).map(log => (
                    <div key={log.id} className={`${glassInner} rounded-xl p-3 flex items-center justify-between`}>
                      <span className="text-sm text-zinc-700 dark:text-zinc-300 capitalize">{log.item}</span>
                      <span className="text-sm font-semibold text-red-600 dark:text-red-400">{log.co2Impact.toFixed(2)} kg CO2</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
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
          <div className={`text-center py-16 ${glass} rounded-3xl shadow-lg border-dashed`}>
            <Receipt size={64} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <h3 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2">No activity yet</h3>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6">Scan your first receipt or food item to start tracking.</p>
            <button
              onClick={() => navigate('/scan')}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors shadow-lg"
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
                className={`${glass} p-6 rounded-3xl shadow-lg hover:shadow-xl transition-all flex flex-col cursor-pointer`}
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
                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/30 dark:border-zinc-700/30 shrink-0">
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
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 pt-2 border-t border-white/15 dark:border-zinc-700/20 mt-2">
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

                {/* Mark as Wasted button for food scans */}
                {activity.type === 'food' && (
                  <div className="mt-4 pt-3 border-t border-white/15 dark:border-zinc-700/20">
                    {wastedItemTimestamps.has(activity.item) ? (
                      <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
                        <Trash2 size={14} />
                        <span>Logged as wasted</span>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => handleMarkAsWasted(activity, e)}
                        disabled={wastingItemId === activity.id}
                        className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        {wastingItemId === activity.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        <span>{wastingItemId === activity.id ? 'Estimating CO2...' : 'Mark as Wasted'}</span>
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Details Modal */}
      {selectedActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`${glass} rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col`}
          >
            <div className="flex items-center justify-between p-6 border-b border-white/15 dark:border-zinc-700/20">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                {selectedActivity.type === 'receipt' ? <Receipt size={24} className="text-emerald-500" /> : <Apple size={24} className="text-blue-500" />}
                {selectedActivity.type === 'receipt' ? 'Receipt Details' : 'Food Scan Details'}
              </h2>
              <button
                onClick={() => setSelectedActivity(null)}
                className={`p-2 ${glassInner} rounded-full hover:shadow-md transition-all`}
              >
                <X size={20} className="text-zinc-700 dark:text-zinc-300" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="w-full md:w-1/2">
                  {selectedActivity.imageUrl ? (
                    <div className={`rounded-2xl overflow-hidden ${glassInner} aspect-[3/4] relative`}>
                      <img
                        src={selectedActivity.imageUrl}
                        alt="Original scan"
                        className="w-full h-full object-contain absolute inset-0"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : (
                    <div className={`rounded-2xl ${glassInner} aspect-[3/4] flex flex-col items-center justify-center text-zinc-400`}>
                      <Receipt size={48} className="mb-4 opacity-50" />
                      <p>No image saved</p>
                    </div>
                  )}
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-4 text-center">
                    Scanned on {new Date(selectedActivity.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="w-full md:w-1/2">
                  {selectedActivity.type === 'receipt' ? (
                    <div>
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
                        Found {selectedActivity.items?.length || 0} Items
                      </h3>
                      <div className={`${glassInner} rounded-xl p-4 max-h-[60vh] overflow-y-auto`}>
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
                      <div className={`${glassInner} rounded-xl p-5`}>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold mb-1">Detected Item</p>
                        <p className="text-xl text-zinc-900 dark:text-zinc-100 capitalize font-bold">{selectedActivity.item}</p>
                      </div>

                      <div className={`${glassInner} rounded-xl p-5`}>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold mb-1">Condition</p>
                        <p className="text-lg text-zinc-900 dark:text-zinc-100 capitalize font-medium">{selectedActivity.condition}</p>
                      </div>

                      {selectedActivity.estimatedExpiry && (
                        <div className={`${glassInner} rounded-xl p-5`}>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold mb-1">Estimated Expiry</p>
                          <p className="text-lg text-zinc-900 dark:text-zinc-100 font-medium">{new Date(selectedActivity.estimatedExpiry).toLocaleDateString()}</p>
                        </div>
                      )}

                      {selectedActivity.suggestions && selectedActivity.suggestions.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-zinc-900 dark:text-white mb-3">Usage Suggestions</h4>
                          <ul className="space-y-3">
                            {selectedActivity.suggestions.map((sug, idx) => (
                              <li key={idx} className={`flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300 ${glassInner} p-3 rounded-lg`}>
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
