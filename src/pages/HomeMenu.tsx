import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { LayoutDashboard, ScanLine, ChefHat, LogOut, Sun, Moon, User as UserIcon, Bell, X, Trash2, AlertTriangle, Leaf } from 'lucide-react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { useTheme } from '../components/ThemeProvider';
import Logo from '../components/Logo';

interface Notification {
  id: string;
  type: 'expiry' | 'waste' | 'scan';
  message: string;
  timestamp: string;
}

export default function HomeMenu() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [displayName, setDisplayName] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastViewedAt, setLastViewedAt] = useState<string>(() => {
    return localStorage.getItem('notif_last_viewed') || '';
  });

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

  // Build notifications from food_scans (expiry alerts) and waste_logs
  useEffect(() => {
    if (!auth.currentUser) return;

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

    let foodNotifs: Notification[] = [];
    let wasteNotifs: Notification[] = [];

    const mergeNotifs = () => {
      const all = [...foodNotifs, ...wasteNotifs].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setNotifications(all);
    };

    const unsubFood = onSnapshot(qFood, (snapshot) => {
      const now = new Date();
      foodNotifs = [];
      snapshot.docs.forEach(d => {
        const data = d.data();
        // Recent scan notification
        const scanDate = new Date(data.createdAt);
        const minutesAgo = (now.getTime() - scanDate.getTime()) / (1000 * 60);
        if (minutesAgo < 1440) { // within 24 hours
          foodNotifs.push({
            id: `scan-${d.id}`,
            type: 'scan',
            message: `Scanned ${data.item} — ${data.condition}`,
            timestamp: data.createdAt,
          });
        }
        // Expiry alert notification
        if (data.estimatedExpiry) {
          const expiry = new Date(data.estimatedExpiry);
          const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysLeft >= 0 && daysLeft <= 3) {
            const label = daysLeft === 0 ? 'expires today' : daysLeft === 1 ? 'expires tomorrow' : `expires in ${daysLeft} days`;
            foodNotifs.push({
              id: `expiry-${d.id}`,
              type: 'expiry',
              message: `${data.item} ${label}`,
              timestamp: data.estimatedExpiry,
            });
          }
        }
      });
      mergeNotifs();
    }, () => {});

    const unsubWaste = onSnapshot(qWaste, (snapshot) => {
      wasteNotifs = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: `waste-${d.id}`,
          type: 'waste' as const,
          message: `${data.item} wasted — ${data.co2Impact?.toFixed(2)} kg CO2`,
          timestamp: data.timestamp,
        };
      });
      mergeNotifs();
    }, () => {});

    return () => {
      unsubFood();
      unsubWaste();
    };
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const glassCard = 'bg-white/40 dark:bg-zinc-900/35 backdrop-blur-2xl border border-white/20 dark:border-zinc-700/20';
  const glassButton = 'bg-white/30 dark:bg-zinc-800/30 backdrop-blur-xl border border-white/20 dark:border-zinc-700/20';

  // Count notifications newer than last viewed time
  const unreadCount = lastViewedAt
    ? notifications.filter(n => new Date(n.timestamp).getTime() > new Date(lastViewedAt).getTime()).length
    : notifications.length;

  const handleNotificationClick = () => {
    if (!showNotifications) {
      // Opening the panel — mark all as read
      const now = new Date().toISOString();
      setLastViewedAt(now);
      localStorage.setItem('notif_last_viewed', now);
    }
    setShowNotifications(!showNotifications);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6 relative overflow-hidden transition-colors duration-300">
      {/* Animated background blobs */}
      <motion.div
        animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-200/40 dark:bg-emerald-900/20 rounded-full blur-3xl"
      />
      <motion.div
        animate={{ scale: [1, 1.5, 1], rotate: [0, -90, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute -bottom-40 -left-40 w-96 h-96 bg-teal-200/40 dark:bg-teal-900/20 rounded-full blur-3xl"
      />
      <motion.div
        animate={{ scale: [1, 1.3, 1], rotate: [0, 60, 0] }}
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
              className={`flex items-center gap-2 px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:shadow-lg ${glassButton} rounded-full transition-all font-medium`}
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

            {/* Notification button */}
            <div className="relative">
              <button
                onClick={handleNotificationClick}
                className={`p-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:shadow-lg ${glassButton} rounded-full transition-all relative`}
              >
                <Bell size={24} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notification panel */}
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`absolute right-0 top-14 w-80 sm:w-96 max-h-[70vh] overflow-hidden rounded-2xl shadow-2xl z-50 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl border border-white/30 dark:border-zinc-700/30`}
                >
                  <div className="flex items-center justify-between p-4 border-b border-white/15 dark:border-zinc-700/20">
                    <h3 className="font-bold text-zinc-900 dark:text-white">Notifications</h3>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="p-1.5 hover:bg-white/30 dark:hover:bg-zinc-800/30 rounded-full transition-colors"
                    >
                      <X size={16} className="text-zinc-500" />
                    </button>
                  </div>
                  <div className="overflow-y-auto max-h-[60vh]">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-zinc-500 dark:text-zinc-400 text-sm">
                        No notifications yet
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {notifications.slice(0, 20).map(notif => (
                          <div
                            key={notif.id}
                            className={`flex items-start gap-3 p-3 rounded-xl transition-colors hover:bg-white/30 dark:hover:bg-zinc-800/20 ${
                              notif.type === 'expiry' ? 'bg-amber-500/5' : ''
                            }`}
                          >
                            <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${
                              notif.type === 'expiry'
                                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                : notif.type === 'waste'
                                  ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                            }`}>
                              {notif.type === 'expiry' && <AlertTriangle size={14} />}
                              {notif.type === 'waste' && <Trash2 size={14} />}
                              {notif.type === 'scan' && <Leaf size={14} />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-zinc-800 dark:text-zinc-200 capitalize">{notif.message}</p>
                              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                                {new Date(notif.timestamp).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>

            <button
              onClick={toggleTheme}
              className={`p-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:shadow-lg ${glassButton} rounded-full transition-all`}
            >
              {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
            </button>
            <button
              onClick={handleLogout}
              className={`p-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:shadow-lg ${glassButton} rounded-full transition-all`}
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
              <div className="bg-emerald-500/15 dark:bg-emerald-500/10 backdrop-blur-sm w-14 h-14 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/15">
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
              <div className="bg-blue-500/15 dark:bg-blue-500/10 backdrop-blur-sm w-14 h-14 rounded-2xl flex items-center justify-center mb-6 border border-blue-500/15">
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
              <div className="bg-amber-500/15 dark:bg-amber-500/10 backdrop-blur-sm w-14 h-14 rounded-2xl flex items-center justify-center mb-6 border border-amber-500/15">
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
