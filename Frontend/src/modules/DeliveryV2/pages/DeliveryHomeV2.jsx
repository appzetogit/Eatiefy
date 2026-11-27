import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDeliveryStore, resolveOrderKey, mapDeliveryPhaseToTripStatus, ordersShareIdentity } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { useProximityCheck, formatTripDistanceKm } from '@/modules/DeliveryV2/hooks/useProximityCheck';
import { useOrderManager } from '@/modules/DeliveryV2/hooks/useOrderManager';
import { NewOrderModal } from '@/modules/DeliveryV2/components/modals/NewOrderModal';
import { useDeliveryNotificationsContext } from '@/modules/DeliveryV2/components/DeliveryRealtimeShell';
import { writeOrderTracking } from '@food/realtimeTracking';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import { mapOrderLocations } from '@/modules/DeliveryV2/utils/orderMapping';

// Components
import LiveMap from '@/modules/DeliveryV2/components/map/LiveMap';
import { PickupActionModal } from '@/modules/DeliveryV2/components/modals/PickupActionModal';
import { DeliveryVerificationModal, extractUserNote } from '@/modules/DeliveryV2/components/modals/DeliveryVerificationModal';
import { OrderSummaryModal } from '@/modules/DeliveryV2/components/modals/OrderSummaryModal';
import ActionSlider from '@/modules/DeliveryV2/components/ui/ActionSlider';
import OrderSwitcher from '@/modules/DeliveryV2/components/orders/OrderSwitcher';
import DeliveryBottomNav from '@/modules/DeliveryV2/components/DeliveryBottomNav';

import { useCompanyName } from "@food/hooks/useCompanyName";
import { useNavigate } from 'react-router-dom';
import useNotificationInbox from "@food/hooks/useNotificationInbox";

// Sub Pages
import PocketV2 from '@/modules/DeliveryV2/pages/PocketV2';
import HistoryV2 from '@/modules/DeliveryV2/pages/HistoryV2';
import ProfileV2 from '@/modules/DeliveryV2/pages/ProfileV2';

// Icons
import {
  Bell, HelpCircle, AlertTriangle,
  Plus, Minus, Navigation2, Target, CheckCircle2, Clock, ChevronDown,
  Contact, Phone, Navigation, Package, Play
} from 'lucide-react';

import { getHaversineDistance, calculateETA, calculateHeading } from '@/modules/DeliveryV2/utils/geo';
import { setRiderGpsPaused } from '@/modules/DeliveryV2/hooks/useRiderLocationSync';
import { computeDrivingRoute } from '@food/utils/drivingRoute';
import { formatOrderAddress } from '@food/utils/orderAddress';

/*
 * Test-ride simulation.
 *
 * Drives the rider marker along the real route so live tracking can be checked
 * without riding anywhere: the simulated position is published exactly like a
 * real GPS fix (socket + HTTP + Firebase), so the customer's map shows the bike
 * moving. Real GPS is paused while it runs, and resumes untouched afterwards.
 *
 * Off unless the build sets VITE_ENABLE_MAP_SIMULATION=true (or it is a dev
 * build), so a live rider never sees the button.
 */
const SIMULATION_ENABLED =
  import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_MAP_SIMULATION || '').toLowerCase() === 'true';
/** Fraction of the current road segment covered per tick (50ms) — about 1.6 segments/sec. */
const SIM_STEP = 0.12;
const SIM_TICK_MS = 60;
/** Matches the server's broadcast throttle; no point publishing faster. */
const SIM_PUBLISH_EVERY_MS = 1500;
const SIM_FALLBACK_STEPS = 60;

