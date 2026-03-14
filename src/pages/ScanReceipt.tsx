import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Camera, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { processReceiptImage } from '../services/receiptProcessor';

export default function ScanReceipt() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const startCamera = async () => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Camera access denied or unavailable. Please check your permissions.");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const captureAndProcess = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);
    setError(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError("Failed to capture image.");
      setIsProcessing(false);
      return;
    }

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Get base64 data
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64Data = dataUrl.split(',')[1];

    try {
      await processReceiptImage(base64Data, 'image/jpeg');
      setSuccess(true);
      stopCamera();
    } catch (err) {
      console.error('Error processing receipt:', err);
      setError('Failed to process the receipt. Please try again with a clearer image.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetScanner = () => {
    setSuccess(false);
    startCamera();
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white p-6 flex flex-col transition-colors duration-300">
      <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col">
        <header className="flex items-center gap-4 mb-8">
          <button
            onClick={() => {
              stopCamera();
              navigate('/');
            }}
            className="p-3 bg-white dark:bg-zinc-800 rounded-full shadow-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          >
            <ArrowLeft size={24} className="text-zinc-700 dark:text-zinc-300" />
          </button>
          <h1 className="text-3xl font-bold">Scan Receipt</h1>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center relative bg-black rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800">
          {!success ? (
            <>
              {error ? (
                <div className="p-8 text-center max-w-md bg-white dark:bg-zinc-900 w-full h-full flex flex-col items-center justify-center">
                  <div className="bg-red-500/20 p-4 rounded-full inline-block mb-4">
                    <Camera size={48} className="text-red-500 dark:text-red-400" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-red-600 dark:text-red-400">Camera Error</h3>
                  <p className="text-zinc-600 dark:text-zinc-400 mb-6">{error}</p>
                  <button 
                    onClick={startCamera}
                    className="px-6 py-3 bg-zinc-900 dark:bg-zinc-800 text-white rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className={`w-full h-full object-cover ${isProcessing ? 'opacity-50 blur-sm' : ''}`}
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  {/* Scanner overlay guides */}
                  <div className="absolute inset-0 pointer-events-none border-[40px] border-black/40">
                    <div className="w-full h-full border-2 border-emerald-500/50 rounded-xl relative">
                      <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 -mt-1 -ml-1 rounded-tl-lg" />
                      <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 -mt-1 -mr-1 rounded-tr-lg" />
                      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 -mb-1 -ml-1 rounded-bl-lg" />
                      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 -mb-1 -mr-1 rounded-br-lg" />
                    </div>
                  </div>

                  <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                    <button
                      onClick={captureAndProcess}
                      disabled={isProcessing || !stream}
                      className="w-20 h-20 bg-emerald-500 rounded-full border-4 border-white dark:border-zinc-900 shadow-xl flex items-center justify-center hover:bg-emerald-400 hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100"
                    >
                      {isProcessing ? (
                        <Loader2 size={32} className="animate-spin text-white dark:text-zinc-900" />
                      ) : (
                        <Camera size={32} className="text-white dark:text-zinc-900" />
                      )}
                    </button>
                  </div>

                  {isProcessing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                      <Loader2 size={48} className="animate-spin text-emerald-500 mb-4" />
                      <p className="text-lg font-medium text-emerald-400">Analyzing Receipt...</p>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-12 px-6 bg-white dark:bg-zinc-900 w-full h-full flex flex-col items-center justify-center"
            >
              <div className="flex justify-center mb-6">
                <div className="bg-emerald-100 dark:bg-emerald-500/20 p-6 rounded-full">
                  <CheckCircle2 size={80} className="text-emerald-600 dark:text-emerald-500" />
                </div>
              </div>
              <h2 className="text-3xl font-bold text-zinc-900 dark:text-white mb-4">Receipt Processed!</h2>
              <p className="text-zinc-500 dark:text-zinc-400 text-lg mb-10 max-w-md">
                Your receipt has been successfully analyzed and added to your dashboard.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-sm">
                <button
                  onClick={resetScanner}
                  className="flex-1 px-6 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-xl font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={20} />
                  Scan Another
                </button>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="flex-1 px-6 py-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 dark:hover:bg-emerald-500 transition-colors"
                >
                  View Dashboard
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
