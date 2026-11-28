import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, ChevronDown, Loader2, Gift, X, 
  CheckCircle2, Clock, Search, History
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import useDeliveryBackNavigation from '../hooks/useDeliveryBackNavigation';
import { Skeleton } from '@food/components/ui/skeleton';
import { getEatiefyIncentiveBreakdown, formatEatiefyIncentiveLine } from '@/modules/DeliveryV2/utils/earningBreakdown';

const HISTORY_PREFS_KEY = 'delivery_trip_history_prefs_v1';

const toLocalDateKey = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseLocalDateKey = (key) => {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return null;
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
};

const loadHistoryPrefs = () => {
  try {
    const raw = localStorage.getItem(HISTORY_PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * HistoryV2 - EXACT 1:1 Match with User Screenshot.
 * Theme: Clean White
 * Accent: Emerald Green (#10B981)
 * Font: Poppins
 */
export const HistoryV2 = () => {
  const goBack = useDeliveryBackNavigation();
  const savedPrefs = useMemo(() => loadHistoryPrefs(), []);
  const [activeTab, setActiveTab] = useState(() => {
    const tab = String(savedPrefs?.activeTab || 'daily').toLowerCase();
    return ['daily', 'weekly', 'monthly'].includes(tab) ? tab : 'daily';
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    return parseLocalDateKey(savedPrefs?.selectedDate) || new Date();
  });
  const [selectedTripType, setSelectedTripType] = useState(() => {
    const type = savedPrefs?.selectedTripType || 'ALL TRIPS';
    return ['ALL TRIPS', 'Completed', 'Cancelled', 'Pending'].includes(type) ? type : 'ALL TRIPS';
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTripTypePicker, setShowTripTypePicker] = useState(false);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [bonusTransactions, setBonusTransactions] = useState([]);
  const [bonusLoading, setBonusLoading] = useState(false);

  const tripTypes = ["ALL TRIPS", "Completed", "Cancelled", "Pending"];

  // Persist filters so refresh / remount keeps yesterday (etc.) selected
  useEffect(() => {
    try {
      localStorage.setItem(
        HISTORY_PREFS_KEY,
        JSON.stringify({
          activeTab,
          selectedDate: toLocalDateKey(selectedDate),
          selectedTripType,
        }),
      );
    } catch {
      // ignore quota / private mode
    }
  }, [activeTab, selectedDate, selectedTripType]);

  // Fetch Logic
  useEffect(() => {
    const fetchTrips = async () => {
      setLoading(true);
      try {
        const dateStr = toLocalDateKey(selectedDate);

        const params = {
          period: activeTab,
          date: dateStr,
          status: selectedTripType !== "ALL TRIPS" ? selectedTripType : undefined,
          limit: 1000
        };
        
        const response = await deliveryAPI.getTripHistory(params);
        if (response.data?.success) {
          setTrips(response.data.data.trips || []);
        }
      } catch (error) {
        toast.error("Failed to load history");
      } finally {
        setLoading(false);
      }
    };
    fetchTrips();
  }, [selectedDate, activeTab, selectedTripType]);

  // Bonus Logic
  useEffect(() => {
     if (showBonusModal) {
        const fetchBonus = async () => {
           setBonusLoading(true);
           try {
              const res = await deliveryAPI.getWalletTransactions({ type: 'bonus', limit: 50 });
              if (res.data?.success) setBonusTransactions(res.data.data.transactions || []);
           } catch (e) { toast.error("Failed to load bonuses"); }
           finally { setBonusLoading(false); }
        };
        fetchBonus();
     }
  }, [showBonusModal]);

  const formatDateDisplay = (date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const day = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    
    if (date.toDateString() === today.toDateString()) return `Today: ${day}`;
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday: ${day}`;
    return day;
  };

  const recentDates = useMemo(() => {
    return [...Array(30)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d;
    });
  }, []);

  const metrics = useMemo(() => {
     return trips.reduce((acc, trip) => {
        const status = String(trip.status || '').toLowerCase();
        if (status === 'completed') {
           acc.earnings += Number(trip.deliveryEarning ?? trip.amount ?? trip.earningAmount ?? 0) || 0;
           const method = String(trip.paymentMethod || '').toLowerCase();
           const isCOD =
             method === 'cash' ||
             method === 'cod' ||
             method === 'cash on delivery' ||
             method === 'cash_on_delivery';
           if (isCOD) {
             const collected = Number(trip.codCollectedAmount);
             const due = Number(trip.codAmount);
             const fallback = Number(trip.orderTotal);
             const amount = Number.isFinite(collected) && collected > 0
               ? collected
               : Number.isFinite(due) && due > 0
                 ? due
                 : (Number.isFinite(fallback) && fallback > 0 ? fallback : 0);
             acc.cod += amount;
           }
        }
        return acc;
     }, { earnings: 0, cod: 0 });
  }, [trips]);

  const extractItems = (trip) => {
    const items = trip.items || trip.orderItems || [];
    if (items.length === 0) return 'Standard Delivery';
    const first = items[0];
    const qty = first.quantity || first.qty || 1;
    const name = first.name || first.itemName || 'Item';
    return `${qty}x ${name}${items.length > 1 ? ` +${items.length - 1} more` : ''}`;
  }

  return (
    <div className="min-h-screen bg-white font-poppins pb-32">
       {/* 1. Header (Premium V2 Styled) */}
       <div className="bg-[#121212] border-b border-white/10 px-6 py-3 flex items-center justify-between sticky top-0 z-[100] backdrop-blur-2xl">
          <div className="flex items-center gap-4">
            <button onClick={goBack} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white border border-white/10 active:scale-90 transition-all">
               <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
               <h1 className="text-xl font-black text-white uppercase tracking-tighter">Trip History</h1>
               <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">Your delivery milestones</p>
            </div>
          </div>
          <button onClick={() => setShowBonusModal(true)} className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-[#10B981] border border-green-500/20 relative active:scale-90 transition-all">
             <Gift className="w-5 h-5" />
             {bonusTransactions.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#10B981] text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                   {bonusTransactions.length}
                </span>
             )}
          </button>
       </div>

       {/* 2. Selection Tabs (Matched to Image) */}
       <div className="bg-white px-4 flex items-center gap-8 sticky top-[61px] z-[90] border-b border-gray-100">
          {['daily', 'weekly', 'monthly'].map((tab) => (
             <button
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={`py-4 text-base font-medium capitalize relative ${activeTab === tab ? 'text-[#10B981]' : 'text-gray-400'}`}
             >
                {tab}
                {activeTab === tab && <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#10B981]" />}
             </button>
          ))}
       </div>

       {/* 3. Filter Controls (Matched to Image) */}
       <div className="bg-white px-4 py-4 flex gap-3 sticky top-[118px] z-[80]">
          <button 
             onClick={() => { setShowDatePicker(!showDatePicker); setShowTripTypePicker(false); }}
             className="flex-1 px-4 py-3 bg-[#f8f9fa] border border-gray-100 rounded-xl flex items-center justify-between text-gray-800"
          >
             <span className="text-sm font-medium">{formatDateDisplay(selectedDate)}</span>
             <ChevronDown className={`w-4 h-4 text-gray-400 transform transition-transform ${showDatePicker ? 'rotate-180' : ''}`} />
          </button>
          <button 
             onClick={() => { setShowTripTypePicker(!showTripTypePicker); setShowDatePicker(false); }}
             className="w-[140px] px-4 py-3 bg-[#f8f9fa] border border-gray-100 rounded-xl flex items-center justify-between text-gray-800"
          >
             <span className="text-sm font-medium">{selectedTripType}</span>
             <ChevronDown className={`w-4 h-4 text-gray-400 transform transition-transform ${showTripTypePicker ? 'rotate-180' : ''}`} />
          </button>
       </div>

       {/* Dropdowns */}
       <AnimatePresence>
          {showDatePicker && (
             <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="fixed left-4 right-4 top-[185px] z-[200] bg-white rounded-2xl shadow-2xl border border-gray-100 max-h-[300px] overflow-y-auto p-2">
                {recentDates.map((date, idx) => (
                   <button 
                      key={idx} 
                      onClick={() => { setSelectedDate(date); setShowDatePicker(false); }}
                      className={`w-full text-left p-4 rounded-xl text-sm font-medium ${date.toDateString() === selectedDate.toDateString() ? 'bg-green-50 text-[#10B981] font-bold' : 'text-gray-700 hover:bg-gray-50'}`}
                   >
                      {formatDateDisplay(date)}
                   </button>
                ))}
             </motion.div>
          )}
          {showTripTypePicker && (
             <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="fixed right-4 top-[185px] w-48 z-[200] bg-white rounded-2xl shadow-2xl border border-gray-100 p-2">
                {tripTypes.map((type, idx) => (
                   <button 
                      key={idx} 
                      onClick={() => { setSelectedTripType(type); setShowTripTypePicker(false); }}
                      className={`w-full text-left p-4 rounded-xl text-sm font-medium ${type === selectedTripType ? 'bg-green-50 text-[#10B981] font-bold' : 'text-gray-700 hover:bg-gray-50'}`}
                   >
                      {type}
                   </button>
                ))}
             </motion.div>
          )}
       </AnimatePresence>

       {/* 4. Page Content */}
       <div className="px-4 py-2 space-y-5">
          {/* Performance Summary Banner (Matched to Image) */}
          <div className="bg-[#E9F9F4] rounded-2xl p-6 border border-[#D1F2E8] flex justify-between items-center">
             <div>
                <p className="text-[11px] font-bold text-[#10B981] mb-1">COD Collected</p>
                <h3 className="text-xl font-bold text-gray-950 min-h-[1.75rem] flex items-center">
                   {loading ? <Skeleton className="h-7 w-24" /> : `₹${metrics.cod.toFixed(2)}`}
                </h3>
             </div>
             <div className="text-right">
                <p className="text-[11px] font-bold text-[#10B981] mb-1">Earnings</p>
                <h3 className="text-xl font-bold text-gray-950 min-h-[1.75rem] flex items-center justify-end">
                   {loading ? <Skeleton className="h-7 w-24" /> : `₹${metrics.earnings.toFixed(2)}`}
                </h3>
             </div>
          </div>

          {/* Trip List */}
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#10B981]" />
                <p className="text-gray-400 text-xs font-medium">Fetching trips...</p>
             </div>
          ) : trips.length > 0 ? (
             <div className="space-y-4">
                {trips.map((trip, idx) => {
                   const isCompleted = (trip.status || '').toLowerCase() === 'completed';
                   const isCancelled = (trip.status || '').toLowerCase() === 'cancelled';
                   const isPending = !isCompleted && !isCancelled;
                   const payout = Number(trip.deliveryEarning ?? trip.amount ?? trip.earningAmount ?? 0) || 0;
                   const method = String(trip.paymentMethod || '').toLowerCase();
                   const isQR = method === 'razorpay_qr';
                   const isCOD =
                     method === 'cash' ||
                     method === 'cod' ||
                     method === 'cash on delivery' ||
                     method === 'cash_on_delivery';

                   const collectedRaw = Number(trip.codCollectedAmount);
                   const dueRaw = Number(trip.codAmount);
                   const totalRaw = Number(trip.orderTotal);

                   let collection = 0;
                   if (isCOD) {
                     if (isCompleted) {
                       collection = Number.isFinite(collectedRaw) && collectedRaw > 0
                         ? collectedRaw
                         : Number.isFinite(dueRaw) && dueRaw > 0
                           ? dueRaw
                           : (Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0);
                     } else if (isPending) {
                       collection = Number.isFinite(dueRaw) && dueRaw > 0
                         ? dueRaw
                         : (Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0);
                     } else {
                       // Cancelled order: no COD collected
                       collection = 0;
                     }
                   }

                   return (
                      <div key={trip.orderId || idx} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm active:scale-[0.99] transition-all">
                         <div className="flex justify-between items-start mb-2">
                             <div>
                                <h4 className="text-base font-bold text-gray-950">{trip.orderId || 'ORDER-ID'}</h4>
                                <p className="text-sm font-medium text-gray-500 mt-0.5">{trip.restaurant || trip.restaurantName || 'Sayaji'}</p>
                                <p className="text-xs text-gray-400 font-medium mt-0.5 line-clamp-1">{extractItems(trip)}</p>
                             </div>
                             <span className={`text-sm font-bold ${isCompleted ? 'text-[#10B981]' : isCancelled ? 'text-red-500' : 'text-orange-500'}`}>
                                {trip.status || 'Status'}
                             </span>
                         </div>
                         
                         <div className="flex gap-2 mb-4 mt-3">
                             <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${(isCOD || isQR) ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-[#10B981]'}`}>
                                {isQR ? 'COD (QR)' : isCOD ? 'COD' : 'Online'}
                             </span>
                         </div>

                         <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-50">
                             <div>
                                <p className="text-[11px] font-medium text-gray-400 mb-1">Time</p>
                                <p className="text-sm font-bold text-gray-950">{trip.time || '--:--'}</p>
                             </div>
                             <div className="text-center">
                                <p className="text-[11px] font-medium text-gray-400 mb-1">COD</p>
                                <p className="text-sm font-bold text-gray-950">₹{collection.toFixed(2)}</p>
                             </div>
                             <div className="text-right">
                                <p className="text-[11px] font-medium text-gray-400 mb-1">Earning</p>
                                <p className="text-sm font-bold text-gray-950">₹{payout.toFixed(2)}</p>
                             </div>
                         </div>
                         {(() => {
                            const breakdown = getEatiefyIncentiveBreakdown(trip, payout);
                            return breakdown ? (
                               <p className="mt-2 text-right text-[11px] font-semibold text-emerald-700">
                                  {formatEatiefyIncentiveLine(breakdown)}
                               </p>
                            ) : null;
                         })()}
                      </div>
                   );
                })}
             </div>
          ) : (
             <div className="py-20 text-center flex flex-col items-center">
                <Clock className="w-12 h-12 text-gray-100 mb-4" />
                <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No Trips Recorded</p>
             </div>
          )}
       </div>

       {/* Bonus Drawer (The Gift Modal) */}
       <AnimatePresence>
          {showBonusModal && (
             <div className="fixed inset-0 z-[1000] flex items-end">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowBonusModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="relative w-full bg-white rounded-t-[2.5rem] p-8 max-h-[85vh] flex flex-col shadow-2xl">
                   <div className="w-12 h-1 bg-gray-100 rounded-full mx-auto mb-8 shrink-0" />
                   <div className="flex items-center justify-between mb-8 shrink-0">
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center text-[#10B981] border border-green-100">
                            <Gift className="w-6 h-6" />
                         </div>
                         <div>
                            <h3 className="text-lg font-bold text-gray-950">Incentive Records</h3>
                            <p className="text-xs text-gray-400 font-medium">Extra bonuses credited by team</p>
                         </div>
                      </div>
                      <button onClick={() => setShowBonusModal(false)} className="p-2 text-gray-400"><X className="w-5 h-5" /></button>
                   </div>
                   
                   <div className="flex-1 overflow-y-auto pr-1 space-y-4">
                      {bonusLoading ? (
                         <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#10B981]" /></div>
                      ) : bonusTransactions.length > 0 ? bonusTransactions.map((tx, i) => (
                         <div key={i} className="bg-gray-50 rounded-2xl p-5 border border-gray-100 flex justify-between items-center">
                            <div>
                               <p className="text-lg font-bold text-gray-950 mb-0.5">₹{Number(tx.amount || 0).toFixed(2)}</p>
                               <p className="text-sm font-medium text-gray-600 line-clamp-1">{tx.description || 'Bonus Payout'}</p>
                               <p className="text-[10px] text-gray-400 font-medium mt-1">{new Date(tx.createdAt || tx.date).toLocaleDateString()}</p>
                            </div>
                            <span className="bg-green-100 text-[#10B981] text-[10px] font-bold px-3 py-1 rounded-full uppercase">DELIVERED</span>
                         </div>
                      )) : (
                         <div className="py-20 text-center flex flex-col items-center">
                             <Search className="w-12 h-12 text-gray-100 mb-4" />
                             <p className="text-sm font-bold text-gray-400">Nothing to show</p>
                         </div>
                      )}
                   </div>
                   
                   <button onClick={() => setShowBonusModal(false)} className="w-full py-5 bg-black text-white rounded-2xl font-bold text-base mt-8 shrink-0 active:scale-95 transition-all">Okay, Got it</button>
                </motion.div>
             </div>
          )}
       </AnimatePresence>
    </div>
  );
};

export default HistoryV2;
