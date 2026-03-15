import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { LayoutDashboard, ScanLine, ChefHat, LogOut, Sun, Moon, User as UserIcon } from 'lucide-react';
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

  const glassCard = 'bg-white/60 dark:bg-zinc-900/50 backdrop-blur-xl border border-white/30 dark:border-zinc-700/30';

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
      <motion.div
        animate={{
          scale: [1, 1.3, 1],
          rotate: [0, 60, 0],
        }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        className="absolute top-1/3 -left-20 w-72 h-72 bg-amber-200/30 dark:bg-amber-900/15 rounded-full blur-3xl"
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
              className="flex items-center gap-2 px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-white/40 dark:hover:bg-zinc-800/50 backdrop-blur-sm rounded-full transition-colors font-medium"
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
              className="p-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-zinc-800/50 backdrop-blur-sm rounded-full transition-colors"
            >
              {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
            </button>
            <button
              onClick={handleLogout}
              className="p-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-zinc-800/50 backdrop-blur-sm rounded-full transition-colors"
            >
              <LogOut size={24} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/dashboard')}
            className={`cursor-pointer group relative overflow-hidden ${glassCard} rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute top-0 right-0 p-6 opacity-[0.07] group-hover:opacity-[0.15] transition-opacity">
              <LayoutDashboard size={100} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="relative z-10 flex flex-col h-full justify-between min-h-[220px]">
              <div className="bg-emerald-500/20 dark:bg-emerald-500/10 backdrop-blur-sm w-14 h-14 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/20">
                <LayoutDashboard size={28} className="text-emerald-700 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Dashboard</h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed">
                  View your waste footprint, track CO2 impact, and manage your food inventory.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/scan')}
            className={`cursor-pointer group relative overflow-hidden ${glassCard} rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute top-0 right-0 p-6 opacity-[0.07] group-hover:opacity-[0.15] transition-opacity">
              <ScanLine size={100} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="relative z-10 flex flex-col h-full justify-between min-h-[220px]">
              <div className="bg-blue-500/20 dark:bg-blue-500/10 backdrop-blur-sm w-14 h-14 rounded-2xl flex items-center justify-center mb-6 border border-blue-500/20">
                <ScanLine size={28} className="text-blue-700 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Scan Food</h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed">
                  Use your camera to scan food items and detect freshness instantly.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/recipes')}
            className={`cursor-pointer group relative overflow-hidden ${glassCard} rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute top-0 right-0 p-6 opacity-[0.07] group-hover:opacity-[0.15] transition-opacity">
              <ChefHat size={100} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="relative z-10 flex flex-col h-full justify-between min-h-[220px]">
              <div className="bg-amber-500/20 dark:bg-amber-500/10 backdrop-blur-sm w-14 h-14 rounded-2xl flex items-center justify-center mb-6 border border-amber-500/20">
                <ChefHat size={28} className="text-amber-700 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">AI Recipes</h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed">
                  Get recipe suggestions from your scanned ingredients using AI.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
