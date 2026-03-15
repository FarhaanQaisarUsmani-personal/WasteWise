import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, addDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ArrowLeft, ChefHat, Loader2, Sun, Moon, User as UserIcon, Sparkles, Clock, X, Bookmark, BookmarkCheck, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { generateRecipe, type Recipe } from '../services/geminiService';
import { useTheme } from '../components/ThemeProvider';
import Logo from '../components/Logo';

interface FoodItem {
  id: string;
  name: string;
  condition: string;
  selected: boolean;
}

interface SavedRecipe extends Recipe {
  id: string;
  savedAt: string;
}

const glass = 'bg-white/60 dark:bg-zinc-900/50 backdrop-blur-xl border border-white/30 dark:border-zinc-700/30';
const glassInner = 'bg-white/40 dark:bg-zinc-800/40 backdrop-blur-sm border border-white/20 dark:border-zinc-700/20';

export default function RecipeSuggestions() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  useEffect(() => {
    const fetchData = async () => {
      if (!auth.currentUser) return;

      const userDoc = await getDocs(query(collection(db, 'users'), where('__name__', '==', auth.currentUser.uid)));
      if (!userDoc.empty) {
        setDisplayName(userDoc.docs[0].data().displayName || auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'User');
      }

      const q = query(
        collection(db, 'food_scans'),
        where('userId', '==', auth.currentUser.uid),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);

      const seen = new Set<string>();
      const items: FoodItem[] = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const name = (data.item || '').toLowerCase();
        if (name && name !== 'unknown' && !seen.has(name)) {
          seen.add(name);
          items.push({
            id: doc.id,
            name: data.item,
            condition: data.condition || 'unknown',
            selected: true,
          });
        }
      });

      setFoodItems(items);
      setLoading(false);
    };
    fetchData();
  }, []);

  // Listen to saved recipes
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'saved_recipes'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('savedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const recipes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedRecipe[];
      setSavedRecipes(recipes);
    }, (error) => {
      console.error('Error listening to saved recipes:', error.message);
      if (error.message.includes('index')) {
        console.error('👆 Click the link above in Firebase console to create the required index');
      }
    });
    return () => unsubscribe();
  }, []);

  // Check if current recipe is saved
  useEffect(() => {
    if (recipe && savedRecipes.length > 0) {
      const found = savedRecipes.some(r => r.recipeName === recipe.recipeName);
      setIsSaved(found);
    } else {
      setIsSaved(false);
    }
  }, [recipe, savedRecipes]);

  const handleSaveRecipe = async () => {
    if (!auth.currentUser || !recipe || savingRecipe) return;
    setSavingRecipe(true);
    try {
      if (isSaved) {
        // Unsave - find and delete
        const existing = savedRecipes.find(r => r.recipeName === recipe.recipeName);
        if (existing) {
          await deleteDoc(doc(db, 'saved_recipes', existing.id));
          console.log('✅ Recipe removed from saved');
        }
      } else {
        // Save
        await addDoc(collection(db, 'saved_recipes'), {
          userId: auth.currentUser.uid,
          recipeName: recipe.recipeName,
          prepTime: recipe.prepTime,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          savedAt: new Date().toISOString(),
        });
        console.log('✅ Recipe saved successfully');
      }
    } catch (err) {
      console.error('Failed to save/unsave recipe:', err);
      alert('Failed to save recipe. Check console for details.');
    } finally {
      setSavingRecipe(false);
    }
  };

  const handleDeleteSaved = async (recipeId: string) => {
    try {
      await deleteDoc(doc(db, 'saved_recipes', recipeId));
    } catch (err) {
      console.error('Failed to delete saved recipe:', err);
    }
  };

  const toggleItem = (id: string) => {
    setFoodItems(prev =>
      prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item)
    );
  };

  const selectedItems = foodItems.filter(i => i.selected);

  const handleGenerate = async () => {
    if (selectedItems.length === 0) return;
    setGenerating(true);
    setRecipe(null);
    try {
      const result = await generateRecipe(
        selectedItems.map(i => ({ name: i.name, condition: i.condition }))
      );
      console.log('Generated recipe:', result);
      setRecipe(result);
    } catch (err) {
      console.error('Recipe generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 transition-colors duration-300 relative overflow-hidden">
      {/* Background blobs */}
      <div className="fixed -top-40 -right-40 w-96 h-96 bg-amber-200/30 dark:bg-amber-900/15 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed -bottom-40 -left-40 w-96 h-96 bg-orange-200/30 dark:bg-orange-900/15 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed top-1/3 left-1/3 w-72 h-72 bg-emerald-200/20 dark:bg-emerald-900/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-3xl mx-auto relative z-10">
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className={`p-3 ${glass} rounded-full shadow-lg hover:shadow-xl transition-all`}
            >
              <ArrowLeft size={24} className="text-zinc-700 dark:text-zinc-300" />
            </button>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-[#617953] rounded-2xl flex items-center justify-center text-[#d4d9c6] shadow-md">
                <Logo size={40} />
              </div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">AI Recipes</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/profile')}
              className={`flex items-center gap-2 px-4 py-2 ${glass} text-zinc-700 dark:text-zinc-300 hover:shadow-lg rounded-full shadow-md transition-all font-medium`}
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
              className={`p-3 ${glass} rounded-full shadow-md hover:shadow-lg transition-all`}
            >
              {theme === 'dark' ? <Sun size={24} className="text-zinc-300" /> : <Moon size={24} className="text-zinc-700" />}
            </button>
          </div>
        </header>

        {/* Ingredients Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`${glass} rounded-3xl p-6 shadow-lg mb-6`}
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-amber-500/20 p-2 rounded-xl border border-amber-500/20">
              <ChefHat size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Your Ingredients</h2>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : foodItems.length === 0 ? (
            <div className="text-center py-8">
              <ChefHat size={48} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
              <p className="text-zinc-500 dark:text-zinc-400 mb-4">No scanned food items found.</p>
              <button
                onClick={() => navigate('/scan')}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors shadow-lg text-sm"
              >
                Scan Food Items
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                Select ingredients to include in your recipe ({selectedItems.length} selected)
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                {foodItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`px-4 py-2 rounded-2xl text-sm font-medium transition-all flex items-center gap-2 ${
                      item.selected
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shadow-sm'
                        : `${glassInner} text-zinc-500 dark:text-zinc-400`
                    }`}
                  >
                    <span className="capitalize">{item.name}</span>
                    <span className="text-xs opacity-60">({item.condition})</span>
                    {item.selected && <X size={14} className="ml-1" />}
                  </button>
                ))}
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating || selectedItems.length === 0}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-semibold transition-colors disabled:opacity-50 shadow-lg text-base"
              >
                {generating ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Sparkles size={20} />
                )}
                <span>{generating ? 'Generating Recipe...' : 'Generate Recipe with AI'}</span>
              </button>
            </>
          )}
        </motion.div>

        {/* Recipe Result */}
        {recipe && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${glass} rounded-3xl p-6 shadow-lg`}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="bg-emerald-500/20 p-2 rounded-xl border border-emerald-500/20">
                  <Sparkles size={20} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{recipe.recipeName}</h2>
              </div>
              <button
                onClick={handleSaveRecipe}
                disabled={savingRecipe}
                className={`p-2.5 rounded-xl transition-all ${
                  isSaved
                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                    : `${glassInner} text-zinc-500 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400`
                }`}
                title={isSaved ? 'Remove from saved' : 'Save recipe'}
              >
                {savingRecipe ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : isSaved ? (
                  <BookmarkCheck size={20} />
                ) : (
                  <Bookmark size={20} />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 mb-6">
              <Clock size={16} className="text-zinc-500 dark:text-zinc-400" />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{recipe.prepTime}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className={`${glassInner} rounded-2xl p-5`}>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white uppercase tracking-wider mb-3">Ingredients</h3>
                <ul className="space-y-2">
                  {recipe.ingredients.map((ing, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      <span>{ing}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`${glassInner} rounded-2xl p-5`}>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white uppercase tracking-wider mb-3">Instructions</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                  {recipe.instructions}
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/15 dark:border-zinc-700/20">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors disabled:opacity-50"
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                <span>Generate Another Recipe</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* Saved Recipes Section */}
        {savedRecipes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${glass} rounded-3xl p-6 shadow-lg mt-6`}
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-amber-500/20 p-2 rounded-xl border border-amber-500/20">
                <BookmarkCheck size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Saved Recipes</h2>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">({savedRecipes.length})</span>
            </div>

            <div className="space-y-3">
              {savedRecipes.map((saved) => (
                <div
                  key={saved.id}
                  className={`${glassInner} rounded-2xl p-4 cursor-pointer hover:shadow-md transition-all`}
                  onClick={() => setRecipe(saved)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-zinc-900 dark:text-white mb-1">{saved.recipeName}</h3>
                      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <Clock size={12} />
                        <span>{saved.prepTime}</span>
                        <span className="mx-1">•</span>
                        <span>{saved.ingredients.length} ingredients</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSaved(saved.id);
                      }}
                      className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      title="Remove from saved"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
