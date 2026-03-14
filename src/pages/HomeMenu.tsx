import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { LayoutDashboard, ScanLine, LogOut, Sun, Moon, User as UserIcon } from 'lucide-react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useTheme } from '../components/ThemeProvider';
import Logo from '../components/Logo';

export default function HomeMenu() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [displayName, setDisplayName] = useState('');

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

  const handleLogout = async () => {
    await signOut(auth);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6 relative overflow-hidden transition-colors duration-300">
      {/* Animated background blobs */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          rotate: [0, 90, 0],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-200/40 dark:bg-emerald-900/20 rounded-full blur-3xl"
      />
      <motion.div
        animate={{
          scale: [1, 1.5, 1],
          rotate: [0, -90, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute -bottom-40 -left-40 w-96 h-96 bg-teal-200/40 dark:bg-teal-900/20 rounded-full blur-3xl"
      />

      <div className="z-10 w-full max-w-4xl">
        <div className="flex justify-between items-center mb-12">
          <div className="flex items-center gap-6">
            <div className="w-28 h-28 bg-[#617953] rounded-3xl flex items-center justify-center text-[#d4d9c6] shadow-lg">
              <Logo size={96} />
            </div>
            <h1 className="text-5xl font-bold text-zinc-900 dark:text-white tracking-tight">
              WasteWise
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/profile')}
              className="flex items-center gap-2 px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-full transition-colors font-medium"
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
              className="p-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-full transition-colors"
            >
              {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
            </button>
            <button
              onClick={handleLogout}
              className="p-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-full transition-colors"
            >
              <LogOut size={24} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/dashboard')}
            className="cursor-pointer group relative overflow-hidden bg-white dark:bg-zinc-900 rounded-3xl p-8 shadow-sm border border-zinc-200 dark:border-zinc-800 hover:shadow-xl transition-all duration-300"
          >
            <div className="absolute top-0 right-0 p-8 opacity-10 dark:opacity-5 group-hover:opacity-20 dark:group-hover:opacity-10 transition-opacity">
              <LayoutDashboard size={120} className="dark:text-white" />
            </div>
            <div className="relative z-10 flex flex-col h-full justify-between min-h-[240px]">
              <div className="bg-emerald-100 dark:bg-emerald-900/50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
                <LayoutDashboard size={32} className="text-emerald-700 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-3xl font-bold text-zinc-900 dark:text-white mb-3">Dashboard</h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed">
                  View your waste footprint, track spending, and upload receipts directly.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/scan')}
            className="cursor-pointer group relative overflow-hidden bg-zinc-900 dark:bg-zinc-800 text-white rounded-3xl p-8 shadow-sm border border-zinc-800 dark:border-zinc-700 hover:shadow-xl transition-all duration-300"
          >
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
              <ScanLine size={120} />
            </div>
            <div className="relative z-10 flex flex-col h-full justify-between min-h-[240px]">
              <div className="bg-zinc-800 dark:bg-zinc-700 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
                <ScanLine size={32} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="text-3xl font-bold mb-3">Scan Receipt or Food</h2>
                <p className="text-zinc-400 text-lg leading-relaxed">
                  Use your device camera to instantly scan a receipt or food item.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
