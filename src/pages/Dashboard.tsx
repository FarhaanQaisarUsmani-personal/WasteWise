import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { handleFirestoreError, OperationType } from '../firestoreError';
import { ArrowLeft, Receipt, ShoppingBag, TrendingUp, UploadCloud, Loader2, Sun, Moon } from 'lucide-react';
import { motion } from 'motion/react';
import { processReceiptImage } from '../services/receiptProcessor';
import { useTheme } from '../components/ThemeProvider';

interface ReceiptData {
  id: string;
  storeName?: string;
  date?: string;
  total?: number;
  items: { name: string; price?: number; category?: string }[];
  createdAt: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'receipts'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReceiptData));
      setReceipts(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'receipts');
      setLoading(false);
    });

    return () => unsubscribe();
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

      await processReceiptImage(base64Data, file.type);
    } catch (err) {
      console.error('Upload error:', err);
      alert('Failed to process the uploaded receipt. Please try again.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const totalSpent = receipts.reduce((sum, r) => sum + (r.total || 0), 0);
  const totalItems = receipts.reduce((sum, r) => sum + (r.items?.length || 0), 0);

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
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
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
              <span>{isUploading ? 'Processing...' : 'Upload Receipt'}</span>
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 flex items-center gap-4 transition-colors">
            <div className="bg-emerald-100 dark:bg-emerald-900/50 p-4 rounded-2xl">
              <TrendingUp size={28} className="text-emerald-700 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">Total Spent</p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">${totalSpent.toFixed(2)}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 flex items-center gap-4 transition-colors">
            <div className="bg-blue-100 dark:bg-blue-900/50 p-4 rounded-2xl">
              <Receipt size={28} className="text-blue-700 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">Receipts Scanned</p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">{receipts.length}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 flex items-center gap-4 transition-colors">
            <div className="bg-purple-100 dark:bg-purple-900/50 p-4 rounded-2xl">
              <ShoppingBag size={28} className="text-purple-700 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">Total Items</p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">{totalItems}</p>
            </div>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-6">Recent Receipts</h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 border-dashed transition-colors">
            <Receipt size={64} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <h3 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2">No receipts yet</h3>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6">Scan your first receipt to start tracking your waste footprint.</p>
            <button
              onClick={() => navigate('/scan')}
              className="px-6 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-medium hover:bg-zinc-800 dark:hover:bg-white transition-colors"
            >
              Scan Receipt
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {receipts.map((receipt) => (
              <motion.div
                key={receipt.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-sm border border-zinc-100 dark:border-zinc-800 hover:shadow-md transition-all"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-zinc-900 dark:text-white truncate max-w-[180px]">
                      {receipt.storeName || 'Unknown Store'}
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {new Date(receipt.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-full font-semibold text-sm">
                    ${receipt.total?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="space-y-2">
                  {receipt.items.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400 truncate mr-2">{item.name}</span>
                      <span className="text-zinc-900 dark:text-zinc-200 font-medium">${item.price?.toFixed(2) || '0.00'}</span>
                    </div>
                  ))}
                  {receipt.items.length > 3 && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                      + {receipt.items.length - 3} more items
                    </p>
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
