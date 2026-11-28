import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import { UtensilsCrossed, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence, usePresence } from "framer-motion";

const CookingAnimation = memo(() => (
  <div className="relative w-12 h-12 flex items-center justify-center rounded-xl bg-orange-50 border border-orange-100 overflow-visible shadow-[0_4px_15px_rgba(235,89,14,0.15)] shrink-0">
    <div className="absolute -top-3 flex gap-1.5">
      <motion.div animate={{ opacity: [0, 0.8, 0], y: [0, -8, -12], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0, ease: "easeOut" }} className="w-1.5 h-3 bg-orange-400/50 rounded-full" />
      <motion.div animate={{ opacity: [0, 0.8, 0], y: [0, -10, -15], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.5, ease: "easeOut" }} className="w-1.5 h-3 bg-orange-400/50 rounded-full" />
      <motion.div animate={{ opacity: [0, 0.8, 0], y: [0, -8, -12], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity, delay: 1, ease: "easeOut" }} className="w-1.5 h-3 bg-orange-400/50 rounded-full" />
    </div>
    <motion.div animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }} className="relative z-10 mt-1" style={{ transformOrigin: "center center" }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#1F6B45]" style={{ shapeRendering: "geometricPrecision" }}>
        {/* Cooker Body */}
        <path d="M6 10h12v6a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-6z" />
        {/* Lid Rim */}
        <rect x="5" y="8" width="14" height="2" rx="1" />
        {/* Pressure Whistle (Top) */}
        <path d="M12 8V5" />
        <path d="M11 5h2v2h-2z" fill="currentColor" />
        {/* Main Handle (Right) */}
        <path d="M19 9l3-1v2l-3 1" fill="currentColor" strokeWidth="1" />
        {/* Sub Handle (Left) */}
        <path d="M5 10H3v2h2" />
      </svg>
    </motion.div>
    {/* Flame below */}
    <motion.div animate={{ opacity: [0.4, 0.8, 0.4], scaleX: [0.8, 1.2, 0.8] }} transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }} className="absolute bottom-0 w-full flex justify-center z-0">
      <div className="w-4 h-1 bg-[#1F6B45] rounded-full" />
    </motion.div>
  </div>
));

import { useOrders } from "@food/context/OrdersContext";
import { useProfile } from "@food/context/ProfileContext";
import { orderAPI } from "@food/api";
import { isModuleAuthenticated } from "@food/utils/auth";
import { getOrderRestaurantInfo } from "@food/hooks/useActiveOrderTracking";

const getOrderKey = (order) => order?.id || order?._id || order?.orderId || null;

const normalizeOrderToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

const getOrderStatus = (order) =>
  normalizeOrderToken(
    order?.orderStatus || order?.status || order?.deliveryState?.status || order?.deliveryStatus || "",
  );

const getOrderPhase = (order) =>
  normalizeOrderToken(order?.deliveryState?.currentPhase || order?.currentPhase || "");

const ACTIVE_PHASES = new Set([
  "created",
  "confirmed",
  "preparing",
  "accepted",
  "ready",
  "ready_for_pickup",
  "reached_pickup",
  "picked_up",
  "out_for_delivery",
  "en_route_to_delivery",
  "at_pickup",
  "at_drop",
  "reached_drop",
]);

/** Orders that should show the live tracking strip (any in-flight order, not terminal). */
const TERMINAL_STATUSES = new Set([
  "delivered",
  "cancelled",
  "canceled",
  "completed",
  "failed",
  "cancelled_by_user",
  "canceled_by_user",
  "cancelled_by_restaurant",
  "canceled_by_restaurant",
  "cancelled_by_admin",
  "canceled_by_admin",
]);

const isActiveOrder = (order) => {
  if (!order) return false;
  const status = getOrderStatus(order);
  const phase = getOrderPhase(order);
  if (TERMINAL_STATUSES.has(status)) return false;
  if (phase === "completed" || phase === "delivered") return false;

  // Don't show live tracker for scheduled orders that haven't started yet
  // They stay in 'confirmed' status until the restaurant starts preparing them.
  if (order.scheduledAt && (status === "confirmed" || status === "created" || status === "pending")) {
    return false;
  }

  // Some refresh payloads provide live phase but sparse status; keep tracking visible.
  if (!status && phase) return ACTIVE_PHASES.has(phase);
  if (!status) return false;
  return true;
};

