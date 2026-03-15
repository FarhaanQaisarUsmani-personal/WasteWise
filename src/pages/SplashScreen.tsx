import React from 'react';
import { motion } from 'motion/react';
import Logo from '../components/Logo';

export default function SplashScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#617953] text-[#d4d9c6] relative overflow-hidden">
      {/* Subtle background blobs that blend with the solid green */}
      <div className="absolute -top-32 -right-32 w-80 h-80 bg-[#7a9a68]/20 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-[#4a6040]/30 rounded-full blur-3xl" />

      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="flex flex-col items-center relative z-10"
      >
        {/* Logo with circular fill from bottom */}
        <div className="mb-6 relative w-[160px] h-[160px]">
          {/* Dimmed base logo — blends with background */}
          <div className="opacity-20">
            <Logo size={160} />
          </div>
          {/* Revealed logo — fill from bottom to top */}
          <motion.div
            className="absolute inset-0"
            initial={{ clipPath: 'inset(100% 0 0 0)' }}
            animate={{ clipPath: 'inset(0% 0 0 0)' }}
            transition={{ duration: 2, ease: 'easeInOut', delay: 0.3 }}
          >
            <Logo size={160} />
          </motion.div>
        </div>

        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="text-5xl font-bold tracking-tight font-sans"
        >
          WasteWise
        </motion.h1>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="mt-4 opacity-80 text-lg font-medium tracking-wide uppercase"
        >
          Track. Reduce. Sustain.
        </motion.p>
      </motion.div>
    </div>
  );
}
