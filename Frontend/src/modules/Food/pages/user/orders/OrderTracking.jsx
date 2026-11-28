import { useParams, Link, useSearchParams, useNavigate, useLocation } from "react-router-dom"
import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from "react"
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion"
import { toast } from "sonner"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"
import {
  ArrowLeft,
  RefreshCw,
  Phone,
  User,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Home as HomeIcon,
  Check,
  CheckCircle2,
  Sparkles,
  RotateCcw,
  Send,
  PartyPopper,
  Shield,
  Receipt,
  CircleSlash,
  Loader2,
  Star,
  Store,
  FileText,
  ShoppingBag,
  Clock,
  UtensilsCrossed,
  Bike,
  Flame,
  Zap,
  Package,
  Smile,
  Copy,
  Maximize2,
  Minimize2,
  ExternalLink,
  ShieldCheck,
  HelpCircle,
  CreditCard,
  AlertCircle
} from "lucide-react"
import { resolveMediaUrl } from "@/shared/utils/mediaUrl"
import { reportError } from "@/shared/utils/errorReporter"
import RouteErrorBoundary from "@/shared/components/RouteErrorBoundary"
import { isVegMenuItem } from "@food/utils/vegMode"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Textarea } from "@food/components/ui/textarea"
import { useOrders } from "@food/context/OrdersContext"
import { useProfile } from "@food/context/ProfileContext"
import { useLocation as useUserLocation } from "@food/hooks/useLocation"
import DeliveryTrackingMap from "@food/components/user/DeliveryTrackingMap"
import { orderAPI, restaurantAPI } from "@food/api"
import { initRazorpayPayment, preloadRazorpayScript } from "@food/utils/razorpay"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { useUserNotifications, ORDER_REALTIME_RESYNC_EVENT } from "@food/hooks/useUserNotifications"
import circleIcon from "@food/assets/circleicon.webp"
import { RESTAURANT_PIN_SVG, CUSTOMER_PIN_SVG, RIDER_BIKE_SVG } from "@food/constants/mapIcons"

// Fallback definitions in case imports fail at runtime or are shadowed
const DEFAULT_CUSTOMER_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_CUSTOMER_PIN = typeof CUSTOMER_PIN_SVG !== 'undefined' ? CUSTOMER_PIN_SVG : DEFAULT_CUSTOMER_PIN;
const DEFAULT_RESTAURANT_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_RESTAURANT_PIN = typeof RESTAURANT_PIN_SVG !== 'undefined' ? RESTAURANT_PIN_SVG : DEFAULT_RESTAURANT_PIN;

const debugLog = (...args) => console.log('[OrderTracking]', ...args)
const debugWarn = (...args) => console.warn('[OrderTracking]', ...args)
const debugError = (...args) => console.error('[OrderTracking]', ...args)


// Animated checkmark component
const AnimatedCheckmark = ({ delay = 0 }) => (
  <motion.svg
    width="80"
    height="80"
    viewBox="0 0 80 80"
    initial="hidden"
    animate="visible"
    className="mx-auto"
  >
    <motion.circle
      cx="40"
      cy="40"
      r="36"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    />
    <motion.path
      d="M24 40 L35 51 L56 30"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.4, delay: delay + 0.4, ease: "easeOut" }}
    />
  </motion.svg>
)

/** Shown while the map cannot be drawn (no coordinates yet, or the map failed). */
const MAP_PLACEHOLDER = <div className="relative h-full w-full bg-gradient-to-b from-gray-100 to-gray-200" />;

// Real Delivery Map Component with User Live Location
const DeliveryMap = React.memo(({ orderId, order, isVisible, fallbackCustomerCoords = null, userLiveCoords = null, userLocationAccuracy = null, onEtaUpdate = null }) => {
  const toPointFromGeoJSON = (coords) => {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  // Memoize coordinates to prevent re-calculating on every parent render
  const restaurantCoords = useMemo(() => {
    let coords = null;

    if (order?.restaurantLocation?.coordinates &&
      Array.isArray(order.restaurantLocation.coordinates) &&
      order.restaurantLocation.coordinates.length >= 2) {
      coords = order.restaurantLocation.coordinates;
    }
    else if (order?.restaurantId?.location?.coordinates &&
      Array.isArray(order.restaurantId.location.coordinates) &&
      order.restaurantId.location.coordinates.length >= 2) {
      coords = order.restaurantId.location.coordinates;
    }
    else if (order?.restaurant?.location?.coordinates &&
      Array.isArray(order.restaurant.location.coordinates) &&
      order.restaurant.location.coordinates.length >= 2) {
      coords = order.restaurant.location.coordinates;
    }
    else if (order?.restaurantId?.location?.latitude && order?.restaurantId?.location?.longitude) {
      coords = [order.restaurantId.location.longitude, order.restaurantId.location.latitude];
    }
    else if (order?.restaurantLocation?.latitude && order?.restaurantLocation?.longitude) {
      coords = [order.restaurantLocation.longitude, order.restaurantLocation.latitude];
    }
    else if (order?.restaurantLocation?.lat && order?.restaurantLocation?.lng) {
      coords = [order.restaurantLocation.lng, order.restaurantLocation.lat];
    }

    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    const fallbackLat = Number(
      order?.restaurantId?.location?.latitude ||
      order?.restaurant?.location?.latitude ||
      order?.restaurantLocation?.latitude ||
      order?.restaurantLocation?.lat
    );
    const fallbackLng = Number(
      order?.restaurantId?.location?.longitude ||
      order?.restaurant?.location?.longitude ||
      order?.restaurantLocation?.longitude ||
      order?.restaurantLocation?.lng
    );
    if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng)) {
      return { lat: fallbackLat, lng: fallbackLng };
    }
    return null;
  }, [order?.restaurantId, order?.restaurantLocation, order?.restaurant]);

  const customerCoords = useMemo(() => {
    const coords =
      order?.address?.coordinates ||
      order?.address?.location?.coordinates ||
      order?.deliveryAddress?.coordinates ||
      order?.deliveryAddress?.location?.coordinates;
    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    const lat = Number(
      order?.address?.location?.latitude ??
      order?.address?.latitude ??
      order?.deliveryAddress?.location?.latitude ??
      order?.deliveryAddress?.latitude
    );
    const lng = Number(
      order?.address?.location?.longitude ??
      order?.address?.longitude ??
      order?.deliveryAddress?.location?.longitude ??
      order?.deliveryAddress?.longitude
    );
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }

    if (
      fallbackCustomerCoords &&
      Number.isFinite(fallbackCustomerCoords.lat) &&
      Number.isFinite(fallbackCustomerCoords.lng)
    ) {
      return fallbackCustomerCoords;
    }
    return null;
  }, [order?.address, order?.deliveryAddress, fallbackCustomerCoords]);

  // Delivery boy data
  const deliveryBoyData = useMemo(() => order?.deliveryPartner ? {
    name: order.deliveryPartner.name || 'Delivery Partner',
    avatar: order.deliveryPartner.avatar || null
  } : null, [order?.deliveryPartner]);

  // Firebase and backend write tracking under order.orderId (string) or mongoId; subscribe to all so we receive updates
  const orderTrackingIdsList = useMemo(() => [
    order?.orderId,
    order?.mongoId,
    order?._id,
    orderId,
    order?.id
  ].filter(Boolean), [order?.orderId, order?.mongoId, order?._id, orderId, order?.id]);

  if (!isVisible || !orderId || !order || (!restaurantCoords && !customerCoords)) {
    return MAP_PLACEHOLDER;
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* A map failure (Maps SDK, odd coordinates) must never take the order
          screen down with it - the rest of the tracking page keeps working. */}
      <RouteErrorBoundary scope="order-tracking-map" resetKey={orderId} fallback={MAP_PLACEHOLDER}>
        <DeliveryTrackingMap
          orderId={orderId}
          orderTrackingIds={orderTrackingIdsList}
          restaurantCoords={restaurantCoords}
          customerCoords={customerCoords}

          userLiveCoords={userLiveCoords}
          userLocationAccuracy={userLocationAccuracy}
          deliveryBoyData={deliveryBoyData}
          order={order}
          onEtaUpdate={onEtaUpdate}
        />
      </RouteErrorBoundary>
    </div>
  );
});

// Section item component
const SectionItem = ({ icon: Icon, iconNode, title, subtitle, onClick, showArrow = true, rightContent }) => (
  <motion.button
    onClick={onClick}
    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left border-b border-dashed border-gray-200 last:border-0"
    whileTap={{ scale: 0.99 }}
  >
    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
      {iconNode ? (
        <div
          className="w-6 h-6 flex-shrink-0 flex items-center justify-center [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
        >
          {iconNode}
        </div>
      ) : (
        <Icon className="w-5 h-5 text-gray-600 flex-shrink-0" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-gray-900 truncate">{title}</p>
      {subtitle && <p className="text-sm text-gray-500 truncate">{subtitle}</p>}
    </div>
    {rightContent || (showArrow && <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />)}
  </motion.button>
)

const getRestaurantCoordsFromOrder = (apiOrder, fallback = null) => {
  if (
    apiOrder?.restaurantId?.location?.coordinates &&
    Array.isArray(apiOrder.restaurantId.location.coordinates) &&
    apiOrder.restaurantId.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurantId.location.coordinates
  }
  if (apiOrder?.restaurantId?.location?.latitude && apiOrder?.restaurantId?.location?.longitude) {
    return [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude]
  }
  if (
    apiOrder?.restaurant?.location?.coordinates &&
    Array.isArray(apiOrder.restaurant.location.coordinates) &&
    apiOrder.restaurant.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurant.location.coordinates
  }
  return fallback || null
}

const getRestaurantAddressFromOrder = (apiOrder, previousOrder = null, explicitRestaurantAddress = null) => {
  if (explicitRestaurantAddress && String(explicitRestaurantAddress).trim()) {
    return String(explicitRestaurantAddress).trim()
  }

  const location = apiOrder?.restaurantId?.location || apiOrder?.restaurant?.location || {}

  if (location?.formattedAddress && String(location.formattedAddress).trim()) {
    return String(location.formattedAddress).trim()
  }
  if (location?.address && String(location.address).trim()) {
    return String(location.address).trim()
  }
  if (location?.addressLine1 && String(location.addressLine1).trim()) {
    return String(location.addressLine1).trim()
  }

  const parts = [location?.street, location?.area, location?.city, location?.state, location?.zipCode]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)

  if (parts.length > 0) return parts.join(', ')

  return previousOrder?.restaurantAddress || apiOrder?.restaurantAddress || apiOrder?.restaurant?.address || 'Restaurant location'
}

const getCustomerCoordsFromApiOrder = (apiOrder, previousOrder = null) => {
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const fromLoc = addr?.location?.coordinates
  if (Array.isArray(fromLoc) && fromLoc.length >= 2) return fromLoc
  const flat = addr?.coordinates
  if (Array.isArray(flat) && flat.length >= 2) return flat
  const prev = previousOrder?.address?.coordinates || previousOrder?.address?.location?.coordinates
  if (Array.isArray(prev) && prev.length >= 2) return prev
  return null
}

const transformOrderForTracking = (apiOrder, previousOrder = null, explicitRestaurantCoords = null, explicitRestaurantAddress = null) => {
  const restaurantCoords = explicitRestaurantCoords || getRestaurantCoordsFromOrder(apiOrder, previousOrder?.restaurantLocation?.coordinates)
  const restaurantAddress = getRestaurantAddressFromOrder(apiOrder, previousOrder, explicitRestaurantAddress)
  // API returns `deliveryAddress`; some paths use `address`
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const customerCoordsResolved = getCustomerCoordsFromApiOrder(apiOrder, previousOrder)

  return {
    id: apiOrder?.orderId || apiOrder?.order_id || apiOrder?._id,
    mongoId: apiOrder?._id || null,
    orderId: apiOrder?.orderId || apiOrder?.order_id || apiOrder?._id,
    // Takeaway vs delivery decides the timeline steps and copy; without it every
    // takeaway order was shown the delivery flow (rider, "On Way").
    orderType: apiOrder?.orderType || previousOrder?.orderType || 'delivery',
    restaurant: apiOrder?.restaurantName || previousOrder?.restaurant || 'Restaurant',
    restaurantPhone:
      apiOrder?.restaurantPhone ||
      apiOrder?.restaurantId?.phone ||
      apiOrder?.restaurantId?.ownerPhone ||
      apiOrder?.restaurant?.phone ||
      apiOrder?.restaurant?.ownerPhone ||
      previousOrder?.restaurantPhone ||
      '',
    restaurantAddress,
    restaurantId: apiOrder?.restaurantId || previousOrder?.restaurantId || null,
    userId: apiOrder?.userId || previousOrder?.userId || null,
    userName: apiOrder?.userName || apiOrder?.userId?.name || apiOrder?.userId?.fullName || previousOrder?.userName || '',
    userPhone: apiOrder?.userPhone || apiOrder?.userId?.phone || previousOrder?.userPhone || '',
    address: {
      street: addr?.street || previousOrder?.address?.street || '',
      city: addr?.city || previousOrder?.address?.city || '',
      state: addr?.state || previousOrder?.address?.state || '',
      zipCode: addr?.zipCode || previousOrder?.address?.zipCode || '',
      additionalDetails: addr?.additionalDetails || previousOrder?.address?.additionalDetails || '',
      formattedAddress: addr?.formattedAddress ||
        (addr?.street && addr?.city
          ? `${addr.street}${addr.additionalDetails ? `, ${addr.additionalDetails}` : ''}, ${addr.city}${addr.state ? `, ${addr.state}` : ''}${addr.zipCode ? ` ${addr.zipCode}` : ''}`
          : previousOrder?.address?.formattedAddress || addr?.city || ''),
      coordinates: customerCoordsResolved || addr?.location?.coordinates || previousOrder?.address?.coordinates || null
    },
    restaurantLocation: {
      coordinates: restaurantCoords
    },
    items: Array.isArray(apiOrder?.items)
      ? apiOrder.items.filter(Boolean).map(item => ({
        name: item.name,
        variantName: item.variantName || '',
        quantity: item.quantity,
        price: item.price,
        isVeg: isVegMenuItem(item),
      }))
      : (previousOrder?.items || []),
    total: apiOrder?.pricing?.total || previousOrder?.total || 0,
    // Backend canonical field is orderStatus; keep legacy `status` for UI compatibility.
    status: apiOrder?.orderStatus || apiOrder?.status || previousOrder?.status || 'pending',
    deliveryPartner: apiOrder?.deliveryPartnerId ? {
      name: apiOrder.deliveryPartnerId.name || apiOrder.deliveryPartnerId.fullName || 'Delivery Partner',
      phone: apiOrder.deliveryPartnerId.phone || apiOrder.deliveryPartnerId.phoneNumber || '',
      avatar: apiOrder.deliveryPartnerId.avatar || apiOrder.deliveryPartnerId.profilePicture || null
    } : (previousOrder?.deliveryPartner || null),
    deliveryPartnerId: apiOrder?.deliveryPartnerId?._id || apiOrder?.deliveryPartnerId || apiOrder?.dispatch?.deliveryPartnerId?._id || apiOrder?.dispatch?.deliveryPartnerId || apiOrder?.assignmentInfo?.deliveryPartnerId || null,
    dispatch: apiOrder?.dispatch || previousOrder?.dispatch || null,
    assignmentInfo: apiOrder?.assignmentInfo || previousOrder?.assignmentInfo || null,
    tracking: apiOrder?.tracking || previousOrder?.tracking || {},
    deliveryState: apiOrder?.deliveryState || previousOrder?.deliveryState || null,
    createdAt: apiOrder?.createdAt || previousOrder?.createdAt || null,
    totalAmount: apiOrder?.pricing?.total || apiOrder?.totalAmount || previousOrder?.totalAmount || 0,
    deliveryFee: apiOrder?.pricing?.deliveryFee || apiOrder?.deliveryFee || previousOrder?.deliveryFee || 0,
    gst: apiOrder?.pricing?.tax || apiOrder?.pricing?.gst || apiOrder?.gst || apiOrder?.tax || previousOrder?.gst || 0,
    packagingFee: apiOrder?.pricing?.packagingFee || apiOrder?.packagingFee || 0,
    platformFee: apiOrder?.pricing?.platformFee || apiOrder?.platformFee || 0,
    discount: apiOrder?.pricing?.discount || apiOrder?.discount || 0,
    subtotal: apiOrder?.pricing?.subtotal || apiOrder?.subtotal || 0,
    paymentMethod: apiOrder?.paymentMethod || apiOrder?.payment?.method || previousOrder?.paymentMethod || null,
    payment: apiOrder?.payment || previousOrder?.payment || null,
    // Preserve delivery OTP code received via socket event.
    // API responses intentionally strip the secret code for security,
    // so without preserving it the UI would lose the OTP on each poll refresh.
    deliveryVerification: (() => {
      const prevDV = previousOrder?.deliveryVerification || null
      const apiDV = apiOrder?.deliveryVerification || null
      const handoverOtp = apiOrder?.handoverOtp || null

      if (!prevDV && !apiDV && !handoverOtp) return null

      const prevDropOtp = prevDV?.dropOtp || null
      const apiDropOtp = apiDV?.dropOtp || null

      const merged = {
        ...(prevDV || {}),
        ...(apiDV || {})
      }

      // Prioritize: 1. Real-time handoverOtp from current API response
      // 2. Previously preserved code in local state (from socket or earlier poll)
      // 3. Nested code field in API response (if ever present)
      const finalCode = handoverOtp || prevDropOtp?.code || apiDropOtp?.code

      if (finalCode || prevDropOtp?.required || apiDropOtp?.required) {
        merged.dropOtp = {
          ...(prevDropOtp || {}),
          ...(apiDropOtp || {}),
          code: finalCode
        }
      }
      return merged
    })(),
    note: apiOrder?.note ?? previousOrder?.note ?? '',
    /*
     * Why the order was cancelled, and by whom.
     *
     * The backend has always sent these (normalizeOrderForClient fills them
     * from the order or its status history), but this transform builds an
     * explicit object and simply did not copy them - so the screen could only
     * ever say "This order has been cancelled" with no reason, whatever the
     * restaurant typed when it rejected the order.
     */
    cancellationReason:
      apiOrder?.cancellationReason || previousOrder?.cancellationReason || '',
    cancelledBy: apiOrder?.cancelledBy || previousOrder?.cancelledBy || '',
    cancelledAt: apiOrder?.cancelledAt || previousOrder?.cancelledAt || null,
    deliveryInstructions: apiOrder?.deliveryInstructions ?? apiOrder?.note ?? previousOrder?.deliveryInstructions ?? previousOrder?.note ?? ''
  }
}

/**
 * Order statuses in flow order - mirrors STATUS_PRIORITY in the backend
 * (orders/services/order.helpers.js). Legacy aliases share the rank of the
 * status they stand for. `ready_for_pickup` sits BELOW `reached_pickup` there:
 * ranking it higher made a fetched "rider reached restaurant" look older than
 * the food-ready state and it was thrown away.
 */
const STATUS_RANK = {
  placed: 1,
  created: 1,
  pending: 1,
  confirmed: 2,
  accepted: 2,
  preparing: 3,
  cooking: 3,
  processed: 3,
  ready: 4,
  ready_for_pickup: 4,
  at_pickup: 5,
  reached_pickup: 5,
  picked_up: 6,
  on_way: 6,
  out_for_delivery: 6,
  en_route_to_delivery: 6,
  at_drop: 7,
  reached_drop: 7,
  at_delivery: 7,
  delivered: 8,
  completed: 8,
  cancelled: 99,
  cancelled_by_user: 99,
  cancelled_by_restaurant: 99,
  cancelled_by_admin: 99,
};

function getStatusRank(status) {
  const s = String(status || '').toLowerCase();
  return STATUS_RANK[s] || 0;
}

/**
 * Backend uses `orderStatus` (created, confirmed, preparing, ready_for_pickup, picked_up, delivered, cancelled_*).
 * Map canonical + legacy values to tracking steps.
 */
function mapBackendOrderStatusToUi(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s || s === "pending" || s === "created") return "placed";
  if (s === "confirmed" || s === "accepted") return "confirmed";
  if (s === "preparing" || s === "cooking" || s === "processed") return "preparing";
  if (s === "ready" || s === "ready_for_pickup" || s === "reached_pickup" || s === "order_confirmed") return "ready";
  if (s === "picked_up" || s === "out_for_delivery" || s === "en_route_to_delivery") return "on_way";
  if (s === "reached_drop" || s === "at_drop" || s === "at_delivery") return "at_drop";
  if (s === "delivered" || s === "completed") return "delivered";
  if (s.includes("cancelled") || s === "cancelled") return "cancelled";
  return "placed";
}