const parsePrepMinutes = (preparationTime) => {
  if (!preparationTime) return null;
  const num = Number(preparationTime);
  if (Number.isFinite(num) && num > 0) return num;
  // Parse strings like "10-20 mins", "25-35 mins" → take the max value
  const match = String(preparationTime).match(/(\d+)\s*-\s*(\d+)/);
  if (match) return Number(match[2]); // use upper bound
  const single = String(preparationTime).match(/(\d+)/);
  if (single) return Number(single[1]);
  return null;
};

const getTimeRemaining = (order) => {
  if (!order) return null;

  // If preparationTime is set by the restaurant, use acceptedAt + preparationTime
  const prepMins = parsePrepMinutes(order.preparationTime);
  if (prepMins && order.acceptedAt) {
    const acceptTime = new Date(order.acceptedAt);
    const targetTime = new Date(acceptTime.getTime() + prepMins * 60000);
    const diff = (targetTime - new Date()) / 60000;
    return Math.ceil(diff);
  }

  // Use scheduled time if available, fallback to creation time
  const orderTime = new Date(
    order.scheduledAt || order.createdAt || order.orderDate || order.created_at || order.date || Date.now(),
  );

  // For non-scheduled orders, we add the estimated delivery time to the creation time.
  // For scheduled orders, scheduledAt is already the target time.
  const isScheduled = !!order.scheduledAt;
  const estimatedMinutes = isScheduled 
    ? 0 
    : (order.estimatedDeliveryTime || order.estimatedTime || order.estimated_delivery_time || 35);

  const deliveryTime = new Date(orderTime.getTime() + estimatedMinutes * 60000);
  return Math.max(0, Math.ceil((deliveryTime - new Date()) / 60000));
};

/** Cheap fingerprint so we skip setState when list content is unchanged (fewer re-renders). */
function ordersFingerprint(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return "";
  return orders
    .map((o) => `${getOrderKey(o)}:${getOrderStatus(o)}`)
    .join("|");
}

