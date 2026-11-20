import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleMap, useJsApiLoader, OverlayView, Polyline } from '@react-google-maps/api';
import { createAppSocket } from '@food/api/socketClient';
import { orderAPI } from '@food/api';
import { LOCATION_CONFIG } from '@/modules/DeliveryV2/utils/locationConfig';
import bikeLogo from '@food/assets/deliveryboy-3d.jpeg';
import mapRiderIcon from '@food/assets/MapRider.png';
import { subscribeOrderTracking, subscribeDeliveryLocation } from '@food/realtimeTracking';
import { useMapTheme } from '@food/utils/mapTheme';
import { computeDrivingRoute } from '@food/utils/drivingRoute';
import { motion } from 'framer-motion';

const LIBRARIES = ['geometry', 'places'];

/**
 * Order statuses in which the rider is carrying the food.
 * From here on, tracking focuses on Rider ↔ Customer live journey.
 */
const PICKED_UP_STATUSES = new Set([
  'picked_up',
  'out_for_delivery',
  'on_way',
  'en_route_to_delivery',
  'reached_drop',
  'at_drop',
  'at_delivery',
]);

/** Tracking stops for good once an order reaches one of these. */
const TERMINAL_STATUSES = new Set([
  'delivered',
  'completed',
  'cancelled',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
]);

/**
 * Map banner while no rider has the order - it follows the restaurant's own
 * status. It used to say "Food is being prepared" for every rider-less order,
 * including ones the restaurant had not accepted yet.
 */
const WAITING_FOR_RESTAURANT_TEXT = 'Waiting for the restaurant to accept your order';
const RESTAURANT_ACCEPTED_TEXT = 'Restaurant accepted your order';
const FOOD_READY_TEXT = 'Food is ready, assigning a delivery partner';
const PRE_RIDER_BANNER_TEXT = {
  created: WAITING_FOR_RESTAURANT_TEXT,
  pending: WAITING_FOR_RESTAURANT_TEXT,
  placed: WAITING_FOR_RESTAURANT_TEXT,
  confirmed: RESTAURANT_ACCEPTED_TEXT,
  accepted: RESTAURANT_ACCEPTED_TEXT,
  preparing: 'Food is being prepared at restaurant',
  ready_for_pickup: FOOD_READY_TEXT,
  ready: FOOD_READY_TEXT,
};

/** Packets older than this (by their own timestamp) are ignored as stale. */
const STALE_PACKET_MS = 10 * 60 * 1000;
/** Allowed clock skew when ordering packets from different sources. */
const PACKET_ORDER_TOLERANCE_MS = 1500;

/** Re-route only after the rider has moved this far — roads don't change faster. */
const ROUTE_REFRESH_DISTANCE_M = 120;
/** …or after this long, so a stationary rider still gets a fresh ETA. */
const ROUTE_REFRESH_INTERVAL_MS = 20000;
/** How often the route conditions are evaluated. */
const ROUTE_TICK_MS = 5000;
/** No packet for this long: tell the customer the rider's position may be out of date. */
const SIGNAL_WEAK_MS = 45 * 1000;
/** Rider marker interpolation bounds, matched to the server's ~1 s packet rate. */
const MIN_INTERP_MS = 800;
const MAX_INTERP_MS = 2500;
/** Distance from route polyline at which rider is considered off-route → immediate reroute. */
const OFF_ROUTE_DISTANCE_M = 60;
/** Max distance to snap rider marker onto the route polyline for smooth on-road rendering. */
const SNAP_TO_ROUTE_MAX_M = 30;

function computeBearing(fromLat, fromLng, toLat, toLng) {
  const fromLatRad = (fromLat * Math.PI) / 180;
  const fromLngRad = (fromLng * Math.PI) / 180;
  const toLatRad = (toLat * Math.PI) / 180;
  const toLngRad = (toLng * Math.PI) / 180;
  const dLng = toLngRad - fromLngRad;
  const y = Math.sin(dLng) * Math.cos(toLatRad);
  const x =
    Math.cos(fromLatRad) * Math.sin(toLatRad) -
    Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function computeDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** @param {number} meters @returns {string} e.g. "450 m" / "3.2 km" */
const formatDistance = (meters) => {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
};

/** @param {number} seconds @returns {string} e.g. "12 min" */
const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const mins = Math.max(1, Math.round(seconds / 60));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
};

/**
 * Projects a point onto a line segment A→B and returns the closest point on that segment.
 * @returns {{lat:number, lng:number, t:number}} where t is 0..1 along the segment.
 */
function projectPointOnSegment(p, a, b) {
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { lat: a.lat, lng: a.lng, t: 0 };
  const t = Math.max(0, Math.min(1, ((p.lat - a.lat) * dx + (p.lng - a.lng) * dy) / lenSq));
  return { lat: a.lat + t * dx, lng: a.lng + t * dy, t };
}

/**
 * Finds the closest point on a polyline path to a given GPS point.
 * @returns {{index:number, snappedPoint:{lat,lng}, distance:number}}
 */
function findClosestPointOnPath(path, point) {
  if (!path || path.length === 0 || !point) return { index: 0, snappedPoint: point, distance: Infinity };
  if (path.length === 1) {
    return { index: 0, snappedPoint: path[0], distance: computeDistanceMeters(point.lat, point.lng, path[0].lat, path[0].lng) };
  }
  let bestDist = Infinity;
  let bestSnap = path[0];
  let bestIdx = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const proj = projectPointOnSegment(point, path[i], path[i + 1]);
    const d = computeDistanceMeters(point.lat, point.lng, proj.lat, proj.lng);
    if (d < bestDist) {
      bestDist = d;
      bestSnap = { lat: proj.lat, lng: proj.lng };
      bestIdx = proj.t >= 0.5 ? i + 1 : i;
    }
  }
  return { index: bestIdx, snappedPoint: bestSnap, distance: bestDist };
}

/** Sum of haversine distances along a path array. */
function computePathLengthM(path) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += computeDistanceMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
  }
  return total;
}

/**
 * Trims a route polyline so only the un-traveled portion is returned.
 * @returns {{remainingPath:{lat,lng}[], snappedPoint:{lat,lng}, offRouteDistance:number}}
 */
function computeRemainingPath(fullPath, riderPos) {
  if (!fullPath || fullPath.length < 2 || !riderPos) {
    return { remainingPath: fullPath || [], snappedPoint: riderPos, offRouteDistance: 0 };
  }
  const { index, snappedPoint, distance } = findClosestPointOnPath(fullPath, riderPos);
  // Build remaining path: snapped point → rest of route
  const remaining = [snappedPoint, ...fullPath.slice(index + 1)];
  // Deduplicate if snapped point is essentially the same as the next vertex
  if (remaining.length >= 2 && computeDistanceMeters(remaining[0].lat, remaining[0].lng, remaining[1].lat, remaining[1].lng) < 1) {
    remaining.shift();
  }
  return { remainingPath: remaining.length >= 2 ? remaining : fullPath, snappedPoint, offRouteDistance: distance };
}

/** Interpolates remaining ETA based on how much of the route is left. */
function interpolateRemainingEta(remainingLenM, fullLenM, fullDurationS) {
  if (!Number.isFinite(remainingLenM) || !Number.isFinite(fullLenM) || !Number.isFinite(fullDurationS)) return null;
  if (fullLenM <= 0 || fullDurationS <= 0) return null;
  const ratio = Math.max(0, Math.min(1, remainingLenM / fullLenM));
  return ratio * fullDurationS;
}