/** A delivery partner has actually taken the order (not merely been offered it). */
function hasAcceptedRider(orderLike) {
  const hasRider = Boolean(orderLike?.deliveryPartnerId || orderLike?.dispatch?.deliveryPartnerId);
  const accepted =
    orderLike?.dispatch?.status === "accepted" ||
    orderLike?.dispatchStatus === "accepted" ||
    orderLike?.assignmentInfo?.status === "accepted" ||
    orderLike?.deliveryPartner?.status === "accepted";
  return hasRider && accepted;
}

/**
 * The tracking step for an order.
 *
 * The restaurant's `orderStatus` is the backbone of the flow; the rider's
 * `deliveryState.currentPhase` only refines it once a rider has accepted. The
 * backend schema defaults that phase to "en_route_to_pickup" on EVERY new order,
 * so reading it on its own put orders the restaurant had not even accepted on
 * "Rider is arriving" and the Cooking step.
 */
function mapOrderToTrackingUiStatus(orderLike) {
  if (!orderLike) return "placed";
  const statusRaw = String(orderLike.status || orderLike.orderStatus || "").toLowerCase();
  const rank = getStatusRank(statusRaw);

  // Terminal states handled first
  if (isFoodOrderCancelledStatus(statusRaw)) return "cancelled";
  if (rank === STATUS_RANK.delivered) return "delivered";

  // Nothing past "placed" can have happened until the restaurant accepts.
  if (!statusRaw || rank === STATUS_RANK.created) return "placed";

  const riderAccepted = hasAcceptedRider(orderLike);
  const riderPhase = riderAccepted ? String(orderLike.deliveryState?.currentPhase || "").toLowerCase() : "";

  if (rank === STATUS_RANK.reached_drop || riderPhase === "at_drop") return "at_drop";
  if (rank === STATUS_RANK.picked_up || riderPhase === "en_route_to_delivery") return "on_way";
  if (rank === STATUS_RANK.reached_pickup || riderPhase === "at_pickup") return "at_pickup";
  // Rider accepted and heading to the restaurant (even if the food is already ready).
  if (riderAccepted) return "assigned";

  // No rider yet: the restaurant's own progress.
  return mapBackendOrderStatusToUi(statusRaw);
}

/** Prefer live delivery phase when present (socket / polling include deliveryState). */
function isFoodOrderCancelledStatus(statusRaw) {
  const s = String(statusRaw || "").toLowerCase();
  return s === "cancelled" || s.includes("cancelled");
}

/**
 * Backend order.service.js allowedStatuses: ['created', 'confirmed', 'preparing']
 * Once the order moves beyond preparing (e.g. ready_for_pickup, picked_up, on_way, at_drop, delivered, cancelled),
 * instructions can no longer be edited.
 */
function canEditOrderInstructions(orderLike) {
  if (!orderLike) return false;
  const rawStatus = String(orderLike.orderStatus || orderLike.status || "").toLowerCase().trim();

  if (isFoodOrderCancelledStatus(rawStatus)) return false;
  if (rawStatus === "delivered" || rawStatus === "completed") return false;

  const editableStatuses = [
    "created",
    "placed",
    "pending",
    "confirmed",
    "accepted",
    "preparing",
    "cooking",
    "processed",
  ];

  return editableStatuses.includes(rawStatus);
}

/**
 * Apply a fetched order without letting it undo a newer live update or revert to a lower status rank.
 */
function mergeFetchedOrder(fetched, prev, requestStartedAt, lastRealtimeAt) {
  if (!prev) return fetched;
  if (!fetched) return prev;

  const prevStatus = prev.status || prev.orderStatus;
  const fetchedStatus = fetched.status || fetched.orderStatus;
  const prevRank = getStatusRank(prevStatus);
  const fetchedRank = getStatusRank(fetchedStatus);

  const isPrevAhead = prevRank > fetchedRank && !isFoodOrderCancelledStatus(fetchedStatus);
  const isSocketNewer = lastRealtimeAt > requestStartedAt;

  if (isPrevAhead || isSocketNewer) {
    return {
      ...fetched,
      status: prev.status,
      orderStatus: prev.orderStatus || prev.status,
      deliveryState: prev.deliveryState || fetched.deliveryState,
      dispatch: prev.dispatch || fetched.dispatch,
      deliveryPartnerId: prev.deliveryPartnerId || fetched.deliveryPartnerId,
      deliveryPartner: fetched.deliveryPartner || prev.deliveryPartner,
      deliveryVerification: prev.deliveryVerification || fetched.deliveryVerification,
    };
  }

  return fetched;
}

function normalizeLookupId(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw || raw === "undefined" || raw === "null") return "";
  return raw;
}

/**
 * The order the cart hands over in router state right after placing it.
 *
 * Rendering it at once means the confirmation screen never waits on - or
 * depends on - the first fetch: a slow network, or a new order that is not
 * readable yet, can no longer leave the customer without a screen. Only used
 * when it is the order in the URL, so stale state can never show another order.
 */
function getPlacedOrderSeed(routeState, orderId) {
  const seed = routeState?.order;
  if (!seed || typeof seed !== "object") return null;
  const target = normalizeLookupId(orderId);
  const seedIds = [seed._id, seed.orderId, seed.id, seed.mongoId].map(normalizeLookupId);
  if (!target || !seedIds.includes(target)) return null;
  try {
    return transformOrderForTracking(seed);
  } catch (err) {
    reportError(err, { scope: "order-tracking", stage: "seed-transform", orderId: target });
    return null;
  }
}

/** Backoff for the first load when nothing is on screen yet. */
const INITIAL_FETCH_RETRY_DELAYS_MS = [1000, 2500, 5000];

/** Network failures, timeouts, rate limits and 5xx are worth retrying; a 4xx is not. */
function isTransientFetchError(err) {
  const status = err?.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}

/** "Cancelled by Restaurant", "Cancelled by you", ... from the backend enum. */
const describeCancelledBy = (status, cancelledBy) => {
  const by = String(cancelledBy || '').toLowerCase();
  const s = String(status || '').toLowerCase();
  if (by === 'customer' || by === 'user' || s === 'cancelled_by_user') return 'Cancelled by you';
  if (by === 'restaurant' || s === 'cancelled_by_restaurant') return 'Cancelled by the restaurant';
  if (by === 'admin' || s === 'cancelled_by_admin') return 'Cancelled by support';
  return 'Order cancelled';
};

/** Timeline position for a status; x.5 = between steps (the earlier step stays active). */
function getTimelineIndex(status, isTakeaway) {
  const s = String(status || '').toLowerCase();
  if (['placed', 'pending', 'created'].includes(s)) return 0;
  if (['confirmed', 'accepted'].includes(s)) return 1;
  if (['preparing', 'cooking', 'processed'].includes(s)) return 2;
  if (['assigned', 'at_pickup', 'reached_pickup'].includes(s)) return 2.5;
  if (['ready', 'ready_for_pickup'].includes(s)) return isTakeaway ? 3 : 2.5;
  if (['on_way', 'picked_up', 'out_for_delivery', 'en_route_to_delivery', 'at_drop', 'reached_drop', 'at_delivery'].includes(s)) return 3;
  if (['delivered', 'completed'].includes(s)) return 4;
  return 0;
}

/** Filled connector length at each whole step, used while the timeline steps through. */
const STEP_CONNECTOR_WIDTHS = ['12%', '30%', '50%', '85%', '100%'];

/** How long each step stays lit when the timeline has to move several steps at once. */
const STEP_ADVANCE_MS = 800;

/**
 * Moves the timeline forward one step at a time.
 *
 * The restaurant's single "Accept" takes the order straight from `created` to
 * `preparing` in the backend, so the timeline used to jump from Placed to
 * Cooking with Confirmed already ticked - it never showed as its own step.
 * Stepping through lights Placed -> Confirmed -> Cooking in order, and on open
 * the timeline walks up to the current step. The settled position is always
 * the real one; a backwards move (never expected) applies at once.
 */
