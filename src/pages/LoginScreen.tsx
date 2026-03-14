import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { LogIn } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../firestoreError';
import Logo from '../components/Logo';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Check if user exists in Firestore
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        try {
          const userData: any = {
            uid: user.uid,
            email: user.email,
            createdAt: new Date().toISOString(),
          };
          if (user.displayName) {
            userData.displayName = user.displayName;
          }
          await setDoc(userRef, userData);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Failed to log in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4 transition-colors duration-300">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-xl overflow-hidden border border-zinc-100 dark:border-zinc-800 transition-colors"
      >
        <div className="bg-[#6b8059] p-8 text-center transition-colors">
          <div className="flex justify-center mb-4">
            <div className="bg-[#5a6b4a] p-3 rounded-2xl shadow-inner">
              <Logo size={40} className="text-[#d4d9c6]" />
            </div>
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">Welcome Back</h2>
          <p className="text-[#d4d9c6]/90">Sign in to manage your waste footprint</p>
        </div>

        <div className="p-8">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-4 px-6 rounded-xl font-medium hover:bg-zinc-800 dark:hover:bg-white transition-all disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="w-6 h-6 border-2 border-white/30 dark:border-zinc-900/30 border-t-white dark:border-t-zinc-900 rounded-full animate-spin" />
            ) : (
              <>
                <LogIn size={20} />
                <span>Continue with Google</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