function OrderTrackingCardInner({ hasBottomNav = true }) {
  const navigate = useNavigate();
  const { orders: contextOrders } = useOrders();
  const { orderType } = useProfile();
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [apiOrders, setApiOrders] = useState([]);
  const [hasFetchedApi, setHasFetchedApi] = useState(false);
  const [activeOrderOverride, setActiveOrderOverride] = useState(null);
  const lastRefreshRef = useRef(0);
  const lastApiFingerprintRef = useRef("");
  const activeOrderKeyRef = useRef("");
  const activeOrderSnapshotRef = useRef(null);
  const [invalidOrderIds, setInvalidOrderIds] = useState(new Set());
  // Guard: track which order keys are currently being verified to prevent concurrent duplicate calls
  const verifyingKeysRef = useRef(new Set());
  const lastVerifyTimeRef = useRef({});
  // Guard: prevent concurrent fetchOrders calls (StrictMode double-invoke / event storms)
  const isFetchingOrdersRef = useRef(false);
  const lastFetchOrdersTimeRef = useRef(0);

  const fetchOrders = useCallback(async () => {
    if (!isModuleAuthenticated("user")) {
      setHasFetchedApi(true);
      return;
    }
    // Drop duplicate concurrent calls — only one fetch at a time
    if (isFetchingOrdersRef.current) return;
    // Throttle: don't re-fetch within 2 seconds of the last completed fetch
    const now = Date.now();
    if (now - lastFetchOrdersTimeRef.current < 2000) return;
    isFetchingOrdersRef.current = true;
    try {
      const response = await orderAPI.getOrders({ limit: 10, page: 1 });
      let nextOrders = [];

      if (response?.data?.success && response?.data?.data?.orders) {
        nextOrders = response.data.data.orders;
      } else if (response?.data?.orders) {
        nextOrders = response.data.orders;
      } else if (response?.data?.data?.data && Array.isArray(response.data.data.data)) {
        nextOrders = response.data.data.data;
      } else if (response?.data?.data?.docs && Array.isArray(response.data.data.docs)) {
        nextOrders = response.data.data.docs;
      } else if (response?.data?.data && Array.isArray(response.data.data)) {
        nextOrders = response.data.data;
      }

      const list = Array.isArray(nextOrders) ? nextOrders : [];
      const fp = ordersFingerprint(list);
      if (fp !== lastApiFingerprintRef.current) {
        lastApiFingerprintRef.current = fp;
        setApiOrders(list);
      }
    } catch (error) {
      if (error?.response?.status === 401) {
        localStorage.removeItem("user_accessToken");
        localStorage.removeItem("accessToken");
      }
      if (lastApiFingerprintRef.current !== "") {
        lastApiFingerprintRef.current = "";
        setApiOrders([]);
      }
    } finally {
      lastFetchOrdersTimeRef.current = Date.now();
      isFetchingOrdersRef.current = false;
      setHasFetchedApi(true);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 60000); // 60s — live updates via Socket.IO anyway
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const uniqueOrders = useMemo(() => {
    const isMongoObjectId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ""));
    const serverKeys = new Set(
      (apiOrders || []).map((o) => String(getOrderKey(o) || "")).filter(Boolean),
    );
    const seen = new Set();

    return [...apiOrders, ...contextOrders].filter((order) => {
      const key = getOrderKey(order);
      if (!key || seen.has(key)) {
        return false;
      }
      if (invalidOrderIds.has(key)) {
        return false;
      }
      // After first API sync, ignore stale local Mongo-like ids that are absent server-side.
      // This prevents repeated verification calls for already-deleted orders.
      if (
        hasFetchedApi &&
        isMongoObjectId(key) &&
        !serverKeys.has(String(key))
      ) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [contextOrders, apiOrders, invalidOrderIds, hasFetchedApi]);

  const activeOrder = useMemo(() => {
    const currentTabType = orderType || "delivery";
    const filteredOrders = uniqueOrders.filter((order) => {
      const type = order?.orderType || "delivery";
      return type === currentTabType;
    });

    const candidate = filteredOrders.find((order) => isActiveOrder(order)) || null;
    if (!candidate) return null;
    const overrideKey = getOrderKey(activeOrderOverride);
    const candidateKey = getOrderKey(candidate);
    if (overrideKey && candidateKey && overrideKey === candidateKey) return activeOrderOverride;
    return candidate;
  }, [uniqueOrders, activeOrderOverride, orderType]);

  useEffect(() => {
    const key = String(getOrderKey(activeOrder) || "");
    activeOrderKeyRef.current = key;
    activeOrderSnapshotRef.current = activeOrder;
  }, [activeOrder]);

  useEffect(() => {
    const handleOrderStatusNotification = async (event) => {
      const detail = event?.detail || {};
      const incomingKey = String(detail?.orderMongoId || detail?.orderId || "").trim();
      const currentKey = activeOrderKeyRef.current;
      if (!incomingKey || !currentKey) return;
      if (incomingKey !== currentKey) return;

      const snap = activeOrderSnapshotRef.current;

      setActiveOrderOverride((prev) => ({
        ...(prev || snap || {}),
        orderStatus: detail?.orderStatus || prev?.orderStatus || snap?.orderStatus,
        deliveryState: detail?.deliveryState
          ? { ...(prev?.deliveryState || snap?.deliveryState || {}), ...detail.deliveryState }
          : prev?.deliveryState || snap?.deliveryState,
        status: detail?.status || prev?.status || snap?.status,
      }));

      const now = Date.now();
      if (now - lastRefreshRef.current < 1500) return;
      lastRefreshRef.current = now;

      try {
        const response = await orderAPI.getOrderDetails(incomingKey);
        const fresh = response?.data?.data?.order || response?.data?.order || response?.data?.data || null;
        if (fresh) setActiveOrderOverride(fresh);
      } catch (error) {
        if (error?.response?.status === 404 || error?.response?.status === 400) {
          setInvalidOrderIds((prev) => {
            const next = new Set(prev);
            next.add(incomingKey);
            return next;
          });
        }
      }
    };

    const handleOrderPlaced = () => {
      fetchOrders();
    };

    window.addEventListener("orderStatusNotification", handleOrderStatusNotification);
    window.addEventListener("order-placed", handleOrderPlaced);

    return () => {
      window.removeEventListener("orderStatusNotification", handleOrderStatusNotification);
      window.removeEventListener("order-placed", handleOrderPlaced);
    };
  }, [fetchOrders]);

  useEffect(() => {
    if (!activeOrder) {
      setTimeRemaining((prev) => (prev !== null ? null : prev));
      return;
    }

    const tick = () => {
      const next = getTimeRemaining(activeOrder);
      setTimeRemaining((prev) => (prev === next ? prev : next));
    };

    tick();
    const interval = setInterval(tick, 60000);

    return () => clearInterval(interval);
  }, [activeOrder]);

  // Proactive verification for active orders not found in recent API list
  useEffect(() => {
    const key = getOrderKey(activeOrder);
    if (!key || invalidOrderIds.has(key)) return;

    // If order is present in the recent server-provided list, we consider it valid without extra check
    const isRecentlyConfirmed = apiOrders.some((o) => getOrderKey(o) === key);
    if (isRecentlyConfirmed) return;

    // Prevent concurrent duplicate calls for the same key
    if (verifyingKeysRef.current.has(key)) return;

    // Cooldown: don't re-verify the same key more than once per 8 seconds
    const now = Date.now();
    const lastVerify = lastVerifyTimeRef.current[key] || 0;
    if (now - lastVerify < 8000) return;

    const verifyOrderExists = async () => {
      verifyingKeysRef.current.add(key);
      lastVerifyTimeRef.current[key] = Date.now();
      try {
        await orderAPI.getOrderDetails(key);
      } catch (error) {
        if (error?.response?.status === 404 || error?.response?.status === 400) {
          setInvalidOrderIds((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
        }
      } finally {
        verifyingKeysRef.current.delete(key);
      }
    };

    verifyOrderExists();
  }, [activeOrder, apiOrders, invalidOrderIds]);

  const [dismissedKey, setDismissedKey] = useState(null);

  const shouldShow = useMemo(() => {
    if (!activeOrder) return false;
    const currentOrderKey = activeOrder.id || activeOrder._id || activeOrder.orderId;
    if (dismissedKey === currentOrderKey) return false;

    const orderStatus = getOrderStatus(activeOrder) || "preparing";
    const orderPhase = getOrderPhase(activeOrder);
    if (TERMINAL_STATUSES.has(orderStatus) || orderPhase === "cancelled" || orderPhase === "canceled") {
      return false;
    }
    return true;
  }, [activeOrder, dismissedKey]);

  const currentOrderKey = activeOrder ? (activeOrder.id || activeOrder._id || activeOrder.orderId) : null;

  const restaurantName = useMemo(() => {
    if (!activeOrder) return "Restaurant";
    return (
      activeOrder.restaurant || 
      activeOrder.restaurantName || 
      activeOrder.restaurantId?.restaurantName || 
      activeOrder.restaurantId?.name || 
      "Restaurant"
    );
  }, [activeOrder]);

  const orderStatus = activeOrder ? getOrderStatus(activeOrder) : "preparing";
  const orderPhase = activeOrder ? getOrderPhase(activeOrder) : "";

  // Detect preparing-expired: timer set, expired, but status still preparing/accepted
  const isPreparingExpired = useMemo(() => {
    const s = String(orderStatus);
    const isPreparing = s === "preparing" || s === "accepted" || s === "processed";
    return isPreparing && activeOrder?.preparationTime && activeOrder?.acceptedAt && timeRemaining !== null && timeRemaining <= 0;
  }, [orderStatus, activeOrder, timeRemaining]);

  const statusText = useMemo(() => {
    if (!activeOrder) return "";
    const s = String(orderStatus);
    const p = String(orderPhase);

    if (s === "confirmed" || s === "placed" || s === "created" || s === "pending") {
      return "Waiting for restaurant to accept";
    }
    if (s === "preparing" || s === "accepted" || s === "processed") {
      // If prep time expired but restaurant hasn't marked ready yet
      if (activeOrder?.preparationTime && activeOrder?.acceptedAt && timeRemaining !== null && timeRemaining <= 0) {
        return "Waiting for restaurant";
      }
      return "Preparing your order";
    }
    if (s === "ready_for_pickup" || s === "ready") return "Ready for pickup";

    if (s === "reached_pickup" || p === "at_pickup") return "Delivery partner reached restaurant";
    if (s === "picked_up" || p === "en_route_to_delivery" || s === "out_for_delivery") return "On the way";
    if (s === "reached_drop" || p === "at_drop" || s === "at_drop") return "Arrived near you";

    if (s === "delivered" || p === "delivered" || p === "completed") return "Delivered";
    return "Waiting for restaurant to accept";
  }, [activeOrder, orderStatus, orderPhase, timeRemaining]);

  return (
    <AnimatePresence>
      {shouldShow && (
        <TrackingCardContent
          activeOrder={activeOrder}
          currentOrderKey={currentOrderKey}
          hasBottomNav={hasBottomNav}
          timeRemaining={timeRemaining}
          statusText={statusText}
          restaurantName={restaurantName}
          orderStatus={orderStatus}
          orderType={orderType}
          isPreparingExpired={isPreparingExpired}
          setDismissedKey={setDismissedKey}
          navigate={navigate}
        />
      )}
    </AnimatePresence>
  );
}

const TrackingCardContent = memo(({
  activeOrder,
  currentOrderKey,
  hasBottomNav,
  timeRemaining,
  statusText,
  restaurantName,
  orderStatus,
  orderType,
  isPreparingExpired,
  setDismissedKey,
  navigate
}) => {
  const restaurantInfo = getOrderRestaurantInfo(activeOrder);
  const [isPresent] = usePresence();
  const [animationCompleted, setAnimationCompleted] = useState(false);

  const shouldClearTransform = animationCompleted && isPresent;

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      onAnimationComplete={() => setAnimationCompleted(true)}
      className={`fixed ${hasBottomNav ? "bottom-32" : "bottom-6"} left-4 right-4 z-40 pointer-events-none antialiased`}
      style={{
        transform: shouldClearTransform ? "none" : undefined,
        transformStyle: shouldClearTransform ? "flat" : "preserve-3d",
      }}
    >
      <div 
        onClick={(e) => {
          e.stopPropagation();
          navigate(
            `/food/user/orders/${activeOrder.id || activeOrder._id || activeOrder.orderId}`,
          );
        }}
        className="relative pointer-events-auto bg-white rounded-[20px] p-4 shadow-[0_8px_30px_rgba(235,89,14,0.15)] border border-orange-100/60 overflow-visible cursor-pointer group select-none"
        style={{
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }}
      >
        {/* Subtle gradient background mesh */}
        <div className="absolute inset-0 bg-gradient-to-r from-orange-50/50 via-white/40 to-white/80 opacity-60 pointer-events-none rounded-[20px]" />
        
        <button 
           onClick={(e) => { e.stopPropagation(); setDismissedKey(currentOrderKey); }}
           className="absolute top-2 right-2 p-1.5 rounded-full bg-orange-50/80 text-orange-400 hover:text-[#14512F] hover:bg-orange-100/80 transition-colors z-20 shadow-sm"
        >
          <X className="w-3.5 h-3.5 pointer-events-none" />
        </button>

        <div className="flex items-center gap-4 relative z-10 w-full">
          {restaurantInfo.image ? <img src={restaurantInfo.image} alt={restaurantName} className="w-12 h-12 rounded-xl object-cover border border-orange-100 shadow-sm shrink-0 bg-orange-50" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <CookingAnimation />}

          <div className="flex-1 min-w-0 pr-4">
            <p className="text-gray-900 font-bold text-base md:text-lg truncate tracking-tight">{restaurantName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-gray-500 font-medium text-xs md:text-sm truncate">{statusText}</p>
              <ChevronRight className="w-3.5 h-3.5 text-[#1F6B45] shrink-0 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {(() => {
            const isTakeawayOrDining = orderType === "takeaway" || orderType === "dining" || activeOrder?.orderType === "takeaway" || activeOrder?.orderType === "dining";
            const rawStatus = getOrderStatus(activeOrder);
            const rawPhase = getOrderPhase(activeOrder);
            const isReadyOrder = rawStatus === "ready" || rawStatus === "ready_for_pickup" || orderStatus === "ready" || orderStatus === "ready_for_pickup";
            const isAccepted = !["created", "pending", "confirmed", "placed", ""].includes(rawStatus);

            if (!isAccepted) {
              return (
                <div className="bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-orange-500/20 rounded-xl px-4 py-2 shrink-0 flex flex-col items-center justify-center border border-amber-400">
                  <p className="text-orange-50 text-[10px] font-bold uppercase tracking-wider opacity-95 leading-tight mb-[2px]">
                    order
                  </p>
                  <p className="text-white text-base md:text-[17px] font-black leading-tight drop-shadow-sm uppercase">
                    placed
                  </p>
                </div>
              );
            }

            if (isTakeawayOrDining && isReadyOrder) {
              return (
                <div className="bg-gradient-to-br from-green-600 to-emerald-500 shadow-lg shadow-green-600/20 rounded-xl px-4 py-2.5 shrink-0 flex items-center justify-center border border-green-400">
                  <p className="text-white text-xs md:text-sm font-black tracking-wider uppercase drop-shadow-sm">
                    Pick Now
                  </p>
                </div>
              );
            }

            // When prep time expired but restaurant hasn't marked ready → show "Preparing" badge
            if (isPreparingExpired) {
              return (
                <div className="bg-gradient-to-br from-[#1F6B45] to-[#D94E0A] shadow-lg shadow-[#1F6B45]/20 rounded-xl px-4 py-2 shrink-0 flex flex-col items-center justify-center border border-orange-200">
                  <p className="text-orange-50 text-[10px] font-bold uppercase tracking-wider opacity-95 leading-tight mb-[2px]">
                    Order
                  </p>
                  <p className="text-white text-base md:text-[17px] font-black leading-tight drop-shadow-sm">
                    Preparing
                  </p>
                </div>
              );
            }

            // Delivery boy reached customer location
            if (rawStatus === 'reached_drop' || orderStatus === 'reached_drop' || rawPhase === 'at_drop') {
              return (
                <div className="bg-gradient-to-br from-green-600 to-emerald-500 shadow-lg shadow-green-600/20 rounded-xl px-4 py-2 shrink-0 flex flex-col items-center justify-center border border-green-400">
                  <p className="text-green-50 text-[10px] font-bold uppercase tracking-wider opacity-95 leading-tight mb-[2px]">
                    Rider
                  </p>
                  <p className="text-white text-base md:text-[17px] font-black leading-tight drop-shadow-sm">
                    Arrived!
                  </p>
                </div>
              );
            }

            return (
              <div className="bg-gradient-to-br from-[#1F6B45] to-[#D94E0A] shadow-lg shadow-[#1F6B45]/20 rounded-xl px-4 py-2 shrink-0 flex flex-col items-center justify-center border border-orange-200">
                <p className="text-orange-50 text-[10px] font-bold uppercase tracking-wider opacity-95 leading-tight mb-[2px]">
                  {isTakeawayOrDining ? "ready in" : "arriving in"}
                </p>
                <p className="text-white text-base md:text-[17px] font-black leading-tight drop-shadow-sm">
                  {timeRemaining !== null && timeRemaining > 0
                    ? `${timeRemaining} min`
                    : "--"}
                </p>
              </div>
            );
          })()}
        </div>
      </div>
    </motion.div>
  );
});

const OrderTrackingCard = memo(OrderTrackingCardInner);
export default OrderTrackingCard;