function useStepByStep(targetIdx) {
  const [shownIdx, setShownIdx] = useState(0);
  useEffect(() => {
    if (shownIdx >= targetIdx) {
      if (shownIdx !== targetIdx) setShownIdx(targetIdx);
      return undefined;
    }
    const timer = setTimeout(() => {
      setShownIdx((prev) => Math.min(targetIdx, Math.floor(prev) + 1));
    }, STEP_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [shownIdx, targetIdx]);
  return shownIdx;
}

const LiveTrackingStepper = memo(({
  status,
  isCancelled,
  riderMode = false,
  isTakeaway = false,
  cancellationReason = '',
  cancelledBy = '',
  orderStatusRaw = ''
}) => {
  // A rider heading to / waiting at the restaurant does not advance the kitchen
  // steps - those follow the restaurant's own status (accepted but not cooking
  // yet stays on "Confirmed").
  const uiStatus = String(status || '').toLowerCase();
  const kitchenStatus = mapBackendOrderStatusToUi(orderStatusRaw);
  const stepperStatus =
    ['assigned', 'at_pickup'].includes(uiStatus) && ['placed', 'confirmed'].includes(kitchenStatus)
      ? kitchenStatus
      : uiStatus;
  const targetIdx = getTimelineIndex(stepperStatus, isTakeaway);
  const shownIdx = useStepByStep(targetIdx);
  const isSettled = shownIdx === targetIdx;

  if (isCancelled) {
    const reason = String(cancellationReason || '').trim();
    return (
      <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-2xl p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/60 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
          <CircleSlash className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-red-800 dark:text-red-300">Order Cancelled</h4>
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
            {describeCancelledBy(orderStatusRaw, cancelledBy)}
          </p>
          {reason ? (
            <p className="text-xs text-red-700 dark:text-red-300 mt-1.5">
              <span className="font-semibold">Reason:</span> {reason}
            </p>
          ) : (
            <p className="text-xs text-red-500/80 dark:text-red-400/80 mt-1.5">
              No reason was given for this cancellation.
            </p>
          )}
        </div>
      </div>
    );
  }

  const deliverySteps = [
    {
      key: 'placed',
      title: 'Placed',
      fullTitle: 'Order Placed',
      desc: 'Received by kitchen',
      icon: ShoppingBag
    },
    {
      key: 'confirmed',
      title: 'Confirmed',
      fullTitle: 'Order Confirmed',
      desc: 'Accepted by kitchen',
      icon: UtensilsCrossed
    },
    {
      key: 'preparing',
      title: 'Cooking',
      fullTitle: 'Preparing Food',
      desc: 'Fresh meal in progress',
      icon: Flame
    },
    {
      key: 'on_way',
      title: 'On Way',
      fullTitle: 'Out for Delivery',
      desc: 'Rider is on the way',
      icon: Bike
    },
    {
      key: 'delivered',
      title: 'Delivered',
      fullTitle: 'Order Delivered',
      desc: 'Enjoy your meal!',
      icon: CheckCircle2
    }
  ];

  const takeawaySteps = [
    {
      key: 'placed',
      title: 'Placed',
      fullTitle: 'Order Placed',
      desc: 'Received by kitchen',
      icon: ShoppingBag
    },
    {
      key: 'confirmed',
      title: 'Confirmed',
      fullTitle: 'Order Confirmed',
      desc: 'Accepted by kitchen',
      icon: UtensilsCrossed
    },
    {
      key: 'preparing',
      title: 'Cooking',
      fullTitle: 'Preparing Food',
      desc: 'Fresh meal in progress',
      icon: Flame
    },
    {
      key: 'ready',
      title: 'Ready',
      fullTitle: 'Ready for Pickup',
      desc: 'Collect at restaurant',
      icon: Package
    },
    {
      key: 'delivered',
      title: 'Picked Up',
      fullTitle: 'Order Picked Up',
      desc: 'Enjoy your meal!',
      icon: CheckCircle2
    }
  ];

  const visibleSteps = isTakeaway ? takeawaySteps : deliverySteps;

  const getStepStatus = (index) => {
    const step = Math.floor(shownIdx);
    if (index < step) return 'completed';
    if (index === step) return 'active';
    return 'upcoming';
  };

  const getConnectorWidth = () => {
    if (!isSettled) return STEP_CONNECTOR_WIDTHS[Math.floor(shownIdx)] || STEP_CONNECTOR_WIDTHS[0];
    const s = stepperStatus;
    if (['placed', 'pending', 'created'].includes(s)) return '12%';
    if (['confirmed', 'accepted'].includes(s)) return '30%';
    if (['preparing', 'cooking', 'processed'].includes(s)) return '50%';
    if (['assigned', 'at_pickup', 'reached_pickup'].includes(s)) return '68%';
    if (['ready', 'ready_for_pickup'].includes(s)) return isTakeaway ? '80%' : '72%';
    if (['on_way', 'picked_up', 'out_for_delivery', 'en_route_to_delivery'].includes(s)) return '85%';
    if (['at_drop', 'reached_drop', 'at_delivery'].includes(s)) return '92%';
    if (['delivered', 'completed'].includes(s)) return '100%';
    return '12%';
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span>{isTakeaway ? 'Takeaway Timeline' : 'Order Timeline'}</span>
        </h3>
        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
          Live Tracking
        </span>
      </div>

      <div className="relative pt-1 pb-1">
        {/* Horizontal Connector Line */}
        <div className="absolute top-6 left-6 right-6 h-1 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-emerald-500 transition-all duration-700 ease-out rounded-full"
            style={{ width: getConnectorWidth() }}
          />
        </div>

        {/* Step Nodes */}
        <div className="flex items-center justify-between relative z-10">
          {visibleSteps.map((s, idx) => {
            const stepState = getStepStatus(idx);
            const Icon = s.icon;
            const isCompleted = stepState === 'completed';
            const isActive = stepState === 'active';

            return (
              <div key={s.key} className="flex flex-col items-center text-center group">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                    isCompleted
                      ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/25 ring-2 ring-emerald-100 dark:ring-emerald-950"
                      : isActive
                      ? "bg-[#EB590E] text-white shadow-lg shadow-orange-500/30 scale-110 ring-4 ring-orange-100 dark:ring-orange-950/60 animate-pulse"
                      : "bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-500"
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5 stroke-[3]" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                <span
                  className={`text-[10px] font-bold mt-2 transition-colors ${
                    isCompleted
                      ? "text-emerald-600 dark:text-emerald-400"
                      : isActive
                      ? "text-[#EB590E] font-black"
                      : "text-gray-400 dark:text-zinc-500"
                  }`}
                >
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ─────────────────── Bottom sheet drag ─────────────────── */

/** Sheet heights per snap point: compact is a fixed bar, the rest scale with the screen. */
const SHEET_COMPACT_PX = 92;
const SHEET_FRACTIONS = { half: 0.56, expanded: 0.9 };
const SHEET_MODES = ['compact', 'half', 'expanded'];
/** Below this movement (and quick enough) a press counts as a tap, not a drag. */
const SHEET_TAP_MAX_PX = 6;
const SHEET_TAP_MAX_MS = 300;
/** A flick faster than this jumps to the next snap point regardless of distance. */
const SHEET_FLICK_VELOCITY = 0.45; // px per ms

const sheetHeightForMode = (mode) => {
  if (mode === 'compact') return SHEET_COMPACT_PX;
  const viewport = typeof window === 'undefined' ? 800 : window.innerHeight;
  return Math.round(viewport * (SHEET_FRACTIONS[mode] ?? SHEET_FRACTIONS.half));
};

/**
 * Makes the sheet's grab handle a real drag handle.
 *
 * The handle only cycled snap points on click, so the sheet could not be pulled
 * to a size or followed with the finger. Height is driven by a motion value:
 * during a drag it tracks the pointer one-to-one, and on release it springs to
 * the nearest snap point - or the next one along when the gesture was a flick.
 *
 * Pointer events (not touch events) so one implementation covers finger, mouse
 * and stylus, and `setPointerCapture` keeps the gesture attached to the handle
 * even when the finger slides off it. The handle sets `touch-action: none`, so
 * dragging it never scrolls the page or pans the map underneath; the sheet's
 * own scroll area is untouched because the gesture starts on the handle only.
 */
function useBottomSheetDrag(sheetMode, setSheetMode) {
  const height = useMotionValue(sheetHeightForMode(sheetMode));
  const animationRef = useRef(null);
  const gestureRef = useRef(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const springTo = useCallback(
    (mode) => {
      animationRef.current?.stop();
      animationRef.current = animate(height, sheetHeightForMode(mode), {
        type: 'spring',
        damping: 28,
        stiffness: 290,
      });
    },
    [height],
  );

  // Follow snap changes made elsewhere (the mode buttons, the compact summary bar).
  useEffect(() => {
    if (draggingRef.current) return;
    springTo(sheetMode);
  }, [sheetMode, springTo]);

  // Keep the open sheet proportional when the viewport changes (rotation, keyboard).
  useEffect(() => {
    const onResize = () => {
      if (draggingRef.current) return;
      height.set(sheetHeightForMode(sheetMode));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [height, sheetMode]);

  useEffect(() => () => animationRef.current?.stop(), []);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button != null && event.button !== 0) return; // primary pointer only
      animationRef.current?.stop();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gestureRef.current = {
        startY: event.clientY,
        startHeight: height.get(),
        startedAt: Date.now(),
        lastY: event.clientY,
        lastAt: Date.now(),
        velocity: 0,
        moved: 0,
      };
      draggingRef.current = true;
      setIsDragging(true);
    },
    [height],
  );

  const onPointerMove = useCallback(
    (event) => {
      const gesture = gestureRef.current;
      if (!draggingRef.current || !gesture) return;
      const now = Date.now();
      const dt = now - gesture.lastAt;
      if (dt > 0) {
        // Upward drag = positive velocity = growing sheet.
        gesture.velocity = (gesture.lastY - event.clientY) / dt;
        gesture.lastY = event.clientY;
        gesture.lastAt = now;
      }
      gesture.moved = Math.max(gesture.moved, Math.abs(event.clientY - gesture.startY));

      const maxHeight = sheetHeightForMode('expanded');
      const next = gesture.startHeight + (gesture.startY - event.clientY);
      height.set(Math.min(maxHeight, Math.max(SHEET_COMPACT_PX, next)));
    },
    [height],
  );

  const endGesture = useCallback(
    (event) => {
      const gesture = gestureRef.current;
      if (!draggingRef.current || !gesture) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      draggingRef.current = false;
      setIsDragging(false);
      gestureRef.current = null;

      const currentIndex = SHEET_MODES.indexOf(sheetMode);

      // A quick press that barely moved: keep the old tap-to-cycle behaviour.
      if (gesture.moved < SHEET_TAP_MAX_PX && Date.now() - gesture.startedAt < SHEET_TAP_MAX_MS) {
        const nextMode = SHEET_MODES[(currentIndex + 1) % SHEET_MODES.length];
        setSheetMode(nextMode);
        springTo(nextMode);
        return;
      }

      let target;
      if (Math.abs(gesture.velocity) >= SHEET_FLICK_VELOCITY) {
        // Flick: step one snap point in the direction of travel.
        const step = gesture.velocity > 0 ? 1 : -1;
        target = SHEET_MODES[Math.min(SHEET_MODES.length - 1, Math.max(0, currentIndex + step))];
      } else {
        // Otherwise settle on whichever snap point is closest to where it was let go.
        const current = height.get();
        target = SHEET_MODES.reduce((best, mode) =>
          Math.abs(sheetHeightForMode(mode) - current) < Math.abs(sheetHeightForMode(best) - current)
            ? mode
            : best,
        );
      }

      setSheetMode(target);
      springTo(target);
    },
    [height, setSheetMode, sheetMode, springTo],
  );

  // Keyboard equivalent, so the handle is usable without a pointer.
  const onKeyDown = useCallback(
    (event) => {
      const index = SHEET_MODES.indexOf(sheetMode);
      let target = null;
      if (event.key === 'ArrowUp') target = SHEET_MODES[Math.min(SHEET_MODES.length - 1, index + 1)];
      else if (event.key === 'ArrowDown') target = SHEET_MODES[Math.max(0, index - 1)];
      else if (event.key === 'Enter' || event.key === ' ') target = SHEET_MODES[(index + 1) % SHEET_MODES.length];
      if (!target) return;
      event.preventDefault();
      setSheetMode(target);
      springTo(target);
    },
    [sheetMode, setSheetMode, springTo],
  );

  return { height, isDragging, onPointerDown, onPointerMove, endGesture, onKeyDown };
}

export default function OrderTracking() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const companyName = useCompanyName()
  const { orderId } = useParams()
  const routeLocation = useLocation()
  const [searchParams] = useSearchParams()
  const confirmed = searchParams.get("confirmed") === "true"
  // Arrived straight from placing this order - its first fetch can race the write.
  const isFreshOrder = confirmed || Boolean(routeLocation.state?.fromOrderPlaced)
  const { getOrderById } = useOrders()
  const { profile, getDefaultAddress } = useProfile()
  const { location: userLiveLocation } = useUserLocation()

  const { isConnected: isSocketConnected } = useUserNotifications()

  // State for order data (seeded from the cart hand-off when available)
  const [order, setOrder] = useState(() => getPlacedOrderSeed(routeLocation.state, orderId))
  const [loading, setLoading] = useState(() => order == null)
  const [error, setError] = useState(null)
  // Latest order for async callbacks (poll) that outlive the render they came from.
  const orderRef = useRef(order)
  const isFreshOrderRef = useRef(isFreshOrder)
  useEffect(() => {
    orderRef.current = order
  }, [order])

  const [showConfirmation, setShowConfirmation] = useState(confirmed)
  const [orderStatus, setOrderStatus] = useState('placed')
  const [estimatedTime, setEstimatedTime] = useState(29)

  const isTakeawayOrder = order?.orderType === 'takeaway'

  // "Pay at Pickup" order that is placed but not yet paid. The customer taps
  // "Pay Now" from this screen when they reach the restaurant.
  const isAwaitingPickupPayment =
    String(order?.payment?.status || "").toLowerCase() === "awaiting_pickup_payment"
  const [isPayingPickup, setIsPayingPickup] = useState(false)

  // Preload the Razorpay SDK so the modal opens instantly when they tap Pay Now.
  useEffect(() => {
    if (isAwaitingPickupPayment) preloadRazorpayScript()
  }, [isAwaitingPickupPayment])

  const handlePayAtPickupNow = useCallback(async () => {
    if (isPayingPickup) return
    const payOrderId = order?._id || order?.orderId || orderId
    if (!payOrderId) return
    setIsPayingPickup(true)
    try {
      const initiateResponse = await orderAPI.initiatePickupPayment(payOrderId)
      const rzp = initiateResponse?.data?.data
      if (!rzp || !rzp.orderId || !rzp.key) {
        throw new Error("Failed to initialize payment. Please try again.")
      }
      const contact = String(profile?.phone || order?.customerPhone || "").replace(/\D/g, "").slice(-10)
      let handled = false
      await initRazorpayPayment({
        key: rzp.key,
        amount: rzp.amount,
        currency: rzp.currency || "INR",
        order_id: rzp.orderId,
        name: companyName || "Eatiefy",
        description: `Pay at Pickup - ₹${(rzp.amount / 100).toFixed(2)}`,
        prefill: {
          name: profile?.name || order?.customerName || "",
          email: profile?.email || "",
          contact,
        },
        handler: async (response) => {
          handled = true
          try {
            await orderAPI.verifyPickupPayment(payOrderId, {
              razorpayOrderId: response?.razorpay_order_id,
              razorpayPaymentId: response?.razorpay_payment_id,
              razorpaySignature: response?.razorpay_signature,
            })
            toast.success("Payment successful! Your order is confirmed.")
            handleRefresh()
          } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || "Payment verification failed. Please contact the restaurant.")
          } finally {
            setIsPayingPickup(false)
          }
        },
        onError: (err) => {
          if (handled) return
          handled = true
          const msg = err?.description || err?.message
          if (err?.code !== "PAYMENT_CANCELLED" && msg) toast.error(msg)
          setIsPayingPickup(false)
        },
        onClose: () => {
          if (handled) return
          handled = true
          setIsPayingPickup(false)
        },
      })
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Could not start payment. Please try again.")
      setIsPayingPickup(false)
    }
  }, [isPayingPickup, order, orderId, profile, companyName])

  // Show the rider journey once a delivery partner has accepted (delivery orders only).
  const isRiderJourney =
    Boolean(order?.deliveryPartnerId || order?.dispatch?.deliveryPartnerId) &&
    (order?.dispatch?.status === "accepted" ||
      ["assigned", "at_pickup", "on_way", "at_drop", "delivered"].includes(orderStatus))

  const isDeliveredOrder =
    orderStatus === "delivered" ||
    order?.status === "delivered" ||
    order?.orderStatus === "delivered" ||
    Boolean(order?.deliveredAt)

  const isCancelledOrder =
    orderStatus === "cancelled" ||
    order?.orderStatus === "cancelled" ||
    isFoodOrderCancelledStatus(order?.status) ||
    isFoodOrderCancelledStatus(order?.orderStatus)

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showOrderDetails, setShowOrderDetails] = useState(false)
  
  // Sheet Snap Modes: 'compact' (~90px), 'half' (~56vh), 'expanded' (~90vh)
  const [sheetMode, setSheetMode] = useState('half')
  const sheetDrag = useBottomSheetDrag(sheetMode, setSheetMode)
  const isSheetCollapsed = sheetMode === 'compact'
  const setIsSheetCollapsed = useCallback((val) => {
    if (typeof val === 'function') {
      setSheetMode(prev => prev === 'compact' ? 'half' : 'compact');
    } else {
      setSheetMode(val ? 'compact' : 'half');
    }
  }, [])

  const [cancellationReason, setCancellationReason] = useState("")
  const [isCancelling, setIsCancelling] = useState(false)
  // Ometto refund flow: paid Razorpay orders can refund to source or wallet.
  const [refundDestination, setRefundDestination] = useState("source")
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false)
  const [deliveryInstructions, setDeliveryInstructions] = useState("")
  const [isUpdatingInstructions, setIsUpdatingInstructions] = useState(false)
  const [resolvedLookupId, setResolvedLookupId] = useState("")
  const [timerNow, setTimerNow] = useState(Date.now())
  const handleEtaUpdate = useCallback((newEta) => setEstimatedTime(newEta), [])
  const lastRealtimeRefreshRef = useRef(0)
  /**
   * When the last live status was applied from the socket. A fetch that was
   * already in flight when that happened carries older data, and applying its
   * status would briefly move the timeline backwards (e.g. "On Way" -> "Cooking").
   */
  const lastRealtimeAtRef = useRef(0)
  const handleRefreshRef = useRef(null)
  const trailingRefreshTimerRef = useRef(null)
  const trackingOrderIdsRef = useRef(new Set())
  const terminalPollStopRef = useRef(false)
  const lookupIdsRef = useRef([])
  const isInitialPollRequestedRef = useRef(null)
  const lastPollExecutionRef = useRef(0) // New: Hard throttle for extreme cases

  // Rating & Review State
  const [restaurantRating, setRestaurantRating] = useState(5)
  const [deliveryRating, setDeliveryRating] = useState(5)
  const [ratingComment, setRatingComment] = useState("")
  const [selectedCompliments, setSelectedCompliments] = useState([])
  const [isSubmittingRating, setIsSubmittingRating] = useState(false)
  const [ratingSubmitted, setRatingSubmitted] = useState(false)

  // Sync existing ratings from order
  useEffect(() => {
    if (order?.ratings?.restaurant?.rating) {
      setRestaurantRating(Number(order.ratings.restaurant.rating) || 5)
      setRatingSubmitted(true)
    }
    if (order?.ratings?.deliveryPartner?.rating) {
      setDeliveryRating(Number(order.ratings.deliveryPartner.rating) || 5)
    }
  }, [order?.ratings])

  const handleRatingSubmit = async () => {
    if (isSubmittingRating) return
    setIsSubmittingRating(true)
    try {
      const payload = {
        restaurantRating,
        ...(isTakeawayOrder ? {} : { deliveryPartnerRating: deliveryRating }),
        restaurantComment: [
          ratingComment.trim(),
          selectedCompliments.length > 0 ? `Compliments: ${selectedCompliments.join(", ")}` : ""
        ].filter(Boolean).join(" - ")
      }
      const ratingOrderId = resolvedLookupId || order?.orderMongoId || order?._id || orderId
      await orderAPI.submitOrderRatings(ratingOrderId, payload)
      setRatingSubmitted(true)
      toast.success("Thank you for your rating! ⭐")
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to submit rating"
      if (msg.toLowerCase().includes("already submitted")) {
        setRatingSubmitted(true)
        toast.info("Rating already submitted for this order")
      } else {
        toast.error(msg)
      }
    } finally {
      setIsSubmittingRating(false)
    }
  }

  // Delivery handover OTP received via socket event or loaded from local cache.
  // Kept separately so UI still renders even if the event arrives
  // before the order API poll populates `order` state.
  const [socketDropOtpCode, setSocketDropOtpCode] = useState(() => {
    try {
      return localStorage.getItem(`eatiefy_order_otp_${orderId}`) || null;
    } catch {
      return null;
    }
  });


  const isInstructionsEditable = useMemo(() => {
    return canEditOrderInstructions(order);
  }, [order]);

  // Sync delivery instructions from order when loaded/refreshed
  useEffect(() => {
    const inst = order?.deliveryInstructions || order?.note;
    if (inst != null) {
      setDeliveryInstructions(inst);
    }
  }, [order?.deliveryInstructions, order?.note]);

  // OTP received via socket event (deliveryDropOtp)
  useEffect(() => {
    const handleDeliveryDropOtp = (event) => {
      const detail = event?.detail || {}
      const otp = detail?.otp != null ? String(detail.otp) : null
      const evtOrderId = detail?.orderId != null ? String(detail.orderId) : null
      const evtOrderMongoId =
        detail?.orderMongoId != null ? String(detail.orderMongoId) : null

      if (!otp) return

      // If the order is already loaded, match by either orderId or mongoId.
      // Otherwise, match against the current URL param.
      const currentIds = [String(orderId)]
      if (order?.orderId) currentIds.push(String(order.orderId))
      if (order?.mongoId) currentIds.push(String(order.mongoId))
      if (order?._id) currentIds.push(String(order._id))

      const matches =
        (evtOrderId && currentIds.includes(evtOrderId)) ||
        (evtOrderMongoId && currentIds.includes(evtOrderMongoId))

      if (!matches) return

      // Always store so UI can render even if `order` hasn't loaded yet.
      setSocketDropOtpCode(otp)

      setOrder((prev) => {
        if (!prev) return prev
        const prevDV = prev.deliveryVerification || {}
        const prevDropOtp = prevDV.dropOtp || {}

        // Only update if code actually changed to avoid render loops
        if (prevDropOtp.code === otp) return prev;

        return {
          ...prev,
          deliveryVerification: {
            ...prevDV,
            dropOtp: {
              ...prevDropOtp,
              required: true,
              verified: false,
              code: otp
            }
          }
        }
      })
    }

    window.addEventListener('deliveryDropOtp', handleDeliveryDropOtp)
    return () => window.removeEventListener('deliveryDropOtp', handleDeliveryDropOtp)
  }, [orderId, order])

  // --------------------------------------------------------------------------
  // DATA FETCHING & POLLING STABILITY (FIXED FOR HAMMERING)
  // --------------------------------------------------------------------------

  // Socket notifications include order ids — keep a set so events match this page.
  useEffect(() => {
    const s = trackingOrderIdsRef.current
    s.add(String(orderId))
    if (order?.orderId) s.add(String(order.orderId))
    if (order?.mongoId) s.add(String(order.mongoId))
    if (order?.id) s.add(String(order.id))
  }, [orderId, order?.orderId, order?.mongoId, order?.id])

  useEffect(() => {
    const ids = [
      resolvedLookupId,
      orderId,
      order?.orderId,
      order?.mongoId,
      order?._id,
      order?.id,
    ]
      .map(normalizeLookupId)
      .filter(Boolean)
    lookupIdsRef.current = Array.from(new Set(ids))
  }, [orderId, resolvedLookupId, order?.orderId, order?.mongoId, order?._id, order?.id])

  // Stability Nuke: Move function bodies into a ref-protected execute flow
  const stableOpsRef = useRef({
    resolveOrderFromList: async (rawLookupId) => {
      const needle = normalizeLookupId(rawLookupId)
      if (!needle) return null
      const maxPages = 3
      const limit = 50

      for (let page = 1; page <= maxPages; page += 1) {
        const listResponse = await orderAPI.getOrders({ page, limit })
        let orders = []
        if (listResponse?.data?.success && listResponse?.data?.data?.orders) {
          orders = listResponse.data.data.orders || []
        } else if (listResponse?.data?.orders) {
          orders = listResponse.data.orders || []
        } else if (Array.isArray(listResponse?.data?.data?.data)) {
          orders = listResponse.data.data.data || []
        } else if (Array.isArray(listResponse?.data?.data)) {
          orders = listResponse.data.data || []
        }

        const matched = (orders || []).find((o) => {
          const candidates = [o?._id, o?.id, o?.orderId, o?.mongoId].map(normalizeLookupId)
          return candidates.includes(needle)
        })
        if (matched) return matched
        const totalPages = Number(listResponse?.data?.data?.pagination?.pages) || Number(listResponse?.data?.data?.totalPages) || 1
        if (page >= totalPages) break
      }
      return null
    },
    fetchOrderDetailsWithFallback: async (options = {}) => {
      const candidates = [
        ...lookupIdsRef.current,
        orderId,
        resolvedLookupId,
      ].map(normalizeLookupId).filter(Boolean);
      const lookupIds = Array.from(new Set(candidates));
      if (lookupIds.length === 0) throw new Error("Order id required");
      let lastError = null;
      for (const id of lookupIds) {
        try {
          return await orderAPI.getOrderDetails(id, options);
        } catch (err) {
          lastError = err;
          if (err?.response?.status === 400 || err?.response?.status === 404) continue;
          throw err;
        }
      }
      throw lastError || new Error("Failed to fetch order details");
    }
  });

  const resolveOrderFromList = useCallback((id) => stableOpsRef.current.resolveOrderFromList(id), [])
  const fetchOrderDetailsWithFallback = useCallback((opts) => stableOpsRef.current.fetchOrderDetailsWithFallback(opts), [])

  /*
   * When the instructions modal opens, sync the latest note and re-validate the
   * order status from the backend.
   *
   * Must stay below the `fetchOrderDetailsWithFallback` declaration: the deps
   * array is evaluated during render, and reading a `const` before its line runs
   * throws "Cannot access ... before initialization" - which crashed every
   * render of this screen and left a blank page after placing an order.
   */
  useEffect(() => {
    if (!isInstructionsModalOpen) return
    setDeliveryInstructions(order?.deliveryInstructions || order?.note || "")
    fetchOrderDetailsWithFallback({ force: true })
      .then((response) => {
        const apiOrder = response?.data?.success ? response?.data?.data?.order : null
        if (apiOrder) setOrder((prev) => transformOrderForTracking(apiOrder, prev))
      })
      .catch((err) => reportError(err, { scope: "order-tracking", stage: "instructions-refresh", orderId }))
  }, [isInstructionsModalOpen, fetchOrderDetailsWithFallback]);

  // Clear OTP when order is finalized.
  useEffect(() => {
    if (!order) return
    const status = mapOrderToTrackingUiStatus(order)
    if (status === 'delivered' || status === 'cancelled') {
      setSocketDropOtpCode(null)


      setOrder((prev) => {
        if (!prev?.deliveryVerification?.dropOtp?.code) return prev
        return {
          ...prev,
          deliveryVerification: {
            ...(prev.deliveryVerification || {}),
            dropOtp: {
              ...(prev.deliveryVerification?.dropOtp || {}),
              code: null
            }
          }
        }
      })
    }
  }, [orderStatus, order])

  const defaultAddress = getDefaultAddress()
  const fallbackCustomerCoords = useMemo(() => {
    const orderCoords = order?.address?.coordinates || order?.address?.location?.coordinates
    if (Array.isArray(orderCoords) && orderCoords.length >= 2) {
      const lng = Number(orderCoords[0])
      const lat = Number(orderCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const defaultCoords = defaultAddress?.location?.coordinates
    if (Array.isArray(defaultCoords) && defaultCoords.length >= 2) {
      const lng = Number(defaultCoords[0])
      const lat = Number(defaultCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const liveLat = Number(userLiveLocation?.latitude)
    const liveLng = Number(userLiveLocation?.longitude)
    if (Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
      return { lat: liveLat, lng: liveLng }
    }

    return null
  }, [
    order?.address?.coordinates,
    order?.address?.location?.coordinates,
    defaultAddress?.location?.coordinates,
    userLiveLocation?.latitude,
    userLiveLocation?.longitude
  ])

  const userLiveCoords = useMemo(() => {
    const lat = Number(userLiveLocation?.latitude)
    const lng = Number(userLiveLocation?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  }, [userLiveLocation?.latitude, userLiveLocation?.longitude])

  const isAdminAccepted = useMemo(() => {
    const status = order?.status
    // Ometto rule: "confirmed" is NOT yet accepted for cancellation purposes.
    // The backend allows cancelling while the order is "created" or "confirmed",
    // so treating "confirmed" as accepted here hid the Cancel button during the
    // one state where cancelling is still permitted.
    return [
      "preparing",
      "ready",
      "ready_for_pickup",
      "picked_up",
    ].includes(status)
  }, [order?.status])

  // Single source of truth: backend order.status (+ deliveryState phase for live ride)
  useEffect(() => {
    if (!order) return
    setOrderStatus(mapOrderToTrackingUiStatus(order))
  }, [
    order?.status,
    order?.deliveryState?.currentPhase,
    order?.deliveryState?.status,
    // Rider assignment changes the screen without changing orderStatus.
    order?.dispatch?.status,
    order?.deliveryPartnerId,
  ])

  const acceptedAtMs = useMemo(() => {
    const timestamp =
      order?.tracking?.confirmed?.timestamp ||
      order?.tracking?.preparing?.timestamp ||
      order?.updatedAt ||
      order?.createdAt

    const parsed = timestamp ? new Date(timestamp).getTime() : NaN
    return Number.isFinite(parsed) ? parsed : null
  }, [order?.tracking?.confirmed?.timestamp, order?.tracking?.preparing?.timestamp, order?.updatedAt, order?.createdAt])

  const editWindowRemainingMs = useMemo(() => {
    if (!isAdminAccepted || !acceptedAtMs) return 0
    const remaining = 60000 - (timerNow - acceptedAtMs)
    return Math.max(0, remaining)
  }, [isAdminAccepted, acceptedAtMs, timerNow])

  const isEditWindowOpen = editWindowRemainingMs > 0

  const editWindowText = useMemo(() => {
    const totalSeconds = Math.ceil(editWindowRemainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }, [editWindowRemainingMs])

  // Takeaway: open the restaurant in the device's maps app so the customer can navigate for pickup.
  const handleGetDirections = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();

    const coords = order?.restaurantLocation?.coordinates;
    const lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
    const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    const destination = hasCoords
      ? `${lat},${lng}`
      : [restaurantDisplayName, order?.restaurantAddress].filter(Boolean).join(', ');

    if (!destination) {
      toast.error('Restaurant location not available');
      return;
    }

    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleCallRestaurant = (e) => {
    // Prevent event bubbling if necessary
    if (e && e.stopPropagation) e.stopPropagation();

    const rawPhone =
      order?.restaurantPhone ||
      order?.restaurantId?.phone ||
      order?.restaurantId?.ownerPhone ||
      order?.restaurantId?.contact?.phone ||
      order?.restaurant?.phone ||
      order?.restaurant?.ownerPhone ||
      order?.restaurantId?.location?.phone ||
      '';

    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');

    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Restaurant phone number not available');
      return;
    }

    debugLog('?? Attempting to call restaurant:', cleanPhone);

    // Most compatible way to trigger dialer on overall mobile/web environments:
    // Create a temporary hidden anchor and programmatically click it.
    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      // Last-ditch fallback
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const handleCallRider = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();

    const rawPhone = order?.deliveryPartner?.phone || '';
    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');

    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Rider phone number not available');
      return;
    }

    debugLog('?? Attempting to call rider:', cleanPhone);

    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const customerDeliveryOtp = useMemo(() => {
    const codeFromOrder = order?.deliveryVerification?.dropOtp?.code || order?.handoverOtp
    const code = codeFromOrder ?? socketDropOtpCode
    return code ? String(code).trim() : null
  }, [order?.deliveryVerification?.dropOtp?.code, order?.handoverOtp, socketDropOtpCode])

  // Persist valid OTP in localStorage so it never disappears on refresh/re-mount
  useEffect(() => {
    if (customerDeliveryOtp && orderId && !isDeliveredOrder && !isCancelledOrder) {
      try {
        localStorage.setItem(`eatiefy_order_otp_${orderId}`, String(customerDeliveryOtp))
        if (order?._id) localStorage.setItem(`eatiefy_order_otp_${order._id}`, String(customerDeliveryOtp))
        if (order?.orderId) localStorage.setItem(`eatiefy_order_otp_${order.orderId}`, String(customerDeliveryOtp))
      } catch (err) {
        // ignore storage quota errors
      }
    }
  }, [customerDeliveryOtp, orderId, order?._id, order?.orderId, isDeliveredOrder, isCancelledOrder])

  // Clear persisted OTP once order is properly delivered or cancelled
  useEffect(() => {
    if (isDeliveredOrder || isCancelledOrder) {
      try {
        localStorage.removeItem(`eatiefy_order_otp_${orderId}`)
        if (order?._id) localStorage.removeItem(`eatiefy_order_otp_${order._id}`)
        if (order?.orderId) localStorage.removeItem(`eatiefy_order_otp_${order.orderId}`)
      } catch (err) {
        // ignore
      }
    }
  }, [isDeliveredOrder, isCancelledOrder, orderId, order?._id, order?.orderId])

  // Active OTP Fetcher: If order is active but OTP is not yet in state, fetch directly from drop-otp API
  useEffect(() => {
    if (!orderId || isDeliveredOrder || isCancelledOrder || customerDeliveryOtp) return
    let isCancelled = false

    const fetchDropOtp = async () => {
      try {
        const res = await orderAPI.getOrderDropOtp(orderId)
        const otp = res?.data?.data?.otp || res?.data?.otp
        if (!isCancelled && otp) {
          setSocketDropOtpCode(String(otp))
        }
      } catch (err) {
        // Non-blocking fallback
      }
    }

    fetchDropOtp()
    return () => { isCancelled = true }
  }, [orderId, customerDeliveryOtp, isDeliveredOrder, isCancelledOrder])

  const handleCopyOtp = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!customerDeliveryOtp) return;
    // writeText is async and rejects when clipboard access is denied or the
    // page is not secure; a sync try/catch missed that (unhandled rejection,
    // and a "copied" toast for nothing copied). Show the OTP instead.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(String(customerDeliveryOtp)))
      .then(() => toast.success("Delivery OTP copied to clipboard! 📋"))
      .catch(() => toast.info(`Delivery OTP: ${customerDeliveryOtp}`));
  };

  useEffect(() => {
    if (!isEditWindowOpen) return
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setTimerNow(Date.now())
    }, 1000)
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setTimerNow(Date.now())
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [isEditWindowOpen])

  // Poll for order updates (especially when delivery partner accepts)

  const pollRef = useRef(null);

  // Main fetch & polling core logic.
  useEffect(() => {
    if (!orderId) return;

    let isSubscribed = true;
    let requestInProgress = false;
    let retryTimer = null;

    const poll = async (isInitial = false, attempt = 0) => {
      if (!isSubscribed || requestInProgress) return;
      if (terminalPollStopRef.current && !isInitial) return;

      // Check context immediately to avoid loaders if data exists locally
      if (isInitial && typeof getOrderById === 'function') {
        const rawContext = getOrderById(orderId);
        if (rawContext) {
          setOrder(transformOrderForTracking(rawContext));
          setLoading(false);
        }
      }

      requestInProgress = true;
      const requestStartedAt = Date.now();
      let retryScheduled = false;
      /*
       * First load failed with nothing on screen. A just-placed order can take a
       * moment to become readable, and a slow/flaky network drops requests - so
       * retry those with backoff before settling on the error screen.
       */
      const scheduleInitialRetry = (err) => {
        const delay = INITIAL_FETCH_RETRY_DELAYS_MS[attempt];
        if (!isInitial || orderRef.current || delay == null) return false;
        if (!isFreshOrderRef.current && !isTransientFetchError(err)) return false;
        retryTimer = setTimeout(() => poll(true, attempt + 1), delay);
        retryScheduled = true;
        return true;
      };
      try {
        const response = await fetchOrderDetailsWithFallback({ force: isInitial });
        if (!isSubscribed) return;

        let finalOrderData = null;

        if (response?.data?.success && response?.data?.data?.order) {
          finalOrderData = response.data.data.order;
        } else if (isInitial) {
          const matchedOrder = await resolveOrderFromList(orderId);
          if (matchedOrder) finalOrderData = matchedOrder;
        }

        if (finalOrderData) {
          setOrder(prev => {
            const transformedOrder = mergeFetchedOrder(
              transformOrderForTracking(finalOrderData, prev),
              prev,
              requestStartedAt,
              lastRealtimeAtRef.current,
            );
            const ui = mapOrderToTrackingUiStatus(transformedOrder);
            terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled';
            return transformedOrder;
          });
          setError(null);
          setLoading(false);
          return;
        }

        if (isInitial && !orderRef.current) {
          if (scheduleInitialRetry(null)) return;
          reportError(new Error(response?.data?.message || 'Order not found'), {
            scope: 'order-tracking', stage: 'initial-load-empty', orderId, attempt,
          });
          setError(response?.data?.message || 'Order not found');
          terminalPollStopRef.current = true;
        }
      } catch (err) {
        if (isInitial && !orderRef.current) {
          try {
            const matchedOrder = await resolveOrderFromList(orderId);
            if (matchedOrder) {
              if (!isSubscribed) return;
              setOrder(prev => transformOrderForTracking(matchedOrder, prev));
              setError(null);
              setLoading(false);
              return;
            }
          } catch { }
          if (!isSubscribed) return;
          if (scheduleInitialRetry(err)) return;
          reportError(err, {
            scope: 'order-tracking', stage: 'initial-load', orderId, attempt, status: err?.response?.status,
          });
          setError(err?.response?.data?.message || 'Failed to fetch order details');
          terminalPollStopRef.current = true;
        }
      } finally {
        requestInProgress = false;
        if (isInitial && isSubscribed && !retryScheduled) setLoading(false);
      }
    };

    pollRef.current = poll;
    terminalPollStopRef.current = false;

    // Immediately trigger initial poll
    poll(true);

    return () => {
      isSubscribed = false;
      clearTimeout(retryTimer);
    };
  }, [orderId, fetchOrderDetailsWithFallback, resolveOrderFromList, getOrderById]);

  // Interval Manager (dynamically adapts based on socket connection state independently)
  useEffect(() => {
    if (!orderId) return;

    const tick = () => {
      if (terminalPollStopRef.current) return;
      if (document.hidden) return;
      // Delegate to the latest instance of our polling function capturing current state
      if (pollRef.current) pollRef.current(false);
    };

    const pollInterval = (isSocketConnected || window.orderSocketConnected) ? 25000 : 10000;
    const interval = setInterval(tick, pollInterval);

    return () => clearInterval(interval);
  }, [orderId, isSocketConnected]);

  // "Try again" on the error screen: restart the initial load (and polling).
  const handleRetryLoad = useCallback(() => {
    setError(null);
    setLoading(true);
    terminalPollStopRef.current = false;
    pollRef.current?.(true);
  }, []);

  useEffect(() => {
    if (!order) return
    const ui = mapOrderToTrackingUiStatus(order)
    terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled'
  }, [order])

  // Post-checkout splash only — real status comes from API / poll / socket.
  useEffect(() => {
    if (!confirmed) return
    const timer1 = setTimeout(() => setShowConfirmation(false), 3000)
    return () => clearTimeout(timer1)
  }, [confirmed])

  // Synchronize ETA with actual order creation time
  useEffect(() => {
    if (!order) return;
    
    const calculateTimeRemaining = () => {
      const orderTime = new Date(
        order.createdAt || order.orderDate || order.created_at || order.date || Date.now()
      );
      const estimatedMinutes =
        order.estimatedDeliveryTime ||
        order.estimatedTime ||
        order.estimated_delivery_time ||
        35;
      const deliveryTime = new Date(orderTime.getTime() + estimatedMinutes * 60000);
      return Math.max(0, Math.floor((deliveryTime - new Date()) / 60000));
    };

    // Set initial
    setEstimatedTime(calculateTimeRemaining());

    // Update every minute
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setEstimatedTime(calculateTimeRemaining());
    }, 60000);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        setEstimatedTime(calculateTimeRemaining());
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [order?.createdAt, order?.estimatedDeliveryTime, order?.estimatedTime]);

  // Listen for order status updates from socket (e.g., "Delivery partner on the way")
  useEffect(() => {
    const handleOrderStatusNotification = (event) => {
      const payload = event?.detail || {};
      const { message, status, estimatedDeliveryTime, orderId: evtOrderId, orderMongoId } = payload;

      const evtKeys = [evtOrderId, orderMongoId, payload?._id, payload?.displayOrderId, payload?.id].filter(Boolean).map(String)
      /*
       * Strict match. An event with no id used to match EVERY open tracking
       * screen, so with two active orders one order's status could overwrite
       * the other's timeline.
       */
      const idMatches =
        evtKeys.length > 0 &&
        (evtKeys.some((k) => String(k) === String(orderId)) ||
          evtKeys.some((k) => trackingOrderIdsRef.current.has(k)))

      debugLog('?? Order status notification received:', { message, status, idMatches });

      // Toasts are app-wide (UserLayout); this screen only reacts to its own order.
      if (!idMatches) return

      const incomingStatus = payload.orderStatus || status
      const hasStatusInfo = Boolean(
        incomingStatus || payload.deliveryState || payload.dispatchStatus,
      )

      if (hasStatusInfo) {
        lastRealtimeAtRef.current = Date.now()
        /*
         * Merge into the order and let the single status effect derive the
         * timeline. This used to call setOrderStatus() straight from the partial
         * payload, and a payload without orderStatus mapped to "placed" - so any
         * update that carried only a phase or a message snapped the timeline
         * back to the first step.
         */
        setOrder((prev) => {
          if (!prev) return prev
          const next = { ...prev }
          if (incomingStatus) next.status = incomingStatus
          if (payload.deliveryState) {
            next.deliveryState = { ...(prev.deliveryState || {}), ...payload.deliveryState }
          }
          if (payload.dispatchStatus) {
            next.dispatch = { ...(prev.dispatch || {}), status: payload.dispatchStatus }
          }
          if (payload.deliveryPartnerId !== undefined) {
            next.deliveryPartnerId = payload.deliveryPartnerId || null
            if (!payload.deliveryPartnerId) next.deliveryPartner = null
          }
          if (payload.deliveryVerification) {
            next.deliveryVerification = {
              ...(prev.deliveryVerification || {}),
              ...payload.deliveryVerification,
              dropOtp: {
                ...(prev.deliveryVerification?.dropOtp || {}),
                ...(payload.deliveryVerification?.dropOtp || {}),
                // The socket copy never carries the secret; keep the one we have.
                code: prev.deliveryVerification?.dropOtp?.code ?? null,
              },
            }
          }
          if (payload.deliveryInstructions !== undefined || payload.restaurantNote !== undefined || payload.note) {
            const updatedNote = payload.deliveryInstructions ?? payload.restaurantNote ?? payload.note
            next.note = updatedNote
            next.deliveryInstructions = updatedNote
          }
          // The cancel event carries the reason; without this the screen showed
          // a bare "Order Cancelled" until the follow-up fetch landed.
          if (payload.cancellationReason) next.cancellationReason = payload.cancellationReason
          if (payload.cancelledBy) next.cancelledBy = payload.cancelledBy
          if (payload.cancelledAt) next.cancelledAt = payload.cancelledAt
          return next
        })
      }

      /*
       * Then pull the full order (rider name/phone, map coordinates, ETA).
       * Leading call plus a trailing one: bursts (accept -> reached pickup ->
       * picked up) used to be throttled into a single early fetch, and the last
       * transition in the burst was only picked up by the next 25s poll.
       */
      const runRefresh = () => {
        lastRealtimeRefreshRef.current = Date.now()
        handleRefreshRef.current?.()
      }
      const now = Date.now()
      if (now - lastRealtimeRefreshRef.current > 1500) {
        runRefresh()
      } else {
        if (trailingRefreshTimerRef.current) clearTimeout(trailingRefreshTimerRef.current)
        trailingRefreshTimerRef.current = setTimeout(() => {
          trailingRefreshTimerRef.current = null
          runRefresh()
        }, 1600)
      }

      // Show notification toast
      if (message) {
        toast.success(message, {
          duration: 5000,
          position: 'top-center',
          description: estimatedDeliveryTime
            ? `Estimated delivery in ${Math.round(estimatedDeliveryTime / 60)} minutes`
            : undefined
        });

        // Optional: Vibrate device if supported
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      }
    };

    // Listen for custom event from DeliveryTrackingMap
    window.addEventListener('orderStatusNotification', handleOrderStatusNotification);

    return () => {
      window.removeEventListener('orderStatusNotification', handleOrderStatusNotification);
      if (trailingRefreshTimerRef.current) {
        clearTimeout(trailingRefreshTimerRef.current);
        trailingRefreshTimerRef.current = null;
      }
    };
  }, [orderId])

  /*
   * Catch up whenever live delivery may have been interrupted: socket
   * (re)connect, tab brought back, window refocused.
   *
   * Polling skips hidden tabs and runs every 25s while the socket is up, and a
   * socket delivers nothing for the time it was down - so a customer returning
   * to this screen could look at a stale step for up to half a minute after the
   * restaurant or rider had already moved the order on.
   */
  useEffect(() => {
    if (!orderId) return
    let lastAt = 0
    const catchUp = () => {
      if (terminalPollStopRef.current) return
      if (typeof document !== 'undefined' && document.hidden) return
      const now = Date.now()
      if (now - lastAt < 1000) return
      lastAt = now
      pollRef.current?.(false)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') catchUp()
    }
    window.addEventListener(ORDER_REALTIME_RESYNC_EVENT, catchUp)
    window.addEventListener('focus', catchUp)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener(ORDER_REALTIME_RESYNC_EVENT, catchUp)
      window.removeEventListener('focus', catchUp)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [orderId])

  const handleCancelOrder = () => {
    // Check if order can be cancelled (only Razorpay orders that aren't delivered/cancelled)
    if (!order) return;

    // Ometto rule: once accepted, cancelling is still allowed while the edit
    // window is counting down; only refuse after that window closes.
    if (isAdminAccepted && !isEditWindowOpen) {
      toast.error('Cancellation window ended. You can no longer cancel this order.');
      return;
    }

    // Allow cancellation for all payment methods (Razorpay, COD, Wallet)
    // Only restrict if order is already cancelled or delivered (checked above)

    const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
    const status = String(order?.payment?.status || "").toLowerCase()
    const isRazorpayPaid =
      method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

    setRefundDestination(isRazorpayPaid ? "source" : "wallet")

    setShowCancelDialog(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancellationReason.trim()) {
      toast.error('Please provide a reason for cancellation');
      return;
    }

    setIsCancelling(true);
    try {
      const cancelLookupId =
        lookupIdsRef.current[0] || normalizeLookupId(orderId)
      const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
      const status = String(order?.payment?.status || "").toLowerCase()
      const isRazorpayPaid =
        method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

      const payload = {
        reason: cancellationReason.trim(),
        ...(isRazorpayPaid ? { refundDestination } : {}),
      }

      const response = await orderAPI.cancelOrder(cancelLookupId, payload);
      if (response.data?.success) {
        const paymentMethod = order?.payment?.method || order?.paymentMethod;
        const successMessage = response.data?.message ||
          (paymentMethod === 'cash' || paymentMethod === 'cod'
            ? 'Order cancelled successfully. No refund required as payment was not made.'
            : paymentMethod === 'wallet'
              ? 'Order cancelled successfully. Refund has been credited to your wallet.'
              : 'Order cancelled successfully. Refund has been initiated to your original payment method.');
        toast.success(successMessage);
        setShowCancelDialog(false);
        setCancellationReason("");
        setRefundDestination("source");
        // Refresh order data
        const orderResponse = await fetchOrderDetailsWithFallback({ force: true });
        if (orderResponse.data?.success && orderResponse.data.data?.order) {
          const apiOrder = orderResponse.data.data.order;
          setOrder(transformOrderForTracking(apiOrder, order));
        }
      } else {
        toast.error(response.data?.message || 'Failed to cancel order');
      }
    } catch (error) {
      debugError('Error cancelling order:', error);
      toast.error(error.response?.data?.message || 'Failed to cancel order');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleUpdateInstructions = async () => {
    if (!isInstructionsEditable) {
      toast.error("Instructions can no longer be updated for this order");
      return;
    }
    try {
      setIsUpdatingInstructions(true);
      const response = await orderAPI.updateOrderInstructions(resolvedLookupId || orderId, deliveryInstructions);
      if (response.data?.success) {
        toast.success("Delivery instructions updated");
        setIsInstructionsModalOpen(false);
        const updatedOrder = response.data.data?.order;
        if (updatedOrder) {
          setOrder(prev => transformOrderForTracking(updatedOrder, prev));
        } else {
          setOrder(prev => ({ ...prev, deliveryInstructions, note: deliveryInstructions }));
        }
      } else {
        toast.error(response.data?.message || "Failed to update instructions");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update instructions");
    } finally {
      setIsUpdatingInstructions(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true)
    const requestStartedAt = Date.now()
    try {
      const response = await fetchOrderDetailsWithFallback({ force: true })
      if (response.data?.success && response.data.data?.order) {
        const apiOrder = response.data.data.order

        // Extract restaurant location coordinates with multiple fallbacks
        let restaurantCoords = null;
        let restaurantAddress = null;

        // Priority 1: restaurantId.location.coordinates (GeoJSON format: [lng, lat])
        if (apiOrder.restaurantId?.location?.coordinates &&
          Array.isArray(apiOrder.restaurantId.location.coordinates) &&
          apiOrder.restaurantId.location.coordinates.length >= 2) {
          restaurantCoords = apiOrder.restaurantId.location.coordinates;
        }
        // Priority 2: restaurantId.location with latitude/longitude properties
        else if (apiOrder.restaurantId?.location?.latitude && apiOrder.restaurantId?.location?.longitude) {
          restaurantCoords = [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude];
        }
        // Priority 3: Check nested restaurant data
        else if (apiOrder.restaurant?.location?.coordinates) {
          restaurantCoords = apiOrder.restaurant.location.coordinates;
        }
        // Priority 4: Check if restaurantId is a string ID and fetch restaurant details
        else if (typeof apiOrder.restaurantId === 'string') {
          debugLog('?? restaurantId is a string ID, fetching restaurant details...', apiOrder.restaurantId);
          try {
            const restaurantResponse = await restaurantAPI.getRestaurantById(apiOrder.restaurantId);
            if (restaurantResponse?.data?.success && restaurantResponse.data.data?.restaurant) {
              const restaurant = restaurantResponse.data.data.restaurant;
              if (restaurant.location?.coordinates && Array.isArray(restaurant.location.coordinates) && restaurant.location.coordinates.length >= 2) {
                restaurantCoords = restaurant.location.coordinates;
                debugLog('? Fetched restaurant coordinates from API:', restaurantCoords);
              }
              restaurantAddress =
                restaurant?.location?.formattedAddress ||
                restaurant?.location?.address ||
                restaurant?.address ||
                null;
            }
          } catch (err) {
            debugError('? Error fetching restaurant details:', err);
          }
        }

        setOrder((prev) =>
          mergeFetchedOrder(
            transformOrderForTracking(apiOrder, prev, restaurantCoords, restaurantAddress),
            prev,
            requestStartedAt,
            lastRealtimeAtRef.current,
          ),
        )
      }
    } catch (err) {
      debugError('Error refreshing order:', err)
    } finally {
      setIsRefreshing(false)
    }
  }
  // The socket listener is registered once per order, so it reaches the refresh
  // through this ref; calling the function it closed over ran the first
  // render's copy, bound to that render's (usually empty) order state.
  handleRefreshRef.current = handleRefresh

  // --------------------------------------------------------------------------
  // RENDER (Final JSX)
  // --------------------------------------------------------------------------

  // Nothing to show yet: loading, or the load failed. Once an order is on
  // screen (fetched or handed over by the cart) a later failure never replaces
  // it - polling simply tries again.
  if (!order) {
    if (loading) {
      return (
        <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#141414] p-4">
          <div className="max-w-lg mx-auto text-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-gray-600 dark:text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">
              {isFreshOrder ? "Confirming your order..." : "Loading order details..."}
            </p>
          </div>
        </AnimatedPage>
      )
    }

    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#141414] p-4">
        <div className="max-w-lg mx-auto text-center py-20">
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 dark:text-white">
            {isFreshOrder ? "We couldn't load your order yet" : "Order Not Found"}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {isFreshOrder
              ? "Your order is saved to your account. Check your connection and try again, or open My Orders."
              : (error || 'The order you\'re looking for doesn\'t exist.')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              onClick={handleRetryLoad}
              className="text-white border-0"
              style={{ backgroundColor: "var(--module-theme-color, #EB590E)" }}
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </Button>
            <Link to={toFoodUserPath("/user/orders")}>
              <Button variant="outline" className="dark:text-white">Back to Orders</Button>
            </Link>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  const statusConfig = {
    placed: {
      title: "Order Placed",
      subtitle: "Waiting for restaurant to accept",
      color: "bg-green-600",
      iconType: 'food'
    },
    confirmed: {
      title: "Order Confirmed",
      subtitle: "Restaurant has accepted your order",
      color: "bg-green-600",
      iconType: 'food'
    },
    preparing: {
      title: "Food is being prepared",
      subtitle: typeof estimatedTime === 'number' && estimatedTime > 0 ? `Arriving in ~${estimatedTime} mins` : "Cooking your fresh meal",
      color: "bg-green-600",
      iconType: 'food'
    },
    assigned: {
      title: "Rider is arriving",
      subtitle: "Delivery partner is heading to the restaurant",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_pickup: {
      title: "Rider at restaurant",
      subtitle: "Delivery partner is waiting for your order",
      color: "bg-green-600",
      iconType: 'rider'
    },
    // Food is ready and no rider has taken it yet (an accepted rider is "assigned").
    ready: {
      title: order?.orderType === "takeaway" ? "Ready for pickup" : "Food is ready",
      subtitle: order?.orderType === "takeaway" ? "Your order is ready to collect at the restaurant" : "Assigning a delivery partner to pick it up",
      color: "bg-green-600",
      iconType: order?.orderType === "takeaway" ? 'rider' : 'food'
    },
    on_way: {
      title: "Out for delivery",
      subtitle: typeof estimatedTime === 'number' && estimatedTime > 0 ? `Arriving in ~${estimatedTime} mins` : "Rider is out for delivery",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_drop: {
      title: "Rider has arrived",
      subtitle: "Delivery partner is at your door — please share OTP",
      color: "bg-green-600",
      iconType: 'rider'
    },
    delivered: {
      title: order?.orderType === "takeaway" ? "Order picked up" : "Order delivered",
      subtitle: "Enjoy your meal!",
      color: "bg-green-600",
      iconType: 'delivered'
    },
    cancelled: {
      title: "Order cancelled",
      // Who cancelled, from the backend status / cancelledBy - the same wording
      // the cancel card uses, so the header never disagrees with it.
      subtitle: describeCancelledBy(order?.status || order?.orderStatus, order?.cancelledBy),
      color: "bg-red-600",
      iconType: 'cancelled'
    }
  }

  const currentStatus = statusConfig[orderStatus] || statusConfig.placed
  const currentEta = typeof estimatedTime === 'number' && estimatedTime > 0
    ? `${estimatedTime} mins`
    : (estimatedTime ? String(estimatedTime) : null)

  const restaurantNameCandidates = [
    order?.restaurantName,
    order?.restaurantId?.name,
    order?.restaurantId?.restaurantName,
    order?.restaurant,
  ]
    .map((value) => (value == null ? "" : String(value).trim()))
    .filter(Boolean)

  const restaurantDisplayName =
    restaurantNameCandidates.find((name) => name.toLowerCase() !== "restaurant") ||
    restaurantNameCandidates[0] ||
    "Restaurant"

  const complaintOrderId = encodeURIComponent(
    String(order?.orderId || order?.order_id || order?.id || orderId || "")
  )
  const themeColor = "var(--module-theme-color, #EB590E)"
  const themeRgb = "var(--module-theme-rgb, 235,89,14)"

  const displayOrderNumber = (
    order?.orderId ||
    order?.order_id ||
    order?.displayOrderId ||
    (order?.id && !/^[a-f0-9]{24}$/i.test(String(order.id)) ? String(order.id) : null) ||
    (orderId && !/^[a-f0-9]{24}$/i.test(String(orderId)) ? String(orderId) : null) ||
    (orderId ? String(orderId).slice(-6) : "ORDER")
  ).toUpperCase().replace(/^#/, "");

  if (isDeliveredOrder) {

    const deliveredTimestamp = order?.deliveredAt || order?.updatedAt || Date.now();
    const deliveredTimeOnly = (() => {
      try {
        const d = new Date(deliveredTimestamp);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      } catch {
        return "2:35 PM";
      }
    })();

    const deliveredFullDateFormatted = (() => {
      try {
        const d = new Date(deliveredTimestamp);
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        return isToday ? `Today, ${timeStr}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${timeStr}`;
      } catch {
        return "Today, 2:35 PM";
      }
    })();

    const riderDisplayName =
      order?.deliveryPartner?.name ||
      order?.deliveryPartnerId?.name ||
      order?.rider?.name ||
      order?.deliveryBoy?.name ||
      "Delivery Partner";

    const orderItems = Array.isArray(order?.items)
      ? order.items
      : Array.isArray(order?.orderItems)
      ? order.orderItems
      : Array.isArray(order?.foodItems)
      ? order.foodItems
      : [];

    const orderTotalAmount =
      order?.pricing?.total != null
        ? Number(order.pricing.total).toFixed(0)
        : order?.totalAmount != null
        ? Number(order.totalAmount).toFixed(0)
        : order?.finalAmount != null
        ? Number(order.finalAmount).toFixed(0)
        : "0";

    const getItemEmoji = (name = "") => {
      const n = String(name).toLowerCase();
      if (n.includes("burger")) return "🍔";
      if (n.includes("pizza")) return "🍕";
      if (n.includes("fries") || n.includes("french")) return "🍟";
      if (n.includes("coke") || n.includes("pepsi") || n.includes("beverage") || n.includes("drink") || n.includes("juice") || n.includes("soda")) return "🥤";
      if (n.includes("coffee") || n.includes("tea") || n.includes("chai")) return "☕";
      if (n.includes("biryani") || n.includes("rice") || n.includes("pulao")) return "🍚";
      if (n.includes("roll") || n.includes("wrap") || n.includes("frankie")) return "🌯";
      if (n.includes("sandwich")) return "🥪";
      if (n.includes("noodle") || n.includes("chowmein") || n.includes("maggi") || n.includes("pasta")) return "🍜";
      if (n.includes("dosa") || n.includes("idli") || n.includes("vada") || n.includes("sambar")) return "🥞";
      if (n.includes("cake") || n.includes("pastry") || n.includes("dessert") || n.includes("sweet") || n.includes("ice cream") || n.includes("shake")) return "🍰";
      if (n.includes("thali") || n.includes("meal") || n.includes("combo")) return "🍱";
      if (n.includes("paneer") || n.includes("curry") || n.includes("dal") || n.includes("sabji") || n.includes("gravy")) return "🍲";
      if (n.includes("momos") || n.includes("dimsum")) return "🥟";
      if (n.includes("tandoori") || n.includes("tikka") || n.includes("kebab")) return "🍢";
      return "🍽️";
    };

    const handleOrderAgain = () => {
      const restId = order?.restaurantId?._id || order?.restaurantId || order?.restaurant?._id;
      if (restId) {
        navigate(`/food/user/restaurants/${restId}`);
      } else {
        navigate('/food/user');
      }
    };

    return (
      <div className="min-h-screen w-full flex flex-col bg-slate-50/70 dark:bg-[#141414] text-gray-900 dark:text-white relative overflow-y-auto pb-12">
        {/* Top Header */}
        <div className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md px-4 py-3.5 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between shadow-xs">
          <button
            type="button"
            onClick={goBack}
            className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 text-gray-800 dark:text-gray-200" />
          </button>
          <div className="text-center">
            <h1 className="text-base font-bold text-gray-900 dark:text-white">Order Details</h1>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Order #{displayOrderNumber}</p>
          </div>
          <div className="w-8" />
        </div>

        {/* Content Body Container */}
        <div className="px-4 py-4 space-y-4 max-w-lg mx-auto w-full">
          {/* Mint Celebration Hero Card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-[#f2faf3] dark:bg-emerald-950/25 border border-emerald-100/90 dark:border-emerald-900/40 rounded-3xl p-5 sm:p-6 relative overflow-hidden flex items-center gap-4 sm:gap-5 shadow-xs"
          >
            <div className="absolute top-3 right-3 text-2xl animate-bounce">🎉</div>
            <div className="absolute top-6 left-3 text-xs opacity-50">✨</div>
            <div className="absolute bottom-3 left-12 text-xs opacity-50">✨</div>

            {/* Concentric Circle Checkmark */}
            <div className="relative shrink-0 flex items-center justify-center">
              <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-full bg-emerald-100/80 dark:bg-emerald-900/40 flex items-center justify-center">
                <div className="w-14 h-14 sm:w-15 sm:h-15 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/25">
                  <Check className="w-8 h-8 stroke-[3]" />
                </div>
              </div>
            </div>

            {/* Right Text */}
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1 bg-emerald-100/90 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase mb-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>DELIVERED</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white leading-tight">
                Order Delivered! 🎉
              </h2>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
                Delivered successfully! Your order has been delivered safely.
              </p>
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-semibold mt-2">
                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                <span>Delivered at {deliveredTimeOnly}</span>
              </div>
            </div>
          </motion.div>

          {/* Delivered Status & Partner Summary Card */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
            <div className="flex items-center gap-3.5 pb-4 border-b border-gray-100 dark:border-zinc-800">
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">Delivered</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Order handed over successfully</p>
              </div>
            </div>

            <div className="pt-4 space-y-3.5 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
                  <Store className="w-4 h-4 text-gray-400" />
                  <span>Restaurant</span>
                </div>
                <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate max-w-[55%] text-right">
                  {restaurantDisplayName}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
                  <User className="w-4 h-4 text-gray-400" />
                  <span>Delivery Partner</span>
                </div>
                <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate max-w-[55%] text-right">
                  {riderDisplayName}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span>Delivered At</span>
                </div>
                <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm text-right">
                  {deliveredFullDateFormatted}
                </span>
              </div>
            </div>
          </div>

          {/* Your Order Card */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
            <h3 className="font-bold text-gray-900 dark:text-white text-base mb-4">Your Order</h3>

            <div className="space-y-3.5">
              {orderItems.length > 0 ? (
                orderItems.map((item, i) => {
                  const itemImg = item?.image || item?.imageUrl || item?.foodItem?.image || item?.dish?.image;
                  const emoji = getItemEmoji(item?.name || "");
                  return (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700/50 flex items-center justify-center shrink-0 overflow-hidden text-lg">
                          {itemImg ? (
                            <img
                              src={resolveMediaUrl(itemImg)}
                              alt={item?.name}
                              className="w-full h-full object-cover"
                              onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <span>{emoji}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {item?.name || "Item"}
                          </p>
                          {item?.variantName && (
                            <p className="text-[11px] text-gray-500 truncate">{item.variantName}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 shrink-0">
                        x {item?.quantity || 1}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-gray-500 py-2">Order items recorded</div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-200 dark:border-zinc-700 my-4 pt-3.5 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Total Paid</span>
              <span className="text-lg font-black text-gray-900 dark:text-white">
                ₹{orderTotalAmount}
              </span>
            </div>

            {/* View Order Details Button */}
            <button
              type="button"
              onClick={() => setShowOrderDetails(prev => !prev)}
              className="w-full py-2.5 px-4 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 text-orange-600 dark:text-orange-400 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>{showOrderDetails ? "Hide Order Details" : "View Order Details"}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showOrderDetails ? 'rotate-90' : ''}`} />
            </button>

            {/* Collapsible Order Breakdown */}
            {showOrderDetails && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800 space-y-2 text-xs text-gray-600 dark:text-gray-400"
              >
                <div className="flex justify-between">
                  <span>Item Subtotal</span>
                  <span>₹{order?.pricing?.subtotal || order?.pricing?.itemsPrice || orderTotalAmount}</span>
                </div>
                {Number(order?.pricing?.deliveryFee || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Delivery Fee</span>
                    <span>₹{order.pricing.deliveryFee}</span>
                  </div>
                )}
                {Number(order?.pricing?.tax || order?.pricing?.gst || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Taxes & Charges</span>
                    <span>₹{order?.pricing?.tax || order?.pricing?.gst}</span>
                  </div>
                )}
                {Number(order?.pricing?.discount || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 font-medium">
                    <span>Coupon Discount</span>
                    <span>-₹{order.pricing.discount}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-gray-100 dark:border-zinc-800 font-bold text-gray-900 dark:text-white">
                  <span>Payment Mode</span>
                  <span className="uppercase">{order?.paymentMethod || order?.payment?.method || "Online"}</span>
                </div>
              </motion.div>
            )}
          </div>

          {/* Feedback & Rating Section */}
          <div className="space-y-3.5">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base">How was your order?</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Your feedback helps us improve</p>
            </div>

            {ratingSubmitted ? (
              <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-3xl p-5 text-center">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/60 rounded-full flex items-center justify-center mx-auto mb-2 text-emerald-600 dark:text-emerald-300 font-bold text-xl">
                  ✓
                </div>
                <h4 className="font-bold text-emerald-900 dark:text-emerald-200 text-sm">Thank you for your rating!</h4>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">Your feedback helps us serve you better.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 2 Side-by-Side Cards (Food Quality & Delivery Experience) */}
                <div className={`grid gap-3 ${isTakeawayOrder ? "grid-cols-1" : "grid-cols-2"}`}>
                  {/* Food Quality Card */}
                  <div className="bg-white dark:bg-zinc-900 rounded-3xl p-4 sm:p-5 border border-gray-100 dark:border-zinc-800 shadow-xs flex flex-col items-center text-center">
                    <div className="w-10 h-10 rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-500 flex items-center justify-center mb-2">
                      <UtensilsCrossed className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm">Food Quality</h4>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-full mb-3">
                      {restaurantDisplayName}
                    </p>

                    <div className="flex items-center justify-center gap-1 sm:gap-1.5 mb-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRestaurantRating(star)}
                          className="p-0.5 transition-transform hover:scale-125 active:scale-95"
                        >
                          <Star
                            className={`w-4 h-4 sm:w-5 sm:h-5 ${
                              star <= restaurantRating
                                ? "text-amber-400 fill-amber-400"
                                : "text-gray-200 dark:text-zinc-700"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400 mt-0.5">
                      {restaurantRating === 5 ? "🤩 Amazing" : restaurantRating === 4 ? "😋 Delicious" : restaurantRating === 3 ? "👍 Good" : restaurantRating === 2 ? "😐 Average" : "👎 Bad"}
                    </span>
                  </div>

                  {/* Delivery Experience Card (not applicable to takeaway orders) */}
                  {!isTakeawayOrder && (
                  <div className="bg-white dark:bg-zinc-900 rounded-3xl p-4 sm:p-5 border border-gray-100 dark:border-zinc-800 shadow-xs flex flex-col items-center text-center">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center mb-2">
                      <Bike className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm">Delivery Experience</h4>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-full mb-3">
                      {riderDisplayName}
                    </p>

                    <div className="flex items-center justify-center gap-1 sm:gap-1.5 mb-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setDeliveryRating(star)}
                          className="p-0.5 transition-transform hover:scale-125 active:scale-95"
                        >
                          <Star
                            className={`w-4 h-4 sm:w-5 sm:h-5 ${
                              star <= deliveryRating
                                ? "text-amber-400 fill-amber-400"
                                : "text-gray-200 dark:text-zinc-700"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {deliveryRating === 5 ? "⚡ Super Fast" : deliveryRating === 4 ? "😊 Polite & On-time" : deliveryRating === 3 ? "👍 Good" : deliveryRating === 2 ? "😐 Average" : "👎 Poor"}
                    </span>
                  </div>
                  )}
                </div>

                {/* What did you like? Compliment tags */}
                <div>
                  <label className="text-xs font-bold text-gray-900 dark:text-white mb-2.5 block">
                    What did you like?
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Hot & Fresh", icon: "🔥" },
                      { label: "Fast Delivery", icon: "⚡", deliveryOnly: true },
                      { label: "Great Packaging", icon: "📦" },
                      { label: "Tasty Food", icon: "😋" },
                      { label: "Polite Rider", icon: "😊", deliveryOnly: true }
                    ].filter((chip) => !(isTakeawayOrder && chip.deliveryOnly)).map((chip) => {
                      const chipKey = `${chip.icon} ${chip.label}`;
                      const isSelected = selectedCompliments.includes(chipKey);
                      return (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => {
                            setSelectedCompliments(prev =>
                              isSelected ? prev.filter(c => c !== chipKey) : [...prev, chipKey]
                            );
                          }}
                          className={`text-xs px-3.5 py-2 rounded-2xl font-semibold transition-all flex items-center gap-1.5 ${
                            isSelected
                              ? "bg-orange-50 dark:bg-orange-950/40 border border-orange-500 text-orange-600 dark:text-orange-400 shadow-xs"
                              : "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <span>{chip.icon}</span>
                          <span>{chip.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Continue/Save Feedback Button */}
                <button
                  type="button"
                  onClick={handleRatingSubmit}
                  disabled={isSubmittingRating}
                  className={`w-full h-12 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 shadow-md ${
                    isSubmittingRating
                      ? "bg-orange-700 text-white cursor-wait opacity-90 shadow-none"
                      : "bg-[#EB590E] hover:bg-[#d44d08] active:scale-[0.99] text-white shadow-orange-500/25 cursor-pointer"
                  }`}
                >
                  {isSubmittingRating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span className="text-white font-bold">Saving Feedback...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 text-white" />
                      <span className="text-white font-bold">Save & Submit Feedback</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Quick Actions (Order Again & View Invoice) */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={handleOrderAgain}
              className="flex items-center justify-center gap-2 py-3.5 px-4 bg-white dark:bg-zinc-900 border border-orange-500 text-orange-600 dark:border-orange-400 dark:text-orange-400 rounded-2xl font-bold text-sm shadow-xs hover:bg-orange-50/50 active:scale-95 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Order Again</span>
            </button>

            <Link
              to={toFoodUserPath(`/user/orders/${orderId || order?.orderId || order?._id || resolvedLookupId}/invoice`)}
              state={{ order, orderId: orderId || order?.orderId || order?._id || resolvedLookupId }}
              className="flex items-center justify-center gap-2 py-3.5 px-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800 text-gray-800 dark:text-white rounded-2xl font-bold text-sm shadow-xs active:scale-95 transition-all"
            >
              <Receipt className="w-4 h-4" />
              <span>View Invoice</span>
            </Link>
          </div>

          {/* Help & Complaints */}
          <div className="pt-2 text-center">
            <Link
              to={`/user/complaints/submit/${complaintOrderId}`}
              className="inline-flex items-center justify-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-semibold hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              <CircleSlash className="w-3.5 h-3.5" />
              <span>Need help with this order? Raise a Complaint</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] w-full flex flex-col overflow-hidden bg-gray-50 dark:bg-[#141414]">
      {/* Order Confirmed Modal */}
      <AnimatePresence>
        {showConfirmation && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-white dark:bg-[#141414] flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="text-center px-8"
            >
              <AnimatedCheckmark delay={0.3} />
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9 }}
                className="text-2xl font-bold text-gray-900 dark:text-white mt-6"
              >
                Order Placed!
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.1 }}
                className="text-gray-600 dark:text-gray-400 mt-2"
              >
                Your order has been placed successfully
              </motion.p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="mt-8"
              >
                <div
                  className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto"
                  style={{ borderColor: themeColor, borderTopColor: "transparent" }}
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">Loading order details...</p>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Container */}
      <motion.div
        className="sticky top-0 z-50 shadow-md backdrop-blur-md"
        style={{ backgroundColor: isCancelledOrder ? "#DC2626" : "rgba(255, 255, 255, 0.9)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="dark:bg-zinc-900/90 py-3 px-4 flex items-center justify-between border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <button 
              type="button"
              onClick={goBack} 
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-gray-200" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-gray-900 dark:text-white leading-snug">Track Order</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Order #{displayOrderNumber}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {customerDeliveryOtp && !isDeliveredOrder && !isCancelledOrder && (
              <button
                type="button"
                onClick={handleCopyOtp}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-blue-900/70 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 rounded-xl text-xs font-black transition-all active:scale-95 shadow-2xs cursor-pointer"
                title="Tap to copy Delivery OTP"
              >
                <Shield className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>OTP: {customerDeliveryOtp}</span>
                <Copy className="w-3 h-3 opacity-70" />
              </button>
            )}

            <button
              type="button"
              onClick={handleRefresh}
              className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-full transition-colors"
              title="Refresh order"
            >
              <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Pay at Pickup: fixed "Pay Now" bar until the order is paid */}
      {isAwaitingPickupPayment && !isCancelledOrder && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-[#1c1c1c] border-t border-amber-200 dark:border-amber-900/50 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <div className="max-w-lg mx-auto px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingBag className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                Reached the restaurant? Pay now to confirm your order.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePayAtPickupNow}
              disabled={isPayingPickup}
              className="w-full bg-[#1F6B45] hover:bg-[#14512F] disabled:opacity-70 text-white h-12 rounded-2xl font-black text-sm tracking-wide shadow-lg shadow-[#1F6B45]/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {isPayingPickup
                ? "Opening payment…"
                : `Pay Now ₹${Number(order?.pricing?.total ?? order?.totalAmount ?? order?.payment?.amountDue ?? 0).toFixed(0)}`}
            </button>
          </div>
        </div>
      )}

      {/* Floating Sticky Side Handover OTP Widget (Always Visible until Handover) */}
      {customerDeliveryOtp && !isDeliveredOrder && !isCancelledOrder && (
        <motion.div
          initial={{ scale: 0.9, opacity: 0, x: 20 }}
          animate={{ scale: 1, opacity: 1, x: 0 }}
          exit={{ scale: 0.9, opacity: 0, x: 20 }}
          onClick={handleCopyOtp}
          className="fixed top-18 right-3 sm:right-6 z-40 flex items-center gap-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white pl-3.5 pr-2.5 py-2 rounded-2xl shadow-xl shadow-blue-500/25 border-2 border-white/80 dark:border-zinc-800 backdrop-blur-md cursor-pointer hover:scale-105 active:scale-95 transition-all group select-none"
          title="Tap to Copy Delivery OTP"
        >
          <div className="flex flex-col text-left">
            <span className="text-[9px] uppercase font-black tracking-widest text-blue-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              DELIVERY OTP
            </span>
            <span className="text-base font-black tracking-[0.2em] leading-tight text-white drop-shadow-xs">
              {customerDeliveryOtp}
            </span>
          </div>
          <div className="p-1.5 bg-white/20 group-hover:bg-white/30 rounded-xl transition-colors ml-1">
            <Copy className="w-3.5 h-3.5 text-white" />
          </div>
        </motion.div>
      )}

      {/* Map Section - also for a delivered or cancelled order: the map goes
          static there (pins only, no live tracking), and hiding it left an
          empty screen behind the sheet. */}
      <div className="absolute inset-0 z-0">
        <DeliveryMap
          orderId={orderId}
          order={order}
          isVisible={order !== null}
          fallbackCustomerCoords={fallbackCustomerCoords}
          userLiveCoords={userLiveCoords}
          userLocationAccuracy={userLiveLocation?.accuracy ?? null}
          onEtaUpdate={handleEtaUpdate}
        />
      </div>

      {/* Floating Map Utility Bar on Top-Right */}
      {!isDeliveredOrder && orderStatus !== 'cancelled' && (
        <div className="absolute top-20 right-4 z-30 hidden sm:flex items-center gap-2">
          {currentEta && !customerDeliveryOtp && (
            <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-lg border border-gray-100 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold text-gray-800 dark:text-gray-200">
              <Clock className="w-3.5 h-3.5 text-[#EB590E]" />
              <span>ETA: ~{currentEta}</span>
            </div>
          )}
        </div>
      )}

      {/* DESKTOP VIEW: Floating Responsive Sidebar (Visible on lg+ screens) */}
      <div className="hidden lg:flex flex-col absolute top-18 left-6 bottom-6 w-[450px] z-40 bg-white/95 dark:bg-[#141414]/95 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.2)] border border-gray-200/80 dark:border-zinc-800 overflow-hidden">
        {/* Desktop Sidebar Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-white/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider">Live Order Status</h2>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-gray-500"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Desktop Scrollable Content */}
        <div className="overflow-y-auto px-6 py-5 space-y-4.5 flex-1 min-h-0 overscroll-contain">
          {/* Main Status Hero */}
          <div className="bg-gradient-to-br from-orange-50 via-white to-amber-50/40 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-850 rounded-3xl p-5 shadow-xs border border-orange-100/70 dark:border-zinc-800 relative overflow-hidden">
            <div className="flex items-start justify-between">
              <div>
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold mb-2 shadow-2xs"
                  style={{ backgroundColor: `rgba(${themeRgb}, 0.12)`, color: themeColor }}
                >
                  <Sparkles className="w-3 h-3" />
                  {currentStatus.title}
                </span>
                <h2 className="text-xl font-black text-gray-900 dark:text-white leading-tight">
                  {currentStatus.subtitle}
                </h2>
                {isCancelledOrder && order?.cancellationReason && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400 font-medium">
                    Reason: {order.cancellationReason}
                  </p>
                )}
              </div>
              {currentEta && !isCancelledOrder && !isDeliveredOrder && (
                <div className="flex flex-col items-end shrink-0 bg-white/90 dark:bg-zinc-800/90 px-3 py-1.5 rounded-2xl border border-gray-100 dark:border-zinc-700 shadow-2xs">
                  <span className="text-[10px] uppercase font-bold text-gray-400">{isTakeawayOrder ? 'Ready In' : 'Estimated Arrival'}</span>
                  <span className="text-sm font-black text-[#EB590E]">~{currentEta}</span>
                </div>
              )}
            </div>
          </div>

          {/* Stepper */}
          <LiveTrackingStepper
            status={orderStatus}
            isCancelled={isCancelledOrder}
            riderMode={isRiderJourney}
            isTakeaway={order?.orderType === 'takeaway'}
            cancellationReason={order?.cancellationReason || ''}
            cancelledBy={order?.cancelledBy}
            orderStatusRaw={order?.status}
          />

          {/* Delivery OTP Card */}
          {customerDeliveryOtp && !isDeliveredOrder && !isCancelledOrder && (
            <motion.div
              className="bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-blue-600/10 dark:from-blue-950/40 dark:to-indigo-950/40 border-2 border-blue-400/40 dark:border-blue-700/60 rounded-3xl p-5 shadow-xs relative overflow-hidden"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-blue-500 text-white flex items-center justify-center shadow-xs">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      DELIVERY PIN / OTP
                    </span>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Share with rider only on delivery</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyOtp}
                  className="px-3 py-1 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 shadow-2xs cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>

              <div className="flex items-center justify-center gap-2.5 py-1">
                {String(customerDeliveryOtp).split("").map((digit, i) => (
                  <div
                    key={i}
                    className="w-12 h-13 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-blue-400 dark:border-blue-500 shadow-md flex items-center justify-center text-2xl font-black text-blue-600 dark:text-blue-400"
                  >
                    {digit}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Delivery Partner Profile Card */}
          {order?.deliveryPartnerId && (
            <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    <div className="w-13 h-13 rounded-2xl bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border-2 border-white dark:border-zinc-800 text-slate-500 shadow-2xs">
                      <User className="w-7 h-7" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-emerald-500 w-4 h-4 rounded-full border-2 border-white dark:border-zinc-900" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">{order.deliveryPartner?.name || 'Delivery Partner'}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">4.9</span>
                      </div>
                      <span className="text-gray-300 dark:text-zinc-700">•</span>
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Bike className="w-3.5 h-3.5" /> Assigned Rider
                      </span>
                    </div>
                  </div>
                </div>
                {!isDeliveredOrder && !isCancelledOrder && (
                  <button
                    type="button"
                    onClick={handleCallRider}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[#14512F] hover:bg-[#0F3D23] text-white rounded-2xl font-bold text-xs shadow-md shadow-[#14512F]/30 active:scale-95 transition-all cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call</span>
                  </button>
                )}
              </div>

            </div>
          )}

          {/* Delivery Address Card (delivery) / Pickup Card (takeaway) */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 rounded-2xl text-blue-500 shrink-0 mt-0.5">
                  {isTakeawayOrder ? <ShoppingBag className="w-5 h-5" /> : <MapPin className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 dark:text-white text-sm mb-1">
                    {isTakeawayOrder
                      ? (isDeliveredOrder ? 'Picked up from restaurant' : 'Pick up from restaurant')
                      : 'Delivering to Home'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed break-words">
                    {isTakeawayOrder
                      ? (order?.restaurantAddress || 'Restaurant address not available')
                      : (order?.address?.formattedAddress || 'Address not available')}
                  </p>
                  {isTakeawayOrder && !isDeliveredOrder && !isCancelledOrder && (
                    <button
                      type="button"
                      onClick={handleGetDirections}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Get Directions
                    </button>
                  )}
                </div>
              </div>
              {!isDeliveredOrder && !isCancelledOrder && (
                <button
                  type="button"
                  onClick={() => setIsInstructionsModalOpen(true)}
                  className="text-xs font-bold text-[#EB590E] hover:underline shrink-0 pt-0.5"
                >
                  {isInstructionsEditable ? "Edit Note" : (order?.deliveryInstructions || order?.note ? "View Note" : "Note Details")}
                </button>
              )}
            </div>
          </div>

          {/* Restaurant Info & Order Items */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-orange-50 dark:bg-orange-950/40 text-[#EB590E] flex items-center justify-center shrink-0">
                  <Store className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 dark:text-white text-sm truncate">{restaurantDisplayName}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{order.restaurantAddress || 'Restaurant Location'}</p>
                </div>
              </div>
              {!isDeliveredOrder && !isCancelledOrder && (
                <button
                  type="button"
                  onClick={handleCallRestaurant}
                  className="p-2.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/60 rounded-2xl text-[#EB590E] transition-colors shrink-0 cursor-pointer"
                  title="Call Restaurant"
                >
                  <Phone className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Items List */}
            <div className="space-y-3">
              {order?.items?.map((item, i) => {
                const resolvedIsVeg = isVegMenuItem(item);

                return (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div
                        className={`w-3.5 h-3.5 mt-0.5 border flex items-center justify-center p-[1px] shrink-0 ${resolvedIsVeg ? "border-[#16a34a] bg-green-50/40 dark:bg-green-900/25" : "border-[#1F6B45] bg-red-50/40 dark:bg-red-900/25"}`}
                      >
                        <div className={`w-full h-full rounded-full ${resolvedIsVeg ? "bg-[#16a34a]" : "bg-[#1F6B45]"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm text-gray-800 dark:text-gray-200 font-semibold truncate">
                          {item?.quantity || 1} x {item?.name || "Item"}
                        </p>
                        {item?.variantName && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{item.variantName}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white shrink-0">
                      ₹{((item?.price || 0) * (item?.quantity || 1)).toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Collapsible Bill Breakdown */}
            <div className="mt-4 pt-3.5 border-t border-dashed border-gray-200 dark:border-zinc-700">
              <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                <div className="flex justify-between">
                  <span>Item Total</span>
                  <span>₹{order?.pricing?.subtotal || order?.subtotal || (order?.totalAmount || 0)}</span>
                </div>
                {Number(order?.pricing?.deliveryFee || order?.deliveryFee || 0) > 0 ? (
                  <div className="flex justify-between">
                    <span>Delivery Fee</span>
                    <span>₹{order?.pricing?.deliveryFee || order?.deliveryFee}</span>
                  </div>
                ) : !isTakeawayOrder && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Delivery Fee</span>
                    <span>FREE</span>
                  </div>
                )}
                {Number(order?.pricing?.tax || order?.pricing?.gst || order?.gst || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Taxes & Restaurant GST</span>
                    <span>₹{order?.pricing?.tax || order?.pricing?.gst || order?.gst}</span>
                  </div>
                )}
                {Number(order?.pricing?.discount || order?.discount || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount</span>
                    <span>-₹{order?.pricing?.discount || order?.discount}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2.5 border-t border-gray-100 dark:border-zinc-800 text-sm font-black text-gray-900 dark:text-white">
                  <span>Total Paid</span>
                  <span>₹{order?.pricing?.total || order?.totalAmount || order?.total || 0}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                <Link
                  to={toFoodUserPath(`/user/orders/${orderId || order?.orderId || order?._id || resolvedLookupId}/invoice`)}
                  state={{ order, orderId: orderId || order?.orderId || order?._id || resolvedLookupId }}
                  className="text-xs font-bold text-[#EB590E] hover:underline flex items-center gap-1"
                >
                  <Receipt className="w-3.5 h-3.5" />
                  <span>View Tax Invoice</span>
                </Link>
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {order?.paymentMethod || order?.payment?.method || "Paid Online"}
                </span>
              </div>
            </div>
          </div>

          {/* Cancel Order Action */}
          {!isAdminAccepted && !isCancelledOrder && !isDeliveredOrder && (
            <div className="bg-red-50/60 dark:bg-red-950/20 rounded-3xl p-4 border border-red-100 dark:border-red-900/40">
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-xs font-bold text-red-900 dark:text-red-200">Need to cancel?</p>
                <span className="text-[10px] uppercase font-bold text-red-600 dark:text-red-400">Available before accepted</span>
              </div>
              <Button
                type="button"
                onClick={handleCancelOrder}
                variant="destructive"
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold h-10 rounded-2xl"
              >
                Cancel Order
              </Button>
            </div>
          )}

          {/* Help & Support Link */}
          <div className="pt-2 text-center pb-6">
            <Link
              to={(orderId || order?.orderId || order?._id || order?.id || resolvedLookupId) ? toFoodUserPath(`/user/help/orders/${orderId || order?.orderId || order?._id || order?.id || resolvedLookupId}`) : toFoodUserPath('/user/profile/support')}
              state={{ 
                order, 
                orderId: orderId || order?.orderId || order?._id || order?.id || resolvedLookupId,
                fromTracking: true,
                from: location.pathname,
                backTo: location.pathname
              }}
              className="relative z-10 inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-[#EB590E] transition-colors touch-manipulation"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Need help with this order? Contact Support</span>
            </Link>
          </div>
        </div>
      </div>

      {/* MOBILE VIEW: Modern Multi-Snap Fluid Bottom Sheet (Visible on < lg screens) */}
      {/* Height is a motion value: it tracks the finger while dragging the handle
          and springs to a snap point on release (see useBottomSheetDrag). */}
      <motion.div
        initial={false}
        style={{ height: sheetDrag.height }}
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#141414]/95 backdrop-blur-2xl rounded-t-[2.5rem] shadow-[0_-20px_50px_rgba(0,0,0,0.22)] flex flex-col overflow-hidden border-t border-white/60 dark:border-zinc-800"
      >
        {/* Interactive Handle Bar with Mode Toggle */}
        <div className="w-full pt-3 pb-2 flex flex-col items-center shrink-0 select-none bg-white/50 dark:bg-zinc-900/50 border-b border-gray-100/80 dark:border-zinc-800/80">
          {/* Pill Drag Handle — drag to resize, tap to cycle, arrows to step.
              The padded wrapper is the grab area (a 6px pill is too small to hit),
              and touch-action:none stops the drag scrolling the page or panning the map. */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Resize order details sheet"
            aria-valuemin={0}
            aria-valuemax={2}
            aria-valuenow={SHEET_MODES.indexOf(sheetMode)}
            aria-valuetext={`${sheetMode} view`}
            onPointerDown={sheetDrag.onPointerDown}
            onPointerMove={sheetDrag.onPointerMove}
            onPointerUp={sheetDrag.endGesture}
            onPointerCancel={sheetDrag.endGesture}
            onKeyDown={sheetDrag.onKeyDown}
            style={{ touchAction: 'none' }}
            className={`px-10 py-2 -mt-1 mb-1.5 flex items-center justify-center rounded-full ${sheetDrag.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          >
            <div
              className={`w-12 h-1.5 rounded-full transition-colors ${
                sheetDrag.isDragging
                  ? 'bg-gray-500 dark:bg-zinc-400'
                  : 'bg-gray-300 hover:bg-gray-400 dark:bg-zinc-700'
              }`}
            />
          </div>

          {/* 3-State Mode Buttons for 1-Tap Control */}
          <div className="flex items-center gap-2 px-4">
            <button
              type="button"
              onClick={() => setSheetMode('compact')}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                sheetMode === 'compact'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
              }`}
            >
              🗺️ Map Focus
            </button>
            <button
              type="button"
              onClick={() => setSheetMode('half')}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                sheetMode === 'half'
                  ? 'bg-[#EB590E] text-white shadow-xs'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
              }`}
            >
              ⚡ Overview
            </button>
            <button
              type="button"
              onClick={() => setSheetMode('expanded')}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                sheetMode === 'expanded'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
              }`}
            >
              📄 All Details
            </button>
          </div>
        </div>

        {/* Compact Mode Summary Bar */}
        {sheetMode === 'compact' && (
          <div
            onClick={() => setSheetMode('half')}
            className="px-5 py-3 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="w-3 h-3 rounded-full shrink-0 animate-pulse"
                style={{ backgroundColor: themeColor }}
              />
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                  {currentStatus.subtitle || currentStatus.title || "Tracking Order"}
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {currentEta ? `ETA: ~${currentEta}` : (restaurantDisplayName || "Live on map")}
                  </p>
                  {customerDeliveryOtp && (
                    <span 
                      onClick={handleCopyOtp}
                      className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 rounded-md text-[10px] font-black tracking-wider shadow-2xs"
                    >
                      OTP: {customerDeliveryOtp}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 px-3 py-1.5 bg-[#EB590E] text-white rounded-full text-xs font-bold shrink-0 shadow-xs">
              <span>View Details</span>
              <ChevronUp className="w-3.5 h-3.5" />
            </div>
          </div>
        )}

        {/* Mobile Scrollable Area (Rendered when half or expanded) */}
        <div className={`overflow-y-auto px-4 sm:px-6 py-4 space-y-4 flex-1 min-h-0 overscroll-contain pb-[calc(4rem+env(safe-area-inset-bottom))] ${sheetMode === 'compact' ? 'hidden' : 'block'}`}>
          {/* Main Status Hero */}
          <div className="bg-gradient-to-br from-orange-50 via-white to-amber-50/40 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-850 rounded-3xl p-5 shadow-xs border border-orange-100/70 dark:border-zinc-800 relative overflow-hidden">
            <div className="flex items-start justify-between">
              <div>
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold mb-2 shadow-2xs"
                  style={{ backgroundColor: `rgba(${themeRgb}, 0.12)`, color: themeColor }}
                >
                  <Sparkles className="w-3 h-3" />
                  {currentStatus.title}
                </span>
                <h2 className="text-xl font-black text-gray-900 dark:text-white leading-tight">
                  {currentStatus.subtitle}
                </h2>
                {isCancelledOrder && order?.cancellationReason && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400 font-medium">
                    Reason: {order.cancellationReason}
                  </p>
                )}
              </div>
              {currentEta && !isCancelledOrder && !isDeliveredOrder && (
                <div className="flex flex-col items-end shrink-0 bg-white/90 dark:bg-zinc-800/90 px-3 py-1.5 rounded-2xl border border-gray-100 dark:border-zinc-700 shadow-2xs">
                  <span className="text-[10px] uppercase font-bold text-gray-400">{isTakeawayOrder ? 'Ready In' : 'Arrival'}</span>
                  <span className="text-sm font-black text-[#EB590E]">~{currentEta}</span>
                </div>
              )}
            </div>
          </div>

          {/* Stepper */}
          <LiveTrackingStepper
            status={orderStatus}
            isCancelled={isCancelledOrder}
            riderMode={isRiderJourney}
            isTakeaway={order?.orderType === 'takeaway'}
            cancellationReason={order?.cancellationReason || ''}
            cancelledBy={order?.cancelledBy}
            orderStatusRaw={order?.status}
          />

          {/* Delivery OTP Card */}
          {customerDeliveryOtp && !isDeliveredOrder && !isCancelledOrder && (
            <motion.div
              className="bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-blue-600/10 dark:from-blue-950/40 dark:to-indigo-950/40 border-2 border-blue-400/40 dark:border-blue-700/60 rounded-3xl p-5 shadow-xs relative overflow-hidden"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-blue-500 text-white flex items-center justify-center shadow-xs">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      DELIVERY PIN / OTP
                    </span>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Share with rider only on delivery</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyOtp}
                  className="px-3 py-1 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 shadow-2xs cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>

              <div className="flex items-center justify-center gap-2.5 py-1">
                {String(customerDeliveryOtp).split("").map((digit, i) => (
                  <div
                    key={i}
                    className="w-12 h-13 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-blue-400 dark:border-blue-500 shadow-md flex items-center justify-center text-2xl font-black text-blue-600 dark:text-blue-400"
                  >
                    {digit}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Delivery Partner Profile Card */}
          {order?.deliveryPartnerId && (
            <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    <div className="w-13 h-13 rounded-2xl bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border-2 border-white dark:border-zinc-800 text-slate-500 shadow-2xs">
                      <User className="w-7 h-7" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-emerald-500 w-4 h-4 rounded-full border-2 border-white dark:border-zinc-900" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">{order.deliveryPartner?.name || 'Delivery Partner'}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">4.9</span>
                      </div>
                      <span className="text-gray-300 dark:text-zinc-700">•</span>
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Bike className="w-3.5 h-3.5" /> Assigned Rider
                      </span>
                    </div>
                  </div>
                </div>
                {!isDeliveredOrder && !isCancelledOrder && (
                  <button
                    type="button"
                    onClick={handleCallRider}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[#14512F] hover:bg-[#0F3D23] text-white rounded-2xl font-bold text-xs shadow-md shadow-[#14512F]/30 active:scale-95 transition-all cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call</span>
                  </button>
                )}
              </div>

            </div>
          )}

          {/* Delivery Address Card (delivery) / Pickup Card (takeaway) */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 rounded-2xl text-blue-500 shrink-0 mt-0.5">
                  {isTakeawayOrder ? <ShoppingBag className="w-5 h-5" /> : <MapPin className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 dark:text-white text-sm mb-1">
                    {isTakeawayOrder
                      ? (isDeliveredOrder ? 'Picked up from restaurant' : 'Pick up from restaurant')
                      : 'Delivering to Home'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed break-words">
                    {isTakeawayOrder
                      ? (order?.restaurantAddress || 'Restaurant address not available')
                      : (order?.address?.formattedAddress || 'Address not available')}
                  </p>
                  {isTakeawayOrder && !isDeliveredOrder && !isCancelledOrder && (
                    <button
                      type="button"
                      onClick={handleGetDirections}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Get Directions
                    </button>
                  )}
                </div>
              </div>
              {!isDeliveredOrder && !isCancelledOrder && (
                <button
                  type="button"
                  onClick={() => setIsInstructionsModalOpen(true)}
                  className="text-xs font-bold text-[#EB590E] hover:underline shrink-0 pt-0.5"
                >
                  {isInstructionsEditable ? "Edit Note" : (order?.deliveryInstructions || order?.note ? "View Note" : "Note Details")}
                </button>
              )}
            </div>
          </div>

          {/* Restaurant Info & Order Items */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-xs border border-gray-100 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-orange-50 dark:bg-orange-950/40 text-[#EB590E] flex items-center justify-center shrink-0">
                  <Store className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 dark:text-white text-sm truncate">{restaurantDisplayName}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{order.restaurantAddress || 'Restaurant Location'}</p>
                </div>
              </div>
              {!isDeliveredOrder && !isCancelledOrder && (
                <button
                  type="button"
                  onClick={handleCallRestaurant}
                  className="p-2.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/60 rounded-2xl text-[#EB590E] transition-colors shrink-0 cursor-pointer"
                  title="Call Restaurant"
                >
                  <Phone className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Items List */}
            <div className="space-y-3">
              {order?.items?.map((item, i) => {
                const resolvedIsVeg = isVegMenuItem(item);

                return (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div
                        className={`w-3.5 h-3.5 mt-0.5 border flex items-center justify-center p-[1px] shrink-0 ${resolvedIsVeg ? "border-[#16a34a] bg-green-50/40 dark:bg-green-900/25" : "border-[#1F6B45] bg-red-50/40 dark:bg-red-900/25"}`}
                      >
                        <div className={`w-full h-full rounded-full ${resolvedIsVeg ? "bg-[#16a34a]" : "bg-[#1F6B45]"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm text-gray-800 dark:text-gray-200 font-semibold truncate">
                          {item?.quantity || 1} x {item?.name || "Item"}
                        </p>
                        {item?.variantName && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{item.variantName}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white shrink-0">
                      ₹{((item?.price || 0) * (item?.quantity || 1)).toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Collapsible Bill Breakdown */}
            <div className="mt-4 pt-3.5 border-t border-dashed border-gray-200 dark:border-zinc-700">
              <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                <div className="flex justify-between">
                  <span>Item Total</span>
                  <span>₹{order?.pricing?.subtotal || order?.subtotal || (order?.totalAmount || 0)}</span>
                </div>
                {Number(order?.pricing?.deliveryFee || order?.deliveryFee || 0) > 0 ? (
                  <div className="flex justify-between">
                    <span>Delivery Fee</span>
                    <span>₹{order?.pricing?.deliveryFee || order?.deliveryFee}</span>
                  </div>
                ) : !isTakeawayOrder && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Delivery Fee</span>
                    <span>FREE</span>
                  </div>
                )}
                {Number(order?.pricing?.tax || order?.pricing?.gst || order?.gst || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Taxes & Restaurant GST</span>
                    <span>₹{order?.pricing?.tax || order?.pricing?.gst || order?.gst}</span>
                  </div>
                )}
                {Number(order?.pricing?.discount || order?.discount || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount</span>
                    <span>-₹{order?.pricing?.discount || order?.discount}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2.5 border-t border-gray-100 dark:border-zinc-800 text-sm font-black text-gray-900 dark:text-white">
                  <span>Total Paid</span>
                  <span>₹{order?.pricing?.total || order?.totalAmount || order?.total || 0}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                <Link
                  to={toFoodUserPath(`/user/orders/${orderId || order?.orderId || order?._id || resolvedLookupId}/invoice`)}
                  state={{ order, orderId: orderId || order?.orderId || order?._id || resolvedLookupId }}
                  className="text-xs font-bold text-[#EB590E] hover:underline flex items-center gap-1"
                >
                  <Receipt className="w-3.5 h-3.5" />
                  <span>View Tax Invoice</span>
                </Link>
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {order?.paymentMethod || order?.payment?.method || "Paid Online"}
                </span>
              </div>
            </div>
          </div>

          {/* Cancel Order Action */}
          {!isAdminAccepted && !isCancelledOrder && !isDeliveredOrder && (
            <div className="bg-red-50/60 dark:bg-red-950/20 rounded-3xl p-4 border border-red-100 dark:border-red-900/40">
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-xs font-bold text-red-900 dark:text-red-200">Need to cancel?</p>
                <span className="text-[10px] uppercase font-bold text-red-600 dark:text-red-400">Available before accepted</span>
              </div>
              <Button
                type="button"
                onClick={handleCancelOrder}
                variant="destructive"
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold h-10 rounded-2xl"
              >
                Cancel Order
              </Button>
            </div>
          )}

          {/* Help & Support Link */}
          <div className="pt-2 text-center pb-6">
            <Link
              to={(orderId || order?.orderId || order?._id || order?.id || resolvedLookupId) ? toFoodUserPath(`/user/help/orders/${orderId || order?.orderId || order?._id || order?.id || resolvedLookupId}`) : toFoodUserPath('/user/profile/support')}
              state={{ 
                order, 
                orderId: orderId || order?.orderId || order?._id || order?.id || resolvedLookupId,
                fromTracking: true,
                from: location.pathname,
                backTo: location.pathname
              }}
              className="relative z-10 inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-[#EB590E] transition-colors touch-manipulation"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Need help with this order? Contact Support</span>
            </Link>
          </div>
        </div>
      </motion.div>

      {/* Cancel Order Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="sm:max-w-xl w-[95%] max-w-[600px] bg-white dark:bg-zinc-900 border-none rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
              Cancel Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-6 px-2">
            <div className="space-y-2 w-full">
              <Textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g., Changed my mind, Wrong address, etc."
                className="w-full min-h-[100px] resize-none border-2 border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 rounded-xl px-4 py-3 text-sm text-gray-800 dark:text-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-200 focus:outline-none transition-colors"
                disabled={isCancelling}
              />
            </div>

            {/*
              Ometto refund flow: a paid Razorpay order can be refunded either to the
              original payment method or instantly to the wallet. The backend's
              cancelOrder accepts refundDestination, so let the customer choose.
            */}
            {(() => {
              const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
              const status = String(order?.payment?.status || "").toLowerCase()
              const isRazorpayPaid =
                method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

              if (!isRazorpayPaid) return null

              return (
                <div className="space-y-3 rounded-xl border-2 border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/60 p-4">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Refund preference</p>
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                      <input
                        type="radio"
                        name="refund-destination"
                        value="source"
                        checked={refundDestination === "source"}
                        onChange={() => setRefundDestination("source")}
                        disabled={isCancelling}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Refund to original payment method (5-7 working days)
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                      <input
                        type="radio"
                        name="refund-destination"
                        value="wallet"
                        checked={refundDestination === "wallet"}
                        onChange={() => setRefundDestination("wallet")}
                        disabled={isCancelling}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Refund to wallet (instant credit)
                      </span>
                    </label>
                  </div>
                </div>
              )
            })()}

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCancelDialog(false);
                  setCancellationReason("");
                  setRefundDestination("source");
                }}
                disabled={isCancelling}
                className="flex-1 dark:bg-zinc-800 dark:text-white dark:border-zinc-700"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCancel}
                disabled={isCancelling || !cancellationReason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white border-none"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Confirm'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Instructions Modal */}
      <Dialog open={isInstructionsModalOpen} onOpenChange={setIsInstructionsModalOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-3xl p-6 border-0 shadow-2xl bg-white dark:bg-zinc-900 max-h-[90vh] overflow-y-auto z-[200]">
          <DialogHeader className="mb-2">
            <DialogTitle
              className="text-xl font-bold bg-clip-text text-transparent"
              style={{ backgroundImage: `linear-gradient(to right, ${themeColor}, rgba(${themeRgb}, 0.72))` }}
            >
              {isTakeawayOrder ? 'Order Note' : 'Delivery Instructions'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {isInstructionsEditable ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {isTakeawayOrder
                    ? 'Add a note for the restaurant about your pickup order.'
                    : 'Add instructions for the delivery partner to help them find your address or know where to leave your order.'}
                </p>
                <Textarea
                  value={deliveryInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                  placeholder="E.g. Ring the doorbell, leave at the front desk..."
                  className="min-h-[120px] resize-none border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 text-base focus:ring-2"
                  style={{ "--tw-ring-color": `rgba(${themeRgb}, 0.45)` }}
                />
                <Button
                  onClick={handleUpdateInstructions}
                  disabled={isUpdatingInstructions}
                  className="w-full text-white font-bold h-12 rounded-xl border-none"
                  style={{ backgroundImage: `linear-gradient(to right, ${themeColor}, rgba(${themeRgb}, 0.78))` }}
                >
                  {isUpdatingInstructions ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Save Instructions"}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <span className="leading-relaxed">
                    Instructions can no longer be updated for this order because it has already progressed past the preparation stage.
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    {deliveryInstructions ? "Saved Instructions" : "Instructions"}
                  </label>
                  <Textarea
                    value={deliveryInstructions || "No instructions were provided for this order."}
                    readOnly
                    disabled
                    className="min-h-[100px] resize-none border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-100/80 dark:bg-zinc-800/50 text-gray-600 dark:text-gray-400 text-sm cursor-not-allowed select-text opacity-90"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsInstructionsModalOpen(false)}
                  className="w-full font-bold h-11 rounded-xl border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
                >
                  Close
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

