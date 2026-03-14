import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Camera, CheckCircle2, Loader2, RefreshCw, AlertCircle, Scan } from 'lucide-react';
import { processImage, ProcessResult } from '../services/imageProcessor';
import { uploadImageToStorage } from '../services/storageService';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

export default function ScanReceipt() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isManualProcessing, setIsManualProcessing] = useState(false);
  const [isAutoAnalyzing, setIsAutoAnalyzing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const isProcessingRef = useRef(false);
  const successRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    successRef.current = success;
    streamRef.current = stream;
  }, [success, stream]);

  const startCamera = async () => {
    setError(null);
    try {
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
      } catch (e) {
        // Fallback to any available camera if environment camera fails
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: true 
        });
      }
      
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Camera access denied or unavailable. Please click the lock icon in your browser's address bar to allow camera access, then refresh the page.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  // Auto-scan loop
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let isActive = true;

    const attemptAutoScan = async () => {
      if (!isActive) return;
      
      if (!videoRef.current || !canvasRef.current || isProcessingRef.current || successRef.current || !streamRef.current) {
        timeoutId = setTimeout(attemptAutoScan, 1000);
        return;
      }

      isProcessingRef.current = true;
      setIsAutoAnalyzing(true);

      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5); // Lower quality for faster auto-scan
          const base64Data = dataUrl.split(',')[1];

          const res = await processImage(base64Data, 'image/jpeg');
          
          if (isActive && res.type !== 'unknown' && !successRef.current) {
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
                console.error("Error saving scan to Firestore:", saveErr);
              }
            }

            setResult(res);
            setSuccess(true);
            stopCamera();
            return; // Stop looping
          }
        }
      } catch (err) {
        console.error('Auto-scan error:', err);
        // Silently fail and retry
      } finally {
        if (isActive) {
          isProcessingRef.current = false;
          setIsAutoAnalyzing(false);
          if (!successRef.current) {
            timeoutId = setTimeout(attemptAutoScan, 2500); // Wait 2.5s before next attempt
          }
        }
      }
    };

    if (stream && !success) {
      timeoutId = setTimeout(attemptAutoScan, 2000); // Start auto-scanning after 2 seconds
    }

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [stream, success]);

  const captureAndProcessManual = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsManualProcessing(true);
    isProcessingRef.current = true; // Pause auto-scan
    setError(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError("Failed to capture image.");
      setIsManualProcessing(false);
      isProcessingRef.current = false;
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64Data = dataUrl.split(',')[1];

    try {
      const res = await processImage(base64Data, 'image/jpeg');
      if (res.type === 'unknown') {
        setError(res.message || "Could not detect food or a receipt. Please try scanning again.");
        setSuccess(false);
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
            console.error("Error saving scan to Firestore:", saveErr);
          }
        }

        setResult(res);
        setSuccess(true);
        stopCamera();
      }
    } catch (err) {
      console.error('Error processing image:', err);
      setError('Failed to process the image. Please try again with a clearer image.');
    } finally {
      setIsManualProcessing(false);
      isProcessingRef.current = false;
    }
  };

  const resetScanner = () => {
    setSuccess(false);
    setResult(null);
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
          <h1 className="text-3xl font-bold">Scan Receipt or Food</h1>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center relative bg-black rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800">
          {!success ? (
            <>
              {error ? (
                <div className="p-8 text-center max-w-md bg-white dark:bg-zinc-900 w-full h-full flex flex-col items-center justify-center">
                  <div className="bg-red-500/20 p-4 rounded-full inline-block mb-4">
                    <AlertCircle size={48} className="text-red-500 dark:text-red-400" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-red-600 dark:text-red-400">Analysis Failed</h3>
                  <p className="text-zinc-600 dark:text-zinc-400 mb-6">{error}</p>
                  <button 
                    onClick={resetScanner}
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
                    className={`w-full h-full object-cover ${isManualProcessing ? 'opacity-50 blur-sm' : ''}`}
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  {/* Auto-analyzing badge */}
                  <div className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none z-10">
                    <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium border border-white/10 shadow-xl">
                      {isAutoAnalyzing ? (
                        <>
                          <Loader2 size={16} className="animate-spin text-emerald-400" />
                          <span>Analyzing surface...</span>
                        </>
                      ) : (
                        <>
                          <Scan size={16} className="text-emerald-400" />
                          <span>Point at food or receipt</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Scanner overlay guides */}
                  <div className="absolute inset-0 pointer-events-none border-[40px] border-black/40">
                    <div className="w-full h-full border-2 border-emerald-500/50 rounded-xl relative overflow-hidden">
                      {/* Laser animation */}
                      <motion.div 
                        animate={{ top: ['0%', '100%', '0%'] }}
                        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                        className="absolute left-0 right-0 h-0.5 bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)] z-10"
                      />
                      <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 -mt-1 -ml-1 rounded-tl-lg" />
                      <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 -mt-1 -mr-1 rounded-tr-lg" />
                      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 -mb-1 -ml-1 rounded-bl-lg" />
                      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 -mb-1 -mr-1 rounded-br-lg" />
                    </div>
                  </div>

                  <div className="absolute bottom-8 left-0 right-0 flex justify-center z-20">
                    <button
                      onClick={captureAndProcessManual}
                      disabled={isManualProcessing || !stream}
                      className="w-20 h-20 bg-emerald-500 rounded-full border-4 border-white dark:border-zinc-900 shadow-xl flex items-center justify-center hover:bg-emerald-400 hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100"
                    >
                      {isManualProcessing ? (
                        <Loader2 size={32} className="animate-spin text-white dark:text-zinc-900" />
                      ) : (
                        <Camera size={32} className="text-white dark:text-zinc-900" />
                      )}
                    </button>
                  </div>

                  {isManualProcessing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-30">
                      <Loader2 size={48} className="animate-spin text-emerald-500 mb-4" />
                      <p className="text-lg font-medium text-emerald-400">Analyzing Image...</p>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-12 px-6 bg-white dark:bg-zinc-900 w-full h-full flex flex-col items-center justify-center overflow-y-auto"
            >
              <div className="flex justify-center mb-6">
                <div className="bg-emerald-100 dark:bg-emerald-500/20 p-6 rounded-full">
                  <CheckCircle2 size={80} className="text-emerald-600 dark:text-emerald-500" />
                </div>
              </div>
              <h2 className="text-3xl font-bold text-zinc-900 dark:text-white mb-4">
                {result?.type === 'receipt' ? 'Receipt Processed!' : 'Food Detected!'}
              </h2>
              
              {result?.type === 'receipt' && (
                <div className="mb-8 w-full max-w-md text-left">
                  <p className="text-zinc-500 dark:text-zinc-400 mb-4 text-center">
                    Found {result.items?.length || 0} food items on your receipt.
                  </p>
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 max-h-48 overflow-y-auto border border-zinc-200 dark:border-zinc-700">
                    <ul className="space-y-2">
                      {result.items?.map((item, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {result?.type === 'food' && (
                <div className="mb-8 w-full max-w-md text-left">
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-6 border border-zinc-200 dark:border-zinc-700">
                    <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 capitalize">{result.item}</h3>
                    <p className="text-zinc-600 dark:text-zinc-400 mb-4">
                      Condition: <span className="font-semibold text-zinc-900 dark:text-zinc-200 capitalize">{result.condition}</span>
                    </p>
                    
                    {result.suggestions && result.suggestions.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-zinc-900 dark:text-white mb-2">Usage Suggestions:</h4>
                        <ul className="space-y-2">
                          {result.suggestions.map((sug, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                              {sug}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