const restaurantFallbackIcon = (color) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="${color}"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`,
  )}`;

/**
 * Reads a rider coordinate out of any of the shapes the order payload uses.
 * @returns {{lat:number, lng:number, heading:number, at:number}|null}
 */
const readOrderRiderPosition = (order) => {
  const loc =
    order?.deliveryState?.currentLocation ||
    order?.tracking?.location ||
    order?.deliveryPartner?.location ||
    order?.dispatch?.currentLocation ||
    order?.dispatch?.location;
  if (!loc) return null;

  const lat = Number(
    loc.lat ?? loc.latitude ?? (Array.isArray(loc.coordinates) ? loc.coordinates[1] : NaN),
  );
  const lng = Number(
    loc.lng ?? loc.longitude ?? (Array.isArray(loc.coordinates) ? loc.coordinates[0] : NaN),
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const at = Number(loc.at ?? loc.timestamp);
  if (!Number.isFinite(at) || at <= 0 || Date.now() - at > STALE_PACKET_MS) return null;

  return { lat, lng, heading: Number(loc.bearing ?? loc.heading) || 0, at };
};

/**
 * Live order tracking map with Zomato-style Phased Lifecycle:
 *
 * 1. Pre-pickup (Accepted / Confirmed / Preparing / Rider Assigned / At Restaurant):
 *    - Shows Restaurant Location + Customer (User) Location on the map.
 *    - Route: Main food route from Restaurant → Customer (User).
 *    - If a Rider is assigned and has GPS: Shows Rider Bike Marker moving to restaurant
 *      with dashed route connecting Rider → Restaurant.
 *    - Map camera automatically fits bounds to show Restaurant + User location clearly.
 *
 * 2. Post-pickup (Picked Up / Out For Delivery / On The Way):
 *    - Shows Live Moving Delivery Boy Location + Customer (User) Delivery Location.
 *    - Live Real-Time Road Route (Pooling Line) from Delivery Boy → User, dynamically trimmed as bike advances.
 *    - Live ETA and distance pills updating in real-time.
 *    - Map camera dynamically frames Delivery Boy and Customer location.
 *
 * 3. Delivered / Terminal:
 *    - Static clean delivered pin with celebration badge at Customer destination.
 */
const DeliveryTrackingMap = ({
  orderId,
  orderTrackingIds = [],
  restaurantCoords,
  customerCoords,
  userLiveCoords = null,
  userLocationAccuracy = null,
  order = null,
  onEtaUpdate = null,
  disableAutoCenterOnUserInteraction = true,
}) => {
  const [map, setMap] = useState(null);
  const [riderLocation, setRiderLocation] = useState(null);
  const [smoothLocation, setSmoothLocation] = useState(null);

  // Routes:
  // - foodDeliveryRoute: Restaurant -> Customer route (shown pre-pickup)
  // - riderRoute: Live route (Rider -> Customer post-pickup, or Rider -> Restaurant pre-pickup)
  const [foodDeliveryRoute, setFoodDeliveryRoute] = useState(null);
  const [riderRoute, setRiderRoute] = useState(null);
  const [routeMeta, setRouteMeta] = useState({ distanceMeters: null, durationSeconds: null });

  const socketRef = useRef(null);
  const currentSmoothPosRef = useRef(null);
  const interpStateRef = useRef({ startPos: null, targetPos: null, startTime: 0, duration: 1500 });
  const lastPacketTimeRef = useRef(0);
  const lastHeadingRef = useRef(0);
  const lastHeadingPosRef = useRef(null);
  const riderRouteStateRef = useRef({ lastAt: 0, lastOrigin: null, inFlight: false });
  const foodRouteFetchedRef = useRef(false);

  const userPannedRef = useRef(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const userInteractedRef = useRef(false);
  const isGestureActiveRef = useRef(false);
  const lastPacketTsRef = useRef(0);
  const animatingRef = useRef(false);
  const startAnimationRef = useRef(() => {});
  const [trackingEnded, setTrackingEnded] = useState(false);
  const [lastFixAt, setLastFixAt] = useState(0);
  const [socketState, setSocketState] = useState('connecting');
  const [clock, setClock] = useState(() => Date.now());

  const { palette, mapStyles } = useMapTheme();

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const trackingIdsKey = useMemo(() => {
    const ids = [
      orderId,
      order?._id,
      order?.orderId,
      order?.orderMongoId,
      ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)].join(',');
  }, [orderId, order?._id, order?.orderId, order?.orderMongoId, orderTrackingIds]);

  const deliveryPartnerId = useMemo(
    () =>
      String(
        order?.deliveryPartnerId ||
          order?.dispatch?.deliveryPartnerId ||
          order?.deliveryPartner?._id ||
          order?.deliveryPartner?.id ||
          '',
      ).trim(),
    [
      order?.deliveryPartnerId,
      order?.dispatch?.deliveryPartnerId,
      order?.deliveryPartner?._id,
      order?.deliveryPartner?.id,
    ],
  );

  const [liveOrderStatus, setLiveOrderStatus] = useState(() =>
    String(
      order?.status ||
      order?.orderStatus ||
      order?.deliveryState?.currentPhase ||
      order?.deliveryState?.status ||
      ''
    ).toLowerCase(),
  );

  useEffect(() => {
    const nextStatus = String(
      order?.status ||
      order?.orderStatus ||
      order?.deliveryState?.currentPhase ||
      order?.deliveryState?.status ||
      ''
    ).toLowerCase();

    if (nextStatus) {
      setLiveOrderStatus((prev) => {
        if (PICKED_UP_STATUSES.has(prev) && !PICKED_UP_STATUSES.has(nextStatus) && !TERMINAL_STATUSES.has(nextStatus)) {
          return prev;
        }
        return nextStatus;
      });
    }
  }, [order?.status, order?.orderStatus, order?.deliveryState?.currentPhase, order?.deliveryState?.status]);

  // Phased Lifecycle classification
  const isTerminal = TERMINAL_STATUSES.has(liveOrderStatus) || trackingEnded;
  const isPickedUp = !isTerminal && PICKED_UP_STATUSES.has(liveOrderStatus);
  const isPrePickup = !isTerminal && !isPickedUp;

  const deliveryPhase = String(order?.deliveryState?.currentPhase || order?.deliveryState?.status || '').toLowerCase();
  const riderAtRestaurant =
    isPrePickup &&
    (deliveryPhase === 'at_pickup' || deliveryPhase === 'reached_pickup' || liveOrderStatus === 'at_pickup' || liveOrderStatus === 'ready');
  const riderAssigned = Boolean(deliveryPartnerId);

  const effectiveCustomerCoords = userLiveCoords || customerCoords;

  /*
   * A cancelled order keeps its restaurant and delivery-address pins - no
   * route, rider or live tracking - so its screen shows where the order was
   * from and to instead of an empty map. Its pin is the order's address, not
   * the customer's live position.
   */
  const isCancelledTerminal = isTerminal && String(liveOrderStatus).includes('cancel');
  const customerPinCoords = isCancelledTerminal
    ? customerCoords || effectiveCustomerCoords
    : !isTerminal
      ? effectiveCustomerCoords
      : null;

  const initialCenterRef = useRef(null);
  if (!initialCenterRef.current) {
    if (isPickedUp) {
      initialCenterRef.current = effectiveCustomerCoords || restaurantCoords;
    } else {
      initialCenterRef.current = restaurantCoords || effectiveCustomerCoords;
    }
  }
  const initialCenter = initialCenterRef.current || { lat: 20.5937, lng: 78.9629 };

  /* ─────────────────── Realtime rider position ─────────────────── */

  useEffect(() => {
    if (currentSmoothPosRef.current) return;
    if (isTerminal) return;
    if (!isPickedUp && !riderAssigned) return;
    const initial = readOrderRiderPosition(order);
    if (!initial) return;
    currentSmoothPosRef.current = initial;
    lastHeadingRef.current = initial.heading || 0;
    lastHeadingPosRef.current = { lat: initial.lat, lng: initial.lng };
    lastPacketTsRef.current = Math.max(lastPacketTsRef.current, initial.at);
    setLastFixAt((prev) => Math.max(prev, initial.at));
    setRiderLocation(initial);
    setSmoothLocation(initial);
  }, [order, isPickedUp, riderAssigned, isTerminal]);

  const handleNewRiderPosition = useCallback((data) => {
    const lat = Number(data?.lat ?? data?.boy_lat ?? data?.latitude);
    const lng = Number(data?.lng ?? data?.boy_lng ?? data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
    if (TERMINAL_STATUSES.has(String(data?.orderStatus || '').toLowerCase())) return;

    const now = Date.now();
    const packetTs = Number(data?.timestamp ?? data?.last_updated ?? data?.at ?? 0);

    // Strict monotonic ordering: ignore stale packets older than 10 mins or older than the newest recorded packet
    if (packetTs > 0) {
      if (now - packetTs > STALE_PACKET_MS) return;
      if (packetTs < lastPacketTsRef.current) return;
      lastPacketTsRef.current = packetTs;
    }

    const fixAt = Number.isFinite(packetTs) && packetTs > 0 ? Math.min(packetTs, now) : now;
    setLastFixAt((prev) => Math.max(prev, fixAt));

    const currentTarget = interpStateRef.current.targetPos;
    const rendered = currentSmoothPosRef.current;
    const prevCoord = currentTarget || rendered;

    // Minimum distance threshold gating: ignore noise jitter below configurable threshold
    if (prevCoord) {
      const distFromPrev = computeDistanceMeters(prevCoord.lat, prevCoord.lng, lat, lng);
      if (distFromPrev < LOCATION_CONFIG.MIN_UPDATE_DISTANCE_M) {
        return;
      }
      // Teleportation glitch rejection
      const sinceLastSec = lastPacketTimeRef.current ? (now - lastPacketTimeRef.current) / 1000 : 1.5;
      if (sinceLastSec < 3 && distFromPrev > LOCATION_CONFIG.MAX_GPS_JUMP_METERS) {
        console.warn('[DeliveryTrackingMap] Outlier GPS jump rejected:', distFromPrev, 'meters');
        return;
      }
    }

    // Heading calculation & circling visual fix:
    // Only recalculate bearing when there is actual net movement exceeding HEADING_MIN_MOVE_DISTANCE_M
    const rawHeading = Number(data?.heading ?? data?.bearing);
    let heading = Number.isFinite(rawHeading) && rawHeading !== 0 ? rawHeading : null;

    if (heading == null) {
      if (lastHeadingPosRef.current) {
        const distForHeading = computeDistanceMeters(
          lastHeadingPosRef.current.lat,
          lastHeadingPosRef.current.lng,
          lat,
          lng
        );
        if (distForHeading >= LOCATION_CONFIG.HEADING_MIN_MOVE_DISTANCE_M) {
          heading = computeBearing(lastHeadingPosRef.current.lat, lastHeadingPosRef.current.lng, lat, lng);
          lastHeadingPosRef.current = { lat, lng };
        } else {
          heading = lastHeadingRef.current;
        }
      } else {
        heading = lastHeadingRef.current || 0;
        lastHeadingPosRef.current = { lat, lng };
      }
    } else {
      lastHeadingPosRef.current = { lat, lng };
    }

    lastHeadingRef.current = heading ?? 0;

    const target = { lat, lng, heading: heading ?? 0 };
    const sinceLast = lastPacketTimeRef.current ? now - lastPacketTimeRef.current : 1500;
    lastPacketTimeRef.current = now;

    interpStateRef.current = {
      startPos: rendered || target,
      targetPos: target,
      startTime: now,
      duration: Math.min(
        Math.max(sinceLast, LOCATION_CONFIG.MIN_INTERP_DURATION_MS),
        LOCATION_CONFIG.MAX_INTERP_DURATION_MS
      ),
    };

    setRiderLocation(target);
    startAnimationRef.current();
  }, []);

  /* ─────────────────── Socket & Channel Subscriptions ─────────────────── */

  useEffect(() => {
    const trackingIds = trackingIdsKey ? trackingIdsKey.split(',') : [];
    if (!trackingIds.length || isTerminal) return undefined;

    const unsubs = [];
    if (isPickedUp || riderAssigned) {
      trackingIds.forEach((id) => {
        unsubs.push(subscribeOrderTracking(id, handleNewRiderPosition));
      });
      if (deliveryPartnerId) {
        unsubs.push(subscribeDeliveryLocation(deliveryPartnerId, handleNewRiderPosition));
      }
    }

    const handleGlobalLocation = (event) => {
      const data = event?.detail;
      if (!data) return;
      const matches = trackingIds.some(
        (id) => String(id) === String(data.orderId) || String(id) === String(data.orderMongoId),
      );
      if (matches) handleNewRiderPosition(data);
    };
    window.addEventListener('riderLocationUpdate', handleGlobalLocation);

    const handleStatusNotification = (event) => {
      const payload = event?.detail;
      if (!payload) return;
      const evtKeys = [payload.orderId, payload.orderMongoId, payload._id].filter(Boolean).map(String);
      const matches = evtKeys.length > 0
        ? trackingIds.some((id) => evtKeys.includes(String(id)))
        : true;

      if (matches) {
        const nextStatus = String(payload.orderStatus || payload.status || '').toLowerCase();
        if (nextStatus) {
          setLiveOrderStatus(nextStatus);
          if (TERMINAL_STATUSES.has(nextStatus)) {
            setTrackingEnded(true);
          }
        }
      }
    };
    window.addEventListener('orderStatusNotification', handleStatusNotification);

    const teardown = (socket) => () => {
      unsubs.forEach((unsub) => unsub?.());
      window.removeEventListener('riderLocationUpdate', handleGlobalLocation);
      window.removeEventListener('orderStatusNotification', handleStatusNotification);
      if (socket) {
        trackingIds.forEach((id) => socket.emit('leave-tracking', id));
        socket.disconnect();
        socketRef.current = null;
      }
    };

    const socket = createAppSocket({ role: 'user', label: 'DeliveryTrackingMap' });
    if (!socket) return teardown(null);
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketState('connected');
      trackingIds.forEach((id) => socket.emit('join-tracking', id));
    });
    socket.on('disconnect', () => setSocketState('disconnected'));
    socket.on('connect_error', () => setSocketState('disconnected'));

    socket.on('order_status_update', (data) => {
      if (!data) return;
      const status = String(data.orderStatus || data.status || '').toLowerCase();
      const matches = trackingIds.some(
        (id) =>
          String(id) === String(data.orderId) ||
          String(id) === String(data.orderMongoId) ||
          String(id) === String(data._id) ||
          String(id) === String(data.displayOrderId),
      );
      if (matches || !data.orderId) {
        if (status) {
          setLiveOrderStatus(status);
          if (TERMINAL_STATUSES.has(status)) {
            setTrackingEnded(true);
          }
        }
        window.dispatchEvent(
          new CustomEvent('orderStatusNotification', {
            detail: {
              orderMongoId: data.orderMongoId,
              orderId: data.orderId,
              displayOrderId: data.displayOrderId || data.orderId,
              status: status,
              orderStatus: status,
              deliveryState: data.deliveryState,
              dispatchStatus: data.dispatchStatus,
              deliveryPartnerId: data.deliveryPartnerId,
              deliveryVerification: data.deliveryVerification,
              cancellationReason: data.cancellationReason,
              cancelledBy: data.cancelledBy,
              cancelledAt: data.cancelledAt,
              note: data.note,
              updatedAt: data.updatedAt,
              message: data.message,
              timestamp: new Date().toISOString(),
            },
          }),
        );
      }
    });

    socket.on('location-update', (data) => {
      if (!data) return;
      const incomingStatus = String(data.orderStatus || '').toLowerCase();
      if (incomingStatus) {
        setLiveOrderStatus((prev) => {
          if (TERMINAL_STATUSES.has(incomingStatus)) return incomingStatus;
          if (PICKED_UP_STATUSES.has(incomingStatus)) return incomingStatus;
          if (incomingStatus === 'at_pickup' || incomingStatus === 'assigned' || incomingStatus === 'ready') return incomingStatus;
          return prev;
        });
      }
      handleNewRiderPosition(data);
    });

    socket.on('tracking-ended', (data) => {
      const matches = trackingIds.some(
        (id) =>
          String(id) === String(data?.orderId) ||
          String(id) === String(data?.orderMongoId) ||
          String(id) === String(data?._id),
      );
      if (matches || !data?.orderId) {
        setTrackingEnded(true);
      }
    });

    const reconnect = () => {
      if (document.visibilityState === 'hidden') return;
      if (!socket.connected) socket.connect();
    };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    const stopSocket = teardown(socket);

    return () => {
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', reconnect);
      stopSocket();
    };
  }, [trackingIdsKey, deliveryPartnerId, handleNewRiderPosition, isTerminal, isPickedUp, riderAssigned]);

  // Fallback short-interval polling (3-5s): activates ONLY when socket drops
  useEffect(() => {
    if (isTerminal) return undefined;
    if (socketState === 'connected') return undefined;

    const primaryId = orderId || (trackingIdsKey ? trackingIdsKey.split(',')[0] : '');
    if (!primaryId) return undefined;

    const pollInterval = LOCATION_CONFIG.TRACKING_FALLBACK_POLL_MS;
    let inFlight = false;

    const pollFallback = async () => {
      if (inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlight = true;
      try {
        const res = await orderAPI.getOrderDetails(primaryId, { force: true });
        const fetchedOrder = res?.data?.data?.order || res?.data?.order || res?.data;
        if (fetchedOrder) {
          const fetchedStatus = String(fetchedOrder.status || fetchedOrder.orderStatus || '').toLowerCase();
          if (fetchedStatus) {
            setLiveOrderStatus((prev) =>
              PICKED_UP_STATUSES.has(prev) && !PICKED_UP_STATUSES.has(fetchedStatus) && !TERMINAL_STATUSES.has(fetchedStatus)
                ? prev
                : fetchedStatus,
            );
          }
          const riderPos = readOrderRiderPosition(fetchedOrder);
          if (riderPos) {
            handleNewRiderPosition({
              lat: riderPos.lat,
              lng: riderPos.lng,
              heading: riderPos.heading,
              timestamp: riderPos.at,
              orderStatus: fetchedStatus,
              source: 'fallback_poll',
            });
          }
        }
      } catch (err) {
        // Silently retry on next tick
      } finally {
        inFlight = false;
      }
    };

    pollFallback();
    const intervalId = setInterval(pollFallback, pollInterval);

    return () => clearInterval(intervalId);
  }, [socketState, isTerminal, orderId, trackingIdsKey, handleNewRiderPosition]);

  // Emit user's live location over persistent channel
  const lastUserEmitRef = useRef({ at: 0, lat: null, lng: null });

  useEffect(() => {
    if (!userLiveCoords || isTerminal || !isPickedUp) return;
    const lat = Number(userLiveCoords.lat ?? userLiveCoords.latitude);
    const lng = Number(userLiveCoords.lng ?? userLiveCoords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;

    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    const now = Date.now();
    const last = lastUserEmitRef.current;
    const moved = last.lat == null ? Infinity : computeDistanceMeters(last.lat, last.lng, lat, lng);
    const since = now - last.at;

    const shouldEmit =
      moved >= LOCATION_CONFIG.USER_LOC_MIN_MOVE_M && since >= LOCATION_CONFIG.USER_LOC_MIN_INTERVAL_MS;
    const isSilenceHeartbeat = since >= LOCATION_CONFIG.USER_LOC_MAX_SILENCE_MS;

    if (last.lat == null || shouldEmit || isSilenceHeartbeat) {
      lastUserEmitRef.current = { at: now, lat, lng };
      const primaryId = orderId || (trackingIdsKey ? trackingIdsKey.split(',')[0] : '');
      if (primaryId) {
        socket.emit('update-user-location', {
          orderId: primaryId,
          lat,
          lng,
          accuracy: Number(userLocationAccuracy) || null,
        });
      }
    }
  }, [userLiveCoords, userLocationAccuracy, orderId, trackingIdsKey, isTerminal, isPickedUp, socketState]);

  useEffect(() => {
    if (isTerminal) return undefined;
    const id = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(id);
  }, [isTerminal]);

  // Clear bike and routes when terminal
  useEffect(() => {
    if (!isTerminal) return;
    interpStateRef.current = { startPos: null, targetPos: null, startTime: 0, duration: 1500 };
    currentSmoothPosRef.current = null;
    setRiderLocation(null);
    setSmoothLocation(null);
    setRiderRoute(null);
    setFoodDeliveryRoute(null);
    setRouteMeta({ distanceMeters: null, durationSeconds: null });
  }, [isTerminal]);

  /* ─────────────────── 60 fps marker interpolation ─────────────────── */

  useEffect(() => {
    let frameId;
    const step = () => {
      const { startPos, targetPos, startTime, duration } = interpStateRef.current;
      if (!startPos || !targetPos) {
        animatingRef.current = false;
        return;
      }
      {
        const progress = Math.min((Date.now() - startTime) / (duration || 1500), 1);
        const eased = 1 - (1 - progress) ** 2;

        let delta = ((targetPos.heading || 0) - (startPos.heading || 0)) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        const next = {
          lat: startPos.lat + (targetPos.lat - startPos.lat) * eased,
          lng: startPos.lng + (targetPos.lng - startPos.lng) * eased,
          heading: ((startPos.heading || 0) + delta * eased + 360) % 360,
        };
        currentSmoothPosRef.current = next;
        setSmoothLocation(next);
        if (progress >= 1) {
          animatingRef.current = false;
          return;
        }
      }
      frameId = requestAnimationFrame(step);
    };

    startAnimationRef.current = () => {
      if (animatingRef.current) return;
      animatingRef.current = true;
      frameId = requestAnimationFrame(step);
    };
    startAnimationRef.current();

    return () => {
      animatingRef.current = false;
      startAnimationRef.current = () => {};
      cancelAnimationFrame(frameId);
    };
  }, []);

  /* ─────────────────── Route 1: Pre-Pickup Restaurant → Customer Food Route ─────────────────── */

  useEffect(() => {
    if (!isLoaded || isTerminal || !restaurantCoords || !effectiveCustomerCoords) return;
    if (foodRouteFetchedRef.current) return;

    foodRouteFetchedRef.current = true;
    computeDrivingRoute(restaurantCoords, effectiveCustomerCoords)
      .then((route) => {
        setFoodDeliveryRoute(route.path);
        if (Number.isFinite(route.distanceMeters) || Number.isFinite(route.durationSeconds)) {
          setRouteMeta((prev) => ({
            distanceMeters: prev.distanceMeters || route.distanceMeters,
            durationSeconds: prev.durationSeconds || route.durationSeconds,
          }));
        }
      })
      .catch((err) => {
        console.warn('[DeliveryTrackingMap] Pre-pickup food delivery route error:', err?.message || err);
      });
  }, [isLoaded, isTerminal, restaurantCoords, effectiveCustomerCoords]);

  /* ─────────────────── Route 2: Active Live Rider Route (Rider → Destination) ─────────────────── */

  const riderPosition = smoothLocation || riderLocation;

  const liveRouteTarget = useMemo(() => {
    if (isTerminal) return null;
    if (isPickedUp) return effectiveCustomerCoords;
    if (isPrePickup && riderAssigned && restaurantCoords) return restaurantCoords;
    return null;
  }, [isTerminal, isPickedUp, isPrePickup, riderAssigned, effectiveCustomerCoords, restaurantCoords]);

  const liveRouteLeg = useMemo(() => {
    if (isTerminal) return null;
    if (isPickedUp && effectiveCustomerCoords) return 'to_customer';
    if (isPrePickup && riderAssigned && restaurantCoords && (riderPosition || currentSmoothPosRef.current)) {
      return 'to_restaurant';
    }
    return null;
  }, [isTerminal, isPickedUp, effectiveCustomerCoords, isPrePickup, riderAssigned, restaurantCoords, riderPosition]);

  const liveRouteLegRef = useRef(liveRouteLeg);
  liveRouteLegRef.current = liveRouteLeg;

  const requestLiveRoute = useCallback(
    (origin) => {
      if (!isLoaded || !origin || !liveRouteTarget || riderRouteStateRef.current.inFlight) return;
      riderRouteStateRef.current.inFlight = true;
      const leg = liveRouteLeg;

      computeDrivingRoute(origin, liveRouteTarget)
        .then((route) => {
          if (leg !== liveRouteLegRef.current) return;
          riderRouteStateRef.current.lastAt = Date.now();
          riderRouteStateRef.current.lastOrigin = origin;
          setRiderRoute(route.path);
          setRouteMeta({
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
          });
          if (leg === 'to_customer' && onEtaUpdate && Number.isFinite(route.durationSeconds)) {
            onEtaUpdate(formatDuration(route.durationSeconds));
          }
        })
        .catch(() => {
          riderRouteStateRef.current.lastAt = Date.now();
        })
        .finally(() => {
          riderRouteStateRef.current.inFlight = false;
        });
    },
    [isLoaded, liveRouteTarget, liveRouteLeg, onEtaUpdate],
  );

  // Clear rider route on leg change
  useEffect(() => {
    setRiderRoute(null);
    riderRouteStateRef.current = { lastAt: 0, lastOrigin: null, inFlight: false };
  }, [liveRouteLeg]);

  // Periodic rider route update
  useEffect(() => {
    if (!liveRouteLeg || !isLoaded || isTerminal) {
      setRiderRoute(null);
      riderRouteStateRef.current = { lastAt: 0, lastOrigin: null, inFlight: false };
      return undefined;
    }

    const tick = () => {
      const origin = currentSmoothPosRef.current;
      if (!origin) return;

      const { lastAt, lastOrigin } = riderRouteStateRef.current;
      const movedFar =
        !lastOrigin ||
        computeDistanceMeters(lastOrigin.lat, lastOrigin.lng, origin.lat, origin.lng) >
          ROUTE_REFRESH_DISTANCE_M;

      let isOffRoute = false;
      if (riderRoute && riderRoute.length >= 2) {
        const { distance: distFromRoute } = findClosestPointOnPath(riderRoute, origin);
        if (distFromRoute > OFF_ROUTE_DISTANCE_M) {
          isOffRoute = true;
        }
      }

      if (isOffRoute || movedFar || Date.now() - lastAt > ROUTE_REFRESH_INTERVAL_MS) {
        requestLiveRoute({ lat: origin.lat, lng: origin.lng });
      }
    };

    tick();
    const intervalId = setInterval(tick, ROUTE_TICK_MS);
    return () => clearInterval(intervalId);
  }, [liveRouteLeg, isLoaded, isTerminal, requestLiveRoute, riderRoute]);

  /* ─────────────────── Route Trimming & Snapping ─────────────────── */

  const activeRiderPath = isPickedUp ? riderRoute : isPrePickup ? riderRoute : null;

  const routeTrimResult = useMemo(() => {
    if (isTerminal || !activeRiderPath || activeRiderPath.length < 2 || !riderPosition) {
      return { remainingPath: activeRiderPath, snappedPoint: null, offRouteDistance: 0 };
    }
    return computeRemainingPath(activeRiderPath, riderPosition);
  }, [isTerminal, activeRiderPath, riderPosition]);

  const remainingPath = routeTrimResult.remainingPath;
  const fullPathLengthM = useMemo(() => computePathLengthM(activeRiderPath), [activeRiderPath]);
  const remainingPathLengthM = useMemo(() => computePathLengthM(remainingPath), [remainingPath]);

  const snappedRiderPos = useMemo(() => {
    if (isTerminal || !routeTrimResult.snappedPoint || !riderPosition) return null;
    if (routeTrimResult.offRouteDistance > SNAP_TO_ROUTE_MAX_M) return null;
    return {
      lat: routeTrimResult.snappedPoint.lat,
      lng: routeTrimResult.snappedPoint.lng,
      heading: riderPosition.heading || 0,
    };
  }, [isTerminal, routeTrimResult, riderPosition]);

  const displayRiderPos = snappedRiderPos || riderPosition;

  /* ─────────────────── Distance & ETA ─────────────────── */

  const tripDistanceMeters = useMemo(() => {
    if (isTerminal) return null;

    if (isPickedUp && remainingPathLengthM > 0) return remainingPathLengthM;
    if (isPickedUp && Number.isFinite(routeMeta.distanceMeters)) return routeMeta.distanceMeters;

    if (isPrePickup && riderAssigned && remainingPathLengthM > 0) return remainingPathLengthM;

    const storedKm = Number(order?.tripDistanceKm ?? order?.pricing?.roadDistanceKm);
    if (Number.isFinite(storedKm) && storedKm > 0) return storedKm * 1000;

    if (restaurantCoords && effectiveCustomerCoords) {
      return computeDistanceMeters(
        restaurantCoords.lat,
        restaurantCoords.lng,
        effectiveCustomerCoords.lat,
        effectiveCustomerCoords.lng,
      );
    }
    return null;
  }, [
    isTerminal,
    isPickedUp,
    isPrePickup,
    riderAssigned,
    remainingPathLengthM,
    routeMeta.distanceMeters,
    order?.tripDistanceKm,
    order?.pricing?.roadDistanceKm,
    restaurantCoords,
    effectiveCustomerCoords,
  ]);

  const liveEtaSeconds = useMemo(() => {
    if (isTerminal || !isPickedUp) return null;
    return interpolateRemainingEta(remainingPathLengthM, fullPathLengthM, routeMeta.durationSeconds);
  }, [isTerminal, isPickedUp, remainingPathLengthM, fullPathLengthM, routeMeta.durationSeconds]);

  const etaText = useMemo(() => {
    if (isTerminal) return '';
    if (isPickedUp && Number.isFinite(liveEtaSeconds) && liveEtaSeconds > 0) {
      return formatDuration(liveEtaSeconds);
    }
    if (isPickedUp && Number.isFinite(routeMeta.durationSeconds)) {
      return formatDuration(routeMeta.durationSeconds);
    }
    const storedMins = Number(order?.tripDurationMins ?? order?.pricing?.roadDurationMins);
    return Number.isFinite(storedMins) && storedMins > 0 ? `${Math.round(storedMins)} min` : '';
  }, [
    isTerminal,
    isPickedUp,
    liveEtaSeconds,
    routeMeta.durationSeconds,
    order?.tripDurationMins,
    order?.pricing?.roadDurationMins,
  ]);

  /* ─────────────────── Camera & Dynamic Bounds (Zomato Style) ─────────────────── */

  const getViewportPadding = useCallback(() => {
    const windowH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const windowW = typeof window !== 'undefined' ? window.innerWidth : 400;
    const isDesktop = windowW >= 1024;

    return {
      top: 80,
      bottom: isDesktop ? 80 : Math.min(Math.round(windowH * 0.44), 360),
      left: isDesktop ? 480 : 45,
      right: isDesktop ? 60 : 45,
    };
  }, []);

  // Pre-pickup camera: frames BOTH Restaurant AND Customer (and Rider if assigned)
  const fitPrePickupBounds = useCallback((mapInstance = map) => {
    if (!mapInstance || !window.google?.maps || isPickedUp || isTerminal) return;

    const points = [];
    if (restaurantCoords && Number.isFinite(restaurantCoords.lat) && Number.isFinite(restaurantCoords.lng)) {
      points.push(restaurantCoords);
    }
    if (effectiveCustomerCoords && Number.isFinite(effectiveCustomerCoords.lat) && Number.isFinite(effectiveCustomerCoords.lng)) {
      points.push(effectiveCustomerCoords);
    }
    const rider = displayRiderPos || currentSmoothPosRef.current;
    if (riderAssigned && rider && Number.isFinite(rider.lat) && Number.isFinite(rider.lng)) {
      points.push(rider);
    }

    if (points.length >= 2) {
      const bounds = new window.google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend(p));
      try {
        mapInstance.fitBounds(bounds, getViewportPadding());
      } catch (err) {
        console.warn('[DeliveryTrackingMap] fitPrePickupBounds error:', err);
      }
    } else if (points.length === 1) {
      try {
        mapInstance.panTo(points[0]);
        mapInstance.setZoom(15);
      } catch (err) {
        console.warn('[DeliveryTrackingMap] center single point error:', err);
      }
    }
  }, [map, isPickedUp, isTerminal, restaurantCoords, effectiveCustomerCoords, riderAssigned, displayRiderPos, getViewportPadding]);

  // Post-pickup camera: frames Delivery Partner AND Customer (User)
  const fitPostPickupBounds = useCallback((mapInstance = map) => {
    if (!isPickedUp || !mapInstance || isTerminal || !window.google?.maps) return;

    const points = [];
    const rider = displayRiderPos || currentSmoothPosRef.current;
    if (rider && Number.isFinite(rider.lat) && Number.isFinite(rider.lng)) {
      points.push(rider);
    } else if (restaurantCoords) {
      points.push(restaurantCoords);
    }
    if (effectiveCustomerCoords && Number.isFinite(effectiveCustomerCoords.lat) && Number.isFinite(effectiveCustomerCoords.lng)) {
      points.push(effectiveCustomerCoords);
    }

    if (points.length >= 2) {
      const bounds = new window.google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend(p));
      try {
        mapInstance.fitBounds(bounds, getViewportPadding());
      } catch (err) {
        console.warn('[DeliveryTrackingMap] fitPostPickupBounds error:', err);
      }
    } else if (points.length === 1) {
      try {
        mapInstance.panTo(points[0]);
        mapInstance.setZoom(15);
      } catch (err) {
        console.warn('[DeliveryTrackingMap] center single point error:', err);
      }
    }
  }, [map, isPickedUp, isTerminal, effectiveCustomerCoords, displayRiderPos, restaurantCoords, getViewportPadding]);

  const prePickupDataKey = useMemo(() => {
    if (!isPrePickup) return null;
    const rLat = Number(restaurantCoords?.lat)?.toFixed(5) || '';
    const rLng = Number(restaurantCoords?.lng)?.toFixed(5) || '';
    const cLat = Number(effectiveCustomerCoords?.lat)?.toFixed(5) || '';
    const cLng = Number(effectiveCustomerCoords?.lng)?.toFixed(5) || '';
    const rider = displayRiderPos || currentSmoothPosRef.current;
    const bLat = Number(rider?.lat)?.toFixed(5) || '';
    const bLng = Number(rider?.lng)?.toFixed(5) || '';
    return `${rLat},${rLng}|${cLat},${cLng}|${bLat},${bLng}`;
  }, [isPrePickup, restaurantCoords, effectiveCustomerCoords, displayRiderPos]);

  useEffect(() => {
    if (!isPrePickup || !map || !prePickupDataKey) return;
    if (userPannedRef.current) return;
    fitPrePickupBounds(map);
  }, [map, isPrePickup, prePickupDataKey, fitPrePickupBounds]);

  useEffect(() => {
    if (!isPickedUp || !map || !effectiveCustomerCoords) return;
    if (userPannedRef.current) return;
    fitPostPickupBounds(map);
  }, [map, isPickedUp, effectiveCustomerCoords, fitPostPickupBounds]);

  // User manual pan/zoom interaction listeners
  useEffect(() => {
    if (!map) return undefined;

    const onDragStart = () => {
      userPannedRef.current = true;
      if (disableAutoCenterOnUserInteraction) {
        userInteractedRef.current = true;
        setUserInteracted(true);
      }
    };

    const onZoomChanged = () => {
      if (isGestureActiveRef.current) {
        userPannedRef.current = true;
        if (disableAutoCenterOnUserInteraction) {
          userInteractedRef.current = true;
          setUserInteracted(true);
        }
      }
    };

    const dragListener = map.addListener('dragstart', onDragStart);
    const zoomListener = map.addListener('zoom_changed', onZoomChanged);

    return () => {
      dragListener?.remove();
      zoomListener?.remove();
    };
  }, [map, disableAutoCenterOnUserInteraction]);

  // Post-pickup auto-pan to follow rider when viewport drifts
  useEffect(() => {
    if (!isPickedUp || !map || isTerminal || !displayRiderPos || userPannedRef.current) return;
    const viewport = map.getBounds();
    if (viewport && !viewport.contains(displayRiderPos)) map.panTo(displayRiderPos);
  }, [isPickedUp, map, isTerminal, displayRiderPos]);

  // Terminal camera
  useEffect(() => {
    if (!isTerminal || !map) return;
    // Cancelled: frame both pins, the way the map does before pickup.
    if (isCancelledTerminal && restaurantCoords && customerPinCoords && window.google?.maps) {
      try {
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend(restaurantCoords);
        bounds.extend(customerPinCoords);
        map.fitBounds(bounds, getViewportPadding());
        return;
      } catch (err) {
        console.warn('[DeliveryTrackingMap] cancelled bounds error:', err);
      }
    }
    const target = customerPinCoords || effectiveCustomerCoords || restaurantCoords;
    if (target) {
      map.panTo(target);
      map.setZoom(16);
    }
  }, [isTerminal, isCancelledTerminal, map, customerPinCoords, effectiveCustomerCoords, restaurantCoords, getViewportPadding]);

  /* ─────────────────── Render Paths & Options ─────────────────── */

  // Fallback dashed line if driving route is loading
  const fallbackDashedPath = useMemo(() => {
    if (isTerminal) return null;
    if (isPickedUp) {
      if (remainingPath && remainingPath.length >= 2) return null;
      const origin = displayRiderPos || restaurantCoords;
      return origin && effectiveCustomerCoords ? [origin, effectiveCustomerCoords] : null;
    }
    if (isPrePickup) {
      if (foodDeliveryRoute && foodDeliveryRoute.length >= 2) return null;
      return restaurantCoords && effectiveCustomerCoords ? [restaurantCoords, effectiveCustomerCoords] : null;
    }
    return null;
  }, [isTerminal, isPickedUp, isPrePickup, remainingPath, foodDeliveryRoute, displayRiderPos, restaurantCoords, effectiveCustomerCoords]);

  const dashedLineOptions = useMemo(
    () => ({
      strokeOpacity: 0,
      geodesic: true,
      zIndex: 4,
      icons: [
        {
          icon: {
            path: 'M 0,-1 0,1',
            strokeColor: palette.routePending || '#9aa1ac',
            strokeOpacity: 0.95,
            strokeWeight: 3,
            scale: 3,
          },
          offset: '0',
          repeat: '14px',
        },
      ],
    }),
    [palette.routePending],
  );

  const mapOptions = useMemo(
    () => ({
      styles: mapStyles,
      backgroundColor: palette.surface,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
    }),
    [mapStyles, palette.surface],
  );

  if (!isLoaded) {
    return (
      <div className="w-full h-full animate-pulse" style={{ backgroundColor: palette.surface }} />
    );
  }

  const badgeStyle = { backgroundColor: palette.badge, color: palette.badgeForeground };
  const distanceText = formatDistance(tripDistanceMeters);

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      onPointerDown={() => { isGestureActiveRef.current = true; }}
      onPointerUp={() => { setTimeout(() => { isGestureActiveRef.current = false; }, 300); }}
      onTouchStart={() => { isGestureActiveRef.current = true; }}
      onTouchEnd={() => { setTimeout(() => { isGestureActiveRef.current = false; }, 300); }}
      onWheel={() => {
        isGestureActiveRef.current = true;
        setTimeout(() => { isGestureActiveRef.current = false; }, 300);
      }}
    >
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={initialCenter}
        onLoad={(mapInstance) => {
          setMap(mapInstance);
          if (isPrePickup) {
            fitPrePickupBounds(mapInstance);
          } else if (isPickedUp) {
            fitPostPickupBounds(mapInstance);
          }
        }}
        options={mapOptions}
      >
        {/* Fallback dashed straight line when driving route is calculating */}
        {fallbackDashedPath && (
          <Polyline path={fallbackDashedPath} options={dashedLineOptions} />
        )}

        {/* PRE-PICKUP: Route from Restaurant → Customer (Zomato-style food journey) */}
        {isPrePickup && foodDeliveryRoute && foodDeliveryRoute.length >= 2 && (
          <>
            <Polyline
              path={foodDeliveryRoute}
              options={{
                strokeColor: palette.routeCasing,
                strokeOpacity: 0.85,
                strokeWeight: 7,
                zIndex: 6,
              }}
            />
            <Polyline
              path={foodDeliveryRoute}
              options={{
                strokeColor: palette.route,
                strokeOpacity: 0.95,
                strokeWeight: 4,
                zIndex: 7,
              }}
            />
          </>
        )}

        {/* PRE-PICKUP: Route from Rider → Restaurant (when rider is approaching restaurant) */}
        {isPrePickup && riderAssigned && displayRiderPos && remainingPath && remainingPath.length >= 2 && (
          <>
            <Polyline
              path={remainingPath}
              options={{
                strokeColor: '#ffffff',
                strokeOpacity: 0.8,
                strokeWeight: 6,
                zIndex: 8,
              }}
            />
            <Polyline
              path={remainingPath}
              options={{
                strokeColor: '#3b82f6',
                strokeOpacity: 1,
                strokeWeight: 4,
                zIndex: 9,
              }}
            />
          </>
        )}

        {/* POST-PICKUP: Live Road Route (Pooling Line) from Rider → Customer (Dynamically Trimmed) */}
        {isPickedUp && remainingPath && remainingPath.length >= 2 && (
          <>
            <Polyline
              path={remainingPath}
              options={{
                strokeColor: palette.routeCasing,
                strokeOpacity: 0.9,
                strokeWeight: 9,
                zIndex: 10,
              }}
            />
            <Polyline
              path={remainingPath}
              options={{
                strokeColor: palette.route,
                strokeOpacity: 1,
                strokeWeight: 5,
                zIndex: 11,
              }}
            />
          </>
        )}

        {/* 1. RESTAURANT MARKER: Shown in Pre-Pickup stage (and subtly in Post-Pickup), and on a cancelled order */}
        {restaurantCoords && (!isTerminal || isCancelledTerminal) && (
          <OverlayView position={restaurantCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div
              className={`relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300 ${
                isPickedUp ? 'opacity-70 scale-90' : 'opacity-100 z-30'
              }`}
            >
              <div
                className="absolute -top-12 z-50 rounded-full flex items-center px-2 py-1 shadow-lg gap-1.5"
                style={badgeStyle}
              >
                <img
                  src={
                    order?.restaurantLogo ||
                    order?.restaurantId?.logo ||
                    order?.restaurantId?.profileImage ||
                    restaurantFallbackIcon(palette.restaurant)
                  }
                  alt=""
                  className="w-5 h-5 rounded-full object-cover bg-white"
                  onError={(e) => {
                    e.target.src = restaurantFallbackIcon(palette.restaurant);
                  }}
                />
                <span className="text-[11px] font-bold pr-1 truncate max-w-[120px]">
                  {order?.restaurantName ||
                    (typeof order?.restaurant === 'string' ? order.restaurant : '') ||
                    order?.restaurantId?.restaurantName ||
                    order?.restaurantId?.name ||
                    'Restaurant'}
                </span>
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45"
                  style={{ backgroundColor: palette.badge }}
                />
              </div>
              <div
                className="w-4 h-4 border-[3px] border-white rounded-full shadow-md z-10"
                style={{ backgroundColor: palette.restaurant }}
              />
            </div>
          </OverlayView>
        )}

        {/* 2. CUSTOMER / USER DELIVERY LOCATION: Shown in both Pre-Pickup and Post-Pickup stages, and on a cancelled order */}
        {customerPinCoords && (
          <OverlayView position={customerPinCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2 z-30">
              <div
                className="absolute -top-12 z-50 rounded-full flex items-center px-2.5 py-1 shadow-lg gap-1.5"
                style={badgeStyle}
              >
                <span className="text-[11px] font-bold">
                  {userLiveCoords && !isCancelledTerminal ? 'You (Live)' : order?.address?.label || 'Home'}
                </span>
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45"
                  style={{ backgroundColor: palette.badge }}
                />
              </div>
              <div
                className="w-4 h-4 border-[3px] border-white rounded-full shadow-md z-10"
                style={{ backgroundColor: palette.customer }}
              />
            </div>
          </OverlayView>
        )}

        {/* 3. STATIC DELIVERED PIN: Shown cleanly on terminal / delivered state */}
        {isTerminal && (liveOrderStatus === 'delivered' || liveOrderStatus === 'completed') && effectiveCustomerCoords && (
          <OverlayView position={effectiveCustomerCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2">
              <div
                className="absolute -top-12 z-50 rounded-full flex items-center px-3 py-1 shadow-lg gap-1.5 bg-emerald-500 text-white"
              >
                <span className="text-[11px] font-bold">Delivered</span>
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-emerald-500"
                />
              </div>
              <div
                className="w-5 h-5 border-[3px] border-white rounded-full shadow-md z-10 bg-emerald-600"
              />
            </div>
          </OverlayView>
        )}

        {/* 4. RIDER MARKER: Pre-pickup (if assigned) and Post-pickup (Live) */}
        {!isTerminal && displayRiderPos && (
          <OverlayView position={displayRiderPos} mapPaneName={OverlayView.MARKER_LAYER}>
            <div
              className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2 z-40"
              style={{ opacity: lastFixAt && clock - lastFixAt > SIGNAL_WEAK_MS ? 0.55 : 1 }}
            >
              {isPickedUp && etaText && (
                <div
                  className="absolute -top-8 z-50 whitespace-nowrap text-[10px] font-bold px-2.5 py-1 rounded-md shadow-xl flex items-center gap-1.5"
                  style={badgeStyle}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: palette.customer }}
                  />
                  <span>{etaText}</span>
                  <div
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45"
                    style={{ backgroundColor: palette.badge }}
                  />
                </div>
              )}

              {isPrePickup && (
                <div
                  className="absolute -top-8 z-50 whitespace-nowrap text-[10px] font-bold px-2.5 py-1 rounded-md shadow-xl flex items-center gap-1.5 bg-blue-600 text-white"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span>Rider arriving</span>
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-blue-600" />
                </div>
              )}

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0">
                <motion.div
                  animate={{ scale: [1, 2.8], opacity: [0.7, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                  className="w-14 h-14 rounded-full border-4"
                  style={{
                    borderColor: isPrePickup ? '#3b82f666' : `${palette.riderPulse}66`,
                    backgroundColor: isPrePickup ? '#3b82f61a' : `${palette.riderPulse}1a`,
                  }}
                />
              </div>

              <div
                className="relative w-16 h-16 flex items-center justify-center z-10"
                style={{
                  transform: `rotate(${displayRiderPos.heading || 0}deg)`,
                  transition: 'transform 0.2s ease-out',
                }}
              >
                <img
                  src={mapRiderIcon}
                  alt="Delivery rider"
                  className="w-[160%] h-[160%] max-w-none object-contain drop-shadow-2xl select-none"
                  onError={(e) => {
                    e.target.src = bikeLogo;
                  }}
                />
              </div>
            </div>
          </OverlayView>
        )}
      </GoogleMap>

      {/* Floating Live Tracking Status Banner */}
      {!isTerminal && (
        (() => {
          const ageMs = lastFixAt ? clock - lastFixAt : null;
          let text = null;
          let tone = palette.routePending;

          if (!riderAssigned) {
            text = PRE_RIDER_BANNER_TEXT[liveOrderStatus] || 'Tracking your order';
            tone = palette.restaurant;
          } else if (!isPickedUp) {
            text = riderAtRestaurant
              ? 'Rider is at the restaurant, collecting order'
              : 'Rider arriving at restaurant for pickup';
            tone = '#3b82f6';
          } else if (socketState === 'disconnected') {
            text = 'Reconnecting to live tracking…';
          } else if (!riderPosition) {
            text = "Waiting for rider's GPS location…";
          } else if (ageMs != null && ageMs > SIGNAL_WEAK_MS) {
            const mins = Math.max(1, Math.round(ageMs / 60000));
            text = `Rider location updated ${mins} min ago`;
          } else {
            text = 'Food on the way • Live tracking';
            tone = palette.route;
          }

          if (!text) return null;

          return (
            <div
              className="absolute top-32 left-3 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-lg max-w-[calc(100%-24px)]"
              style={badgeStyle}
              role="status"
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tone }} />
              <span className="truncate">{text}</span>
            </div>
          );
        })()
      )}

      {/* Floating Distance & ETA Pill */}
      {!isTerminal && distanceText && (
        <div
          className="absolute top-20 left-3 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-lg"
          style={badgeStyle}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: isPickedUp ? palette.route : palette.routePending }}
          />
          <span>{isPickedUp ? `${distanceText} away` : `${distanceText} total distance`}</span>
          {etaText && (
            <>
              <span className="opacity-40">•</span>
              <span>{etaText}</span>
            </>
          )}
        </div>
      )}

      {/* Floating Recenter button when user manually panned/zoomed */}
      {!isTerminal && userInteracted && (
        <button
          type="button"
          onClick={() => {
            userInteractedRef.current = false;
            setUserInteracted(false);
            userPannedRef.current = false;
            if (isPickedUp) {
              fitPostPickupBounds(map);
            } else {
              fitPrePickupBounds(map);
            }
          }}
          className="absolute top-20 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 bg-white/95 dark:bg-zinc-900/95 text-gray-800 dark:text-gray-100 text-[11px] font-bold rounded-full shadow-lg border border-gray-200/80 dark:border-zinc-700/80 backdrop-blur-xs transition-transform active:scale-95 hover:bg-gray-50 dark:hover:bg-zinc-800 cursor-pointer"
          aria-label="Recenter map"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-3.5 h-3.5 text-[#EB590E]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="22" y1="12" x2="18" y2="12" />
            <line x1="6" y1="12" x2="2" y2="12" />
            <line x1="12" y1="6" x2="12" y2="2" />
            <line x1="12" y1="22" x2="12" y2="18" />
          </svg>
          <span>Recenter</span>
        </button>
      )}
    </div>
  );
};

export default React.memo(DeliveryTrackingMap);
