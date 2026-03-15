import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDocFromServer } from 'firebase/firestore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './components/ThemeProvider';

import SplashScreen from './pages/SplashScreen';
import LoginScreen from './pages/LoginScreen';
import HomeMenu from './pages/HomeMenu';
import Dashboard from './pages/Dashboard';
import ScanReceipt from './pages/ScanReceipt';
import Profile from './pages/Profile';
import RecipeSuggestions from './pages/RecipeSuggestions';

export const AuthContext = React.createContext<{ user: User | null; isAuthReady: boolean }>({
  user: null,
  isAuthReady: false,
});

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Test connection
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });

    // Hide splash screen after 3 seconds
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  if (showSplash) {
    return <SplashScreen />;
  }

  if (!isAuthReady) {
    return null; // Or a simple loading spinner
  }

  return (
    <AuthContext.Provider value={{ user, isAuthReady }}>
      <Router>
        <Routes>
          <Route path="/login" element={!user ? <LoginScreen /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <HomeMenu /> : <Navigate to="/login" />} />
          <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
          <Route path="/scan" element={user ? <ScanReceipt /> : <Navigate to="/login" />} />
          <Route path="/profile" element={user ? <Profile /> : <Navigate to="/login" />} />
          <Route path="/recipes" element={user ? <RecipeSuggestions /> : <Navigate to="/login" />} />
        </Routes>
      </Router>
    </AuthContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </ThemeProvider>
  );
}
