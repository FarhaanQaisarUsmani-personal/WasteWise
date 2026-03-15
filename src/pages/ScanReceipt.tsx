import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Camera, CheckCircle2, Loader2, RefreshCw, AlertCircle, Scan, User as UserIcon } from 'lucide-react';
import { processImage, ProcessResult } from '../services/imageProcessor';
import { uploadImageToStorage } from '../services/storageService';
import { db, auth } from '../firebase';
import { collection, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { estimateExpiry } from '../services/geminiService';
import { addReceipt, addFoodScan } from '../services/firestoreService';

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
  const [displayName, setDisplayName] = useState('');
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  const isProcessingRef = useRef(false);
  const successRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const errorRef = useRef(false);

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
    successRef.current = success;
    streamRef.current = stream;
    errorRef.current = Boolean(error);
  }, [success, stream, error]);

  const startCamera = async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API is not supported in this browser or context.");
      }

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

      if (errorRef.current) {
        return;
      }
      
      if (!videoRef.current || !canvasRef.current || isProcessingRef.current || successRef.current || !streamRef.current) {
        timeoutId = setTimeout(attemptAutoScan, 1000);
        return;
      }

      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        timeoutId = setTimeout(attemptAutoScan, 500);
        return;
      }

      isProcessingRef.current = true;
      setIsAutoAnalyzing(true);

      try {
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5); // Lower quality for faster auto-scan
          const base64Data = dataUrl.split(',')[1];

          const res = await processImage(base64Data, 'image/jpeg');

          if (isActive && res.type === 'unknown' && !successRef.current) {
            setError('This is not food. Please try again with a food item.');
            return;
          }
          
          if (isActive && res.type !== 'unknown' && !successRef.current) {
            if (auth.currentUser) {
              const userId = auth.currentUser.uid;
              const now = new Date().toISOString();
              try {
                const imageUrl = await uploadImageToStorage(base64Data, userId);

                if (res.type === 'receipt') {
                  await addReceipt(userId, {
                    items: res.items || [],
                    createdAt: now,
                    imageUrl: imageUrl || null
                  });
                } else if (res.type === 'food') {
                  const foodDocRef = await addDoc(collection(db, 'food_scans'), {
                    userId,
                    item: res.item || 'Unknown',
                    condition: res.condition || 'Unknown',
                    suggestions: res.suggestions || [],
                    etaRange: res.etaRange || null,
                    repurposingActions: res.repurposingActions || [],
                    createdAt: now,
                    imageUrl: imageUrl || null
                  });
                  // Estimate expiry in background
                  estimateExpiry(res.item || 'Unknown', res.condition || 'Unknown')
                    .then(expiryDate => updateDoc(foodDocRef, { estimatedExpiry: expiryDate }))
                    .catch(err => console.error('Expiry estimation failed:', err));
                }
              } catch (saveErr) {
                console.error("Error saving scan to Firestore:", saveErr);
                setError("Failed to save scan. Please try again.");
                return;
              }
            }

            setResult(res);
            setCapturedPreview(dataUrl);
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
          if (!successRef.current && !errorRef.current) {
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
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setError("Camera is still initializing. Please wait a moment.");
      setIsManualProcessing(false);
      isProcessingRef.current = false;
      return;
    }

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
        setError('This is not food. Please try again with a food item.');
        setSuccess(false);
      } else {
        if (auth.currentUser) {
          const userId = auth.currentUser.uid;
          const now = new Date().toISOString();
          try {
            const imageUrl = await uploadImageToStorage(base64Data, userId);

            if (res.type === 'receipt') {
              await addReceipt(userId, {
                items: res.items || [],
                createdAt: now,
                imageUrl: imageUrl || null
              });
            } else if (res.type === 'food') {
              const foodDocRef = await addDoc(collection(db, 'food_scans'), {
                userId,
                item: res.item || 'Unknown',
                condition: res.condition || 'Unknown',
                suggestions: res.suggestions || [],
                createdAt: now,
                imageUrl: imageUrl || null
              });
              // Estimate expiry in background
              estimateExpiry(res.item || 'Unknown', res.condition || 'Unknown')
                .then(expiryDate => updateDoc(foodDocRef, { estimatedExpiry: expiryDate }))
                .catch(err => console.error('Expiry estimation failed:', err));
            }
          } catch (saveErr) {
            console.error("Error saving scan to Firestore:", saveErr);
            setError("Failed to save scan. Please try again.");
            return;
          }
        }

        setResult(res);
        setCapturedPreview(dataUrl);
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
    setCapturedPreview(null);
    setError(null);
    startCamera();
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white p-6 flex flex-col transition-colors duration-300">
      <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
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
          </div>
          <button
            onClick={() => {
              stopCamera();
              navigate('/profile');
            }}
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
        </header>

        <div className="flex-1 flex flex-col items-center justify-center relative bg-black rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800">
          {error ? (
            <div className="p-8 text-center max-w-md bg-white dark:bg-zinc-900 w-full h-full flex flex-col items-center justify-center">
              <div className="bg-red-500/20 p-4 rounded-full inline-block mb-4">
                <AlertCircle size={48} className="text-red-500 dark:text-red-400" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-red-600 dark:text-red-400">Analysis Failed</h3>
              <p className="text-zinc-600 dark:text-zinc-400 mb-6">{error}</p>
              <div className="flex flex-col gap-3 w-full max-w-xs">
                <button 
                  onClick={resetScanner}
                  className="w-full px-6 py-3 bg-zinc-900 dark:bg-zinc-800 text-white rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors"
                >
                  Try Again
                </button>
                <button 
                  onClick={() => {
                    stopCamera();
                    navigate('/dashboard');
                  }}
                  className="w-full px-6 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Upload from Dashboard
                </button>
              </div>
            </div>
          ) : (
            <>
              {capturedPreview && success ? (
                <img
                  src={capturedPreview}
                  alt="Captured scan"
                  className="w-full h-full object-cover"
                />
              ) : (
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  onLoadedMetadata={() => {
                    videoRef.current?.play().catch(console.error);
                  }}
                  className={`w-full h-full object-cover ${isManualProcessing ? 'opacity-50 blur-sm' : ''}`}
                />
              )}
              <canvas ref={canvasRef} className="hidden" />
              
              {!success && (
                <>
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
                          <span>Point at a food item</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="absolute inset-0 pointer-events-none border-[40px] border-black/40">
                    <div className="w-full h-full border-2 border-emerald-500/50 rounded-xl relative overflow-hidden">
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

                  <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-6 z-20">
                    <button
                      onClick={() => {
                        stopCamera();
                        navigate('/dashboard');
                      }}
                      className="w-12 h-12 bg-black/50 backdrop-blur-md rounded-full border border-white/20 flex items-center justify-center hover:bg-black/70 transition-colors"
                      title="Upload from Dashboard"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </button>
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
                    <div className="w-12 h-12" />
                  </div>
                </>
              )}

              {isManualProcessing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-30">
                  <Loader2 size={48} className="animate-spin text-emerald-500 mb-4" />
                  <p className="text-lg font-medium text-emerald-400">Analyzing Image...</p>
                </div>
              )}

              {success && result && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-md p-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-white/95 dark:bg-zinc-900/95 shadow-2xl overflow-hidden"
                  >
                    <div className="p-6 sm:p-8">
                      <div className="flex justify-center mb-5">
                        <div className="bg-emerald-100 dark:bg-emerald-500/20 p-5 rounded-full">
                          <CheckCircle2 size={64} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                      </div>
                      <h2 className="text-3xl font-bold text-zinc-900 dark:text-white text-center mb-2">
                        Scan Complete
                      </h2>
                      <p className="text-center text-zinc-500 dark:text-zinc-400 mb-6">
                        {result.type === 'food'
                          ? 'Detected by your trained model.'
                          : result.message || 'The scan is complete.'}
                      </p>

                      {result.type === 'food' && (
                        <div className="space-y-4 mb-6">
                          <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 p-5">
                            <div className="flex items-start justify-between gap-4 mb-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400 mb-2">Food Type</p>
                                <h3 className="text-2xl font-bold text-zinc-900 dark:text-white capitalize">{result.item}</h3>
                              </div>
                              {typeof result.confidence === 'number' && (
                                <div className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 text-sm font-semibold">
                                  Confidence: {Math.round(result.confidence * 100)}%
                                </div>
                              )}
                            </div>
                          </div>

                          {result.condition && (
                            <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 p-5">
                              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400 mb-2">Freshness Level</p>
                              <div className="flex items-center gap-3">
                                <span className={`inline-block w-3 h-3 rounded-full ${
                                  result.condition === 'fresh' ? 'bg-green-500' :
                                  result.condition === 'ripe' ? 'bg-yellow-500' :
                                  result.condition === 'aging' ? 'bg-orange-500' :
                                  result.condition === 'overripe' ? 'bg-orange-600' :
                                  'bg-red-500'
                                }`} />
                                <span className="text-lg font-semibold text-zinc-900 dark:text-white capitalize">{result.condition}</span>
                                {result.conditionConfidence && (
                                  <span className="text-sm text-zinc-500 dark:text-zinc-400">({Math.round(result.conditionConfidence * 100)}%)</span>
                                )}
                              </div>
                            </div>
                          )}

                          {result.etaRange && (
                            <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 p-5">
                              <p className="text-xs uppercase tracking-[0.24em] text-amber-700 dark:text-amber-400 font-semibold mb-3">Time Until Spoilage</p>
                              <p className="text-base font-semibold text-amber-900 dark:text-amber-100 mb-4">⏱️ {result.etaRange}</p>

                              {result.repurposingActions && result.repurposingActions.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-3">What You Can Do:</p>
                                  <ul className="space-y-2">
                                    {result.repurposingActions.map((action, idx) => (
                                      <li key={idx} className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100">
                                        <span className="shrink-0 mt-0.5">→</span>
                                        <span>{action}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {result.suggestions && result.suggestions.length > 0 && (
                            <div>
                              <h4 className="font-semibold text-zinc-900 dark:text-white mb-3">Suggestions</h4>
                              <ul className="space-y-2">
                                {result.suggestions.map((sug, idx) => (
                                  <li key={idx} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/30 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                                    <span className="leading-relaxed">{sug}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {result.type === 'unknown' && (
                        <div className="mb-6 rounded-2xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 p-5 text-center text-zinc-600 dark:text-zinc-300">
                          {result.message || 'The model could not confidently classify this image.'}
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row gap-3">
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
                    </div>
                  </motion.div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