const parseSimPoint = (raw) => {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const lng = Number(raw[0]);
    const lat = Number(raw[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (Array.isArray(raw.coordinates) && raw.coordinates.length >= 2) {
    const lng = Number(raw.coordinates[0]);
    const lat = Number(raw.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (raw.location) {
    return parseSimPoint(raw.location);
  }
  const lat = Number(raw.lat ?? raw.latitude);
  const lng = Number(raw.lng ?? raw.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/** Straight line between two points, used when no road route is available yet. */
const buildFallbackPath = (from, to, steps = SIM_FALLBACK_STEPS) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
  });

/** Minimal bottom-sheet popup (Restored from legacy FeedNavbar) */
function BottomPopup({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[600] flex items-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative w-full bg-white rounded-t-3xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-gray-900 uppercase tracking-tight">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
             <AlertTriangle className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

/**
 * DeliveryHomeV2 - Premium 1:1 Match with Original App UI.
 * Featuring logical tab switching for Feed, Pocket, History, and Profile.
 */
export default function DeliveryHomeV2({ tab = 'feed' }) {
  const navigate = useNavigate();
  const { isOnline, toggleOnline, riderLocation, acceptedOrders, focusedOrderId, orderSessions, setRiderLocation, setAcceptedOrders, setCapacity, setFocusedOrder, updateOrderSession, updateTripStatus, removeAcceptedOrder } = useDeliveryStore();
  const activeOrder = useDeliveryStore((state) => state.getFocusedOrder());
  const tripStatus = useDeliveryStore((state) => state.getFocusedTripStatus());
  const focusedSession = focusedOrderId ? orderSessions[focusedOrderId] || {} : {};
  const showVerification = Boolean(focusedSession.showVerification);
  const isModalMinimized = Boolean(focusedSession.isModalMinimized);
  const setShowVerification = (value) => {
    if (!focusedOrderId) return;
    updateOrderSession(focusedOrderId, { showVerification: value });
  };
  const setIsModalMinimized = (value) => {
    if (!focusedOrderId) return;
    updateOrderSession(focusedOrderId, { isModalMinimized: value });
  };
  const { isWithinRange, distanceToTarget } = useProximityCheck();
  const { acceptOrder, reachPickup, pickUpOrder, reachDrop, completeDelivery, resetTrip } = useOrderManager();
  const { newOrder, clearNewOrder, dismissNewOrder, isOrderAlertMuted, toggleOrderAlertMuted, orderStatusUpdate, clearOrderStatusUpdate, claimedOrderId, clearClaimedOrderId, adminNotification, clearAdminNotification, isConnected: isSocketConnected, emitLocation } = useDeliveryNotificationsContext();
  const newOrders = useDeliveryStore((state) => state.newOrders);
  const currentOffer = newOrder || (newOrders && newOrders.length > 0 ? newOrders[0] : null);
  const companyName = useCompanyName();
  const { items: broadcastItems, unreadCount: notificationUnreadCount, markAsRead: markBroadcastAsRead, markAllAsRead: markAllBroadcastRead, dismissAll: dismissAllBroadcast } = useNotificationInbox("delivery", { limit: 20 });

  /*
   * Accept / pass for the incoming-offer card. Refs rather than state, so a
   * second slide or tap in the same tick already sees the first one.
   */
  const acceptingOfferRef = useRef(false);
  const passingOfferRef = useRef(false);

  const handleAcceptOffer = async () => {
    const offered = currentOffer;
    if (!offered || acceptingOfferRef.current) return;
    acceptingOfferRef.current = true;
    // Stop the ringtone immediately, but do NOT blocklist the order yet:
    // clearNewOrder marks it processed, and a failed accept would then
    // make it impossible to receive this order again.
    dismissNewOrder();
    try {
      await acceptOrder(offered);
      const accepted = (useDeliveryStore.getState().acceptedOrders || []).some((order) =>
        ordersShareIdentity(order, offered),
      );
      // acceptOrder has already told the rider why. Failing here resets the
      // slider so they can try again - it used to stay on "Order Accepted"
      // with the order not accepted and no way to retry.
      if (!accepted) throw new Error('Order was not accepted');
      // Accepted for real — now it may be retired from the offer feed.
      clearNewOrder(offered);
    } finally {
      acceptingOfferRef.current = false;
    }
  };

  const handlePassOffer = async () => {
    const offered = currentOffer;
    const orderId = resolveOrderKey(offered);
    if (!orderId || passingOfferRef.current) return;
    passingOfferRef.current = true;
    // Silence at once; the decline below is a network call.
    dismissNewOrder();
    try {
      // Decline on the server as well (the Orders tab already does). Clearing
      // it only on this device left the offer open in the backend, so the next
      // sync put the same card straight back and "Pass" seemed to do nothing.
      await deliveryAPI.rejectOrder(orderId);
    } catch (error) {
      // Already taken or expired on the server: it is gone either way.
      console.warn('[DeliveryHome] pass failed:', error?.message || error);
    } finally {
      clearNewOrder(offered);
      passingOfferRef.current = false;
    }
  };

  const [cashLimitNotice, setCashLimitNotice] = useState(null);
  const [currentTab, setCurrentTab] = useState(tab);
  const [showNotifications, setShowNotifications] = useState(false);

  // Opening the sheet means the notifications have been seen: clear the bell badge.
  useEffect(() => {
    if (showNotifications && notificationUnreadCount > 0) markAllBroadcastRead();
    // Keyed on opening only, so a failing request cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNotifications]);
  useEffect(() => {
    setCurrentTab(tab);
  }, [tab]);

  const [showEmergencyPopup, setShowEmergencyPopup] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [emergencyNumbers, setEmergencyNumbers] = useState({
    medicalEmergency: "",
    accidentHelpline: "",
    contactPolice: "",
    insurance: "",
  });
  
  const [eta, setEta] = useState(null);

  // ─── Test-ride simulation (only reachable when SIMULATION_ENABLED) ───
  const mapRef = useRef(null);
  const [isSimMode, setIsSimMode] = useState(false);
  const [simPath, setSimPath] = useState([]);
  const [simIndex, setSimIndex] = useState(0);
  const lastSimPublishAtRef = useRef(0);
  const simStartedRef = useRef(false);

  /*
   * Simulated ride: walks the rider marker along `simPath` and publishes each
   * position the same way the real GPS hook does, so the customer's tracking
   * map is exercised end to end. Stops at the end of the path; turning the
   * toggle off resumes real GPS immediately.
   */
  useEffect(() => {
    if (!SIMULATION_ENABLED || !isSimMode) return undefined;
    if (!Array.isArray(simPath) || simPath.length < 2) return undefined;

    let localIdx = 0;
    let progress = 0;

    const interval = setInterval(() => {
      if (localIdx >= simPath.length - 1) {
        setIsSimMode(false);
        toast.success('Test ride reached destination!');
        return;
      }

      progress += SIM_STEP;
      if (progress >= 1) {
        progress = 0;
        localIdx += 1;
        setSimIndex(localIdx);
        if (localIdx >= simPath.length - 1) {
          setIsSimMode(false);
          toast.success('Test ride reached destination!');
          return;
        }
      }

      const from = simPath[localIdx];
      const to = simPath[localIdx + 1];
      if (!from || !to) return;

      const lat = from.lat + (to.lat - from.lat) * progress;
      const lng = from.lng + (to.lng - from.lng) * progress;
      const heading = calculateHeading(from.lat, from.lng, to.lat, to.lng);

      setRiderLocation({ lat, lng, heading });
      mapRef.current?.panTo({ lat, lng });

      const now = Date.now();
      if (now - lastSimPublishAtRef.current >= SIM_PUBLISH_EVERY_MS) {
        lastSimPublishAtRef.current = now;

        const orderId = activeOrder?.orderId || activeOrder?._id;
        deliveryAPI.updateLocation(lat, lng, true, { heading }).catch(() => {});
        if (orderId) {
          emitLocation?.({ orderId, lat, lng, heading, speed: 20, accuracy: 5 });
          writeOrderTracking(orderId, { lat, lng, heading, status: tripStatus, eta }).catch(() => {});
        }
      }
    }, SIM_TICK_MS);

    return () => clearInterval(interval);
  }, [isSimMode, simPath, activeOrder, emitLocation, setRiderLocation, tripStatus, eta]);

  // Real GPS must not publish or move the marker while the test ride runs.
  useEffect(() => {
    if (!SIMULATION_ENABLED) return undefined;
    setRiderGpsPaused(isSimMode);
    return () => setRiderGpsPaused(false);
  }, [isSimMode]);

  // A new order or a new leg (to restaurant / to customer) restarts the walk.
  useEffect(() => {
    if (!SIMULATION_ENABLED) return;
    setSimIndex(0);
    simStartedRef.current = false;
  }, [tripStatus, activeOrder?._id, isSimMode]);

  /** Road route from the map; used as the test ride's path while it is running. */
  const handleSimPath = useCallback((path) => {
    if (!SIMULATION_ENABLED || !Array.isArray(path) || path.length < 2) return;
    setSimPath((current) => {
      // Keep the walk going: only adopt a new route when it really changed.
      if (current.length === path.length && current[0]?.lat === path[0]?.lat && current[0]?.lng === path[0]?.lng) {
        return current;
      }
      setSimIndex(0);
      return path;
    });
  }, []);

  /** Starts/stops the simulated ride toward the current leg's destination. */
  const toggleSimulation = useCallback(async () => {
    if (!SIMULATION_ENABLED) return;

    if (isSimMode) {
      setIsSimMode(false);
      toast.info('Test ride stopped — real GPS resumed');
      return;
    }

    const goingToCustomer = tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP';
    const target = parseSimPoint(
      goingToCustomer
        ? (activeOrder?.customerLiveLocation || activeOrder?.customerLocation || activeOrder?.deliveryAddress?.location || activeOrder?.address?.location || activeOrder?.deliveryAddress || activeOrder?.address)
        : (activeOrder?.restaurantLocation || activeOrder?.restaurantId?.location || activeOrder?.restaurant?.location)
    );

    if (!target) {
      toast.error('Accept an order first', {
        description: 'The test ride follows the route to the restaurant or the customer.',
      });
      return;
    }

    // Start from the rider's real position when known, otherwise just short of
    // the destination so there is always a visible stretch to travel.
    const start =
      parseSimPoint(useDeliveryStore.getState().riderLocation) ||
      (goingToCustomer ? parseSimPoint(activeOrder?.restaurantLocation || activeOrder?.restaurantId?.location) : null) ||
      { lat: target.lat + 0.015, lng: target.lng + 0.015 };

    setRiderLocation({ lat: start.lat, lng: start.lng, heading: 0 });
    setSimIndex(0);
    lastSimPublishAtRef.current = 0;

    // The map's road route replaces this as soon as it arrives (handleSimPath).
    setSimPath(buildFallbackPath(start, target));
    setIsSimMode(true);
    toast.warning('Test ride started', {
      description: goingToCustomer ? 'Simulating delivery route to customer' : 'Simulating pickup route to restaurant',
    });

    // Also fetch the real driving route directly
    try {
      const route = await computeDrivingRoute(start, target);
      if (route?.path && Array.isArray(route.path) && route.path.length >= 2) {
        setSimPath(route.path);
        setSimIndex(0);
      }
    } catch (e) {
      console.warn('[Simulation] computeDrivingRoute fallback:', e);
    }
  }, [isSimMode, tripStatus, activeOrder, setRiderLocation]);

  const routeProgressRef = useRef(null);
  const handleRouteProgress = useCallback((progress) => {
    routeProgressRef.current = progress ? { ...progress, at: Date.now() } : null;
    if (progress && Number.isFinite(progress.etaSeconds)) {
      setEta(Math.max(1, Math.round(progress.etaSeconds / 60)));
    }
  }, []);
  const lastLocationSentAt = useRef(0);
  const lastCoordRef = useRef(null);
  const rollingSpeedRef = useRef([]);
  const lastAutoArrivalRef = useRef({ PICKING_UP: false, PICKED_UP: false });

  const [zoom, setZoom] = useState(13.5);

  const isLoggingOut = useRef(false);
  const gpsBlockedToastShown = useRef(false);
  const handleLogout = useCallback(() => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;
    
    // 1. Clear tokens and state
    localStorage.removeItem('delivery_accessToken');
    localStorage.removeItem('delivery_refreshToken');
    localStorage.removeItem('delivery_authenticated');
    localStorage.removeItem('delivery_user');
    
    // 2. Alert user and redirect
    toast.error("Session Expired", { description: "Please log in again." });
    navigate("/food/delivery/login", { replace: true });

    // Optional: Full refresh after delay ONLY if we're not already on login
    setTimeout(() => {
       if (!window.location.pathname.includes('/login')) {
          window.location.reload();
       }
    }, 1500);
  }, [navigate]);

  useEffect(() => {
    const onAuthFailure = (e) => {
      if (e.detail?.module === 'delivery') {
        handleLogout();
      }
    };
    window.addEventListener('authRefreshFailed', onAuthFailure);
    return () => window.removeEventListener('authRefreshFailed', onAuthFailure);
  }, [handleLogout]);


  // Fetch Emergency numbers and Profile (Restored logic)
  useEffect(() => {
    (async () => {
      try {
        const [emergencyRes, profileRes] = await Promise.all([
          deliveryAPI.getEmergencyHelp(),
          deliveryAPI.getProfile()
        ]);
        if (emergencyRes?.data?.success && emergencyRes.data.data) {
          setEmergencyNumbers(emergencyRes.data.data);
        }
        if (profileRes?.data?.success && profileRes.data.data?.profile) {
          const profile = profileRes.data.data.profile;
          setProfileImage(profile.profileImage?.url || profile.documents?.photo || null);
        }
      } catch (err) { console.warn('Navbar Data Fetch Error:', err); }
    })();
  }, []);

  const emergencyOptions = [
    { title: "Medical Emergency", subtitle: "Call an ambulance", icon: <AlertTriangle className="text-red-600" />, phone: emergencyNumbers.medicalEmergency },
    { title: "Accident Helpline", subtitle: "Report an accident", icon: <AlertTriangle className="text-orange-600" />, phone: emergencyNumbers.accidentHelpline },
    { title: "Contact Police", subtitle: "Nearest police support", icon: <AlertTriangle className="text-blue-600" />, phone: emergencyNumbers.contactPolice },
    { title: "Insurance", subtitle: "Policy & claim help", icon: <AlertTriangle className="text-green-600" />, phone: emergencyNumbers.insurance },
  ];


  // Auto-restore modal when status or content changes

  // Auto-restore modal when status or content changes
  useEffect(() => {
    setIsModalMinimized(false);
  }, [tripStatus, focusedOrderId]);

  // 1. Initial Sync (Force sync with server to avoid 'stuck' persistent state)
  useEffect(() => {
    const syncWithServer = async () => {
      try {
        const response = await deliveryAPI.getCurrentDelivery();
        const payload = response?.data?.data || {};
        const activeOrders = Array.isArray(payload.activeOrders)
          ? payload.activeOrders
          : payload.activeOrder
            ? [payload.activeOrder]
            : [];

        if (payload.capacity) {
          setCapacity(payload.capacity);
        }

        if (activeOrders.length) {
          const mapped = activeOrders.map(mapOrderLocations).filter(Boolean);
          setAcceptedOrders(mapped, { capacity: payload.capacity });

          mapped.forEach((order) => {
            const orderId = resolveOrderKey(order);
            const backendStatus = String(
              order.deliveryStatus ||
                order.orderState?.status ||
                order.orderStatus ||
                order.status ||
                '',
            ).toLowerCase();
            const currentPhase = order.deliveryState?.currentPhase;
            let nextStatus = mapDeliveryPhaseToTripStatus(order);
            if (['delivered', 'completed'].includes(backendStatus)) nextStatus = 'COMPLETED';
            else if (currentPhase === 'at_drop' || backendStatus === 'reached_drop') nextStatus = 'REACHED_DROP';
            else if (['picked_up', 'delivering'].includes(backendStatus)) nextStatus = 'PICKED_UP';
            else if (currentPhase === 'at_pickup' || backendStatus === 'reached_pickup') nextStatus = 'REACHED_PICKUP';
            updateOrderSession(orderId, { tripStatus: nextStatus });
          });
        }
      } catch (err) {
        console.error('Order Sync Failed:', err);
      }
    };
    syncWithServer();
  }, [setAcceptedOrders, setCapacity, updateOrderSession]);
  
  // 1.5 Professional Unified ETA Calculation Hook
  useEffect(() => {
    // Road-route ETA from the map (remaining route length x route duration) is the
    // real figure; the straight-line/speed estimate is only a fallback.
    const routeProgress = routeProgressRef.current;
    if (routeProgress && Date.now() - routeProgress.at < 30000 && Number.isFinite(routeProgress.etaSeconds)) {
      setEta(Math.max(1, Math.round(routeProgress.etaSeconds / 60)));
      return;
    }
    // If we have distance, calculate ETA. Fallback to 8m/s (28km/h) avg if GPS speed is unknown.
    if (distanceToTarget != null && distanceToTarget !== Infinity) {
      const avgSpeed = rollingSpeedRef.current.length > 0 
        ? rollingSpeedRef.current.reduce((a, b) => a + b, 0) / rollingSpeedRef.current.length 
        : 8;
      
      setEta(calculateETA(distanceToTarget, avgSpeed));
    } else {
      setEta(null);
    }
  }, [distanceToTarget]);

  // 2. Online/Offline Status Sync (Low Frequency)
  useEffect(() => {
    deliveryAPI.updateOnlineStatus(isOnline).catch(() => {});
  }, [isOnline]);

  // 3. Live GPS comes from useRiderLocationSync (mounted in DeliveryRealtimeShell),
  // which runs on every delivery screen and publishes the rider's position for all
  // active orders. The watcher that used to live here captured the active order at
  // mount (usually none), so it never published a location, and it stopped whenever
  // the rider left the Feed tab.

  // Rolling speed (for the fallback ETA) and geofence auto-arrival, evaluated on each
  // real GPS fix with current values.
  useEffect(() => {
    if (!riderLocation) return;

    const speed = Number(riderLocation.speed);
    if (Number.isFinite(speed) && speed > 0) {
      rollingSpeedRef.current = [...rollingSpeedRef.current.slice(-4), speed];
    }

    // Geo-fencing auto-arrival (within 100m) - disabled in DEV so UI steps can be tested manually
    if (!import.meta.env.DEV && distanceToTarget && distanceToTarget <= 100 && !lastAutoArrivalRef.current[tripStatus]) {
      if (tripStatus === 'PICKING_UP') {
        lastAutoArrivalRef.current[tripStatus] = true;
        reachPickup().catch(() => { lastAutoArrivalRef.current[tripStatus] = false; });
      } else if (tripStatus === 'PICKED_UP') {
        lastAutoArrivalRef.current[tripStatus] = true;
        reachDrop().catch(() => { lastAutoArrivalRef.current[tripStatus] = false; });
      }
    }

    if (distanceToTarget > 200) {
      lastAutoArrivalRef.current[tripStatus] = false;
    }
  }, [riderLocation, distanceToTarget, tripStatus, reachPickup, reachDrop]);

  useEffect(() => {
    if (!claimedOrderId) return;
    clearNewOrder(claimedOrderId);
    clearClaimedOrderId();
  }, [claimedOrderId, clearNewOrder, clearClaimedOrderId]);

  useEffect(() => {
    if (!isOnline) return;
    if (currentTab !== 'feed' && currentTab !== 'orders') return;

    let cancelled = false;

    const hydrateAvailableOrder = async () => {
      try {
        const currentResponse = await deliveryAPI.getCurrentDelivery();
        const currentPayload = currentResponse?.data?.data || {};
        const activeOrders = Array.isArray(currentPayload.activeOrders)
          ? currentPayload.activeOrders
          : currentPayload.activeOrder
            ? [currentPayload.activeOrder]
            : [];

        if (!cancelled && currentPayload.capacity) {
          setCapacity(currentPayload.capacity);
        }

        if (!cancelled && activeOrders.length) {
          setAcceptedOrders(
            activeOrders.map(mapOrderLocations).filter(Boolean),
            { capacity: currentPayload.capacity },
          );
        }

        const availableResponse = await deliveryAPI.getOrders({ limit: 20, page: 1 });
        const availablePayload =
          availableResponse?.data?.data ||
          availableResponse?.data ||
          {};

        const nextCashLimitNotice =
          availablePayload?.cashLimit?.blocked ? availablePayload.cashLimit : null;
        if (!cancelled) setCashLimitNotice(nextCashLimitNotice);

        if (!cancelled && availablePayload.capacity) {
          setCapacity(availablePayload.capacity);
        }

        const newOffers = Array.isArray(availablePayload.newOffers)
          ? availablePayload.newOffers
          : [];

        if (!cancelled) {
          newOffers.forEach((order) => useDeliveryStore.getState().addNewOrder(order));
          if (newOffers.length) setCashLimitNotice(null);
        }
      } catch (error) {
        console.warn('[DeliveryHomeV2] Available order fallback sync failed:', error?.message || error);
      }
    };

    void hydrateAvailableOrder();
    const poller = window.setInterval(() => {
      if (!document.hidden) {
        void hydrateAvailableOrder();
      }
    }, isSocketConnected ? 12000 : 5000);

    const handleVisibility = () => {
      if (!document.hidden) {
        void hydrateAvailableOrder();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    
    return () => {
      cancelled = true;
      window.clearInterval(poller);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [currentTab, isOnline, isSocketConnected, setAcceptedOrders, setCapacity]);

  useEffect(() => {
    if (orderStatusUpdate) {
      if (orderStatusUpdate.status === 'cancelled') {
        toast.error('Order cancelled');
        const cancelledId =
          orderStatusUpdate.orderId ||
          orderStatusUpdate.orderMongoId ||
          orderStatusUpdate._id;
        if (cancelledId) {
          removeAcceptedOrder(cancelledId);
        } else {
          resetTrip();
        }
      }
      clearOrderStatusUpdate();
    }
  }, [orderStatusUpdate, resetTrip, clearOrderStatusUpdate, removeAcceptedOrder]);

  // Handle Real-time Admin Notifications
  useEffect(() => {
    if (adminNotification) {
      toast.info(adminNotification.title || "New Notification", {
        description: adminNotification.message || adminNotification.body || "",
        duration: 8000,
        action: {
          label: "View",
          onClick: () => setShowNotifications(true)
        }
      });
      clearAdminNotification();
    }
  }, [adminNotification, clearAdminNotification]);


  const handleCenterMap = () => {
    const loc = useDeliveryStore.getState().riderLocation;
    if (mapRef.current && loc) {
      const lat = parseFloat(loc.lat || loc.latitude);
      const lng = parseFloat(loc.lng || loc.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        mapRef.current.panTo({ lat, lng });
        mapRef.current.setZoom(13.5);
      }
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading || 0,
            speed: pos.coords.speed || 0,
            accuracy: pos.coords.accuracy,
            timestamp: Date.now(),
          };
          useDeliveryStore.getState().setRiderLocation(fix);
          if (mapRef.current) {
            mapRef.current.panTo({ lat: fix.lat, lng: fix.lng });
            mapRef.current.setZoom(13.5);
          }
        },
        (err) => console.warn('Center GPS error:', err),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  };

  const handleMapClick = () => {
    if (activeOrder || showVerification) {
      setIsModalMinimized(true);
    }
  };

  return (
    <div className="relative h-screen w-full bg-white text-gray-900 overflow-hidden flex flex-col">
      {/* ─── 1. TOP HEADER (Premium Dark Gray) ─── */}
      {currentTab !== 'history' && (
      <div className="absolute top-0 inset-x-0 bg-[#121212]/95 backdrop-blur-2xl shadow-2xl z-[200] safe-top pb-2 border-b border-white/10">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-4">
             <div 
                onClick={() => navigate('/food/delivery/profile')}
                className="w-10 h-10 rounded-full border border-white/20 p-0.5 shadow-xl overflow-hidden bg-white/5 cursor-pointer active:scale-95 transition-all"
             >
                <img src={profileImage || "/assets/images/profile_avatar.webp"} alt="Profile" className="w-full h-full object-cover rounded-full" />
             </div>
              <button 
                onClick={async () => {
                  const nextState = !isOnline;
                  toggleOnline(); // Store action
                  if (nextState) {
                     // 1. Immediate sync from current known location in 0ms
                     const currentLoc = useDeliveryStore.getState().riderLocation;
                     if (currentLoc && Number.isFinite(Number(currentLoc.lat)) && Number.isFinite(Number(currentLoc.lng))) {
                       deliveryAPI.updateLocation(Number(currentLoc.lat), Number(currentLoc.lng), true, {
                         heading: currentLoc.heading || 0,
                         speed: currentLoc.speed || 0,
                         accuracy: currentLoc.accuracy,
                       }).catch(() => {});
                       if (mapRef.current) {
                         mapRef.current.panTo({ lat: Number(currentLoc.lat), lng: Number(currentLoc.lng) });
                         mapRef.current.setZoom(13.5);
                       }
                     }
                     // 2. Immediate fresh GPS fix in parallel
                     if (typeof navigator !== 'undefined' && navigator.geolocation) {
                       navigator.geolocation.getCurrentPosition((pos) => {
                           const fix = {
                             lat: pos.coords.latitude,
                             lng: pos.coords.longitude,
                             heading: pos.coords.heading || 0,
                             speed: pos.coords.speed || 0,
                             accuracy: pos.coords.accuracy,
                             timestamp: Date.now()
                           };
                           setRiderLocation(fix);
                           deliveryAPI.updateLocation(pos.coords.latitude, pos.coords.longitude, true, {
                             heading: fix.heading,
                             speed: fix.speed,
                             accuracy: fix.accuracy,
                           }).catch(() => {});
                           if (mapRef.current) {
                             mapRef.current.panTo({ lat: fix.lat, lng: fix.lng });
                             mapRef.current.setZoom(13.5);
                           }
                       }, (err) => console.warn('Online sync position failed:', err), { enableHighAccuracy: true, timeout: 8000 });
                     }
                  } else {
                     deliveryAPI.updateOnlineStatus(false).catch(() => {});
                  }
                }}
                className={`delivery-online-toggle relative w-[92px] h-8 rounded-full p-1 transition-all duration-500 flex items-center ${isOnline ? 'is-online bg-green-500 shadow-lg shadow-green-500/20' : 'is-offline bg-green-400 shadow-lg shadow-green-400/20'}`}
              >
                <div className={`flex items-center justify-between w-full px-2 text-[8.5px] font-black uppercase tracking-widest text-white`}>
                  <span>{isOnline ? 'Online' : ''}</span>
                  <span>{!isOnline ? 'Offline' : ''}</span>
                </div>
                <motion.div animate={{ x: isOnline ? 59 : 0 }} className="absolute left-1 w-6 h-6 bg-white rounded-full shadow-sm" />
              </button>

           </div>
          <div className="flex items-center gap-3">
             <button onClick={() => setShowEmergencyPopup(true)} className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/20 active:scale-95 transition-all shadow-lg"><AlertTriangle className="w-4 h-4" /></button>
             <button onClick={() => navigate('/food/delivery/help/id-card')} className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20 active:scale-95 transition-all shadow-lg"><Contact className="w-4 h-4" /></button>
             <button onClick={() => setShowNotifications(true)} className="relative w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white border border-white/10 active:scale-95 transition-all shadow-lg">
                <Bell className="w-4 h-4" />
                {notificationUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-600 flex items-center justify-center text-[9px] font-black text-white border-2 border-[#121212] shadow-xl animate-in zoom-in duration-300">
                    {notificationUnreadCount > 9 ? '9+' : notificationUnreadCount}
                  </span>
                )}
             </button>
          </div>
        </div>

        {/* ─── LIVE STATUS / PROGRESS BADGE (MATCHED PRO) ─── */}
        <AnimatePresence>
          {currentTab === 'feed' && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="px-3 md:px-4 mt-1"
            >
              {activeOrder ? (
                <div className="grid grid-cols-2 gap-3 w-full">
                  {/* LEFT: DISTANCE (Vibrant Orange Card) */}
                  <div className="bg-[#ff8100] rounded-2xl p-3.5 shadow-xl shadow-orange-500/20 border border-orange-400/50 flex items-center justify-between overflow-hidden relative">
                    <div className="flex flex-col z-10">
                      <span className="text-[9px] text-white/70 font-black uppercase tracking-[0.15em] mb-1">Distance</span>
                      <div className="flex items-end gap-1">
                        <span className="text-2xl font-black text-white leading-none tracking-tighter">
                          {formatTripDistanceKm(distanceToTarget)}
                        </span>
                        <span className="text-[11px] text-white/80 font-bold mb-0.5">KM</span>
                      </div>
                    </div>
                    <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center z-10 shadow-lg">
                      <Navigation2 className="w-4 h-4 text-[#ff8100] rotate-45" />
                    </div>
                  </div>

                  {/* RIGHT: TIME (Emerald PRO Content) */}
                  <div className="bg-[#10B981] rounded-2xl p-3.5 shadow-xl shadow-green-500/20 border border-green-400/50 flex items-center justify-between relative overflow-hidden group">
                    <div className="flex flex-col z-10">
                      <span className="text-[9px] text-white/70 font-black uppercase tracking-[0.15em] mb-1">Arrival</span>
                      <div className="flex items-end gap-1">
                        <span className="text-2xl font-black text-white leading-none tracking-tighter">
                          {eta ? String(eta) : '--'}
                        </span>
                        <span className="text-[11px] text-white/80 font-bold mb-0.5">MIN</span>
                      </div>
                    </div>
                    <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center z-10 shadow-lg">
                       <Clock className="w-4 h-4 text-[#10B981]" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 rounded-2xl p-4 flex items-center border border-white/5 shadow-sm backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center">
                      <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                    </div>
                    <div>
                      <h3 className="text-white font-black text-[11px] uppercase tracking-widest leading-none mb-1">{isOnline ? 'System Online' : 'System Offline'}</h3>
                      <p className="text-gray-400 text-[10px] font-bold uppercase tracking-tight">{isOnline ? 'Waiting for order requests' : 'Go online to receive jobs'}</p>
                    </div>
                  </div>
                </div>
              )}

              {!activeOrder && cashLimitNotice?.blocked && (
                <div className="mt-3 rounded-2xl border border-amber-300/40 bg-amber-500/10 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
                    Cash Limit Alert
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-amber-100">
                    {cashLimitNotice?.message || 'Please deposit your amount to get orders.'}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {currentTab === 'feed' && acceptedOrders.length > 1 && (
          <OrderSwitcher
            orders={acceptedOrders}
            focusedOrderId={focusedOrderId}
          />
        )}
      </div>
      )}

      {/* ─── 2. MAIN CONTENT ─── */}
      <div className={`flex-1 relative overflow-y-auto ${currentTab === 'history' ? 'pt-0' : 'pt-[120px]'} no-scrollbar`}>
         {currentTab === 'feed' ? (
           <div className="absolute inset-0 top-[-120px]">
             <LiveMap
               onMapLoad={(m) => mapRef.current = m}
               onMapClick={handleMapClick}
               onRouteProgress={handleRouteProgress}
               // Road route for the test ride, so the marker follows real streets.
               onPathReceived={SIMULATION_ENABLED ? handleSimPath : undefined}
               onPolylineReceived={(poly) => {
                 // If we have an order, push the INITIAL polyline to Firebase immediately for the customer
                 const orderId = activeOrder?.orderId || activeOrder?._id;
                 if (orderId && poly) {
                   writeOrderTracking(orderId, { polyline: poly, status: tripStatus, eta: eta }).catch(() => {});
                 }
               }}
               zoom={zoom}
             />
             

             <div className="absolute right-4 bottom-28 md:bottom-32 flex flex-col gap-4 z-[120]">
                <div className="flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
                   <button onClick={() => setZoom(z => Math.min(22, z + 1))} className="p-3 hover:bg-gray-50 border-b border-gray-100 text-gray-900 active:scale-90 transition-all" aria-label="Zoom in"><Plus className="w-5 h-5 stroke-[2.75]" /></button>
                   <button onClick={() => setZoom(z => Math.max(8, z - 1))} className="p-3 hover:bg-gray-50 text-gray-900 active:scale-90 transition-all" aria-label="Zoom out"><Minus className="w-5 h-5 stroke-[2.75]" /></button>
                </div>
                <button 
                   onClick={() => mapRef.current?.setOptions({ gestureHandling: 'greedy' })} 
                   className="w-14 h-14 bg-white rounded-full shadow-2xl flex items-center justify-center text-blue-600 border border-gray-100 active:scale-90 transition-all"
                >
                  <div className="w-8 h-8 rounded-full border-2 border-blue-600 flex items-center justify-center"><Navigation2 className="w-4 h-4" /></div>
                </button>
                <button
                  onClick={handleCenterMap}
                  className="w-14 h-14 bg-white rounded-full shadow-2xl flex items-center justify-center text-gray-900 border border-gray-100 group active:scale-90 transition-all"
                >
                  <Target className="w-7 h-7" />
                </button>
                {/* Test ride: only rendered when the build enables simulation. */}
                {SIMULATION_ENABLED && (
                  <button
                    onClick={toggleSimulation}
                    title={isSimMode ? 'Stop test ride' : 'Start test ride (simulated movement)'}
                    aria-label={isSimMode ? 'Stop test ride' : 'Start test ride'}
                    className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center border border-gray-100 active:scale-90 transition-all ${isSimMode ? 'bg-orange-500 text-white' : 'bg-white text-green-600'}`}
                  >
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${isSimMode ? 'border-white' : 'border-green-600'}`}>
                      <Play className={`w-4 h-4 fill-current ml-0.5 ${isSimMode ? 'animate-pulse' : ''}`} />
                    </div>
                  </button>
                )}
             </div>

             {/* Banner so a simulated position is never mistaken for the real one. */}
             {SIMULATION_ENABLED && isSimMode && (
               <div className="absolute top-4 left-4 right-4 z-[130] bg-black/80 backdrop-blur-md rounded-xl p-3 border border-orange-400/40 flex items-center justify-between shadow-2xl">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center animate-pulse shrink-0">
                     <Play className="w-4 h-4 text-white fill-current" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-orange-400 text-[10px] font-bold uppercase tracking-widest">Test ride running</span>
                     <span className="text-white text-[11px] font-medium">
                       Simulated movement — real GPS paused{simPath.length > 1 ? ` · ${Math.min(simIndex + 1, simPath.length)}/${simPath.length}` : ''}
                     </span>
                   </div>
                 </div>
                 <button
                   onClick={toggleSimulation}
                   className="bg-white/10 text-white/70 hover:text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/10 shrink-0"
                 >
                   Stop
                 </button>
               </div>
             )}
           </div>
         ) : currentTab === 'pocket' ? (
           <PocketV2 />
         ) : currentTab === 'history' ? (
           <HistoryV2 />
         ) : (
           <ProfileV2 />
         )}

         {/* OVERLAYS (Persistent if active) */}
      </div>

      {/* OVERLAYS (Persistent if active) - Outside flex container to avoid clipping and z-index issues */}
      {/* Only show on the feed tab — must not appear over History/Profile/Pocket. */}
      {currentTab === 'feed' && (
        <AnimatePresence>
          {!isModalMinimized && (
            <motion.div
              key="modal-container"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-x-0 top-0 bottom-[92px] z-[300] pointer-events-none flex items-end"
            >
              <div className="w-full pointer-events-auto relative">
                {(tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') && (
                  <PickupActionModal 
                    order={activeOrder} 
                    status={tripStatus} 
                    isWithinRange={isWithinRange} 
                    distanceToTarget={distanceToTarget}
                    eta={eta}
                    onReachedPickup={reachPickup} 
                    onPickedUp={(billImageUrl) => pickUpOrder(billImageUrl)} 
                    onMinimize={() => setIsModalMinimized(true)}
                  />
                )}
                {(tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP') && (
                  <div className="absolute inset-x-0 z-[120] px-4" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                    {tripStatus === 'PICKED_UP' ? (
                      <div className="bg-white rounded-[3rem] p-8 shadow-[0_-20px_80px_rgba(0,0,0,0.4)] border border-gray-100 flex flex-col items-center">
                        {/* Handle / Minimize */}
                        <div className="w-full flex justify-center pb-4 pt-0 -mt-2">
                          <button onClick={() => setIsModalMinimized(true)} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
                             <ChevronDown className="w-6 h-6 text-gray-400 stroke-[3]" />
                          </button>
                        </div>
                        <div className="flex justify-between w-full items-start mb-10 px-2 text-left gap-3">
                          <div className="flex items-start gap-4 min-w-0 flex-1">
                            <div className="w-16 h-16 rounded-2xl overflow-hidden border border-gray-100 shadow-sm shrink-0">
                               <img 
                                 src={activeOrder?.user?.logo || activeOrder?.user?.profileImage || activeOrder?.userId?.profileImage || 'https://cdn-icons-png.flaticon.com/512/1275/1275302.png'} 
                                 className="w-full h-full object-cover" 
                                 alt="User"
                               />
                            </div>
                            <div className="min-w-0 flex-1">
                               <h3 className="text-gray-950 text-xl sm:text-2xl font-bold leading-tight break-words">
                                 {activeOrder?.customerName ||
                                   activeOrder?.userId?.name ||
                                   activeOrder?.user?.name ||
                                   activeOrder?.deliveryAddress?.fullName ||
                                   activeOrder?.deliveryAddress?.name ||
                                   'Customer'}
                               </h3>
                               {(() => {
                                 const addr =
                                   activeOrder?.customerAddress ||
                                   formatOrderAddress(activeOrder?.deliveryAddress);
                                 return addr ? (
                                   <p className="text-gray-500 text-xs font-medium mt-1.5 leading-snug break-words">
                                     {addr}
                                   </p>
                                 ) : null;
                               })()}
                               <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mt-1.5 ${isWithinRange ? 'text-green-600' : 'text-orange-500'}`}>
                                 {isWithinRange
                                   ? 'Ready - Swipe to Arrive √'
                                   : formatTripDistanceKm(distanceToTarget) === '--'
                                     ? 'Locating customer…'
                                     : `${formatTripDistanceKm(distanceToTarget)} km • ${eta || '--'} min Arrival`}
                               </p>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const raw =
                                  activeOrder?.customerPhone ||
                                  activeOrder?.userPhone ||
                                  activeOrder?.userId?.phone ||
                                  activeOrder?.user?.phone ||
                                  activeOrder?.deliveryAddress?.phone ||
                                  '';
                                const num = String(raw).replace(/\D/g, '');
                                if (!num) {
                                  toast.error('Customer number not available');
                                  return;
                                }
                                window.location.href = `tel:${num}`;
                              }}
                              className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100 active:scale-95 transition-all"
                              aria-label="Call customer"
                            >
                              <Phone className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const loc = activeOrder?.customerLocation;
                                const lat = parseFloat(loc?.lat ?? loc?.latitude);
                                const lng = parseFloat(loc?.lng ?? loc?.longitude);
                                if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                                  toast.error('Customer location not available');
                                  return;
                                }
                                window.open(
                                  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
                                  '_blank',
                                  'noopener,noreferrer'
                                );
                              }}
                              className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-lg active:scale-95 transition-all"
                              aria-label="Navigate to customer"
                            >
                              <Navigation className="w-5 h-5" />
                            </button>
                          </div>
                        </div>

                        {/* Customer Instructions Panel */}
                        {Boolean(extractUserNote(activeOrder)) && (
                          <div className="w-full bg-orange-50 border border-orange-100 rounded-3xl p-5 mb-8 flex gap-4 items-start shadow-sm mx-2">
                             <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-orange-500 shadow-sm shrink-0 border border-orange-50">
                                <Package className="w-5 h-5" />
                             </div>
                             <div className="flex-1">
                                <p className="text-[10px] font-black text-orange-600 uppercase tracking-[0.2em] mb-1.5 opacity-80">User Note / Drop Message</p>
                                <p className="text-sm font-bold text-gray-950 leading-relaxed capitalize">"{extractUserNote(activeOrder)}"</p>
                             </div>
                          </div>
                        )}
                        <ActionSlider label="Slide to Arrive" successLabel="Arrived ✓" disabled={false} onConfirm={reachDrop} color="bg-blue-600" />
                      </div>
                    ) : (
                      <button 
                        onClick={() => setShowVerification(true)} 
                        className="w-full text-white rounded-2xl py-4 sm:py-5 px-4 font-bold text-xs sm:text-sm tracking-[0.14em] transform transition-all active:scale-95 flex items-center justify-center gap-2.5 sm:gap-3 border border-white/20"
                        style={{
                          background: 'linear-gradient(33deg, #15498b 0%, #000000 100%)',
                          boxShadow: '0 14px 34px rgba(21, 73, 139, 0.42)',
                        }}
                      >
                        <CheckCircle2 className="w-6 h-6" /> VERIFY & COMPLETE
                      </button>
                    )}
                  </div>
                )}
                {showVerification && tripStatus !== 'COMPLETED' && (
                  <DeliveryVerificationModal 
                    order={activeOrder} 
                    onComplete={async (otp, paymentOverride) => {
                      const res = await completeDelivery(otp, paymentOverride);
                      setShowVerification(false);
                      return res;
                    }}
                    onClose={() => setShowVerification(false)}
                  />
                )}
                {tripStatus === 'COMPLETED' && <OrderSummaryModal order={activeOrder} onDone={() => { resetTrip(activeOrder); navigate('/food/delivery', { replace: true }); }} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/*
        Incoming order offer. The socket and the alert sound were already wired,
        but nothing rendered the offer, so a rider heard the ringtone and saw the
        push while the accept / reject card never appeared.
      */}
      {currentOffer && !activeOrder && (
        <NewOrderModal
          order={currentOffer}
          isMuted={isOrderAlertMuted?.(currentOffer) ?? false}
          onToggleMute={() => toggleOrderAlertMuted?.(currentOffer)}
          /* Minimise only hides the card — the offer must stay claimable. */
          onMinimize={() => dismissNewOrder()}
          /* Reject is a real decline, so this one blocklists the order. */
          onReject={handlePassOffer}
          onAccept={handleAcceptOffer}
        />
      )}

      {/* ─── MODALS RESTORED FROM OLD UI ─── */}
      <BottomPopup isOpen={showEmergencyPopup} title="Emergency Help" onClose={() => setShowEmergencyPopup(false)}>
         <div className="grid gap-4 py-2">
           {emergencyOptions.map((opt, i) => (
             <button 
               key={i} 
               onClick={() => {
                 const num = opt.phone?.replace(/\D/g, '');
                 if (num) window.location.href = `tel:${num}`;
                 else toast.error('Number not configured');
               }}
               className="flex items-center gap-5 p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 active:scale-95 transition-all text-left"
             >
               <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-xl">{opt.icon}</div>
               <div>
                 <h4 className="font-bold text-gray-900">{opt.title}</h4>
                 <p className="text-xs text-gray-500 font-medium">{opt.subtitle}</p>
               </div>
             </button>
           ))}
         </div>
      </BottomPopup>

      <BottomPopup 
        isOpen={showNotifications} 
        title="Notifications" 
        onClose={() => {
           setShowNotifications(false);
           // Optional: refresh count if needed
        }}
      >
         <div className="flex flex-col gap-3 -mt-2 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
            {broadcastItems && broadcastItems.length > 0 ? (
               <>
                  <div className="flex justify-end mb-1">
                     <button 
                        onClick={() => {
                           dismissAllBroadcast();
                           toast.success("All notifications cleared");
                        }}
                        className="text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50 px-3 py-1.5 rounded-full"
                     >
                        Clear All
                     </button>
                  </div>
                  <div className="grid gap-2.5">
                     {broadcastItems.map((item) => (
                        <div 
                           key={item.id} 
                           onClick={() => {
                              markBroadcastAsRead(item.id);
                              if (item.link) {
                                 // Handle link if present
                                 const path = item.link.startsWith('/') ? item.link : `/${item.link}`;
                                 navigate(path);
                                 setShowNotifications(false);
                              }
                           }}
                           className={`p-4 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer ${item.read ? 'bg-gray-50 border-gray-100' : 'bg-orange-50 border-orange-100 shadow-sm shadow-orange-500/5'}`}
                        >
                           <div className="flex gap-3 items-start">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.read ? 'bg-gray-200 text-gray-500' : 'bg-[#EB590E] text-white shadow-lg'}`}>
                                 <Bell className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                 <div className="flex justify-between items-start gap-2">
                                    <h4 className={`text-sm font-bold truncate ${item.read ? 'text-gray-600' : 'text-gray-950'}`}>
                                       {item.title}
                                    </h4>
                                    <span className="text-[9px] font-black uppercase text-gray-400 shrink-0 whitespace-nowrap pt-0.5">
                                       {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                 </div>
                                 <p className={`text-[12px] leading-relaxed mt-0.5 break-words ${item.read ? 'text-gray-500 line-clamp-2' : 'text-gray-700'}`}>
                                    {item.message}
                                 </p>
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>
               </>
            ) : (
               <div className="py-20 flex flex-col items-center justify-center text-center px-10">
                  <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mb-4 border border-gray-100/50">
                     <Bell className="w-7 h-7 text-gray-300" />
                  </div>
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest leading-none mb-2">No Notifications</h3>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-tight leading-relaxed">System notifications for order requests and updates will appear here.</p>
               </div>
            )}
         </div>
         <div className="mt-8 mb-2">
            <button 
               onClick={() => {
                  setShowNotifications(false);
                  navigate('/food/delivery/notifications');
               }}
               className="w-full py-4 rounded-2xl bg-gray-950 text-white text-xs font-black uppercase tracking-[0.2em] shadow-xl shadow-gray-950/20 active:scale-95 transition-all"
            >
               View Notification History
            </button>
         </div>
      </BottomPopup>

      {/* Floating Minimize/Restore Toggle - Above navbar (feed tab only) */}
      {currentTab === 'feed' && isModalMinimized && (activeOrder || showVerification) && (
        <motion.div 
           initial={{ y: 100, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           className="fixed bottom-[100px] inset-x-0 z-[300] px-6"
        >
           <button 
             onClick={() => setIsModalMinimized(false)}
             className="w-full bg-gray-900/90 text-white rounded-2xl py-4 flex items-center justify-between px-6 shadow-2xl backdrop-blur-md border border-white/10"
           >
              <div className="flex flex-col items-start gap-0.5">
                 <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Order Action Pending</span>
                 <span className="text-xs font-bold uppercase tracking-wider">Tap to open delivery panel</span>
              </div>
              <div className="bg-orange-500 p-2 rounded-xl text-white">
                 <Plus className="w-5 h-5" />
              </div>
           </button>
        </motion.div>
      )}

      <DeliveryBottomNav currentTab={currentTab} />
    </div>
  );
}
