import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  Trash2, 
  DollarSign, 
  PieChart, 
  ArrowUpRight, 
  ArrowDownRight,
  Search,
  Loader2,
  Globe,
  LogOut,
  LogIn,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';
import { cn, formatCurrency, formatPercentage } from './lib/utils';
import { StockHolding, PortfolioSummary } from './types';
import { fetchStockPrices, getExchangeRate } from './services/gemini';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  onAuthStateChanged, 
  User, 
  handleFirestoreError, 
  OperationType 
} from './firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newTicker, setNewTicker] = useState('');
  const [newShares, setNewShares] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCurrency, setNewCurrency] = useState<'USD' | 'KRW'>('USD');
  const [baseCurrency, setBaseCurrency] = useState<'USD' | 'KRW'>('KRW');
  const [usdToKrwRate, setUsdToKrwRate] = useState<number>(1350); // Default fallback
  const [error, setError] = useState<string | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        // Create user profile if it doesn't exist
        const userRef = doc(db, 'users', currentUser.uid);
        setDoc(userRef, {
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          createdAt: new Date().toISOString()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`));
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time Holdings Listener
  useEffect(() => {
    // If not logged in, we show a "Public/Demo" portfolio
    const targetUid = user ? user.uid : 'public_portfolio';

    const holdingsRef = collection(db, 'users', targetUid, 'holdings');
    const q = query(holdingsRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as StockHolding[];
      setHoldings(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${targetUid}/holdings`);
    });

    return () => unsubscribe();
  }, [user]);

  const summary = useMemo<PortfolioSummary>(() => {
    const totalValue = holdings.reduce((sum, h) => {
      let value = (h.currentPrice || h.avgPrice) * h.shares;
      if (h.currency !== baseCurrency) {
        value = h.currency === 'USD' ? value * usdToKrwRate : value / usdToKrwRate;
      }
      return sum + value;
    }, 0);

    const totalCost = holdings.reduce((sum, h) => {
      let cost = h.avgPrice * h.shares;
      if (h.currency !== baseCurrency) {
        cost = h.currency === 'USD' ? cost * usdToKrwRate : cost / usdToKrwRate;
      }
      return sum + cost;
    }, 0);

    const totalGainLoss = totalValue - totalCost;
    const totalGainLossPercentage = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;

    return {
      totalValue,
      totalCost,
      totalGainLoss,
      totalGainLossPercentage
    };
  }, [holdings, baseCurrency, usdToKrwRate]);

  const handleRefresh = async () => {
    if (!user || holdings.length === 0) return;
    setIsRefreshing(true);
    setError(null);
    try {
      const tickersToFetch = holdings.map(h => ({ ticker: h.ticker, currency: h.currency }));
      const [prices, rate] = await Promise.all([
        fetchStockPrices(tickersToFetch),
        getExchangeRate('USD', 'KRW')
      ]);
      
      setUsdToKrwRate(rate);
      
      // Update each holding in Firestore
      const updatePromises = holdings.map(h => {
        const normalizedTicker = h.ticker.trim().toUpperCase();
        const newPrice = prices[normalizedTicker];
        if (typeof newPrice === 'number') {
          const holdingRef = doc(db, 'users', user.uid, 'holdings', h.id);
          return setDoc(holdingRef, {
            currentPrice: newPrice,
            lastUpdated: new Date().toISOString()
          }, { merge: true });
        }
        return Promise.resolve();
      });
      
      await Promise.all(updatePromises);
    } catch (err) {
      setError("Failed to fetch latest prices. Please try again.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTicker || !newShares || !newPrice) return;

    const ticker = newTicker.trim().toUpperCase();
    const shares = parseFloat(newShares);
    const avgPrice = parseFloat(newPrice);
    const currency = newCurrency;

    try {
      const holdingsRef = collection(db, 'users', user.uid, 'holdings');
      const docRef = await addDoc(holdingsRef, {
        ticker,
        shares,
        avgPrice,
        currency,
        currentPrice: avgPrice,
        lastUpdated: new Date().toISOString()
      });

      setNewTicker('');
      setNewShares('');
      setNewPrice('');

      // Immediately try to fetch the real current price
      const prices = await fetchStockPrices([{ ticker, currency }]);
      const fetchedPrice = prices[ticker];
      if (typeof fetchedPrice === 'number') {
        await setDoc(doc(db, 'users', user.uid, 'holdings', docRef.id), {
          currentPrice: fetchedPrice,
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/holdings`);
    }
  };

  const removeHolding = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'holdings', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/holdings/${id}`);
    }
  };

  const chartData = useMemo(() => {
    return holdings.map(h => {
      let profit = ((h.currentPrice || h.avgPrice) - h.avgPrice) * h.shares;
      if (h.currency !== baseCurrency) {
        profit = h.currency === 'USD' ? profit * usdToKrwRate : profit / usdToKrwRate;
      }
      return {
        name: h.ticker,
        profit
      };
    }).sort((a, b) => b.profit - a.profit);
  }, [holdings, baseCurrency, usdToKrwRate]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-auto py-4 sm:h-16 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 self-start sm:self-center">
            <div className="bg-indigo-600 p-2 rounded-lg shrink-0">
              <TrendingUp className="text-white w-5 h-5" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-none">StockWise</h1>
              <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded uppercase tracking-wider w-fit">
                Data Delayed ~15m
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between w-full sm:w-auto gap-3 sm:gap-4">
            {user ? (
              <div className="flex items-center gap-3 mr-2">
                <div className="hidden md:block text-right">
                  <p className="text-xs font-bold text-slate-900">{user.displayName}</p>
                  <p className="text-[10px] text-slate-500">{user.email}</p>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                    <UserIcon className="w-4 h-4 text-slate-500" />
                  </div>
                )}
                <button 
                  onClick={logout}
                  className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={loginWithGoogle}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm"
              >
                <LogIn className="w-4 h-4" />
                Login
              </button>
            )}
            <div className="flex bg-slate-100 p-1 rounded-lg shrink-0">
              <button 
                onClick={() => setBaseCurrency('KRW')}
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
                  baseCurrency === 'KRW' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                KRW
              </button>
              <button 
                onClick={() => setBaseCurrency('USD')}
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
                  baseCurrency === 'USD' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                USD
              </button>
            </div>
            <button 
              onClick={handleRefresh}
              disabled={isRefreshing || holdings.length === 0}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isRefreshing ? 'Updating...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isAuthReady ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
            <p className="text-slate-500 font-medium">Loading your portfolio...</p>
          </div>
        ) : (
          <>
            {/* Dashboard Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <span className="text-slate-500 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Total Value ({baseCurrency})</span>
              <DollarSign className="text-indigo-500 w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 truncate">{formatCurrency(summary.totalValue, baseCurrency)}</div>
            <div className="mt-1 sm:mt-2 text-xs text-slate-500">
              Cost Basis: {formatCurrency(summary.totalCost, baseCurrency)}
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <span className="text-slate-500 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Total Profit/Loss</span>
              <PieChart className="text-indigo-500 w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className={cn(
              "text-2xl sm:text-3xl font-bold flex items-center gap-2 truncate",
              summary.totalGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"
            )}>
              {summary.totalGainLoss >= 0 ? <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6" /> : <TrendingDown className="w-5 h-5 sm:w-6 sm:h-6" />}
              {formatCurrency(summary.totalGainLoss, baseCurrency)}
            </div>
            <div className={cn(
              "mt-1 sm:mt-2 text-xs font-semibold flex items-center gap-1",
              summary.totalGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"
            )}>
              {summary.totalGainLoss >= 0 ? <ArrowUpRight className="w-3 h-3 sm:w-4 sm:h-4" /> : <ArrowDownRight className="w-3 h-3 sm:w-4 sm:h-4" />}
              {formatPercentage(summary.totalGainLossPercentage)}
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <span className="text-slate-500 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Exchange Rate</span>
              <Globe className="text-indigo-500 w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 truncate">1 USD = {usdToKrwRate.toLocaleString()} KRW</div>
            <div className="mt-1 sm:mt-2 text-xs text-slate-500">
              Used for portfolio conversion
            </div>
          </motion.div>
        </div>

        <div className={cn(
          "flex flex-col gap-8",
          user ? "lg:grid lg:grid-cols-3" : "max-w-4xl mx-auto"
        )}>
          {/* Main Content: Holdings (Top on mobile, Right on desktop) */}
          <div className={cn(
            "order-1 space-y-8",
            user ? "lg:order-2 lg:col-span-2" : "w-full"
          )}>
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-bold">Your Holdings</h2>
                {error && <span className="text-xs text-rose-500 font-medium">{error}</span>}
              </div>
              
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                      <th className="px-6 py-4">Ticker</th>
                      <th className="px-6 py-4">Shares</th>
                      <th className="px-6 py-4">Avg. Price</th>
                      <th className="px-6 py-4">Current</th>
                      <th className="px-6 py-4">Gain/Loss</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence mode="popLayout">
                      {holdings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                            No holdings yet. {user ? 'Add your first stock to get started.' : 'Login to start tracking your own portfolio.'}
                          </td>
                        </tr>
                      ) : (
                        holdings.map((h) => {
                          const gainLoss = ((h.currentPrice || h.avgPrice) - h.avgPrice) * h.shares;
                          const gainLossPct = (gainLoss / (h.avgPrice * h.shares)) * 100;
                          
                          return (
                            <motion.tr 
                              key={h.id}
                              layout
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0, x: -20 }}
                              className="hover:bg-slate-50 transition-colors group"
                            >
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-bold",
                                    h.currency === 'USD' ? "bg-blue-100 text-blue-600" : "bg-red-100 text-red-600"
                                  )}>
                                    {h.currency}
                                  </span>
                                  <div className="font-bold text-slate-900">{h.ticker}</div>
                                </div>
                                <div className="text-[10px] text-slate-400 font-medium">
                                  {h.lastUpdated ? `Updated ${new Date(h.lastUpdated).toLocaleTimeString()}` : 'Never updated'}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm font-medium text-slate-600">{h.shares}</td>
                              <td className="px-6 py-4 text-sm font-medium text-slate-600">{formatCurrency(h.avgPrice, h.currency)}</td>
                              <td className="px-6 py-4 text-sm font-bold text-indigo-600">
                                {formatCurrency(h.currentPrice || h.avgPrice, h.currency)}
                              </td>
                              <td className="px-6 py-4">
                                <div className={cn(
                                  "text-sm font-bold flex items-center gap-1",
                                  gainLoss >= 0 ? "text-emerald-600" : "text-rose-600"
                                )}>
                                  {gainLoss >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                  {formatCurrency(gainLoss, h.currency)}
                                </div>
                                <div className={cn(
                                  "text-[10px] font-bold",
                                  gainLoss >= 0 ? "text-emerald-500" : "text-rose-500"
                                )}>
                                  {gainLossPct >= 0 ? '+' : ''}{gainLossPct.toFixed(2)}%
                                </div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                {user && (
                                  <button 
                                    onClick={() => removeHolding(h.id)}
                                    className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </motion.tr>
                          );
                        })
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-slate-100">
                <AnimatePresence mode="popLayout">
                  {holdings.length === 0 ? (
                    <div className="px-6 py-12 text-center text-slate-400 text-sm">
                      No holdings yet. {user ? 'Add your first stock to get started.' : 'Login to start tracking your own portfolio.'}
                    </div>
                  ) : (
                    holdings.map((h) => {
                      const gainLoss = ((h.currentPrice || h.avgPrice) - h.avgPrice) * h.shares;
                      const gainLossPct = (gainLoss / (h.avgPrice * h.shares)) * 100;
                      
                      return (
                        <motion.div 
                          key={h.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-bold",
                                h.currency === 'USD' ? "bg-blue-100 text-blue-600" : "bg-red-100 text-red-600"
                              )}>
                                {h.currency}
                              </span>
                              <span className="font-bold text-slate-900">{h.ticker}</span>
                              <span className="text-xs text-slate-400 font-medium">({h.shares} shares)</span>
                            </div>
                            {user && (
                              <button 
                                onClick={() => removeHolding(h.id)}
                                className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Avg / Current</p>
                              <p className="text-xs font-medium text-slate-600">
                                {formatCurrency(h.avgPrice, h.currency)} / <span className="text-indigo-600 font-bold">{formatCurrency(h.currentPrice || h.avgPrice, h.currency)}</span>
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Gain / Loss</p>
                              <div className={cn(
                                "text-xs font-bold flex items-center justify-end gap-1",
                                gainLoss >= 0 ? "text-emerald-600" : "text-rose-600"
                              )}>
                                {gainLoss >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                {formatCurrency(gainLoss, h.currency)}
                                <span className="text-[10px]">({gainLossPct >= 0 ? '+' : ''}{gainLossPct.toFixed(1)}%)</span>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>

          {/* Sidebar: Form (Bottom on mobile, Left on desktop) */}
          {user && (
            <div className="order-2 lg:order-1 lg:col-span-1 space-y-8">
              {/* Add Stock Form */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-indigo-600" />
                  Add New Position
                </h2>
              <form onSubmit={handleAddStock} className="space-y-4">
                <div className="flex gap-2 p-1 bg-slate-50 rounded-xl mb-4 overflow-x-auto no-scrollbar">
                  <button 
                    type="button"
                    onClick={() => setNewCurrency('USD')}
                    className={cn(
                      "flex-1 py-2 px-3 text-[10px] sm:text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                      newCurrency === 'USD' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    USD (US Market)
                  </button>
                  <button 
                    type="button"
                    onClick={() => setNewCurrency('KRW')}
                    className={cn(
                      "flex-1 py-2 px-3 text-[10px] sm:text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                      newCurrency === 'KRW' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    KRW (KR Market)
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Ticker Symbol</label>
                  <input 
                    type="text" 
                    placeholder={newCurrency === 'USD' ? "e.g. AAPL" : "e.g. 005930"}
                    value={newTicker}
                    onChange={(e) => setNewTicker(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Shares</label>
                    <input 
                      type="number" 
                      step="any"
                      placeholder="0.00"
                      value={newShares}
                      onChange={(e) => setNewShares(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Avg. Price ({newCurrency})</label>
                    <input 
                      type="number" 
                      step="any"
                      placeholder="0.00"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      required
                    />
                  </div>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add to Portfolio
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </>
  )}
</main>
    </div>
  );
}
