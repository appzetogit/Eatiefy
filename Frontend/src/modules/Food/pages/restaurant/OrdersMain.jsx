import { useState, useEffect, useLayoutEffect, useRef, memo, Component, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  checkOnboardingStatus,
  isRestaurantOnboardingComplete,
} from "@food/utils/onboardingUtils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Printer,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  X,
  AlertCircle,
  Loader2,
  Calendar,
  Clock,
  Users,
  MessageSquare,
  FileText,
  Search,
  ShoppingBag,
  MapPin,
  RotateCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import BottomNavOrders from "@food/components/restaurant/BottomNavOrders";
import RestaurantNavbar from "@food/components/restaurant/RestaurantNavbar";
import { isDiningEnabled } from "@food/config/featureFlags";
const notificationSound = "/assets/media/restaurant_alert.mp3";
import { restaurantAPI, diningAPI } from "@food/api";
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { setupPdfFonts } from "@food/utils/pdfFontUtils";
import ResendNotificationButton from "@food/components/restaurant/ResendNotificationButton";
import OnboardingExitModal from "@/shared/components/OnboardingExitModal";
import {
  getRestaurantItemLineTotal,
  getRestaurantOrderTotal,
} from "@food/utils/restaurantOrderPricing";
import { resolveMediaUrl } from "@/shared/utils/mediaUrl";
import { formatOrderAddress } from "@food/utils/orderAddress";
const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };

const STORAGE_KEY = "restaurant_online_status";

// Top filter tabs
const filterTabs = [
  { id: "all", label: "All" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "out-for-delivery", label: "Out for delivery" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

// Active statuses come first (group 0), terminal statuses come after (group 1)
const allOrdersStatusGroup = {
  pending: 0,
  confirmed: 0,
  preparing: 0,
  ready: 0,
  out_for_delivery: 0,
  delivered: 1,
  completed: 1,
  picked_up: 1,
  cancelled: 1,
};

// Within active group: lower priority number = higher urgency
const allOrdersStatusPriority = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  out_for_delivery: 4,
  delivered: 6,
  completed: 6,
  picked_up: 6,
  cancelled: 7,
};

const getAllOrdersTimestamp = (order) =>
  order?.cancelledAt ||
  order?.deliveredAt ||
  order?.updatedAt ||
  order?.createdAt ||
  new Date().toISOString();

const TERMINAL_STATUSES = new Set(["delivered", "completed", "picked_up", "cancelled"]);
const HIDDEN_FROM_ORDERS_TAB = new Set([
  "cancelled",
  "canceled",
  "delivered",
  "completed",
  "picked_up",
  "refunded"
]);

const extractOrderImage = (order) => {
  const item = order?.items?.[0] || order?.orderItems?.[0];
  const rawImage =
    item?.image ||
    item?.imageUrl ||
    item?.foodItem?.image ||
    item?.dish?.image ||
    item?.itemImage ||
    item?.foodImage ||
    item?.photo ||
    order?.image ||
    order?.photoUrl ||
    order?.imageUrl ||
    null;
  return resolveMediaUrl(rawImage) || null;
};

const transformOrderForList = (order) => {
  const normalizedStatus = String(order?.status || "").toLowerCase();
  // Filter out cancelled, delivered, refunded, completed orders from front of Orders tab
  if (HIDDEN_FROM_ORDERS_TAB.has(normalizedStatus)) return null;
  const isTerminal = TERMINAL_STATUSES.has(order.status);
  // Dining orders are handled via Dining Booking tab, not the food order list
  if (String(order.orderType || "").toLowerCase() === "dining") return null;
  return {
    orderId: order.orderId || order._id,
    mongoId: order._id,
    status: order.status || "pending",
    customerName: order.userId?.name || order.customerName || "Customer",
    type: order.orderType === "takeaway"
      ? "Takeaway"
      : order.orderType === "dining"
        ? "Dining"
        : "Home Delivery",
    tableOrToken: null,
    timePlaced: new Date(getAllOrdersTimestamp(order)).toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
    ),
    eta: null,
    itemsSummary:
      order.items?.map((item) => `${item.quantity}x ${item.name}${item.variantName ? ` (${item.variantName})` : ''}`).join(", ") ||
      "No items",
    photoUrl: extractOrderImage(order),
    photoAlt: order.items?.[0]?.name || order.orderItems?.[0]?.name || "Order",
    paymentMethod: order.paymentMethod || order.payment?.method || null,
    deliveryPartnerId: order.deliveryPartnerId || null,
    dispatchStatus: order.dispatch?.status || null,
    deliveryPhase: order.deliveryState?.currentPhase || order.deliveryState?.status || null,
    preparingTimestamp: order.tracking?.preparing?.timestamp
      ? new Date(order.tracking.preparing.timestamp)
      : (order.acceptedAt
        ? new Date(order.acceptedAt)
        : new Date(order.createdAt || Date.now())),
    initialETA: order.preparationTime || order.estimatedDeliveryTime || 30,
    // For active orders: sort by creation time (newest first within same status)
    // For terminal orders: sort by the most recent event (cancelledAt/deliveredAt/updatedAt)
    sortTimestamp: isTerminal
      ? new Date(getAllOrdersTimestamp(order)).getTime()
      : new Date(order.createdAt || Date.now()).getTime(),
    restaurantNote: order.restaurantNote || order.note || null,
    acceptedAt: order.acceptedAt || null,
  };
};

// Completed Orders List Component
function CompletedOrders({ onSelectOrder, refreshToken = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    let isMounted = true;

    const fetchOrders = async (primed) => {
      try {
        const response = primed || (await restaurantAPI.getOrders());

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          const completedOrders = response.data.data.orders.filter(
            (order) =>
              order.status === "delivered" || order.status === "completed",
          );

          const transformedOrders = completedOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "delivered",
            customerName: order.userId?.name || order.customerName || "Customer",
            type: order.orderType === "takeaway"
              ? "Takeaway"
              : order.orderType === "dining"
                ? "Dining"
                : "Home Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            deliveredAt:
              order.deliveredAt || order.updatedAt || order.createdAt,
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}${item.variantName ? ` (${item.variantName})` : ''}`)
                .join(", ") || "No items",
            photoUrl: extractOrderImage(order),
            photoAlt: order.items?.[0]?.name || order.orderItems?.[0]?.name || "Order",
            amount: order.pricing?.total || order.total || 0,
            paymentMethod: order.paymentMethod || order.payment?.method || null,
            restaurantNote: order.restaurantNote || order.note || null,
          }));

          transformedOrders.sort((a, b) => {
            const dateA = new Date(a.deliveredAt);
            const dateB = new Date(b.deliveredAt);
            return dateB - dateA;
          });

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching completed orders:", error);
        }

        if (isMounted) {
          // Keep what is on screen: one failed refresh (network blip, server restart)
          // used to wipe the list and flash an empty state until the next success.
          setLoading(false);
        }
      }
    };

    // Paint the last known list immediately (layout effect: before first paint),
    // then revalidate. Switching tabs used to show a blank "Loading..." every
    // time even though the same orders were already in memory.
    const primedResponse = restaurantAPI.peekOrdersCache?.();
    if (primedResponse) fetchOrders(primedResponse);
    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Completed orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Completed orders</h2>
        <span className="text-xs text-gray-500">{orders.length} total</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No completed orders yet
        </div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3">
          {orders.map((order) => {
            const deliveredDate = order.deliveredAt
              ? new Date(order.deliveredAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
              : "N/A";

            return (
              <div
                key={order.orderId || order.mongoId}
                className="w-full bg-white rounded-xl p-3 mb-2.5 border border-gray-100 shadow-sm transition-all">
                <button
                  type="button"
                  onClick={() =>
                    onSelectOrder?.({
                      orderId: order.orderId,
                      status: "Delivered",
                      customerName: order.customerName,
                      type: order.type,
                      tableOrToken: order.tableOrToken,
                      timePlaced: deliveredDate,
                      itemsSummary: order.itemsSummary,
                      paymentMethod: order.paymentMethod,
                    })
                  }
                  className="w-full text-left flex gap-3 items-stretch">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0 my-auto border border-gray-100">
                    {order.photoUrl ? (
                      <img
                        src={order.photoUrl}
                        alt={order.photoAlt}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-1">
                        <span className="text-[9px] font-medium text-gray-400 text-center leading-tight">
                          {order.photoAlt}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-between min-h-[80px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-slate-900 leading-none truncate">
                          Order #{order.orderId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium capitalize truncate">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-600">
                          <span className="h-1 w-1 rounded-full bg-emerald-500" />
                          {order.type === "Takeaway" ? "Picked Up" : "Delivered"}
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium">
                          {deliveredDate}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {order.itemsSummary}
                      </p>
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <p className="text-[11px] text-gray-500">
                          {order.type}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] text-gray-500">
                          Amount
                        </span>
                        <span className="text-xs font-medium text-black">
                          ₹{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Cancelled Orders List Component
function CancelledOrders({ onSelectOrder, refreshToken = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    let isMounted = true;

    const fetchOrders = async (primed) => {
      try {
        const response = primed || (await restaurantAPI.getOrders());

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter cancelled orders (both restaurant and user cancelled)
          const cancelledOrders = response.data.data.orders.filter(
            (order) => order.status === "cancelled",
          );

          const transformedOrders = cancelledOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "cancelled",
            customerName: order.userId?.name || order.customerName || "Customer",
            type: order.orderType === "takeaway"
              ? "Takeaway"
              : order.orderType === "dining"
                ? "Dining"
                : "Home Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            cancelledAt:
              order.cancelledAt || order.updatedAt || order.createdAt,
            cancelledBy: order.cancelledBy || "unknown",
            cancellationReason:
              order.cancellationReason || "No reason provided",
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}${item.variantName ? ` (${item.variantName})` : ''}`)
                .join(", ") || "No items",
            photoUrl: extractOrderImage(order),
            photoAlt: order.items?.[0]?.name || order.orderItems?.[0]?.name || "Order",
            amount: order.pricing?.total || order.total || 0,
            paymentMethod: order.paymentMethod || order.payment?.method || null,
            restaurantNote: order.restaurantNote || order.note || null,
          }));

          transformedOrders.sort((a, b) => {
            const dateA = new Date(a.cancelledAt);
            const dateB = new Date(b.cancelledAt);
            return dateB - dateA;
          });

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching cancelled orders:", error);
        }

        if (isMounted) {
          // Keep what is on screen: one failed refresh (network blip, server restart)
          // used to wipe the list and flash an empty state until the next success.
          setLoading(false);
        }
      }
    };

    // Paint the last known list immediately (layout effect: before first paint),
    // then revalidate. Switching tabs used to show a blank "Loading..." every
    // time even though the same orders were already in memory.
    const primedResponse = restaurantAPI.peekOrdersCache?.();
    if (primedResponse) fetchOrders(primedResponse);
    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Cancelled orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Cancelled orders</h2>
        <span className="text-xs text-gray-500">{orders.length} total</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No cancelled orders yet
        </div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3">
          {orders.map((order) => {
            const cancelledDate = order.cancelledAt
              ? new Date(order.cancelledAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
              : "N/A";

            const cancelledByText =
              order.cancelledBy === "user"
                ? "Cancelled by User"
                : order.cancelledBy === "restaurant"
                  ? "Cancelled by Restaurant"
                  : "Cancelled";

            return (
              <div
                key={order.orderId || order.mongoId}
                className="w-full bg-white rounded-xl p-3 mb-2.5 border border-gray-100 shadow-sm transition-all">
                <button
                  type="button"
                  onClick={() =>
                    onSelectOrder?.({
                      orderId: order.orderId,
                      status: "Cancelled",
                      customerName: order.customerName,
                      type: order.type,
                      tableOrToken: order.tableOrToken,
                      timePlaced: cancelledDate,
                      itemsSummary: order.itemsSummary,
                      paymentMethod: order.paymentMethod,
                    })
                  }
                  className="w-full text-left flex gap-3 items-stretch">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0 my-auto border border-gray-100">
                    {order.photoUrl ? (
                      <img
                        src={order.photoUrl}
                        alt={order.photoAlt}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-1">
                        <span className="text-[9px] font-medium text-gray-400 text-center leading-tight">
                          {order.photoAlt}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-between min-h-[80px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-slate-900 leading-none truncate">
                          Order #{order.orderId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium capitalize truncate">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${order.cancelledBy === "user"
                              ? "border-orange-200 bg-orange-50 text-orange-600"
                              : "border-rose-200 bg-rose-50 text-rose-600"
                            }`}>
                          <span
                            className={`h-1 w-1 rounded-full ${order.cancelledBy === "user"
                                ? "bg-orange-500"
                                : "bg-rose-500"
                              }`}
                          />
                          {cancelledByText}
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium">
                          {cancelledDate}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {order.itemsSummary}
                      </p>
                      {order.cancellationReason && (
                        <p className="text-[10px] text-[#2E7D52] mt-1 line-clamp-1">
                          Reason: {order.cancellationReason}
                        </p>
                      )}
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <p className="text-[11px] text-gray-500">
                          {order.type}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] text-gray-500">
                          Amount
                        </span>
                        <span className="text-xs font-medium text-black">
                          ₹{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Table Bookings List Component
function TableBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const handleStatusUpdate = async (bookingId, newStatus) => {
    try {
      const response = await diningAPI.updateBookingStatusRestaurant(bookingId, newStatus);
      if (response.data.success) {
        setBookings(prev => prev.map(b =>
          b._id === bookingId ? { ...b, status: newStatus } : b
        ));
        toast.success(`Booking ${newStatus === 'accepted' ? 'accepted' : 'declined'}`);
      }
    } catch (error) {
      debugError("Error updating booking status:", error);
      toast.error("Failed to update booking status");
    }
  };

  useEffect(() => {
    let isMounted = true;
    let cachedRestaurant = null;

    const fetchBookings = async () => {
      try {
        let restaurant = cachedRestaurant;
        if (!restaurant) {
          const res = await restaurantAPI.getCurrentRestaurant();
          restaurant = res.data?.data?.restaurant || res.data?.restaurant || res.data?.data;
          cachedRestaurant = restaurant;
        }
        const restaurantId = restaurant?._id || restaurant?.id;

        if (restaurantId) {
          const response = await diningAPI.getRestaurantBookings(restaurant);
          if (isMounted && response.data.success) {
            setBookings(response.data.data);
          }
        }
      } catch (error) {
        debugError("Error fetching table bookings:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchBookings();
    const interval = setInterval(fetchBookings, 8000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await restaurantAPI.getCurrentRestaurant();
      const restaurant = res.data?.data?.restaurant || res.data?.restaurant || res.data?.data;
      const response = await diningAPI.getRestaurantBookings(restaurant);
      if (response.data.success) {
        setBookings(response.data.data);
        toast.success("Bookings refreshed");
      }
    } catch {
      toast.error("Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  const pendingCount = bookings.filter(b => String(b.status).toLowerCase() === 'pending').length;

  if (loading)
    return (
      <div className="text-center py-10 text-gray-400">Loading bookings...</div>
    );

  return (
    <div className="pt-4 pb-6 px-1">
      <div className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="text-base font-semibold text-black">Dining Bookings</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="text-[10px] font-black text-primary-orange uppercase tracking-widest hover:opacity-80 transition-opacity"
          >
            Refresh
          </button>
          <span className="text-xs text-gray-500 font-medium">({bookings.length})</span>
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
          <p className="text-gray-400 text-sm">No dining bookings yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const statusConfig = (() => {
              const s = String(booking.status || '').toLowerCase();
              if (s === 'pending') {
                return {
                  style: { color: '#2E7D52', backgroundColor: '#FDF2F4', borderColor: '#FBCFE8' },
                  text: 'APPROVAL REQ'
                };
              }
              if (['accepted', 'confirmed'].includes(s)) {
                return {
                  style: { color: '#15803D', backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
                  text: 'CONFIRMED'
                };
              }
              if (s === 'checked-in') {
                return {
                  style: { color: '#F97316', backgroundColor: '#FFF7ED', borderColor: '#FFEDD5' },
                  text: 'CHECKED-IN'
                };
              }
              if (s === 'completed') {
                return {
                  style: { color: '#3B82F6', backgroundColor: '#EFF6FF', borderColor: '#DBEAFE' },
                  text: 'COMPLETED'
                };
              }
              // cancelled/rejected/declined
              return {
                style: { color: '#B91C1C', backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
                text: 'CANCELLED'
              };
            })();

            return (
              <div
                key={booking._id}
                className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm transition-all hover:border-gray-300">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-gray-900">
                      {booking.user?.name}
                    </h3>
                    <p className="text-[11px] text-gray-500">
                      {booking.user?.phone || "No phone"}
                    </p>
                  </div>
                  <span
                    style={statusConfig.style}
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border shadow-sm"
                  >
                    {statusConfig.text}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-[11px] text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span>
                      {new Date(booking.date).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    <span>{booking.timeSlot}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span>{booking.guests} Guests</span>
                  </div>
                </div>

                {booking.specialRequest && (
                  <div className="mt-3 p-2 bg-blue-50/50 rounded-lg border border-blue-100/50">
                    <p className="text-[10px] text-blue-700 italic flex items-start gap-1">
                      <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                      <span className="line-clamp-2">
                        {booking.specialRequest}
                      </span>
                    </p>
                  </div>
                )}

                {String(booking.status || '').toLowerCase() === 'pending' && (
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => handleStatusUpdate(booking._id, 'accepted')}
                      className="flex-1 py-2 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white text-[11px] font-black rounded-xl hover:opacity-95 transition-opacity uppercase tracking-widest shadow-sm"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleStatusUpdate(booking._id, 'cancelled')}
                      className="flex-1 py-2 bg-white border border-rose-200 text-slate-600 text-[11px] font-black rounded-xl hover:bg-slate-50 transition-colors uppercase tracking-widest"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AllOrders({ onSelectOrder, onCancel, onVerifyTakeaway, refreshToken = 0 }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [markingReadyOrderIds, setMarkingReadyOrderIds] = useState({});

  useLayoutEffect(() => {
    let isMounted = true;
    let intervalId = null;
    let countdownIntervalId = null;

    const fetchOrders = async (primed) => {
      try {
        const response = primed || (await restaurantAPI.getOrders());

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          const transformedOrders = response.data.data.orders
            .map(transformOrderForList)
            .filter(Boolean)
            .sort((a, b) => {
              // Group 0 = active orders, Group 1 = terminal (delivered/cancelled)
              const groupA = allOrdersStatusGroup[a.status] ?? 0;
              const groupB = allOrdersStatusGroup[b.status] ?? 0;
              if (groupA !== groupB) return groupA - groupB;

              if (groupA === 0) {
                // Within active orders: sort by status urgency first, then newest created first
                const priorityDiff =
                  (allOrdersStatusPriority[a.status] ?? 999) -
                  (allOrdersStatusPriority[b.status] ?? 999);
                if (priorityDiff !== 0) return priorityDiff;
                return b.sortTimestamp - a.sortTimestamp;
              } else {
                // Within terminal orders: sort purely by most recent event (newest first)
                return b.sortTimestamp - a.sortTimestamp;
              }
            });

          setOrders(transformedOrders);
        } else {
          setOrders([]);
        }
      } catch (error) {
        if (!isMounted) return;

        if (
          error.code !== "ERR_NETWORK" &&
          error.response?.status !== 404 &&
          error.response?.status !== 401
        ) {
          debugError("Error fetching all orders:", error);
        }

        // Keep what is on screen: one failed refresh (network blip, server restart)
        // used to wipe the list and flash an empty state until the next success.
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    // Paint the last known list immediately (layout effect: before first paint),
    // then revalidate. Switching tabs used to show a blank "Loading..." every
    // time even though the same orders were already in memory.
    const primedResponse = restaurantAPI.peekOrdersCache?.();
    if (primedResponse) fetchOrders(primedResponse);
    fetchOrders();
    intervalId = setInterval(fetchOrders, 10000);

    const handleVisibility = () => {
      if (!document.hidden) {
        fetchOrders();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    countdownIntervalId = setInterval(() => {
      if (isMounted) {
        setCurrentTime(new Date());
      }
    }, 1000);

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
      if (countdownIntervalId) clearInterval(countdownIntervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshToken]);

  const handleMarkReady = async ({ orderId, mongoId }) => {
    const orderKey = mongoId || orderId;
    if (!orderKey || markingReadyOrderIds[orderKey]) return;

    try {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: true }));
      await restaurantAPI.markOrderReady(orderKey);
      setOrders((prev) =>
        prev.map((order) =>
          (order.mongoId || order.orderId) === orderKey
            ? {
              ...order,
              status: "ready",
              eta: null,
              sortTimestamp: Date.now(),
            }
            : order,
        ),
      );
      toast.success("Order marked as ready");
    } catch (error) {
      debugError("Error marking order as ready from All orders:", error);
      toast.error(
        error.response?.data?.message || "Failed to mark order as ready",
      );
    } finally {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: false }));
    }
  };

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">All orders</h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-black">All orders</h2>
          <span className="text-xs text-gray-500">({orders.length})</span>
        </div>
        <button
          onClick={() => navigate('/food/restaurant/orders/all', { state: { from: '/food/restaurant' } })}
          className="text-xs font-bold text-[#2E7D52] hover:underline flex items-center gap-1"
        >
          Full History
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders found
        </div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3">
          {orders.map((order) => {
            const normalizedStatus = String(order.status || "").toLowerCase();
            let etaDisplay = order.eta;

            if (normalizedStatus === "preparing" && order.preparingTimestamp) {
              const elapsedMs = currentTime - order.preparingTimestamp;
              const remainingMs = order.initialETA * 60000 - elapsedMs;
              const remainingMinutes = Math.ceil(remainingMs / 60000);

              if (remainingMinutes <= 0) {
                etaDisplay = "0 mins";
              } else {
                etaDisplay = `${remainingMinutes} mins`;
              }
            }

            return (
              <OrderCard
                key={order.orderId || order.mongoId}
                {...order}
                eta={etaDisplay}
                onSelect={onSelectOrder}
                onCancel={
                  normalizedStatus === "preparing" ? onCancel : undefined
                }
                onMarkReady={
                  normalizedStatus === "preparing" ? handleMarkReady : undefined
                }
                isMarkingReady={Boolean(
                  markingReadyOrderIds[order.mongoId || order.orderId],
                )}
                onVerifyTakeaway={onVerifyTakeaway}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Takeaway Orders Component — same data as AllOrders but filtered to Takeaway type only
function TakeawayOrders({ onSelectOrder, onCancel, onVerifyTakeaway, refreshToken = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [markingReadyOrderIds, setMarkingReadyOrderIds] = useState({});

  useLayoutEffect(() => {
    let isMounted = true;
    let intervalId = null;
    let countdownIntervalId = null;

    const fetchOrders = async (primed) => {
      try {
        const response = primed || (await restaurantAPI.getOrders());
        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          const transformedOrders = response.data.data.orders
            .filter((o) => String(o.orderType || '').toLowerCase() === 'takeaway')
            .map(transformOrderForList)
            .filter(Boolean)
            .sort((a, b) => {
              const groupA = allOrdersStatusGroup[a.status] ?? 0;
              const groupB = allOrdersStatusGroup[b.status] ?? 0;
              if (groupA !== groupB) return groupA - groupB;
              if (groupA === 0) {
                const priorityDiff =
                  (allOrdersStatusPriority[a.status] ?? 999) -
                  (allOrdersStatusPriority[b.status] ?? 999);
                if (priorityDiff !== 0) return priorityDiff;
                return b.sortTimestamp - a.sortTimestamp;
              }
              return b.sortTimestamp - a.sortTimestamp;
            });

          setOrders(transformedOrders);
        } else {
          setOrders([]);
        }
      } catch (error) {
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404 && error.response?.status !== 401) {
          debugError('Error fetching takeaway orders:', error);
        }
        // Keep what is on screen: one failed refresh (network blip, server restart)
        // used to wipe the list and flash an empty state until the next success.
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    // Paint the last known list immediately (layout effect: before first paint),
    // then revalidate. Switching tabs used to show a blank "Loading..." every
    // time even though the same orders were already in memory.
    const primedResponse = restaurantAPI.peekOrdersCache?.();
    if (primedResponse) fetchOrders(primedResponse);
    fetchOrders();
    intervalId = setInterval(fetchOrders, 10000);
    const handleVisibility = () => { if (!document.hidden) fetchOrders(); };
    document.addEventListener('visibilitychange', handleVisibility);
    countdownIntervalId = setInterval(() => { if (isMounted) setCurrentTime(new Date()); }, 1000);

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
      if (countdownIntervalId) clearInterval(countdownIntervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshToken]);

  const handleMarkReady = async ({ orderId, mongoId }) => {
    const orderKey = mongoId || orderId;
    if (!orderKey || markingReadyOrderIds[orderKey]) return;
    try {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: true }));
      await restaurantAPI.markOrderReady(orderKey);
      setOrders((prev) =>
        prev.map((order) =>
          (order.mongoId || order.orderId) === orderKey
            ? { ...order, status: 'ready', eta: null, sortTimestamp: Date.now() }
            : order,
        ),
      );
      toast.success('Order marked as ready');
    } catch (error) {
      debugError('Error marking takeaway order as ready:', error);
      toast.error(error.response?.data?.message || 'Failed to mark order as ready');
    } finally {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: false }));
    }
  };

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">Takeaway orders</h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-black">Takeaway orders</h2>
          <span className="text-xs text-gray-500">({orders.length})</span>
        </div>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">No takeaway orders found</div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3">
          {orders.map((order) => {
            const normalizedStatus = String(order.status || '').toLowerCase();
            let etaDisplay = order.eta;
            if (normalizedStatus === 'preparing' && order.preparingTimestamp) {
              const elapsedMs = currentTime - order.preparingTimestamp;
              const remainingMs = order.initialETA * 60000 - elapsedMs;
              const remainingMinutes = Math.ceil(remainingMs / 60000);
              if (remainingMinutes <= 0) {
                etaDisplay = '0 mins';
              } else {
                etaDisplay = `${remainingMinutes} mins`;
              }
            }
            return (
              <OrderCard
                key={order.orderId || order.mongoId}
                {...order}
                eta={etaDisplay}
                onSelect={onSelectOrder}
                onCancel={normalizedStatus === 'preparing' ? onCancel : undefined}
                onMarkReady={normalizedStatus === 'preparing' ? handleMarkReady : undefined}
                isMarkingReady={Boolean(markingReadyOrderIds[order.mongoId || order.orderId])}
                onVerifyTakeaway={onVerifyTakeaway}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Search Results Component
function SearchResults({ query, results, isLoading, onSelectOrder, onVerifyTakeaway }) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary-orange mb-4" />
        <p className="text-gray-500 text-sm">Searching for "{query}"...</p>
      </div>
    );
  }

  const transformedResults = (results || []).map(transformOrderForList);

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-semibold text-black">Search results for</h2>
        <span className="bg-gray-200 px-2 py-0.5 rounded text-sm text-gray-700 italic">"{query}"</span>
        <span className="text-xs text-gray-500 font-medium ml-1">({transformedResults.length})</span>
      </div>

      {transformedResults.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-gray-300" />
          </div>
          <p className="text-gray-900 font-bold mb-1">No results found</p>
          <p className="text-gray-500 text-xs">Try searching for a different order ID or customer name</p>
        </div>
      ) : (
        <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3 md:gap-y-3">
          {transformedResults.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
              onVerifyTakeaway={onVerifyTakeaway}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Helper to calculate initial countdown based on order creation time
const isTakeawayOrder = (order) =>
  String(order?.orderType || order?.type || "").toLowerCase() === "takeaway";

/**
 * True while an order is still waiting for the restaurant to accept or reject.
 * `restaurantAPI.getOrders` maps the backend "created" to "confirmed" in
 * `status` for the UI tabs, so the raw backend `orderStatus` decides.
 */
const isAwaitingRestaurantDecision = (order) => {
  const raw = String(order?.orderStatus || "").toLowerCase();
  if (raw) return raw === "created" || raw === "pending";
  const ui = String(order?.status || "").toLowerCase();
  return ui === "created" || ui === "pending";
};

/** Fallback accept window when admin settings are missing or unreachable. */
const DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS = 10 * 60;
const OTHER_REJECT_REASON = "Other reason";
// Same limit the server enforces on a cancellation reason.
const MAX_CUSTOM_REASON_LENGTH = 150;

/** Required free-text reason, shown when "Other reason" is picked. */
function CustomReasonInput({ id, value, onChange, disabled }) {
  const containerRef = useRef(null);
  const textareaRef = useRef(null);
  const isEmpty = !String(value || "").trim();

  const scrollToCenter = useCallback(() => {
    if (!containerRef.current) return;
    try {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    } catch (_) {
      try {
        containerRef.current.scrollIntoView(false);
      } catch (_) {}
    }
  }, []);

  useEffect(() => {
    // Scroll immediately on render and again after on-screen keyboard finishes popping up
    const t1 = setTimeout(scrollToCenter, 60);
    const t2 = setTimeout(scrollToCenter, 250);
    const t3 = setTimeout(scrollToCenter, 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [scrollToCenter]);

  return (
    <div ref={containerRef} className="mt-3 scroll-mt-6 pb-2">
      <label htmlFor={id} className="block text-sm font-medium text-gray-900 mb-1.5">
        Enter reason <span className="text-red-600">*</span>
      </label>
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_CUSTOM_REASON_LENGTH))}
        onFocus={() => {
          setTimeout(scrollToCenter, 100);
          setTimeout(scrollToCenter, 300);
        }}
        onClick={() => {
          setTimeout(scrollToCenter, 100);
        }}
        maxLength={MAX_CUSTOM_REASON_LENGTH}
        rows={3}
        required
        autoFocus
        disabled={disabled}
        aria-invalid={isEmpty}
        placeholder="Type the reason"
        className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#2E7D52] resize-none disabled:opacity-60 bg-white shadow-sm"
      />
      <div className="mt-1 flex justify-between text-xs">
        <span className={isEmpty ? "text-red-600 font-medium" : "text-transparent"}>Reason is required</span>
        <span className="text-gray-500">
          {String(value || "").length}/{MAX_CUSTOM_REASON_LENGTH}
        </span>
      </div>
    </div>
  );
}

const resolveAcceptOrderTimeoutSeconds = (
  order,
  deliveryTimeoutSeconds,
  takeawayTimeoutSeconds,
) => {
  if (isTakeawayOrder(order)) return takeawayTimeoutSeconds;
  return deliveryTimeoutSeconds;
};

/**
 * The accept window counts from when the restaurant was first sent the order
 * (restaurantNotifiedAt). For online payments that is after payment, so counting
 * from createdAt used to hand the restaurant a window that was already partly gone.
 */
const getAcceptWindowStartMs = (order) => {
  const raw = order?.restaurantNotifiedAt || order?.createdAt;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const getInitialCountdown = (order, timeoutSeconds) => {
  if (!timeoutSeconds || timeoutSeconds <= 0) return 0;
  const start = getAcceptWindowStartMs(order);
  if (start == null) return timeoutSeconds;
  const remaining = Math.ceil((start + timeoutSeconds * 1000 - Date.now()) / 1000);
  return Math.max(0, Math.min(timeoutSeconds, remaining));
}

class OrdersErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[OrdersMain] Render error:', error, info);
    this.setState({ stack: error?.stack || '', componentStack: info?.componentStack || '' });
  }
  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || 'Unknown error';
      const stack = this.state.stack || '';
      const comp = this.state.componentStack || '';
      return (
        <div style={{ padding: 16, background: '#fff', minHeight: '100dvh', overflowY: 'auto' }}>
          <h2 style={{ color: '#2E7D52', fontWeight: 700, marginBottom: 8, fontSize: 16 }}>Something went wrong</h2>
          <p style={{ fontSize: 12, color: '#2E7D52', fontWeight: 600, marginBottom: 8, wordBreak: 'break-all' }}>{msg}</p>
          {stack ? (
            <pre style={{ fontSize: 9, color: '#555', background: '#f5f5f5', padding: 8, borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 8 }}>
              {stack.slice(0, 800)}
            </pre>
          ) : null}
          {comp ? (
            <pre style={{ fontSize: 9, color: '#777', background: '#fafafa', padding: 8, borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 12 }}>
              {comp.slice(0, 400)}
            </pre>
          ) : null}
          <button
            onClick={() => { this.setState({ hasError: false, error: null, stack: '', componentStack: '' }); window.location.reload(); }}
            style={{ padding: '10px 20px', background: '#2E7D52', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function OrdersMainInner() {
  const navigate = useNavigate();
  // Restaurant notifications hook for real-time orders
  const {
    newOrder,
    clearNewOrder,
    isConnected,
    stopSound,
    startAlertLoop,
    mutedOrderIds = new Set(),
    muteOrders,
    unmuteOrder,
  } = useRestaurantNotifications();
  const [activeFilter, setActiveFilter] = useState("all");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [showExitAppModal, setShowExitAppModal] = useState(false);
  const isSheetOpenRef = useRef(false);
  isSheetOpenRef.current = isSheetOpen;
  const showExitAppModalRef = useRef(false);
  showExitAppModalRef.current = showExitAppModal;
  const orderModalPushedRef = useRef(false);
  const rootGuardPushedRef = useRef(false);

  const showRejectPopupRef = useRef(false);
  const showCancelPopupRef = useRef(false);
  const showVerifyTakeawayPopupRef = useRef(false);
  const contentRef = useRef(null);
  const filterBarRef = useRef(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);
  const mouseStartX = useRef(0);
  const mouseEndX = useRef(0);
  const isMouseDown = useRef(false);

  // Refresh & Pull-to-refresh states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef(0);
  const isPullGestureActiveRef = useRef(false);

  // New order popup states
  const [showNewOrderPopup, setShowNewOrderPopup] = useState(false);
  const [popupOrder, setPopupOrder] = useState(null); // Store order for popup (from Socket.IO or API)
  const [prepTime, setPrepTime] = useState(11);
  const [deliveryAcceptOrderTimeoutSeconds, setDeliveryAcceptOrderTimeoutSeconds] = useState(DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
  const [takeawayAcceptOrderTimeoutSeconds, setTakeawayAcceptOrderTimeoutSeconds] = useState(DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
  const deliveryAcceptOrderTimeoutSecondsRef = useRef(DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
  const takeawayAcceptOrderTimeoutSecondsRef = useRef(DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
  const [countdown, setCountdown] = useState(0);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [showRejectPopup, setShowRejectPopup] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectOtherText, setRejectOtherText] = useState("");
  const [isRejectingOrder, setIsRejectingOrder] = useState(false);
  const [showCancelPopup, setShowCancelPopup] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOtherText, setCancelOtherText] = useState("");
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [acceptSwipeProgress, setAcceptSwipeProgress] = useState(0);
  const [orderQueue, setOrderQueue] = useState([]);
  const orderQueueRef = useRef([]);
  const autoRejectInitiatedRef = useRef(false);

  useEffect(() => {
    orderQueueRef.current = orderQueue;
  }, [orderQueue]);

  useEffect(() => {
    deliveryAcceptOrderTimeoutSecondsRef.current = deliveryAcceptOrderTimeoutSeconds;
  }, [deliveryAcceptOrderTimeoutSeconds]);

  useEffect(() => {
    takeawayAcceptOrderTimeoutSecondsRef.current = takeawayAcceptOrderTimeoutSeconds;
  }, [takeawayAcceptOrderTimeoutSeconds]);

  useEffect(() => {
    let cancelled = false;

    const loadRestaurantSettings = async () => {
      try {
        const res = await restaurantAPI.getRestaurantSettings();
        const data = res?.data?.data || {};
        const deliveryMinutes = Number(data.deliveryAcceptOrderTimeMinutes);
        const takeawayMinutes = Number(data.takeawayAcceptOrderTimeMinutes);

        if (!cancelled) {
          if (Number.isFinite(deliveryMinutes) && deliveryMinutes >= 1 && deliveryMinutes <= 60) {
            setDeliveryAcceptOrderTimeoutSeconds(Math.round(deliveryMinutes) * 60);
          } else {
            setDeliveryAcceptOrderTimeoutSeconds(DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
          }

          if (Number.isFinite(takeawayMinutes) && takeawayMinutes >= 1 && takeawayMinutes <= 60) {
            setTakeawayAcceptOrderTimeoutSeconds(Math.round(takeawayMinutes) * 60);
          } else {
            setTakeawayAcceptOrderTimeoutSeconds(DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
          }
        }
      } catch (error) {
        debugError("Failed to load restaurant accept order time:", error);
        // Never let a settings failure hide incoming orders — the popup is
        // gated on this value, so fall back instead of leaving it unset.
        if (!cancelled) {
          setDeliveryAcceptOrderTimeoutSeconds((prev) => prev ?? DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
          setTakeawayAcceptOrderTimeoutSeconds((prev) => prev ?? DEFAULT_ACCEPT_ORDER_TIMEOUT_SECONDS);
        }
      }
    };

    loadRestaurantSettings();
    const refreshInterval = setInterval(loadRestaurantSettings, 30000);
    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
    };
  }, []);

  // Manage displaying the next order from the queue with a slight delay
  useEffect(() => {
    if (!showNewOrderPopup && orderQueue.length > 0 && !showRejectPopup) {
      const timer = setTimeout(() => {
        if (!showNewOrderPopupRef.current && orderQueueRef.current.length > 0 && !showRejectPopup) {
          const nextOrder = orderQueueRef.current[0];
          const activeTimeout = resolveAcceptOrderTimeoutSeconds(
            nextOrder,
            deliveryAcceptOrderTimeoutSecondsRef.current,
            takeawayAcceptOrderTimeoutSecondsRef.current,
          );
          if (!activeTimeout || activeTimeout <= 0) return;
          setPopupOrder(nextOrder);
          setShowNewOrderPopup(true);
          setCountdown(getInitialCountdown(nextOrder, activeTimeout));
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [
    orderQueue,
    showNewOrderPopup,
    showRejectPopup,
    deliveryAcceptOrderTimeoutSeconds,
    takeawayAcceptOrderTimeoutSeconds,
  ]);

  // Ring while any unmuted order is waiting: in the popup, just arrived, or queued.
  // This used to stop the ringtone whenever the popup was not yet open - the
  // socket started it, then this effect killed it during the 800ms before the
  // popup appeared, so the alert started late and choppy (and not at all on
  // devices that block the second autoplay attempt).
  useEffect(() => {
    // A cancelled order (shown briefly as "cancelled" in the popup) never rings.
    const canRing = (order) =>
      Boolean(order) && !isAnyCancelledStatus(order?.orderStatus || order?.status);
    const activeOrder = showNewOrderPopup ? popupOrder || newOrder : newOrder;
    const activeId = resolveOrderActionId(activeOrder);
    
    let soundingOrder = null;
    if (canRing(activeOrder) && activeId && !mutedOrderIds.has(activeId)) {
      soundingOrder = activeOrder;
    } else {
      // Find first unmuted order in queue
      for (const order of orderQueue) {
        const oid = resolveOrderActionId(order);
        if (canRing(order) && oid && !mutedOrderIds.has(oid)) {
          soundingOrder = order;
          break;
        }
      }
    }

    if (soundingOrder) {
      if (startAlertLoop) {
        startAlertLoop(soundingOrder);
      }
    } else {
      if (stopSound) {
        stopSound();
      }
    }
  }, [showNewOrderPopup, popupOrder, newOrder, orderQueue, mutedOrderIds, startAlertLoop, stopSound]);

  // Takeaway OTP verification states
  const [showVerifyTakeawayPopup, setShowVerifyTakeawayPopup] = useState(false);
  const [verifyingOrder, setVerifyingOrder] = useState(null);
  const [takeawayOtpInput, setTakeawayOtpInput] = useState("");
  const [isSubmittingVerifyTakeaway, setIsSubmittingVerifyTakeaway] = useState(false);
  const otpInputRef = useRef(null);
  // Tracks how much the iOS/Android software keyboard is covering the
  // viewport so the OTP sheet can lift itself clear of it instead of
  // getting clipped/overlapped by the keyboard + accessory bar.
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);
  const shownOrdersRef = useRef(new Set()); // Track orders already shown in popup
  const acceptSliderRef = useRef(null);
  const acceptSwipeStartXRef = useRef(0);
  const acceptSwipeActiveRef = useRef(false);
  // Latest drag progress, readable synchronously from pointer handlers (state lags a render).
  const acceptSwipeProgressRef = useRef(0);
  const acceptPointerIdRef = useRef(null);
  // Claimed synchronously so a release + click or a double gesture cannot accept twice.
  const acceptInFlightRef = useRef(false);
  const [isAcceptSwipeDragging, setIsAcceptSwipeDragging] = useState(false);
  const [restaurantStatus, setRestaurantStatus] = useState({
    isActive: null,
    rejectionReason: null,
    onboarding: null,
    isLoading: true,
  });
  const [isReverifying, setIsReverifying] = useState(false);
  const showNewOrderPopupRef = useRef(showNewOrderPopup);
  const isMutedRef = useRef(false);
  const newOrderRef = useRef(null);

  // Pending counts for tabs
  const [pendingBookingsCount, setPendingBookingsCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [activeTakeawayCount, setActiveTakeawayCount] = useState(0);
  const [pendingDiningRequest, setPendingDiningRequest] = useState(null);

  // Fetch pending counts and settings
  const fetchCounts = useCallback(async () => {
    try {
      // Fetch current restaurant data
      const resRes = await restaurantAPI.getCurrentRestaurant();
      const restaurantData = resRes.data?.data?.restaurant || resRes.data?.restaurant || resRes.data?.data;

      if (restaurantData?._id || restaurantData?.id) {
        if (isDiningEnabled()) {
          // 1. Fetch bookings
          const res = await diningAPI.getRestaurantBookings(restaurantData);
          if (res.data?.success) {
            const bookings = Array.isArray(res.data.data) ? res.data.data : [];
            const pending = bookings.filter(b => String(b.status).toLowerCase() === 'pending').length;

            setPendingBookingsCount((prev) => {
              if (pending > prev && prev > 0) {
                toast.info(`New dining booking request! Check the "Dining Booking" tab.`);
              }
              return pending;
            });
          }

          // 2. Fetch pending dining request (for restaurant's own request to enable/update dining)
          const requestRes = await restaurantAPI.getPendingDiningRequest();
          if (requestRes.data?.success && requestRes.data.data) {
            setPendingDiningRequest(requestRes.data.data);
          } else {
            setPendingDiningRequest(null);
          }
        }
      }

      // 3. Fetch pending orders
      const ordersRes = await restaurantAPI.getOrders({ page: 1, limit: 100 });
      if (ordersRes.data?.success) {
        const orders = Array.isArray(ordersRes.data.data?.orders) ? ordersRes.data.data.orders : [];
        const pending = orders.filter(o =>
          String(o.status).toLowerCase() === 'pending' ||
          String(o.status).toLowerCase() === 'created' ||
          String(o.status).toLowerCase() === 'confirmed'
        ).length;
        setPendingOrdersCount(pending);

        // Count active (non-terminal) takeaway orders for the button badge
        const activeStatuses = new Set(['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'created']);
        const takeawayActive = orders.filter(o =>
          (String(o.orderType || '').toLowerCase() === 'takeaway') &&
          activeStatuses.has(String(o.status || o.orderStatus || '').toLowerCase())
        ).length;
        setActiveTakeawayCount(takeawayActive);
      }
    } catch (error) {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [fetchCounts]);

  const handleManualRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      restaurantAPI.invalidateOrdersCache?.();
      setOrdersRefreshToken((t) => t + 1);
      await fetchCounts();
      await new Promise((resolve) => setTimeout(resolve, 450));
      toast.success("Orders refreshed", { id: "orders-refresh-toast", duration: 1500 });
    } catch (err) {
      console.error("Refresh error:", err);
      toast.error("Failed to refresh orders");
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
      isPullGestureActiveRef.current = false;
    }
  }, [isRefreshing, fetchCounts]);

  // Global search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Global search listener
  useEffect(() => {
    const handleSearch = (event) => {
      const { query, results, isLoading } = event.detail;
      setSearchQuery(query || "");
      setSearchResults(results || []);
      setIsSearching(isLoading || false);
    };

    window.addEventListener("restaurantSearchUpdated", handleSearch);
    return () =>
      window.removeEventListener("restaurantSearchUpdated", handleSearch);
  }, []);

  const markOrderAsShown = (orderLike) => {
    const keys = [
      orderLike?.orderMongoId,
      orderLike?.orderId,
      orderLike?._id,
      orderLike?.id,
    ]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);

    for (const k of keys) shownOrdersRef.current.add(k);
  };

  const hasOrderBeenShown = (orderLike) => {
    const keys = [
      orderLike?.orderMongoId,
      orderLike?.orderId,
      orderLike?._id,
      orderLike?.id,
    ]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);

    return keys.some((k) => shownOrdersRef.current.has(k));
  };

  const resolveOrderActionId = (orderLike) => {
    const raw =
      orderLike?.orderMongoId ||
      orderLike?._id ||
      orderLike?.orderId ||
      orderLike?.order_id ||
      orderLike?.id;
    const value = raw == null ? "" : String(raw).trim();
    return value || null;
  };

  const normalizeOrderStatusValue = (value) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_");

  const isUserCancelledStatus = (statusValue) =>
    normalizeOrderStatusValue(statusValue) === "cancelled_by_user";

  const isAnyCancelledStatus = (statusValue) => {
    const normalized = normalizeOrderStatusValue(statusValue);
    return (
      normalized === "cancelled" ||
      normalized === "cancelled_by_user" ||
      normalized === "cancelled_by_restaurant" ||
      normalized === "cancelled_by_admin"
    );
  };

  const getPopupOrderTotal = getRestaurantOrderTotal;

  const getRestaurantItemAmount = getRestaurantItemLineTotal;

  const lastOrderToastRef = useRef({ key: "", at: 0 });

  // Mobile error logging — only async rejections (safe, fires outside render)
  useEffect(() => {
    const handleRejection = (event) => {
      const reason = event?.reason?.message || String(event?.reason || 'Promise rejected');
      console.error('[OrdersMain] unhandledrejection:', event?.reason);
      setTimeout(() => {
        toast.error(`[Async Error] ${reason}`, { duration: 10000, id: 'async-error' });
      }, 100);
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  const rejectReasons = [
    "Restaurant is too busy",
    "Item not available",
    "Outside delivery area",
    "Kitchen closing soon",
    "Technical issue",
    OTHER_REJECT_REASON,
  ];
  // "Other reason" sends what the restaurant typed, never the label itself.
  const resolveReasonText = (reason, otherText) =>
    reason === OTHER_REJECT_REASON ? String(otherText || "").trim() : reason;
  const effectiveRejectReason = resolveReasonText(rejectReason, rejectOtherText);
  const effectiveCancelReason = resolveReasonText(cancelReason, cancelOtherText);

  // Fetch restaurant verification status
  useEffect(() => {
    const fetchRestaurantStatus = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant();
        const restaurant =
          response?.data?.data?.restaurant || response?.data?.restaurant;

        if (restaurant) {
          // Log restaurant status for debugging redirection issues
          console.log("🏪 [OrdersMain] Restaurant Status Check:", {
            id: restaurant._id || restaurant.restaurantId,
            status: restaurant.status,
            isActive: restaurant.isActive,
            hasOnboarding: !!restaurant.onboarding
          });

          setRestaurantStatus({
            isActive: restaurant.isActive,
            rejectionReason: restaurant.rejectionReason || null,
            onboarding: restaurant.onboarding || null,
            isLoading: false,
          });

          // Check if onboarding is incomplete and redirect if needed
          // isRestaurantOnboardingComplete now handles 'pending' and existing restaurant IDs
          if (!isRestaurantOnboardingComplete(restaurant)) {
            console.warn("⚠️ [OrdersMain] Onboarding detected as INCOMPLETE. Checking next step...");

            const incompleteStep = await checkOnboardingStatus();

            if (incompleteStep) {
              console.log(`🚀 [OrdersMain] Redirecting to onboarding step ${incompleteStep}`);
              navigate(`/food/restaurant/onboarding?step=${incompleteStep}`, {
                replace: true,
              });
              return;
            } else {
              console.log("✅ [OrdersMain] No incomplete step found, staying on dashboard.");
            }
          } else {
            console.log("✅ [OrdersMain] Onboarding is COMPLETE. No redirect needed.");
          }
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (
          error.code !== "ERR_NETWORK" &&
          error.code !== "ECONNABORTED" &&
          !error.message?.includes("timeout")
        ) {
          debugError("Error fetching restaurant status:", error);
        }
        // Set loading to false so UI doesn't stay in loading state
        setRestaurantStatus((prev) => ({ ...prev, isLoading: false }));
      }
    };

    fetchRestaurantStatus();

    // Listen for restaurant profile updates
    const handleProfileRefresh = () => {
      fetchRestaurantStatus();
    };

    window.addEventListener("restaurantProfileRefresh", handleProfileRefresh);

    return () => {
      window.removeEventListener(
        "restaurantProfileRefresh",
        handleProfileRefresh,
      );
    };
  }, [navigate]);

  // Handle reverify (resubmit for approval)
  const handleReverify = async () => {
    try {
      setIsReverifying(true);
      await restaurantAPI.reverify();

      // Refresh restaurant status
      const response = await restaurantAPI.getCurrentRestaurant();
      const restaurant =
        response?.data?.data?.restaurant || response?.data?.restaurant;
      if (restaurant) {
        setRestaurantStatus({
          isActive: restaurant.isActive,
          rejectionReason: restaurant.rejectionReason || null,
          onboarding: restaurant.onboarding || null,
          isLoading: false,
        });
      }

      // Trigger profile refresh event
      window.dispatchEvent(new Event("restaurantProfileRefresh"));

      alert(
        "Restaurant reverified successfully! Verification will be done in 24 hours.",
      );
    } catch (error) {
      // Don't log network/timeout errors (backend might be down)
      if (
        error.code !== "ERR_NETWORK" &&
        error.code !== "ECONNABORTED" &&
        !error.message?.includes("timeout")
      ) {
        debugError("Error reverifying restaurant:", error);
      }

      // Handle 401 Unauthorized errors (token expired/invalid)
      if (error.response?.status === 401) {
        const errorMessage =
          error.response?.data?.message ||
          "Your session has expired. Please login again.";
        alert(errorMessage);
        // The axios interceptor should handle redirecting to login
        // But if it doesn't, we can manually redirect
        if (!error.response?.data?.message?.includes("inactive")) {
          // Only redirect if it's not an "inactive" error (which we handle differently)
          setTimeout(() => {
            window.location.href = "/food/restaurant/login";
          }, 1500);
        }
      } else {
        // Other errors (400, 500, etc.)
        const errorMessage =
          error.response?.data?.message ||
          "Failed to reverify restaurant. Please try again.";
        alert(errorMessage);
      }
    } finally {
      setIsReverifying(false);
    }
  };



  // Show new order popup when real order notification arrives from Socket.IO
  useEffect(() => {
    if (newOrder) {
      debugLog("?? New order received via Socket.IO:", newOrder);

      if (isAnyCancelledStatus(newOrder?.status || newOrder?.orderStatus)) {
        const cancelledId = resolveOrderActionId(newOrder);
        setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== cancelledId));
        clearNewOrder(cancelledId);
        return;
      }

      if (!hasOrderBeenShown(newOrder)) {
        markOrderAsShown(newOrder);
        const newId = resolveOrderActionId(newOrder);
        setOrderQueue((prev) => {
          const exists = prev.some((o) => resolveOrderActionId(o) === newId);
          if (!exists) {
            return [...prev, newOrder];
          }
          return prev;
        });
        requestOrdersRefresh();
      }
    }
  }, [newOrder]);

  useEffect(() => {
    const onRestaurantOrderStatusUpdate = (event) => {
      const payload = event?.detail || {};
      const payloadStatus = payload?.orderStatus || payload?.status;
      const normalizedPayloadStatus = normalizeOrderStatusValue(payloadStatus);
      // Admin accept moves the order straight to "preparing", so rely on the
      // acceptedBy flag (any status) rather than a specific status value.
      const isAdminAccepted = payload?.acceptedBy === "admin";

      if (!isAnyCancelledStatus(payloadStatus) && !isAdminAccepted) return;

      const activePopupOrder = popupOrder || newOrder;
      if (!activePopupOrder) return;

      const activeIds = [
        activePopupOrder?.orderMongoId,
        activePopupOrder?.orderId,
        activePopupOrder?._id,
        activePopupOrder?.id,
      ]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean);

      const payloadIds = [
        payload?.orderMongoId,
        payload?.orderId,
        payload?._id,
        payload?.id,
      ]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean);

      const isSameOrder = payloadIds.some((id) => activeIds.includes(id));
      if (!isSameOrder) {
        const cancelledId = payload?.orderMongoId || payload?.orderId || payload?._id || payload?.id;
        if (cancelledId) {
          setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== cancelledId));
        }
        return;
      }

      const cancelledStatus = normalizedPayloadStatus;
      const toastKey =
        `${payload?.orderMongoId || payload?.orderId || payload?._id || payload?.id || activePopupOrder?.orderMongoId || activePopupOrder?.orderId || activePopupOrder?._id || activePopupOrder?.id || "unknown"}:${cancelledStatus}`;
      const now = Date.now();
      if (
        lastOrderToastRef.current.key === toastKey &&
        now - lastOrderToastRef.current.at < 5000
      ) {
        return;
      }
      lastOrderToastRef.current = { key: toastKey, at: now };

      setShowRejectPopup(false);
      if (stopSound) stopSound();

      const targetId = payload?.orderMongoId || payload?.orderId || payload?._id || payload?.id;

      if (isAdminAccepted) {
        // Admin already accepted this order — close the popup entirely instead of showing it as cancelled.
        setShowNewOrderPopup(false);
        setPopupOrder(null);
      } else {
        setPopupOrder((prev) => {
          const base = prev || activePopupOrder || {};
          return {
            ...base,
            status: cancelledStatus,
            orderStatus: cancelledStatus,
            cancelledBy: payload?.cancelledBy || "customer",
          };
        });
      }

      if (targetId) {
        setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== targetId));
      }
      clearNewOrder();
    };

    window.addEventListener(
      "restaurantOrderStatusUpdate",
      onRestaurantOrderStatusUpdate,
    );
    window.addEventListener(
      "orderCancelledByUser",
      onRestaurantOrderStatusUpdate,
    );

    return () => {
      window.removeEventListener(
        "restaurantOrderStatusUpdate",
        onRestaurantOrderStatusUpdate,
      );
      window.removeEventListener(
        "orderCancelledByUser",
        onRestaurantOrderStatusUpdate,
      );
    };
  }, [popupOrder, newOrder, stopSound, clearNewOrder]);

  // Auto-dismiss popup after a brief moment when an order is cancelled
  useEffect(() => {
    const activePopupOrder = popupOrder || newOrder;
    const currentStatus = activePopupOrder?.orderStatus || activePopupOrder?.status;
    if (showNewOrderPopup && isAnyCancelledStatus(currentStatus)) {
      if (stopSound) stopSound();
      const timer = setTimeout(() => {
        setShowNewOrderPopup(false);
        setPopupOrder(null);
        const orderId = resolveOrderActionId(activePopupOrder);
        if (orderId && clearNewOrder) clearNewOrder(orderId);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [showNewOrderPopup, popupOrder, newOrder, stopSound, clearNewOrder]);

  /*
   * Keep the order tabs live when someone ELSE moves an order.
   *
   * The restaurant's own actions already refresh the list, but a rider
   * accepting, picking up or delivering - or an admin override - only arrived as
   * a socket event that closed popups. Preparing, Ready and Out for delivery
   * have no polling of their own, so they stayed wrong until the restaurant
   * tapped something. Bursty events (accept -> reached pickup -> picked up) are
   * coalesced into one fetch.
   */
  useEffect(() => {
    let timer = null;
    const onStatusUpdate = (event) => {
      const payload = event?.detail || {};
      const payloadNote = payload?.restaurantNote ?? payload?.note;
      if (payloadNote !== undefined) {
        setSelectedOrder((prev) => {
          if (!prev) return prev;
          const prevIds = [prev.orderMongoId, prev.mongoId, prev.orderId, prev.id, prev._id]
            .filter(Boolean)
            .map(String);
          const eventIds = [payload.orderMongoId, payload.orderId, payload.displayOrderId, payload.order_id, payload.id, payload._id]
            .filter(Boolean)
            .map(String);
          const isMatch = eventIds.some((id) => prevIds.includes(id));
          if (isMatch) {
            return {
              ...prev,
              note: payloadNote,
              restaurantNote: payloadNote,
            };
          }
          return prev;
        });
      }

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        requestOrdersRefreshRef.current();
      }, 400);
    };
    window.addEventListener("restaurantOrderStatusUpdate", onStatusUpdate);
    return () => {
      window.removeEventListener("restaurantOrderStatusUpdate", onStatusUpdate);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Events sent while the socket was down are gone for good; catch up on reconnect.
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) requestOrdersRefreshRef.current();
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /*
   * Safety net for tabs without their own polling (All and Takeaway already poll
   * every 10s). Visibility-aware so a backgrounded dashboard costs nothing, and
   * an immediate catch-up when the tab comes back into view.
   */
  useEffect(() => {
    const selfPolling = activeFilter === "all" || activeFilter === "takeaway-orders";
    if (selfPolling || activeFilter === "table-booking") return undefined;
    const tick = () => {
      if (!document.hidden) requestOrdersRefreshRef.current();
    };
    const interval = setInterval(tick, 15000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeFilter]);

  // Keep refs in sync to avoid stale state inside one-time event handlers.
  useEffect(() => {
    showNewOrderPopupRef.current = showNewOrderPopup;
  }, [showNewOrderPopup]);

  const activePopupOrder = popupOrder || newOrder;
  const activePopupOrderId = resolveOrderActionId(activePopupOrder);
  const isCurrentOrderMuted = activePopupOrderId ? mutedOrderIds.has(activePopupOrderId) : false;

  useEffect(() => {
    isMutedRef.current = isCurrentOrderMuted;
  }, [isCurrentOrderMuted]);

  useEffect(() => {
    newOrderRef.current = newOrder;
  }, [newOrder]);

  // Audio is now managed globally by useRestaurantNotifications hook

  // Best-effort unlock for popup buzzer so it can keep playing when tab is backgrounded.
  // Audio is managed globally by useRestaurantNotifications hook

  // Ensure audio stops when user comes to the page
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden" && newOrderRef.current && !isMutedRef.current) {
        // Keep the active alert running in background as well.
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const [ordersRefreshToken, setOrdersRefreshToken] = useState(0);
  /*
   * A refresh must actually reach the server.
   *
   * getOrders() answers from a 3s cache, and most refreshes fire right after a
   * fetch (new-order socket event, accept, cancel) - so the "refresh" handed back
   * the list from before the change and the new order or status move did not
   * show until some unrelated later fetch. Invalidate first; tabs still paint the
   * last snapshot instantly while the fresh request runs.
   */
  const requestOrdersRefresh = () => {
    restaurantAPI.invalidateOrdersCache();
    setOrdersRefreshToken((t) => t + 1);
  };
  const requestOrdersRefreshRef = useRef(requestOrdersRefresh);
  requestOrdersRefreshRef.current = requestOrdersRefresh;

  // Check for confirmed orders that haven't been shown in popup yet
  useEffect(() => {
    const checkOrdersToPopup = async () => {
      try {
        const response = await restaurantAPI.getOrders();
        if (response.data?.success && response.data.data?.orders) {
          const targetOrders = response.data.data.orders.filter((order) => {
            if (hasOrderBeenShown(order)) return false;

            const orderId = resolveOrderActionId(order);
            const inQueue = orderQueueRef.current.some((o) => resolveOrderActionId(o) === orderId);
            if (inQueue) return false;

            /*
             * Only orders still waiting for this restaurant's decision. The orders
             * API rewrites the backend "created" to "confirmed" in `status` for the
             * tabs, so read the raw backend `orderStatus`: "created" is a new order,
             * while a raw "confirmed" is one that was already accepted and must
             * never pop up (or be auto-rejected) again.
             */
            if (!isAwaitingRestaurantDecision(order)) return false;
            if (String(order.orderType || "").toLowerCase() === "dining") return false;

            // Already past its accept window: the server auto-rejects it.
            const windowSeconds = resolveAcceptOrderTimeoutSeconds(
              order,
              deliveryAcceptOrderTimeoutSecondsRef.current,
              takeawayAcceptOrderTimeoutSecondsRef.current,
            );
            return getInitialCountdown(order, windowSeconds) > 0;
          });

          // Queue all matching orders
          if (targetOrders.length > 0) {
            const newQueueItems = [];
            for (const orderToPopup of targetOrders) {
              const orderId = orderToPopup.orderId || orderToPopup._id;
              markOrderAsShown({ orderId, _id: orderToPopup._id });

              newQueueItems.push({
                orderId: orderToPopup.orderId,
                orderMongoId: orderToPopup._id,
                restaurantId: orderToPopup.restaurantId,
                restaurantName: orderToPopup.restaurantName,
                items: orderToPopup.items || [],
                pricing: orderToPopup.pricing || {},
                packagingFee: orderToPopup.packagingFee || orderToPopup.pricing?.packagingFee || 0,
                total: orderToPopup.pricing?.total || orderToPopup.total || 0,
                customerAddress: orderToPopup.address,
                status: orderToPopup.status,
                // Raw backend status: `status` above is rewritten for the tabs
                // ("created" -> "confirmed"), and the ring gate reads this one.
                orderStatus: orderToPopup.orderStatus,
                createdAt: orderToPopup.createdAt,
                restaurantNotifiedAt: orderToPopup.restaurantNotifiedAt || null,
                estimatedDeliveryTime: orderToPopup.estimatedDeliveryTime || 30,
                note: orderToPopup.restaurantNote || orderToPopup.note || "",
                restaurantNote: orderToPopup.restaurantNote || orderToPopup.note || "",
                sendCutlery: orderToPopup.sendCutlery,
                paymentMethod:
                  orderToPopup.paymentMethod ||
                  orderToPopup.payment?.method ||
                  null,
                payment: orderToPopup.payment,
                orderType: orderToPopup.orderType || "delivery",
              });
            }

            if (newQueueItems.length > 0) {
              setOrderQueue((prev) => {
                const filteredNew = newQueueItems.filter(
                  (item) => !prev.some((o) => resolveOrderActionId(o) === resolveOrderActionId(item))
                );
                return [...prev, ...filteredNew];
              });
            }
          }
        }
      } catch (error) {
        if (error.response?.status !== 401) {
          debugError("Error checking orders to popup:", error);
        }
      }
    };

    // Check once on mount, and then every 8 seconds
    checkOrdersToPopup();
    const intervalId = setInterval(checkOrdersToPopup, 8000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const orderToReject = popupOrder || newOrder;
    const timeoutSeconds = resolveAcceptOrderTimeoutSeconds(
      orderToReject,
      deliveryAcceptOrderTimeoutSecondsRef.current,
      takeawayAcceptOrderTimeoutSecondsRef.current,
    );
    if (!timeoutSeconds || timeoutSeconds <= 0) return;

    if (showNewOrderPopup && countdown > 0) {
      // Derive the remaining time from the order's real deadline on every tick.
      // Decrementing by one per interval drifted badly whenever the browser
      // throttled timers (backgrounded tab, locked phone), so the popup timed out
      // minutes late - or the settings loaded after it opened were never applied.
      const tick = () => {
        const activeOrder = popupOrder || newOrder;
        const windowSeconds = resolveAcceptOrderTimeoutSeconds(
          activeOrder,
          deliveryAcceptOrderTimeoutSecondsRef.current,
          takeawayAcceptOrderTimeoutSecondsRef.current,
        );
        const next = getInitialCountdown(activeOrder, windowSeconds);
        setCountdown((prev) => (prev === next ? prev : next));
      };
      const timer = setInterval(tick, 1000);
      const onVisible = () => {
        if (document.visibilityState === "visible") tick();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
      };
    } else if (showNewOrderPopup && countdown === 0) {
      // Auto-reject when timer hits zero
      const orderToReject = popupOrder || newOrder;
      const orderId = resolveOrderActionId(orderToReject);

      // A slide that already claimed acceptance must never be auto-rejected or closed.
      if (acceptInFlightRef.current) return;

      if (orderId && !isAcceptingOrder) {
        if (autoRejectInitiatedRef.current) return;

        // Safety: double check the order has genuinely expired against its real window start.
        const orderTime = getAcceptWindowStartMs(orderToReject) ?? Date.now();
        const secondsElapsed = Math.floor((Date.now() - orderTime) / 1000);
        const timeoutSeconds = resolveAcceptOrderTimeoutSeconds(
          orderToReject,
          deliveryAcceptOrderTimeoutSecondsRef.current,
          takeawayAcceptOrderTimeoutSecondsRef.current,
        );

        if (secondsElapsed >= timeoutSeconds - 5) {
          autoRejectInitiatedRef.current = true;
          debugLog("⏰ Timer expired. Auto-rejecting order:", orderId);
          if (stopSound) {
            stopSound();
          }

          // Instantly close the reject reasons popup
          setShowRejectPopup(false);

          // Show cancelled status in the main popup
          setPopupOrder((prev) => {
            const base = prev || orderToReject || {};
            return {
              ...base,
              status: "cancelled",
              orderStatus: "cancelled"
            };
          });

          // Remove from queue
          setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== orderId));

          restaurantAPI.rejectOrder(orderId, "No response from restaurant (Auto-rejected)")
            .then(() => {
              toast.info("Order auto-rejected due to no response");
              requestOrdersRefresh();
              // The 2.5s timer in the other useEffect will close the main popup
            })
            .catch((err) => {
              debugError("Auto-reject failed:", err);
              setShowNewOrderPopup(false);
            });
        } else {
          // If time is still remaining in reality, correct the countdown state instead of auto-cancelling!
          const remaining = Math.max(0, timeoutSeconds - secondsElapsed);
          debugLog("⏳ Recalculated countdown state to match real time elapsed:", remaining);
          setCountdown(remaining);
        }
      } else {
        setShowRejectPopup(false);
        setShowNewOrderPopup(false);
        setPopupOrder(null);
        if (orderId) {
          setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== orderId));
        }
      }
    }
  }, [showNewOrderPopup, countdown, popupOrder, newOrder, isAcceptingOrder]);

  useEffect(() => {
    if (!showNewOrderPopup) {
      setAcceptSwipeProgress(0);
      setIsAcceptingOrder(false);
      setIsAcceptSwipeDragging(false);
      acceptSwipeActiveRef.current = false;
      acceptSwipeStartXRef.current = 0;
      acceptSwipeProgressRef.current = 0;
      acceptPointerIdRef.current = null;
      acceptInFlightRef.current = false;
      autoRejectInitiatedRef.current = false;
    }
  }, [showNewOrderPopup]);

  useEffect(() => {
    if (!showNewOrderPopup) return;

    const activePopupOrder = popupOrder || newOrder;
    const popupStatus =
      activePopupOrder?.orderStatus || activePopupOrder?.status;

    if (!isAnyCancelledStatus(popupStatus)) return;

    const timer = setTimeout(() => {
      const activeId = resolveOrderActionId(activePopupOrder);
      setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== activeId));

      setShowNewOrderPopup(false);
      setPopupOrder(null);
      clearNewOrder(activeId);
      setCountdown(0);
      setPrepTime(11);
    }, 2500);

    return () => clearTimeout(timer);
  }, [showNewOrderPopup, popupOrder, newOrder]);

  // Format countdown time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Handle is h-10 w-10 inside a track with 8px (left-2) inset on each side.
  const ACCEPT_HANDLE_SIZE = 40;
  const ACCEPT_TRACK_INSET = 8;
  const ACCEPT_SWIPE_THRESHOLD = 0.7;

  const getAcceptSliderMetrics = () => {
    const sliderWidth = acceptSliderRef.current?.offsetWidth || 320;
    const maxTravel = Math.max(
      sliderWidth - ACCEPT_HANDLE_SIZE - ACCEPT_TRACK_INSET * 2,
      1,
    );
    return { maxTravel };
  };

  const setAcceptSwipeProgressValue = (value) => {
    acceptSwipeProgressRef.current = value;
    setAcceptSwipeProgress(value);
  };

  const triggerSwipeAccept = () => {
    if (acceptInFlightRef.current || isAcceptingOrder) return;
    acceptInFlightRef.current = true;
    const activeOrder = popupOrder || newOrder;
    const orderId = activeOrder?.orderMongoId || activeOrder?.orderId || activeOrder?._id || activeOrder?.id;
    if (stopSound) stopSound();
    if (clearNewOrder) clearNewOrder(orderId);

    setAcceptSwipeProgressValue(1);
    setTimeout(() => {
      handleAcceptOrder({ alreadyClaimed: true });
    }, 160);
  };

  /*
   * Slide-to-accept uses Pointer Events with pointer capture. The old touch
   * handlers let the browser claim the gesture (touch-pan-y), which fired
   * touchcancel mid-swipe, and the window listeners read a stale progress value,
   * so a completed slide usually snapped back without accepting.
   */
  const releaseAcceptPointer = (event) => {
    try {
      if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* capture already released */
    }
  };

  const handleAcceptSwipePointerDown = (event) => {
    if (acceptInFlightRef.current || isAcceptingOrder) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (acceptSwipeActiveRef.current) return;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture unsupported: events still arrive while over the track */
    }
    const { maxTravel } = getAcceptSliderMetrics();
    acceptPointerIdRef.current = event.pointerId;
    acceptSwipeStartXRef.current = event.clientX - acceptSwipeProgressRef.current * maxTravel;
    acceptSwipeActiveRef.current = true;
    setIsAcceptSwipeDragging(true);
  };

  const handleAcceptSwipePointerMove = (event) => {
    if (!acceptSwipeActiveRef.current || event.pointerId !== acceptPointerIdRef.current) return;
    if (acceptInFlightRef.current) return;
    event.preventDefault();
    const { maxTravel } = getAcceptSliderMetrics();
    const deltaX = Math.min(Math.max(event.clientX - acceptSwipeStartXRef.current, 0), maxTravel);
    setAcceptSwipeProgressValue(deltaX / maxTravel);
  };

  const endAcceptSwipe = (event, { cancelled = false } = {}) => {
    if (!acceptSwipeActiveRef.current) return;
    if (acceptPointerIdRef.current !== null && event?.pointerId !== acceptPointerIdRef.current) return;

    acceptSwipeActiveRef.current = false;
    acceptPointerIdRef.current = null;
    setIsAcceptSwipeDragging(false);
    releaseAcceptPointer(event);

    if (!cancelled && acceptSwipeProgressRef.current >= ACCEPT_SWIPE_THRESHOLD) {
      triggerSwipeAccept();
      return;
    }
    if (!acceptInFlightRef.current) {
      setAcceptSwipeProgressValue(0);
    }
  };

  // Handle accept order
  const handleAcceptOrder = async ({ alreadyClaimed = false } = {}) => {
    if (!alreadyClaimed) {
      if (acceptInFlightRef.current || isAcceptingOrder) return;
      acceptInFlightRef.current = true;
    }
    setIsAcceptingOrder(true);

    if (stopSound) {
      stopSound();
    }

    // Use popupOrder (from Socket.IO or API fallback) or newOrder (from hook)
    const orderToAccept = popupOrder || newOrder;

    // Ensure this order can't re-trigger fallback popup by using a different id key.
    markOrderAsShown(orderToAccept);

    // Accept order only from the explicit popup payload.
    let orderId = resolveOrderActionId(orderToAccept);

    // Synchronously stop ringtone & mark as processed before API call
    if (clearNewOrder) {
      clearNewOrder(orderToAccept || orderId);
    }

    if (orderId) {
      try {
        const response = await restaurantAPI.acceptOrder(orderId, prepTime);
        debugLog("? Order accepted:", orderId);
        toast.success("Order accepted successfully");
        requestOrdersRefresh();
      } catch (error) {
        debugError("? Error accepting order:", error);
        const errorMessage = error.response?.data?.message || error.message || "";
        const lowerMsg = errorMessage.toLowerCase();

        // If order was already cancelled (e.g. by customer or admin)
        if (lowerMsg.includes("cancel") || lowerMsg.includes("already cancelled")) {
          toast.error("Order has already been cancelled by the customer.");
          setShowNewOrderPopup(false);
          setPopupOrder(null);
          clearNewOrder(orderId);
          setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== orderId));
          requestOrdersRefresh();
          setIsAcceptingOrder(false);
          setAcceptSwipeProgressValue(0);
          acceptInFlightRef.current = false;
          return;
        }

        // If order already moved to a forward status, treat as success
        if (errorMessage.includes('further ahead') || errorMessage.includes('cannot be moved backwards')) {
          toast.success("Order already accepted");
          requestOrdersRefresh();
          // fall through to close popup
        } else if (error.response?.status === 404) {
          toast.error("Order not found. It may have been cancelled or already processed.");
          setShowNewOrderPopup(false);
          setPopupOrder(null);
          clearNewOrder(orderId);
          setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== orderId));
          requestOrdersRefresh();
          setIsAcceptingOrder(false);
          setAcceptSwipeProgressValue(0);
          acceptInFlightRef.current = false;
          return;
        } else {
          toast.error(errorMessage || "Failed to accept order. Please try again.");
          setIsAcceptingOrder(false);
          setAcceptSwipeProgressValue(0);
          acceptInFlightRef.current = false;
          return;
        }
      }
    } else {
      toast.error("Unable to accept this order: order id missing");
      setIsAcceptingOrder(false);
      setAcceptSwipeProgressValue(0);
      acceptInFlightRef.current = false;
      return;
    }

    setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== orderId));
    setShowNewOrderPopup(false);
    setPopupOrder(null);
    clearNewOrder(orderId);
    setCountdown(0);
    setPrepTime(11);
    setAcceptSwipeProgressValue(0);
    setIsAcceptingOrder(false);
    acceptInFlightRef.current = false;

    // Note: PreparingOrders component will automatically refresh orders via its own useEffect
    // No need to manually refresh here as the component polls every 10 seconds
  };

  // Handle reject order modal opening
  const handleRejectClick = () => {
    setShowRejectPopup(true);
  };

  const handleRejectConfirm = async () => {
    if (!effectiveRejectReason || isRejectingOrder) return;
    setIsRejectingOrder(true);

    const orderToReject = popupOrder || newOrder;

    if (stopSound) {
      stopSound();
    }

    const orderId = orderToReject?.orderMongoId || orderToReject?.orderId || orderToReject?._id || orderToReject?.id;

    // Optimistically update status in local memory instantly (0ms delay)
    if (orderId) {
      restaurantAPI.optimisticallyUpdateOrderStatus(orderId, "cancelled_by_restaurant");
    }

    // Reject order via API if we have a real order
    if (orderToReject?.orderMongoId || orderToReject?.orderId) {
      try {
        await restaurantAPI.rejectOrder(orderId, effectiveRejectReason);
        debugLog("✅ Order rejected:", orderId);
        toast.info("Order rejected successfully");
      } catch (error) {
        debugError("❌ Error rejecting order:", error);
        const errorMessage = error.response?.data?.message || error.message || "";
        // If order was already cancelled or status conflict, handle gracefully without alert
        if (errorMessage.includes("already") || errorMessage.includes("cancelled") || error.response?.status === 400 || error.response?.status === 409) {
          debugLog("Order already rejected/cancelled");
        } else {
          toast.error(errorMessage || "Failed to reject order. Please try again.");
          setIsRejectingOrder(false);
          return;
        }
      }
    }

    const targetId = resolveOrderActionId(orderToReject);
    setOrderQueue((prev) => prev.filter((o) => resolveOrderActionId(o) !== targetId));

    setShowRejectPopup(false);
    setShowNewOrderPopup(false);
    setPopupOrder(null);
    clearNewOrder(orderId);
    setRejectReason("");
    setRejectOtherText("");
    setCountdown(0);
    setPrepTime(11);
    setIsRejectingOrder(false);
    requestOrdersRefresh();
  };

  const handleRejectCancel = () => {
    if (isRejectingOrder) return;
    setShowRejectPopup(false);
    setRejectReason("");
    setRejectOtherText("");
  };

  // Handle cancel order (for preparing orders)
  const handleCancelClick = (order) => {
    setOrderToCancel(order);
    setShowCancelPopup(true);
  };

  const handleCancelConfirm = async () => {
    if (!effectiveCancelReason || !orderToCancel || isCancellingOrder) return;
    setIsCancellingOrder(true);

    try {
      const orderId = orderToCancel.mongoId || orderToCancel.orderId;
      if (orderId) {
        restaurantAPI.optimisticallyUpdateOrderStatus(orderId, "cancelled_by_restaurant");
      }
      await restaurantAPI.rejectOrder(orderId, effectiveCancelReason);
      toast.success("Order cancelled successfully");
      setShowCancelPopup(false);
      setOrderToCancel(null);
      setCancelReason("");
      setCancelOtherText("");
      requestOrdersRefresh();
    } catch (error) {
      debugError("❌ Error cancelling order:", error);
      toast.error(error.response?.data?.message || "Failed to cancel order");
    } finally {
      setIsCancellingOrder(false);
    }
  };

  const handleCancelPopupClose = () => {
    setShowCancelPopup(false);
    setOrderToCancel(null);
    setCancelReason("");
    setCancelOtherText("");
  };

  // Keep the OTP sheet above the on-screen keyboard: iOS/Android resize the
  // visual viewport (not the layout viewport) when the keyboard opens, so a
  // vertically-centered fixed modal can end up partly hidden behind it. We
  // measure that gap and feed it back in as padding so the sheet docks just
  // above the keyboard instead of being cut off / overlapped.
  useEffect(() => {
    if (!showVerifyTakeawayPopup) {
      setKeyboardInset(0);
      return;
    }
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const updateInset = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };

    updateInset();
    vv.addEventListener("resize", updateInset);
    vv.addEventListener("scroll", updateInset);
    return () => {
      vv.removeEventListener("resize", updateInset);
      vv.removeEventListener("scroll", updateInset);
    };
  }, [showVerifyTakeawayPopup]);

  // Handle takeaway verification modal opening
  const handleVerifyTakeawayClick = (order) => {
    setVerifyingOrder(order);
    setTakeawayOtpInput("");
    setShowVerifyTakeawayPopup(true);
  };

  // Handle OTP verification and order completion
  const handleVerifyTakeawayConfirm = async () => {
    if (!verifyingOrder || !takeawayOtpInput.trim()) return;

    setIsSubmittingVerifyTakeaway(true);
    try {
      const orderId = verifyingOrder.mongoId || verifyingOrder.orderId;
      await restaurantAPI.completeTakeawayOrder(orderId, takeawayOtpInput.trim());

      toast.success("Order verified & completed successfully");
      requestOrdersRefresh();
      setShowVerifyTakeawayPopup(false);
      setVerifyingOrder(null);
      setTakeawayOtpInput("");
    } catch (error) {
      debugError("Error verifying takeaway order:", error);
      toast.error(error.response?.data?.message || "Invalid OTP");
      // Clear input and refocus so restaurant can retry quickly
      setTakeawayOtpInput("");
      setTimeout(() => otpInputRef.current?.focus(), 50);
    } finally {
      setIsSubmittingVerifyTakeaway(false);
    }
  };

  const handleVerifyTakeawayClose = () => {
    setShowVerifyTakeawayPopup(false);
    setVerifyingOrder(null);
    setTakeawayOtpInput("");
  };


  // Toggle mute
  const toggleMute = () => {
    const activeOrder = popupOrder || newOrder;
    const activeId = resolveOrderActionId(activeOrder);
    if (!activeId) return;

    // Check if there are any unmuted orders in active popup or queue
    const allPendingOrders = [activeOrder, ...orderQueue].filter(Boolean);
    const hasUnmuted = allPendingOrders.some((o) => {
      const oid = resolveOrderActionId(o);
      return oid && !mutedOrderIds.has(oid);
    });

    if (hasUnmuted) {
      // Mute all pending orders
      const idsToMute = allPendingOrders.map(resolveOrderActionId).filter(Boolean);
      if (muteOrders) {
        muteOrders(idsToMute);
      }
    } else {
      // Unmute the active popup order
      if (unmuteOrder) {
        unmuteOrder(activeId);
      }
    }
  };

  // Handle PDF download
  const handlePrint = async () => {
    // Was referenced below but never defined, so printing always failed.
    const orderToPrint = popupOrder || newOrder;
    if (!orderToPrint) {
      debugWarn("No order data available for PDF generation");
      return;
    }

    try {
      // Create new PDF document
      const doc = new jsPDF();
      setupPdfFonts(doc);

      // Set font
      doc.setFont("Roboto", "bold");

      // Header
      doc.setFontSize(20);
      doc.text("Order Receipt", 105, 20, { align: "center" });

      // Restaurant name
      doc.setFontSize(14);
      doc.setFont("Roboto", "normal");
      doc.text(orderToPrint.restaurantName || "Restaurant", 105, 30, {
        align: "center",
      });

      // Order details
      doc.setFontSize(10);
      doc.setFont("Roboto", "bold");
      doc.text(`Order ID: ${orderToPrint.orderId || "N/A"}`, 20, 45);
      doc.setFont("Roboto", "normal");

      const orderDate = orderToPrint.createdAt
        ? new Date(orderToPrint.createdAt).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        : new Date().toLocaleString("en-GB", { hour12: true });

      doc.text(`Date: ${orderDate}`, 20, 52);

      // Customer address
      if (orderToPrint.customerAddress) {
        doc.setFont("Roboto", "bold");
        doc.text("Delivery Address:", 20, 62);
        doc.setFont("Roboto", "normal");
        const addressText = formatOrderAddress(orderToPrint.customerAddress) || "Address not available";
        const addressLines = doc.splitTextToSize(addressText, 170);
        doc.text(addressLines, 20, 69);
      }

      // Items table
      let yPos = 85;
      if (orderToPrint.items && orderToPrint.items.length > 0) {
        doc.setFont("Roboto", "bold");
        doc.text("Items:", 20, yPos);
        yPos += 8;

        // Prepare table data
        const tableData = orderToPrint.items.map((item) => [
          item.variantName ? `${item.name || "Item"} (${item.variantName})` : (item.name || "Item"),
          item.quantity || 1,
          `₹${(item.price || 0).toFixed(2)}`,
          `₹${((item.price || 0) * (item.quantity || 1)).toFixed(2)}`,
        ]);

        autoTable(doc, {
          startY: yPos,
          head: [["Item", "Qty", "Price", "Total"]],
          body: tableData,
          theme: "striped",
          headStyles: {
            font: "Roboto",
            fillColor: [0, 0, 0],
            textColor: 255,
            fontStyle: "bold",
          },
          styles: { font: "Roboto", fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 80 },
            1: { cellWidth: 30, halign: "center" },
            2: { cellWidth: 35, halign: "right" },
            3: { cellWidth: 35, halign: "right" },
          },
        });

        yPos = doc.lastAutoTable.finalY + 10;
      }

      // Total
      doc.setFont("Roboto", "bold");
      doc.setFontSize(12);
      doc.text(`Total: ₹${(orderToPrint.total || 0).toFixed(2)}`, 20, yPos);

      // Payment status
      yPos += 10;
      doc.setFontSize(10);
      doc.setFont("Roboto", "normal");
      doc.text(
        `Payment Status: ${orderToPrint.status === "confirmed" ? "Paid" : "Pending"}`,
        20,
        yPos,
      );

      // Estimated delivery time
      if (orderToPrint.estimatedDeliveryTime) {
        yPos += 8;
        doc.text(
          `Estimated Delivery: ${orderToPrint.estimatedDeliveryTime} minutes`,
          20,
          yPos,
        );
      }

      // Delivery Note
      if (orderToPrint.note) {
        yPos += 10;
        doc.setFont("Roboto", "bold");
        doc.text("Note for Delivery:", 20, yPos);
        doc.setFont("Roboto", "normal");
        const noteLines = doc.splitTextToSize(orderToPrint.note, 170);
        doc.text(noteLines, 20, yPos + 7);
        yPos += (noteLines.length * 7);
      }

      // Restaurant Note
      const noteToPrint = orderToPrint.restaurantNote || orderToPrint.note;
      if (noteToPrint) {
        yPos += 10;
        doc.setFont("Roboto", "bold");
        doc.text("Note for Restaurant:", 20, yPos);
        doc.setFont("Roboto", "normal");
        const restaurantNoteLines = doc.splitTextToSize(noteToPrint, 170);
        doc.text(restaurantNoteLines, 20, yPos + 7);
      }

      // Footer
      const pageHeight = doc.internal.pageSize.height;
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(
        `Generated on ${new Date().toLocaleString("en-GB", { hour12: true })}`,
        105,
        pageHeight - 10,
        { align: "center" },
      );

      // Download PDF
      const fileName = `Order-${orderToPrint.orderId || "Receipt"}-${Date.now()}.pdf`;
      doc.save(fileName);

      debugLog("? PDF generated successfully:", fileName);
    } catch (error) {
      debugError("? Error generating PDF:", error);
      alert("Failed to generate PDF. Please try again.");
    }
  };

  // Handle swipe and pull-to-refresh gestures
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchEndX.current = e.touches[0].clientX;
    isSwiping.current = false;

    pullStartYRef.current = e.touches[0].clientY;
    isPullGestureActiveRef.current = (contentRef.current?.scrollTop || 0) <= 0;
  };

  const handleTouchMove = (e) => {
    if (isPullGestureActiveRef.current && (contentRef.current?.scrollTop || 0) <= 0 && !isRefreshing) {
      const currentY = e.touches[0].clientY;
      const diff = currentY - pullStartYRef.current;
      if (diff > 5) {
        const distance = Math.min(80, Math.pow(diff, 0.82));
        setPullDistance(distance);
        return;
      } else if (diff < 0) {
        setPullDistance(0);
      }
    }

    if (!isSwiping.current) {
      const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current);
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current);

      // Determine if this is a horizontal swipe
      if (deltaX > deltaY && deltaX > 10) {
        isSwiping.current = true;
      }
    }

    if (isSwiping.current) {
      touchEndX.current = e.touches[0].clientX;
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance >= 60 && !isRefreshing) {
      handleManualRefresh();
    } else {
      setPullDistance(0);
    }
    isPullGestureActiveRef.current = false;

    if (!isSwiping.current) {
      touchStartX.current = 0;
      touchEndX.current = 0;
      return;
    }

    const swipeDistance = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;
    const swipeVelocity = Math.abs(swipeDistance);

    if (swipeVelocity > minSwipeDistance && !isTransitioning) {
      const currentIndex = filterTabs.findIndex(
        (tab) => tab.id === activeFilter,
      );
      let newIndex = currentIndex;

      if (swipeDistance > 0 && currentIndex < filterTabs.length - 1) {
        // Swipe left - go to next filter (right side)
        newIndex = currentIndex + 1;
      } else if (swipeDistance < 0 && currentIndex > 0) {
        // Swipe right - go to previous filter (left side)
        newIndex = currentIndex - 1;
      }

      if (newIndex !== currentIndex) {
        setIsTransitioning(true);

        // Smooth transition with animation
        setTimeout(() => {
          setActiveFilter(filterTabs[newIndex].id);
          scrollToFilter(newIndex);

          // Reset transition state after animation
          setTimeout(() => {
            setIsTransitioning(false);
          }, 300);
        }, 50);
      }
    }

    // Reset touch positions
    touchStartX.current = 0;
    touchEndX.current = 0;
    touchStartY.current = 0;
    isSwiping.current = false;
  };

  // Scroll filter bar to show active button with smooth animation
  const scrollToFilter = (index) => {
    if (filterBarRef.current) {
      const buttons = filterBarRef.current.querySelectorAll("button");
      if (buttons[index]) {
        const button = buttons[index];
        const container = filterBarRef.current;
        const buttonLeft = button.offsetLeft;
        const buttonWidth = button.offsetWidth;
        const containerWidth = container.offsetWidth;
        const scrollLeft = buttonLeft - containerWidth / 2 + buttonWidth / 2;

        container.scrollTo({
          left: scrollLeft,
          behavior: "smooth",
        });
      }
    }
  };

  // Scroll to active filter on change with smooth animation
  useEffect(() => {
    const index = filterTabs.findIndex((tab) => tab.id === activeFilter);
    if (index >= 0) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        scrollToFilter(index);
      });
    }
  }, [activeFilter]);

  showRejectPopupRef.current = showRejectPopup;
  showCancelPopupRef.current = showCancelPopup;
  showVerifyTakeawayPopupRef.current = showVerifyTakeawayPopup;

  const closeOrderDetailsModal = useCallback(() => {
    setIsSheetOpen(false);
    setSelectedOrder(null);
    if (orderModalPushedRef.current) {
      orderModalPushedRef.current = false;
      try {
        window.history.back();
      } catch {}
    }
  }, []);

  const handleSelectOrder = useCallback((order) => {
    setSelectedOrder(order);
    setIsSheetOpen(true);
    if (!orderModalPushedRef.current) {
      try {
        window.history.pushState({ restaurantOrderModal: true }, "", window.location.href);
        orderModalPushedRef.current = true;
      } catch {}
    }
  }, []);

  const handleExitApp = useCallback(() => {
    setShowExitAppModal(false);
    if (window.flutter_inappwebview?.callHandler) {
      window.flutter_inappwebview.callHandler("exitApp", {}).catch(() => {});
      window.flutter_inappwebview.callHandler("closeApp", {}).catch(() => {});
    }
    if (window.navigator?.app?.exitApp) {
      try {
        window.navigator.app.exitApp();
        return;
      } catch {}
    }
    try {
      window.close();
    } catch {}
  }, []);

  const handleStayApp = useCallback(() => {
    setShowExitAppModal(false);
  }, []);

  // Back button and exit app guard handling (Issues 51 & 52)
  useEffect(() => {
    const isRootRestaurantPath =
      window.location.pathname === "/food/restaurant" ||
      window.location.pathname === "/food/restaurant/";

    if (isRootRestaurantPath && !rootGuardPushedRef.current) {
      try {
        window.history.pushState({ restaurantRootGuard: true }, "", window.location.href);
        rootGuardPushedRef.current = true;
      } catch {}
    }

    const handlePopState = () => {
      // 1. If order details sheet is open, close it (Issue 51)
      if (isSheetOpenRef.current || orderModalPushedRef.current) {
        orderModalPushedRef.current = false;
        setIsSheetOpen(false);
        setSelectedOrder(null);
        return;
      }

      // 2. If exit app modal is open and user presses back, close it
      if (showExitAppModalRef.current) {
        setShowExitAppModal(false);
        return;
      }

      // 3. If any other popup is open, close it
      if (showRejectPopupRef.current) {
        setShowRejectPopup(false);
        return;
      }
      if (showCancelPopupRef.current) {
        setShowCancelPopup(false);
        return;
      }
      if (showVerifyTakeawayPopupRef.current) {
        setShowVerifyTakeawayPopup(false);
        return;
      }

      // 4. User is on root restaurant screen and presses back: show themed exit modal (Issue 52)
      if (isRootRestaurantPath) {
        try {
          window.history.pushState({ restaurantRootGuard: true }, "", window.location.href);
        } catch {}
        setShowExitAppModal(true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (orderModalPushedRef.current) {
        orderModalPushedRef.current = false;
        try {
          window.history.back();
        } catch {}
      }
    };
  }, []);

  const renderContent = () => {
    if (searchQuery.trim() !== "") {
      return (
        <SearchResults
          query={searchQuery}
          results={searchResults}
          isLoading={isSearching}
          onSelectOrder={handleSelectOrder}
          onVerifyTakeaway={handleVerifyTakeawayClick}
        />
      );
    }

    switch (activeFilter) {
      case "all":
        return (
          <AllOrders
            onSelectOrder={handleSelectOrder}
            onCancel={handleCancelClick}
            onVerifyTakeaway={handleVerifyTakeawayClick}
            refreshToken={ordersRefreshToken}
          />
        );
      case "preparing":
        return (
          <PreparingOrders
            onSelectOrder={handleSelectOrder}
            onCancel={handleCancelClick}
            refreshToken={ordersRefreshToken}
            onStatusChanged={requestOrdersRefresh}
          />
        );
      case "ready":
        return (
          <ReadyOrders
            onSelectOrder={handleSelectOrder}
            onVerifyTakeaway={handleVerifyTakeawayClick}
            refreshToken={ordersRefreshToken}
          />
        );
      case "out-for-delivery":
        return (
          <OutForDeliveryOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "completed":
        return (
          <CompletedOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "table-booking":
        return <TableBookings />;
      case "takeaway-orders":
        return (
          <TakeawayOrders
            onSelectOrder={handleSelectOrder}
            onCancel={handleCancelClick}
            onVerifyTakeaway={handleVerifyTakeawayClick}
            refreshToken={ordersRefreshToken}
          />
        );
      case "cancelled":
        return (
          <CancelledOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      default:
        return <EmptyState />;
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-gray-100 flex flex-col overflow-hidden">
      <div className="z-50 flex-shrink-0">
        <RestaurantNavbar showNotifications={true} hideSearch={true} />
      </div>

      {/* Top Filter Bar */}
      <div className="z-40 bg-gray-100 px-4 pb-2 flex-shrink-0">
        {/* Search Bar & Refresh Button */}
        <div className="py-3 flex items-center gap-2">
          <div className="relative group flex-1">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Search className="h-4.5 w-4.5 text-slate-400 group-focus-within:text-[#2E7D52] transition-colors" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by order ID or dish name"
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-100 rounded-2xl text-[14px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-[#2E7D52]/10 focus:border-[#2E7D52]/20 transition-all shadow-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-3 flex items-center"
              >
                <X className="h-4 w-4 text-slate-400 hover:text-slate-600" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            aria-label="Refresh orders"
            className="flex-shrink-0 h-[46px] w-[46px] flex items-center justify-center bg-white border border-slate-100 rounded-2xl text-slate-700 hover:text-[#2E7D52] hover:bg-slate-50 active:scale-95 transition-all shadow-sm disabled:opacity-60 cursor-pointer"
            title="Refresh orders"
          >
            <RotateCw className={`h-4.5 w-4.5 text-slate-600 transition-transform ${isRefreshing ? "animate-spin text-[#2E7D52]" : ""}`} />
          </button>
        </div>

        <div
          ref={filterBarRef}
          className="flex gap-2 overflow-x-auto scrollbar-hide bg-transparent rounded-full py-1"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            WebkitOverflowScrolling: "touch",
          }}>
          <style>{`
            .scrollbar-hide::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          {filterTabs.map((tab, index) => {
            const isActive = activeFilter === tab.id;

            return (
              <motion.button
                key={tab.id}
                onClick={() => {
                  if (!isTransitioning) {
                    setIsTransitioning(true);
                    setActiveFilter(tab.id);
                    scrollToFilter(index);
                    setTimeout(() => setIsTransitioning(false), 300);
                  }
                }}
                className={`shrink-0 px-6 py-3.5 rounded-full font-medium text-sm whitespace-nowrap relative overflow-hidden ${isActive ? "text-white" : "bg-white text-black"
                  }`}
                animate={{
                  scale: isActive ? 1.05 : 1,
                  opacity: isActive ? 1 : 0.7,
                }}
                transition={{
                  duration: 0.3,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
                whileTap={{ scale: 0.95 }}>
                {isActive && (
                  <motion.div
                    layoutId="activeFilterBackground"
                    className="absolute inset-0 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-full -z-10"
                    initial={false}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 30,
                    }}
                  />
                )}
                <div className="flex items-center gap-2 relative z-10">
                  <span className="flex items-center gap-1.5">
                    {tab.label}
                    {tab.id === 'all' && pendingOrdersCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black">
                        {pendingOrdersCount}
                      </span>
                    )}
                  </span>
                  {tab.id === 'all' && pendingOrdersCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Content Area - Scrollable */}
      <div
        ref={contentRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 overflow-y-auto px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom,16px))] content-scroll"
        style={{ WebkitOverflowScrolling: "touch" }}>
        <style>{`
          .content-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
            -webkit-overflow-scrolling: touch;
            scroll-behavior: smooth;
          }
          .content-scroll::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        {/* Pull-to-refresh Indicator */}
        <div
          className="overflow-hidden transition-all duration-200 flex flex-col items-center justify-center"
          style={{
            height: isRefreshing ? 48 : pullDistance > 0 ? `${pullDistance}px` : 0,
            opacity: isRefreshing || pullDistance > 15 ? 1 : 0,
          }}
        >
          <div className="flex items-center gap-2 py-1.5 px-3.5 my-1 text-xs font-semibold text-slate-700 bg-white/90 backdrop-blur-sm rounded-full shadow-sm border border-slate-200/80">
            <RotateCw
              className={`w-3.5 h-3.5 text-[#2E7D52] transition-transform duration-200 ${
                isRefreshing ? "animate-spin" : pullDistance >= 60 ? "rotate-180" : ""
              }`}
            />
            <span>
              {isRefreshing
                ? "Refreshing orders..."
                : pullDistance >= 60
                ? "Release to refresh"
                : "Pull down to refresh"}
            </span>
          </div>
        </div>

        {/* Verification Pending Card - Show if onboarding is complete (all 4 steps) and restaurant is not active */}
        {!restaurantStatus.isLoading &&
          !restaurantStatus.isActive &&
          restaurantStatus.onboarding?.completedSteps === 4 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className={`mt-4 mb-4 rounded-2xl shadow-sm px-6 py-4 ${restaurantStatus.rejectionReason
                  ? "bg-white border border-red-200"
                  : "bg-white border border-yellow-200"
                }`}>
              {restaurantStatus.rejectionReason ? (
                <>
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 rounded-full p-2 bg-red-100">
                      <AlertCircle className="w-5 h-5 text-[#2E7D52]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-[#2E7D52] mb-2">
                        Denied Verification
                      </h3>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                        <p className="text-xs font-semibold text-red-800 mb-2">
                          Reason for Rejection:
                        </p>
                        <div className="text-xs text-red-700 space-y-1">
                          {restaurantStatus.rejectionReason
                            .split("\n")
                            .filter((line) => line.trim()).length > 1 ? (
                            <ul className="space-y-1 list-disc list-inside">
                              {restaurantStatus.rejectionReason
                                .split("\n")
                                .map(
                                  (point, index) =>
                                    point.trim() && (
                                      <li key={index}>{point.trim()}</li>
                                    ),
                                )}
                            </ul>
                          ) : (
                            <p className="text-red-700">
                              {restaurantStatus.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 mb-3">
                    Please correct the above issues and click "Reverify" to
                    resubmit your request for approval.
                  </p>
                  <button
                    onClick={handleReverify}
                    disabled={isReverifying}
                    className="w-full px-6 py-2.5 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {isReverifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      "Reverify"
                    )}
                  </button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    Verification Done in 24 Hours
                  </h3>
                  <p className="text-sm text-gray-600">
                    Your account is under verification. You'll be notified once
                    approved.
                  </p>
                </>
              )}
            </motion.div>
          )}

        {/* Dining Approval Pending Card — gated by isDiningEnabled() */}
        {isDiningEnabled() && pendingDiningRequest && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 mb-4 rounded-2xl shadow-sm px-6 py-4 bg-white border border-blue-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-full bg-blue-100">
                <Clock className="w-4 h-4 text-[#2E7D52]" />
              </div>
              <h3 className="text-base font-bold text-gray-900">
                Dining Activation Request Pending
              </h3>
            </div>
            <p className="text-sm text-gray-600">
              Your request to {pendingDiningRequest.requestedSettings?.isEnabled ? "enable" : "update"} dining services is being reviewed by our team. You'll be notified via SMS/Dashboard once it's approved.
            </p>
            <div className="mt-3 flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase tracking-widest">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              Under Review
            </div>
          </motion.div>
        )}

        {searchQuery.trim() === '' && (
          activeFilter === 'all' ||
          activeFilter === 'preparing' ||
          activeFilter === 'ready' ||
          activeFilter === 'out-for-delivery' ||
          activeFilter === 'table-booking' ||
          activeFilter === 'takeaway-orders'
        ) && (
            <div className="pt-2 pb-2 flex justify-center gap-3 w-full">
              {/* Takeaway Orders button — count hidden on 'all' tab */}
              <motion.button
                onClick={() => {
                  if (activeFilter === 'takeaway-orders') {
                    setActiveFilter('all');
                  } else {
                    setActiveFilter('takeaway-orders');
                  }
                }}
                className={`flex-1 min-w-0 py-3 rounded-full font-bold text-sm whitespace-nowrap relative overflow-hidden shadow-sm border border-gray-200 transition-all text-center ${activeFilter === 'takeaway-orders' ? 'text-white' : 'bg-white text-black hover:bg-gray-50'
                  }`}
                animate={{ scale: activeFilter === 'takeaway-orders' ? 1.05 : 1 }}
                whileTap={{ scale: 0.95 }}>
                {activeFilter === 'takeaway-orders' && (
                  <div className="absolute inset-0 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-full -z-10" />
                )}
                <div className="flex items-center justify-center gap-2 relative z-10">
                  <span className="flex items-center gap-1.5">
                    Takeaway Orders
                    {activeTakeawayCount > 0 && activeFilter !== 'all' && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black animate-bounce">
                        {activeTakeawayCount}
                      </span>
                    )}
                  </span>
                  {activeTakeawayCount > 0 && activeFilter !== 'all' && (
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                  )}
                </div>
              </motion.button>

              {/* Table Booking button — gated by isDiningEnabled() */}
              {isDiningEnabled() && (
              <motion.button
                onClick={() => {
                  if (activeFilter === 'table-booking') {
                    setActiveFilter('all');
                  } else {
                    setActiveFilter('table-booking');
                  }
                }}
                className={`flex-1 min-w-0 py-3 rounded-full font-bold text-sm whitespace-nowrap relative overflow-hidden shadow-sm border border-gray-200 transition-all text-center ${activeFilter === 'table-booking' ? 'text-white' : 'bg-white text-black hover:bg-gray-50'
                  }`}
                animate={{ scale: activeFilter === 'table-booking' ? 1.05 : 1 }}
                whileTap={{ scale: 0.95 }}>
                {activeFilter === 'table-booking' && (
                  <div className="absolute inset-0 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-full -z-10" />
                )}
                <div className="flex items-center justify-center gap-2 relative z-10">
                  <span className="flex items-center gap-1.5">
                    Dining Booking
                    {pendingBookingsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-[#2E7D52] text-[10px] font-black animate-bounce">
                        {pendingBookingsCount}
                      </span>
                    )}
                  </span>
                  {pendingBookingsCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                  )}
                </div>
              </motion.button>
              )}
            </div>
          )}

        <AnimatePresence mode="wait">
          <motion.div
            key={activeFilter}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}>
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Audio element */}

      {/* New Order Popup */}
      <AnimatePresence>
        {showNewOrderPopup && Boolean(popupOrder || newOrder) && (
          <>
            <motion.div
              className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center overflow-hidden p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}>
              <motion.div
                className="w-full max-w-md max-h-[85dvh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="shrink-0 px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-gray-900 truncate">
                        {(popupOrder || newOrder)?.orderId || "#Order"}
                      </h3>
                      {(() => {
                        const activeOrder = popupOrder || newOrder;
                        if (!activeOrder) return null;
                        const isTakeaway = activeOrder.orderType === "takeaway" || activeOrder.type === "Takeaway";
                        const isDining = activeOrder.orderType === "dining" || activeOrder.type === "Dining";
                        if (isTakeaway) {
                          return (
                            <span className="px-2.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
                              Takeaway
                            </span>
                          );
                        } else if (isDining) {
                          return (
                            <span className="px-2.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
                              Dining
                            </span>
                          );
                        } else {
                          return (
                            <span className="px-2.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
                              Home Delivery
                            </span>
                          );
                        }
                      })()}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(popupOrder || newOrder)?.restaurantName || "Restaurant"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleMute}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      aria-label={isCurrentOrderMuted ? "Unmute" : "Mute"}>
                      {isCurrentOrderMuted ? (
                        <VolumeX className="w-5 h-5 text-gray-700" />
                      ) : (
                        <Volume2 className="w-5 h-5 text-gray-700" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="px-4 pt-4 pb-4 flex-1 overflow-y-auto min-h-0 overscroll-contain" style={{ scrollbarWidth: 'thin', scrollbarColor: '#e5e7eb transparent' }}>
                  {/* Order Type Banner/Card */}
                  {(() => {
                    const activeOrder = popupOrder || newOrder;
                    if (!activeOrder) return null;

                    const oType = String(activeOrder.orderType || activeOrder.type || "").toLowerCase().trim();
                    const isTakeaway = oType === "takeaway";
                    const isDining = oType === "dining";

                    if (isTakeaway) {
                      return (
                        <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                            <ShoppingBag className="w-4 h-4 text-orange-600" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-orange-800 uppercase tracking-wider">
                              Takeaway Order
                            </p>
                            <p className="text-xs text-orange-950 font-semibold mt-0.5">
                              Customer will pick up from restaurant.
                            </p>
                          </div>
                        </div>
                      );
                    }

                    if (isDining) {
                      return (
                        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                            <Users className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">
                              Dining Order
                            </p>
                            <p className="text-xs text-blue-950 font-semibold mt-0.5">
                              For in-restaurant dining. Table service.
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // Home Delivery
                    const addrObj = activeOrder.customerAddress || activeOrder.deliveryAddress || activeOrder.address;
                    const displayAddress = formatOrderAddress(addrObj) || addrObj?.label || "";

                    return (
                      <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                          <MapPin className="w-4 h-4 text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-green-800 uppercase tracking-wider">
                            Home Delivery Order
                          </p>
                          {displayAddress ? (
                            <p className="text-xs text-green-950 font-semibold mt-0.5 break-words">
                              Deliver to: {displayAddress}
                            </p>
                          ) : (
                            <p className="text-xs text-green-950 font-semibold mt-0.5">
                              Deliver to customer address.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Restaurant Note */}
                  {((popupOrder || newOrder)?.restaurantNote || (popupOrder || newOrder)?.note) && (
                    <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-[#2E7D52]" />
                        <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">
                          Note for Restaurant
                        </p>
                      </div>
                      <p className="text-sm font-medium text-blue-900">
                        {(popupOrder || newOrder).restaurantNote || (popupOrder || newOrder).note}
                      </p>
                    </div>
                  )}

                  {/* Details Section — first 4 always visible, extra items expandable */}
                  {(() => {
                    const activeOrder = popupOrder || newOrder;
                    const orderItems = activeOrder?.items || [];
                    const ALWAYS_SHOW = 4;
                    const visibleItems = orderItems.slice(0, ALWAYS_SHOW);
                    const extraItems = orderItems.slice(ALWAYS_SHOW);
                    const hasExtra = extraItems.length > 0;

                    const formattedTime = activeOrder?.createdAt
                      ? new Date(activeOrder.createdAt)
                          .toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          })
                          .replace(/ am/i, " AM")
                          .replace(/ pm/i, " PM")
                      : "Just now";

                    const renderItem = (item, index) => {
                      const itemImg = resolveMediaUrl(
                        item.image || item.imageUrl || item.foodItem?.image || item.itemImage || item.foodImage || item.photo
                      );
                      const isVeg = item.isVeg !== false && item.veg !== false && !String(item.type || '').toLowerCase().includes('non');
                      const variantText = 
                        (typeof item.variantName === 'string' && item.variantName.trim()) ||
                        (typeof item.variant === 'string' && item.variant.trim()) ||
                        (typeof item.variant === 'object' && item.variant?.name) ||
                        (typeof item.selectedVariant === 'string' && item.selectedVariant.trim()) ||
                        (typeof item.selectedVariant === 'object' && item.selectedVariant?.name) ||
                        (typeof item.variant_name === 'string' && item.variant_name.trim()) ||
                        (typeof item.variation === 'string' && item.variation.trim()) ||
                        (typeof item.variation === 'object' && item.variation?.name) ||
                        (typeof item.size === 'string' && item.size.trim()) ||
                        (typeof item.portion === 'string' && item.portion.trim()) ||
                        (typeof item.option === 'string' && item.option.trim()) ||
                        (typeof item.choice === 'string' && item.choice.trim()) ||
                        '';
                      const itemAddons = Array.isArray(item.addons) ? item.addons : Array.isArray(item.selectedAddons) ? item.selectedAddons : [];

                      return (
                        <div key={index} className="flex items-start justify-between gap-3 bg-gradient-to-r from-slate-50/90 via-white to-slate-50/70 p-3 sm:p-3.5 rounded-xl border border-slate-200/90 shadow-xs hover:shadow-sm transition-all">
                          <div className="flex items-start gap-2.5 flex-1 min-w-0">
                            {/* Food Photo if available */}
                            {itemImg && (
                              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg overflow-hidden bg-slate-100 shrink-0 border border-slate-200/80 shadow-xs self-center">
                                <img
                                  src={itemImg}
                                  alt={item.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                                  loading="lazy"
                                />
                              </div>
                            )}

                            {/* Veg / Non-Veg Icon */}
                            <div className={`w-4 sm:w-5 h-4 sm:h-5 border-2 shrink-0 rounded-[4px] flex items-center justify-center p-[2px] mt-0.5 ${isVeg ? "border-emerald-600 bg-emerald-50/80" : "border-rose-600 bg-rose-50/80"}`}>
                              <div className={`w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full ${isVeg ? "bg-emerald-600" : "bg-rose-600"}`} />
                            </div>

                            {/* Prominent Quantity Badge */}
                            <span className="shrink-0 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-gray-900 text-amber-400 font-black text-xs sm:text-sm tracking-wider shadow-xs border border-gray-800">
                              {item.quantity}×
                            </span>

                            {/* Item Name & Variant */}
                            <div className="flex flex-col min-w-0 flex-1">
                              <p className="text-sm sm:text-base font-extrabold text-gray-950 leading-snug">
                                {item.name}
                              </p>
                              {variantText && (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black text-rose-900 bg-rose-100 border-2 border-rose-300 px-2.5 py-0.5 rounded-lg shadow-xs">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                                    {variantText}
                                  </span>
                                </div>
                              )}
                              {itemAddons.length > 0 && (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {itemAddons.map((addon, aIdx) => (
                                    <span key={aIdx} className="inline-flex items-center text-xs font-bold text-slate-800 bg-slate-100 border border-slate-300 px-2.5 py-0.5 rounded-md">
                                      + {typeof addon === 'string' ? addon : addon.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Item price: the restaurant's own price for this line. */}
                          <div className="shrink-0 ml-2 text-right">
                            <span className="inline-block text-sm sm:text-base font-black text-gray-900 bg-gray-100/90 border border-gray-200 px-2.5 py-1 rounded-lg">
                              ₹{getRestaurantItemAmount(item)}
                            </span>
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div className="mb-4">
                        {/* Header with item count & order timestamp */}
                        <div className="flex items-center justify-between py-2 border-b border-gray-200 mb-3">
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-sm font-semibold text-gray-900">Details</span>
                            <span className="text-xs text-gray-500">({orderItems.length} item{orderItems.length !== 1 ? 's' : ''})</span>
                          </div>
                          <span className="text-xs font-semibold text-gray-500">{formattedTime}</span>
                        </div>

                        {/* Always-visible first 4 items */}
                        <div className="space-y-3">
                          {visibleItems.map(renderItem)}
                        </div>

                        {/* Expand/collapse extra items */}
                        {hasExtra && (
                          <>
                            <AnimatePresence>
                              {isDetailsExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 space-y-3">
                                    {extraItems.map((item, i) => renderItem(item, ALWAYS_SHOW + i))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>

                            <button
                              onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                              className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 text-xs font-semibold transition-colors"
                            >
                              {isDetailsExpanded ? (
                                <><ChevronUp className="w-4 h-4" /> Show less</>
                              ) : (
                                <><ChevronDown className="w-4 h-4" /> +{extraItems.length} more item{extraItems.length !== 1 ? 's' : ''}</>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* Total bill & breakdown — what this order pays the restaurant */}
                  {(() => {
                    const activeOrder = popupOrder || newOrder;
                    const items = Array.isArray(activeOrder?.items) ? activeOrder.items : [];
                    const itemsSubtotal = items.reduce(
                      (sum, it) => sum + getRestaurantItemAmount(it),
                      0
                    );
                    const packagingFee = Number(
                      activeOrder?.pricing?.packagingFee ??
                      activeOrder?.packagingFee ??
                      activeOrder?.packagingCharge ??
                      0
                    ) || 0;
                    const restaurantTotal = getPopupOrderTotal(activeOrder);

                    return (
                      <div className="mb-4 py-3 border-y border-gray-200 space-y-1.5">
                        {packagingFee > 0 && (
                          <>
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span>Items Subtotal</span>
                              <span className="font-semibold text-gray-800">₹{itemsSubtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span>Packaging Charge</span>
                              <span className="text-emerald-700 font-semibold">+₹{packagingFee.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-2">
                            <svg
                              className="w-5 h-5 text-gray-700"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
                              />
                            </svg>
                            <span className="text-sm font-semibold text-gray-900">
                              Total bill
                            </span>
                          </div>
                          <span className="text-base font-bold text-gray-900">
                            ₹{restaurantTotal}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Payment method: treat cash/cod (any case) as COD */}
                  {(() => {
                    const raw =
                      (popupOrder || newOrder)?.paymentMethod ||
                      (popupOrder || newOrder)?.payment?.method;
                    const m =
                      raw != null ? String(raw).toLowerCase().trim() : "";
                    const isCod = m === "cash" || m === "cod";
                    return (
                      <div className="mb-4 flex items-center justify-between py-2">
                        <span className="text-sm font-medium text-gray-700">
                          Payment
                        </span>
                        <span
                          className={`text-sm font-semibold ${isCod ? "text-amber-600" : "text-green-600"}`}>
                          {isCod ? "Cash on Delivery" : "Paid"}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Preparation time */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-gray-700">
                        Preparation time
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPrepTime(Math.max(1, prepTime - 1))}
                          className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors">
                          <Minus className="w-4 h-4 text-gray-700" />
                        </button>
                        <span className="text-base font-semibold text-gray-900 min-w-[60px] text-center">
                          {prepTime} mins
                        </span>
                        <button
                          onClick={() => setPrepTime(prepTime + 1)}
                          className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors">
                          <Plus className="w-4 h-4 text-gray-700" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 px-4 pb-4 pt-3 border-t border-gray-200 bg-white">
                  {(() => {
                    const activePopupOrder = popupOrder || newOrder;
                    const popupStatus =
                      activePopupOrder?.orderStatus || activePopupOrder?.status;
                    const popupTimeoutSeconds = resolveAcceptOrderTimeoutSeconds(
                      activePopupOrder,
                      deliveryAcceptOrderTimeoutSeconds,
                      takeawayAcceptOrderTimeoutSeconds,
                    );
                    const userCancelled = isUserCancelledStatus(popupStatus);
                    const anyCancelled = isAnyCancelledStatus(popupStatus);

                    if (anyCancelled) {
                      return (
                        <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-center">
                          <div className="flex items-center justify-center gap-2 mb-1.5">
                            <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                            <p className="text-sm font-bold text-red-700">
                              {userCancelled
                                ? "Cancelled by user"
                                : "Order cancelled"}
                            </p>
                          </div>
                          <p className="text-xs text-red-600 font-medium mb-3">
                            This order is no longer available for acceptance.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setShowNewOrderPopup(false);
                              setPopupOrder(null);
                              clearNewOrder(resolveOrderActionId(activePopupOrder));
                            }}
                            className="w-full py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        <div
                          ref={acceptSliderRef}
                          role="presentation"
                          onPointerDown={handleAcceptSwipePointerDown}
                          onPointerMove={handleAcceptSwipePointerMove}
                          onPointerUp={(e) => endAcceptSwipe(e)}
                          onPointerCancel={(e) => endAcceptSwipe(e, { cancelled: true })}
                          onLostPointerCapture={(e) => endAcceptSwipe(e)}
                          onContextMenu={(e) => e.preventDefault()}
                          style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
                          className={`relative h-14 rounded-2xl bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] overflow-hidden select-none ${isAcceptingOrder ? "cursor-wait" : "cursor-grab active:cursor-grabbing"}`}>
                          <motion.div
                            className="absolute inset-y-0 left-0 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F]"
                            initial={{ width: "100%" }}
                            animate={{ width: `${popupTimeoutSeconds > 0 ? (countdown / popupTimeoutSeconds) * 100 : 0}%` }}
                            transition={{ duration: 1, ease: "linear" }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center px-12 sm:px-16">
                            <span className="relative z-10 text-xs sm:text-sm font-semibold text-white text-center leading-tight">
                              {isAcceptingOrder
                                ? "Accepting order..."
                                : `Slide to accept (${formatTime(countdown)})`}
                            </span>
                          </div>
                          <motion.button
                            type="button"
                            aria-label="Slide to accept order"
                            className="absolute left-2 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-white text-gray-900 shadow-md disabled:cursor-not-allowed"
                            style={{ touchAction: "none" }}
                            initial={false}
                            animate={{
                              x: acceptSwipeProgress * getAcceptSliderMetrics().maxTravel,
                            }}
                            transition={
                              isAcceptSwipeDragging
                                ? { duration: 0 }
                                : { type: "spring", stiffness: 520, damping: 38 }
                            }
                            onClick={(e) => {
                              // Pointer input must slide; only keyboard activation (detail 0) accepts directly.
                              if (e.detail === 0) triggerSwipeAccept();
                            }}
                            disabled={isAcceptingOrder}>
                            {isAcceptingOrder ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <span className="text-lg font-bold">›</span>
                            )}
                          </motion.button>
                        </div>

                        <button
                          onClick={handleRejectClick}
                          disabled={isAcceptingOrder}
                          className="w-full bg-white border-2 border-red-500 text-red-600 py-3 rounded-lg font-semibold text-sm hover:bg-red-50 transition-colors disabled:opacity-60 cursor-pointer">
                          Reject Order
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reject Order Popup */}
      <AnimatePresence>
        {showRejectPopup && (
          <>
            <motion.div
              className="fixed inset-0 z-[110] bg-black/60 flex items-start sm:items-center justify-center overflow-y-auto overscroll-contain p-3 sm:p-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleRejectCancel}>
              <motion.div
                className="w-full max-w-md max-h-[min(92dvh,calc(100dvh-1.5rem))] my-auto bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="shrink-0 px-4 py-3 sm:py-4 border-b border-gray-200">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900">
                    Reject Order {(popupOrder || newOrder)?.orderId || "#Order"}
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">
                    Please select a reason for rejecting this order
                  </p>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 sm:py-4">
                  <div className="space-y-2">
                    {rejectReasons.map((reason) => (
                      <button
                        key={reason}
                        onClick={() => setRejectReason(reason)}
                        className={`w-full text-left p-3 sm:p-4 rounded-lg border-2 transition-all ${rejectReason === reason
                            ? "border-[#2E7D52] bg-red-50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                          }`}>
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-sm font-medium ${rejectReason === reason
                                ? "text-[#2E7D52]"
                                : "text-gray-900"
                              }`}>
                            {reason}
                          </span>
                          {rejectReason === reason && (
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] flex items-center justify-center">
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {rejectReason === OTHER_REJECT_REASON && (
                    <CustomReasonInput
                      id="reject-other-reason"
                      value={rejectOtherText}
                      onChange={setRejectOtherText}
                      disabled={isRejectingOrder}
                    />
                  )}
                </div>

                {/* Footer */}
                <div className="shrink-0 px-4 py-3 sm:py-4 bg-gray-50 border-t border-gray-200 flex gap-2 sm:gap-3">
                  <button
                    onClick={handleRejectCancel}
                    disabled={isRejectingOrder}
                    className="flex-1 bg-white border-2 border-gray-300 text-gray-700 py-2.5 sm:py-3 rounded-lg font-semibold text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    Cancel
                  </button>
                  <button
                    onClick={handleRejectConfirm}
                    disabled={!effectiveRejectReason || isRejectingOrder}
                    className={`flex-1 py-2.5 sm:py-3 rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${effectiveRejectReason
                        ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white shadow-md shadow-red-900/20 active:scale-98 disabled:opacity-90 cursor-not-allowed"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                      }`}>
                    {isRejectingOrder ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Confirming...</span>
                      </>
                    ) : (
                      "Confirm Rejection"
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cancel Order Popup */}
      <AnimatePresence>
        {showCancelPopup && orderToCancel && (
          <>
            <motion.div
              className="fixed inset-0 z-[110] bg-black/60 flex items-start sm:items-center justify-center overflow-y-auto overscroll-contain p-3 sm:p-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCancelPopupClose}>
              <motion.div
                className="w-full max-w-md max-h-[min(92dvh,calc(100dvh-1.5rem))] my-auto bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="shrink-0 px-4 py-3 sm:py-4 border-b border-gray-200">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900">
                    Cancel Order {orderToCancel.orderId || "#Order"}
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">
                    Please provide a reason for cancelling this order
                  </p>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 sm:py-4">
                  <div className="space-y-2 sm:space-y-3">
                    {rejectReasons.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setCancelReason(reason)}
                        className={`w-full text-left px-3 py-2.5 sm:px-4 sm:py-3 rounded-lg border-2 transition-colors ${cancelReason === reason
                            ? "border-red-500 bg-red-50"
                            : "border-gray-200 hover:border-gray-300"
                          }`}>
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${cancelReason === reason
                                ? "border-red-500 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F]"
                                : "border-gray-300"
                              }`}>
                            {cancelReason === reason && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </div>
                          <span
                            className={`text-sm font-medium ${cancelReason === reason
                                ? "text-red-700"
                                : "text-gray-700"
                              }`}>
                            {reason}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  {cancelReason === OTHER_REJECT_REASON && (
                    <CustomReasonInput
                      id="cancel-other-reason"
                      value={cancelOtherText}
                      onChange={setCancelOtherText}
                      disabled={isCancellingOrder}
                    />
                  )}
                </div>

                {/* Footer */}
                <div className="shrink-0 px-4 py-3 sm:py-4 bg-gray-50 border-t border-gray-200 flex gap-2 sm:gap-3">
                  <button
                    onClick={handleCancelPopupClose}
                    disabled={isCancellingOrder}
                    className="flex-1 bg-white border-2 border-gray-300 text-gray-700 py-2.5 sm:py-3 rounded-lg font-semibold text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    Cancel
                  </button>
                  <button
                    onClick={handleCancelConfirm}
                    disabled={!effectiveCancelReason || isCancellingOrder}
                    className={`flex-1 py-2.5 sm:py-3 rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${effectiveCancelReason
                        ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white shadow-md shadow-red-900/20 active:scale-98 disabled:opacity-90 cursor-not-allowed"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                      }`}>
                    {isCancellingOrder ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Confirming...</span>
                      </>
                    ) : (
                      "Confirm Cancellation"
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Verify & Complete Takeaway OTP Popup */}
      {showVerifyTakeawayPopup && verifyingOrder && (
        <>
          <div
            className="fixed inset-0 z-[110] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
            style={{ paddingBottom: keyboardInset }}
            onClick={handleVerifyTakeawayClose}>
            <div
              className="w-full sm:w-[95%] max-w-sm bg-white dark:bg-[#242424] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-y-auto max-h-[88vh]"
              onClick={(e) => e.stopPropagation()}>

              {/* Gradient Header */}
              <div className="bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] px-6 pt-6 pb-8 text-center relative overflow-hidden">
                {/* decorative circles */}
                <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10" />
                <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />

                {/* Bag Icon */}
                <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-3 shadow-lg relative z-10">
                  <ShoppingBag className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-white font-black text-lg tracking-tight relative z-10">
                  Verify Takeaway
                </h3>
                <p className="text-white/70 text-[11px] font-semibold uppercase tracking-widest mt-0.5 relative z-10">
                  Self-Pickup Verification
                </p>
              </div>

              {/* Pull-up card */}
              <div className="px-5 -mt-5 relative z-10">
                {/* Order info card */}
                <div className="bg-white dark:bg-[#252525] rounded-2xl shadow-lg border border-slate-100 dark:border-slate-800 p-4 flex items-center gap-3">
                  {/* Photo */}
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 flex-shrink-0 shadow-sm">
                    {verifyingOrder.photoUrl ? (
                      <img src={resolveMediaUrl(verifyingOrder.photoUrl)} alt={verifyingOrder.photoAlt || "Food"} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBag className="w-6 h-6 text-slate-300" />
                      </div>
                    )}
                  </div>
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Order</span>
                      <span className="text-sm font-black text-slate-900 dark:text-white">#{verifyingOrder.orderId}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mt-0.5 truncate">
                      {verifyingOrder.customerName}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate italic">
                      {verifyingOrder.itemsSummary}
                    </p>
                  </div>
                </div>
              </div>

              {/* OTP Section */}
              <div className="px-5 pt-5 pb-2">
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 text-center">
                  Enter 4-Digit Customer OTP
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={takeawayOtpInput}
                  onChange={(e) => setTakeawayOtpInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  ref={otpInputRef}
                  placeholder="••••"
                  className="w-full text-center text-5xl font-black tracking-[0.6em] pl-[0.3em] py-4 border-2 border-slate-200 dark:border-slate-700 rounded-2xl focus:border-[#2E7D52] focus:outline-none focus:ring-4 focus:ring-[#2E7D52]/10 bg-slate-50 dark:bg-slate-800/50 text-slate-800 dark:text-white transition-all font-mono caret-[#2E7D52]"
                />
              </div>

              {/* Actions */}
              <div
                className="flex gap-3 px-5 pt-3 pb-6"
                style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
                <button
                  type="button"
                  onClick={handleVerifyTakeawayClose}
                  className="flex-1 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleVerifyTakeawayConfirm}
                  disabled={isSubmittingVerifyTakeaway || takeawayOtpInput.length < 4}
                  className="flex-1 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider text-white shadow-lg shadow-[#DC2626]/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                  style={{ background: takeawayOtpInput.length < 4 ? '#94a3b8' : 'linear-gradient(135deg, #2E7D52, #1B5E3F)' }}>
                  {isSubmittingVerifyTakeaway ? "Verifying…" : "Complete Order"}
                </button>
              </div>

            </div>
          </div>
        </>
      )}


      {/* Centered Modal for Order Details */}
      <AnimatePresence>
        {isSheetOpen && selectedOrder && (
          <motion.div
            className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOrderDetailsModal}>
            <motion.div
              className="w-full max-w-sm sm:max-w-md mx-auto max-h-[85vh] overflow-y-auto overflow-x-hidden bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-gray-100 relative"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}>
              {/* Header drag handle / bar */}
              <div className="flex justify-center mb-2">
                <div className="h-1 w-10 rounded-full bg-gray-200" />
              </div>

              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-extrabold text-black truncate">
                    Order #{selectedOrder.orderId}
                  </p>
                  <p className="text-xs font-semibold text-gray-600 mt-0.5 break-words [overflow-wrap:anywhere]">
                    {selectedOrder.customerName}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 font-medium truncate">
                    {selectedOrder.type}
                    {selectedOrder.tableOrToken
                      ? ` • ${selectedOrder.tableOrToken}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border uppercase tracking-wider ${(selectedOrder.status === "Ready" ||
                        String(selectedOrder.status).toLowerCase() === "delivered" ||
                        String(selectedOrder.status).toLowerCase() === "completed" ||
                        String(selectedOrder.status).toLowerCase() === "picked_up" ||
                        String(selectedOrder.status).toLowerCase() === "ready")
                        ? "border-emerald-500 text-emerald-600 bg-emerald-50"
                        : (String(selectedOrder.status).toLowerCase() === "cancelled" || String(selectedOrder.status).toLowerCase() === "rejected")
                          ? "border-rose-500 text-rose-600 bg-rose-50"
                          : "border-slate-800 text-slate-900 bg-slate-50"
                      }`}>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${(selectedOrder.status === "Ready" ||
                          String(selectedOrder.status).toLowerCase() === "delivered" ||
                          String(selectedOrder.status).toLowerCase() === "completed" ||
                          String(selectedOrder.status).toLowerCase() === "picked_up" ||
                          String(selectedOrder.status).toLowerCase() === "ready")
                          ? "bg-emerald-500"
                          : (String(selectedOrder.status).toLowerCase() === "cancelled" || String(selectedOrder.status).toLowerCase() === "rejected")
                            ? "bg-rose-500"
                            : "bg-slate-800"
                        }`}
                    />
                    {(String(selectedOrder.status).toLowerCase() === "delivered" && selectedOrder.type === "Takeaway") ? "Picked Up" : selectedOrder.status}
                  </span>
                  <span className="text-[11px] font-medium text-gray-400">
                    {selectedOrder.timePlaced}
                  </span>
                  {/* Delivery Resend Button - Only for preparing/ready orders with no partner */}
                  {selectedOrder.type !== "Takeaway" &&
                    selectedOrder.type !== "Dining" &&
                    (String(selectedOrder.status).toLowerCase() === "preparing" ||
                      String(selectedOrder.status).toLowerCase() === "ready") &&
                    !selectedOrder.deliveryPartnerId && (
                      <div className="mt-1">
                        <ResendNotificationButton
                          orderId={selectedOrder.orderId}
                          mongoId={selectedOrder.mongoId}
                          onSuccess={closeOrderDetailsModal}
                        />
                      </div>
                    )}
                </div>
              </div>

              <div className="border-t border-gray-100 my-3" />

              <div className="mb-4">
                <p className="text-xs font-extrabold text-gray-900 mb-2 uppercase tracking-wide">Items</p>
                <div className="space-y-2">
                  {String(selectedOrder.itemsSummary || "")
                    .split(/,\s*/)
                    .filter(Boolean)
                    .map((itemStr, idx) => (
                      <div key={idx} className="text-sm text-slate-900 font-bold flex items-center gap-2 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200/80 shadow-sm min-w-0">
                        <span className="w-2 h-2 rounded-full bg-[#2E7D52] shrink-0" />
                        <span className="leading-snug break-words [overflow-wrap:anywhere] min-w-0">{itemStr}</span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-600 mb-4 bg-gray-50/80 px-3 py-2 rounded-lg">
                {/* Hide ETA for ready orders */}
                {selectedOrder.status !== "ready" && selectedOrder.eta && (
                  <span>
                    ETA:{" "}
                    <span className="font-bold text-black">
                      {selectedOrder.eta}
                    </span>
                  </span>
                )}
                {(() => {
                  const raw = selectedOrder.paymentMethod;
                  const normalized =
                    raw != null ? String(raw).toLowerCase().trim() : "";
                  const isCod = normalized === "cash" || normalized === "cod";
                  return (
                    <span>
                      Payment:{" "}
                      <span
                        className={`font-bold ${isCod ? "text-amber-700" : "text-black"}`}>
                        {isCod ? "Cash on Delivery" : "Paid online"}
                      </span>
                    </span>
                  );
                })()}
              </div>

              {selectedOrder.status === "cancelled" && selectedOrder.cancellationReason && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-[10px] font-bold text-[#2E7D52] uppercase mb-1">Cancellation Reason</p>
                  <p className="text-xs text-red-700 font-medium">{selectedOrder.cancellationReason}</p>
                </div>
              )}

              {selectedOrder.status === "rejected" && selectedOrder.rejectionReason && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Rejection Reason</p>
                  <p className="text-xs text-amber-700 font-medium">{selectedOrder.rejectionReason}</p>
                </div>
              )}

              {(selectedOrder.restaurantNote || selectedOrder.note) && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl min-w-0">
                  <p className="text-[10px] font-bold text-[#2E7D52] uppercase mb-1">Note for Restaurant</p>
                  <p className="text-xs text-blue-700 font-medium break-words [overflow-wrap:anywhere]">{selectedOrder.restaurantNote || selectedOrder.note}</p>
                </div>
              )}

              <button
                className="w-full bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white py-3 rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
                onClick={closeOrderDetailsModal}>
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Themed Exit App Confirmation Modal (Issue 52) */}
      <OnboardingExitModal
        open={showExitAppModal}
        onStay={handleStayApp}
        onExit={handleExitApp}
        title="Exit App?"
        message="Are you sure you want to exit the restaurant app?"
        stayLabel="Stay"
        exitLabel="Exit App"
        theme="restaurant"
      />

      {/* Bottom Navigation - Sticky */}
      <BottomNavOrders />
    </div>
  );
}

export default function OrdersMain() {
  return (
    <OrdersErrorBoundary>
      <OrdersMainInner />
    </OrdersErrorBoundary>
  );
}


// Order Card Component
const OrderCard = memo(function OrderCard({
  orderId,
  mongoId,
  status,
  customerName,
  type,
  tableOrToken,
  timePlaced,
  eta,
  itemsSummary,
  paymentMethod,
  photoUrl,
  photoAlt,
  deliveryPartnerId,
  dispatchStatus,
  deliveryPhase = null,
  onSelect,
  onCancel,
  onMarkReady,
  isMarkingReady = false,
  restaurantNote = null,
  onVerifyTakeaway,
  acceptedAt = null,
  adminStatusNote
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedPhoto = !imageFailed && photoUrl ? resolveMediaUrl(photoUrl) : null;

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl]);

  const normalizedStatus = String(status || "").toLowerCase();
  const normalizedType = String(type || "").toLowerCase();
  const isReady = normalizedStatus === "ready";
  const isPreparing = normalizedStatus === "preparing";
  const brandColor = "#2E7D52";

  const isAccepted = !!acceptedAt;
  const isWaitingAcceptance = !isAccepted && (normalizedStatus === "confirmed" || normalizedStatus === "pending" || normalizedStatus === "created");

  const statusLabel = (normalizedStatus === "delivered" && normalizedType === "takeaway")
    ? "Picked Up"
    : normalizedStatus === "placed"
      ? "Order Placed"
      : isWaitingAcceptance
        ? "Pending"
        : String(status || "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="w-full bg-white rounded-xl p-3 mb-3 border border-slate-100 shadow-sm relative overflow-hidden active:bg-slate-50 transition-colors">
      <div
        className="absolute top-0 left-0 w-1 h-full"
        style={{ backgroundColor: brandColor }}
      />

      <div
        onClick={() => onSelect?.({ orderId, mongoId, status, customerName, type, tableOrToken, timePlaced, eta, itemsSummary, paymentMethod, restaurantNote, deliveryPartnerId })}
        className="flex gap-3 items-center cursor-pointer pl-1">

        {/* Photo Container - Centered vertically and slightly larger */}
        <div className="h-[60px] w-[60px] rounded-lg overflow-hidden bg-slate-50 flex-shrink-0 border border-slate-100 self-center flex items-center justify-center">
          {resolvedPhoto ? (
            <img
              src={resolvedPhoto}
              alt={photoAlt || "Food"}
              className="h-full w-full object-cover"
              onError={() => setImageFailed(true)}
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center p-1 bg-slate-50">
              <span className="text-[8px] font-bold text-slate-300 text-center leading-none uppercase">
                {photoAlt}
              </span>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {/* Top Row: ID & Status Badge */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <h3 className="text-[11px] font-black text-slate-900 truncate">
              #<span style={{ color: brandColor }}>{orderId}</span>
            </h3>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-black border uppercase tracking-wider ${(isReady || normalizedStatus === "delivered" || normalizedStatus === "completed" || normalizedStatus === "picked_up")
                  ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                  isWaitingAcceptance
                    ? "bg-amber-50 text-amber-600 border-amber-100 animate-pulse"
                    : normalizedStatus === "confirmed" ? "bg-amber-50 text-amber-600 border-amber-100" :
                    (normalizedStatus.includes("cancel") || normalizedStatus.includes("reject") || normalizedStatus === "failed")
                      ? "bg-rose-50 text-rose-600 border-rose-100" :
                      "bg-slate-50 text-slate-500 border-slate-100"
                }`}>
                {statusLabel}
              </span>

              {adminStatusNote && (
                <div className="mt-1 text-[8px] font-medium text-slate-500 italic truncate max-w-[150px]">
                  {adminStatusNote}
                </div>
              )}

              {isPreparing && onCancel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel({ orderId, mongoId, customerName });
                  }}
                  className="p-1 rounded-full bg-rose-50 text-rose-500"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Customer & Type */}
          <div className="flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-tight mb-1">
            <div className="flex items-center gap-1.5 text-slate-500 truncate max-w-[65%]">
              <span>{customerName}</span>
            </div>
            <span className="whitespace-nowrap flex-shrink-0">
              {normalizedType === "takeaway" ? (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-[#D97706] border border-amber-200/50">
                  Takeaway
                </span>
              ) : normalizedType === "dining" ? (
                <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200/50">
                  Dining
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200/50">
                  {type}
                </span>
              )}
            </span>
          </div>

          {/* Items Summary - Line by line */}
          <div className="text-xs sm:text-sm text-slate-900 font-extrabold mb-1.5 space-y-1">
            {String(itemsSummary || "")
              .split(/,\s*/)
              .filter(Boolean)
              .map((itemStr, idx) => (
                <div key={idx} className="flex items-center gap-1.5 leading-tight">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D52] shrink-0" />
                  <span>{itemStr}</span>
                </div>
              ))}
          </div>

          {/* Time Placed */}
          <div className="text-[9px] text-slate-400 font-bold uppercase tracking-tight mb-1">
            {timePlaced}
          </div>

          {restaurantNote && (
            <div className="mb-2 px-2 py-1 bg-blue-50 border border-blue-100 rounded-md">
              <p className="text-[9px] text-blue-700 font-bold line-clamp-1 italic">
                Note: {restaurantNote}
              </p>
            </div>
          )}

          {/* Bottom Actions Row - Only shown if actions/ETA exist */}
          {((!isReady && eta) || (isPreparing || isReady || normalizedStatus === "confirmed")) && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-50 mt-1.5">
              <div className="flex flex-col gap-0.5">
                {!isReady && eta && (
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-bold text-slate-400 uppercase">ETA</span>
                    <span className="text-[11px] font-black text-slate-800">{eta}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
                {(isPreparing || isReady || normalizedStatus === "confirmed") && (
                  <>
                    {deliveryPartnerId && (
                      <div className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600" title="Driver Assigned">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}

                    {dispatchStatus && normalizedType !== "takeaway" && normalizedType !== "dining" && !isWaitingAcceptance && (
                      <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 border border-slate-100 rounded-full px-2 py-0.5">
                        {dispatchStatus === "accepted"
                          ? ["at_pickup", "reached_pickup"].includes(String(deliveryPhase || "").toLowerCase())
                            ? "Rider at restaurant"
                            : "Rider on the way"
                          : dispatchStatus === "assigned"
                            ? "Rider notified"
                            : dispatchStatus === "unassigned"
                              ? "Finding rider"
                              : dispatchStatus}
                      </span>
                    )}

                    {(isPreparing || isReady) &&
                      normalizedType !== "takeaway" &&
                      normalizedType !== "dining" &&
                      dispatchStatus !== "accepted" &&
                      !deliveryPartnerId &&
                      !isWaitingAcceptance && (
                        <ResendNotificationButton
                          orderId={orderId}
                          mongoId={mongoId}
                        />
                      )}

                    {isPreparing && onMarkReady && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkReady({ orderId, mongoId, customerName });
                        }}
                        disabled={isMarkingReady}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black text-white shadow-sm transition-all active:scale-95 disabled:opacity-70 ${isMarkingReady ? "animate-pulse" : "hover:brightness-110"}`}
                        style={{ backgroundColor: brandColor }}>
                        MARK READY
                      </button>
                    )}

                    {isReady && normalizedType === "takeaway" && onVerifyTakeaway && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onVerifyTakeaway({ orderId, mongoId, customerName, photoUrl, photoAlt, type, itemsSummary });
                        }}
                        className="px-3 py-1.5 rounded-lg text-[9px] font-black text-white shadow-sm transition-transform active:scale-95 hover:brightness-110"
                        style={{ backgroundColor: brandColor }}>
                        VERIFY & COMPLETE
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// Preparing Orders List
function PreparingOrders({
  onSelectOrder,
  onCancel,
  refreshToken = 0,
  onStatusChanged,
}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [markingReadyOrderIds, setMarkingReadyOrderIds] = useState({});

  useLayoutEffect(() => {
    let isMounted = true;

    const fetchOrders = async (primed) => {
      try {
        // Fetch all orders and filter for 'preparing' status on frontend
        const response = primed || (await restaurantAPI.getOrders());

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter orders with 'preparing' status only
          // 'confirmed' orders should only appear in popup notification, not in preparing list
          // After accepting, order status changes to 'preparing' and then appears here
          const preparingOrders = response.data.data.orders.filter(
            (order) => order.status === "preparing" && String(order.orderType || "").toLowerCase() !== "dining",
          );

          const transformedOrders = preparingOrders.map((order) => {
            const initialETA = order.preparationTime || order.estimatedDeliveryTime || 30; // in minutes
            const preparingTimestamp = order.tracking?.preparing?.timestamp
              ? new Date(order.tracking.preparing.timestamp)
              : (order.acceptedAt
                ? new Date(order.acceptedAt)
                : new Date(order.createdAt)); // Fallback to createdAt if preparing timestamp not available

            return {
              orderId: order.orderId || order._id,
              mongoId: order._id,
              status: order.status || "preparing",
              customerName: order.userId?.name || "Customer",
              type:
                order.orderType === "takeaway"
                  ? "Takeaway"
                  : order.orderType === "dining"
                    ? "Dining"
                    : order.deliveryFleet === "standard"
                      ? "Home Delivery"
                      : "Express Delivery",
              tableOrToken: null,
              timePlaced: new Date(order.createdAt).toLocaleTimeString(
                "en-US",
                { hour: "2-digit", minute: "2-digit" },
              ),
              initialETA, // Store initial ETA in minutes
              preparingTimestamp, // Store when order started preparing
              itemsSummary:
                order.items
                  ?.map((item) => `${item.quantity}x ${item.name}${item.variantName ? ` (${item.variantName})` : ''}`)
                  .join(", ") || "No items",
              photoUrl: extractOrderImage(order),
              photoAlt: order.items?.[0]?.name || order.orderItems?.[0]?.name || "Order",
              deliveryPartnerId: order.deliveryPartnerId || null,
              dispatchStatus: order.dispatch?.status || null,
              deliveryPhase: order.deliveryState?.currentPhase || order.deliveryState?.status || null,
              paymentMethod:
                order.paymentMethod || order.payment?.method || null,
              restaurantNote: order.restaurantNote || order.note || null,
            };
          });

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        // Don't log network errors, 404, or 401 errors
        // 401 is handled by axios interceptor (token refresh/redirect)
        // 404 means no orders found (normal)
        // ERR_NETWORK means backend is down (expected in dev)
        if (
          error.code !== "ERR_NETWORK" &&
          error.response?.status !== 404 &&
          error.response?.status !== 401
        ) {
          debugError("Error fetching preparing orders:", error);
        }

        if (isMounted) {
          // Keep what is on screen: one failed refresh (network blip, server restart)
          // used to wipe the list and flash an empty state until the next success.
          setLoading(false);
        }
      }
    };

    // Paint the last known list immediately (layout effect: before first paint),
    // then revalidate. Switching tabs used to show a blank "Loading..." every
    // time even though the same orders were already in memory.
    const primedResponse = restaurantAPI.peekOrdersCache?.();
    if (primedResponse) fetchOrders(primedResponse);
    fetchOrders();

    // Update countdown every second
    const countdownIntervalId = setInterval(() => {
      if (isMounted) {
        setCurrentTime(new Date());
      }
    }, 1000);

    return () => {
      isMounted = false;
      if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
      }
    };
  }, [refreshToken]); // Re-fetch only when parent requests it

  // Track which orders have been marked as ready to avoid duplicate API calls
  const markedReadyOrdersRef = useRef(new Set());

  // Auto-mark orders as ready when ETA reaches 0
  useEffect(() => {
    if (orders.length === 0) return;

    const checkAndMarkReady = async () => {
      const now = new Date();
      for (const order of orders) {
        const orderKey = order.mongoId || order.orderId;

        // Skip if already marked as ready
        if (markedReadyOrdersRef.current.has(orderKey)) {
          continue;
        }

        // Calculate remaining ETA
        const elapsedMs = now - order.preparingTimestamp;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);
        const remainingMinutes = Math.max(0, order.initialETA - elapsedMinutes);

        // If ETA has reached 0 (or slightly past), mark as ready
        if (remainingMinutes <= 0 && order.status === "preparing") {
          const elapsedSeconds = Math.floor(elapsedMs / 1000);
          const totalETASeconds = order.initialETA * 60;

          // Mark as ready when ETA time has elapsed (with 2 second buffer)
          if (elapsedSeconds >= totalETASeconds - 2) {
            try {
              debugLog(
                `?? Auto-marking order ${order.orderId} as ready (ETA reached 0)`,
              );
              markedReadyOrdersRef.current.add(orderKey); // Mark as processing
              await restaurantAPI.markOrderReady(
                order.mongoId || order.orderId,
              );
              debugLog(`? Order ${order.orderId} marked as ready`);
              onStatusChanged?.();
              // Order will be removed from preparing list on next fetch
            } catch (error) {
              const status = error.response?.status;
              const msg = (
                error.response?.data?.message ||
                error.message ||
                ""
              ).toLowerCase();
              // If 400 and message says order cannot be marked ready (e.g. already ready),
              // treat as idempotent - backend cron or another client already marked it.
              if (
                status === 400 &&
                (msg.includes("cannot be marked as ready") ||
                  msg.includes("current status"))
              ) {
                // Keep in markedReadyOrdersRef so we don't retry; order will disappear on next fetch
              } else {
                debugError(
                  `? Failed to auto-mark order ${order.orderId} as ready:`,
                  error,
                );
                markedReadyOrdersRef.current.delete(orderKey);
              }
              // Don't show error toast - it will retry on next check (for non-idempotent errors)
            }
          }
        }
      }
    };

    // Check every 2 seconds for orders that need to be marked ready
    const readyCheckInterval = setInterval(checkAndMarkReady, 2000);

    return () => {
      clearInterval(readyCheckInterval);
    };
  }, [orders, onStatusChanged]);

  // Clear marked orders when orders list changes (orders moved to ready)
  useEffect(() => {
    const currentOrderKeys = new Set(orders.map((o) => o.mongoId || o.orderId));
    // Remove keys that are no longer in the preparing orders list
    for (const key of markedReadyOrdersRef.current) {
      if (!currentOrderKeys.has(key)) {
        markedReadyOrdersRef.current.delete(key);
      }
    }
  }, [orders]);

  const handleMarkReady = async ({ orderId, mongoId, customerName }) => {
    const orderKey = mongoId || orderId;
    if (!orderKey || markingReadyOrderIds[orderKey]) return;

    try {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: true }));
      await restaurantAPI.markOrderReady(orderKey);
      setOrders((prev) =>
        prev.filter((order) => (order.mongoId || order.orderId) !== orderKey),
      );
      toast.success(
        `Order ${orderId} marked ready${customerName ? ` for ${customerName}` : ""}`,
      );
      onStatusChanged?.();
    } catch (error) {
      const status = error.response?.status;
      const message =
        error.response?.data?.message || "Failed to mark order as ready";
      if (
        status === 400 &&
        String(message).toLowerCase().includes("current status")
      ) {
        setOrders((prev) =>
          prev.filter((order) => (order.mongoId || order.orderId) !== orderKey),
        );
        toast.success(`Order ${orderId} is already ready`);
        onStatusChanged?.();
      } else {
        toast.error(message);
      }
    } finally {
      setMarkingReadyOrderIds((prev) => {
        const next = { ...prev };
        delete next[orderKey];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Preparing orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Preparing orders</h2>
        <span className="text-xs text-gray-500">{orders.length} active</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders in preparation
        </div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3">
          {orders.map((order) => {
            // Format ETA display
            let etaDisplay = "";
            {
              const elapsedMs = currentTime - order.preparingTimestamp;
              const remainingMs = order.initialETA * 60000 - elapsedMs;
              const remainingMinutes = Math.ceil(remainingMs / 60000);
              if (remainingMinutes <= 0) {
                etaDisplay = "0 mins";
              } else {
                etaDisplay = `${remainingMinutes} mins`;
              }
            }

            return (
              <OrderCard
                key={order.orderId || order.mongoId}
                orderId={order.orderId}
                mongoId={order.mongoId}
                status={order.status}
                customerName={order.customerName}
                type={order.type}
                tableOrToken={order.tableOrToken}
                timePlaced={order.timePlaced}
                eta={etaDisplay}
                itemsSummary={order.itemsSummary}
                photoUrl={order.photoUrl}
                photoAlt={order.photoAlt}
                paymentMethod={order.paymentMethod}
                deliveryPartnerId={order.deliveryPartnerId}
                dispatchStatus={order.dispatchStatus}
                deliveryPhase={order.deliveryPhase}
                onSelect={onSelectOrder}
                onCancel={onCancel}
                onMarkReady={handleMarkReady}
                isMarkingReady={Boolean(
                  markingReadyOrderIds[order.mongoId || order.orderId],
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Ready Orders List
function ReadyOrders({ onSelectOrder, onVerifyTakeaway, refreshToken = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    let isMounted = true;

    const fetchOrders = async (primed) => {
      try {
        // Fetch all orders and filter for 'ready' status on frontend
        const response = primed || (await restaurantAPI.getOrders());

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter orders with 'ready' status
          const readyOrders = response.data.data.orders.filter(
            (order) => order.status === "ready" && String(order.orderType || "").toLowerCase() !== "dining",
          );

          const transformedOrders = readyOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "ready",
            customerName: order.userId?.name || "Customer",
            type:
              order.orderType === "takeaway"
                ? "Takeaway"
                : order.orderType === "dining"
                  ? "Dining"
                  : order.deliveryFleet === "standard"
                    ? "Home Delivery"
                    : "Express Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            eta: null, // Don't show ETA for ready orders
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}${item.variantName ? ` (${item.variantName})` : ''}`)
                .join(", ") || "No items",
            photoUrl: extractOrderImage(order),
            photoAlt: order.items?.[0]?.name || order.orderItems?.[0]?.name || "Order",
            paymentMethod: order.paymentMethod || order.payment?.method || null,
            deliveryPartnerId: order.deliveryPartnerId || null,
            dispatchStatus: order.dispatch?.status || null,
            deliveryPhase: order.deliveryState?.currentPhase || order.deliveryState?.status || null,
            restaurantNote: order.restaurantNote || order.note || null,
          }));

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        // Don't log network errors repeatedly - they're expected if backend is down
        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching ready orders:", error);
        }

        if (isMounted) {
          // Keep what is on screen: one failed refresh (network blip, server restart)
          // used to wipe the list and flash an empty state until the next success.
          setLoading(false);
        }
      }
    };

    // Paint the last known list immediately (layout effect: before first paint),
    // then revalidate. Switching tabs used to show a blank "Loading..." every
    // time even though the same orders were already in memory.
    const primedResponse = restaurantAPI.peekOrdersCache?.();
    if (primedResponse) fetchOrders(primedResponse);
    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]); // Re-fetch only when parent requests it

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Ready for pickup
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Ready for pickup</h2>
        <span className="text-xs text-gray-500">{orders.length} active</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders ready for pickup
        </div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
              onVerifyTakeaway={onVerifyTakeaway}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Out for Delivery Orders List
const OutForDeliveryOrders = ({ onSelectOrder, refreshToken = 0 }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    let isMounted = true;

    const fetchOrders = async (primed) => {
      try {
        // Fetch all orders and filter for 'out_for_delivery' status on frontend
        const response = primed || (await restaurantAPI.getOrders());

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter orders with 'out_for_delivery' status
          const outForDeliveryOrders = response.data.data.orders.filter(
            (order) => order.status === "out_for_delivery",
          );

          const transformedOrders = outForDeliveryOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "out_for_delivery",
            customerName: order.userId?.name || "Customer",
            type:
              order.orderType === "takeaway"
                ? "Takeaway"
                : order.orderType === "dining"
                  ? "Dining"
                  : order.deliveryFleet === "standard"
                    ? "Home Delivery"
                    : "Express Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            eta: null,
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}${item.variantName ? ` (${item.variantName})` : ''}`)
                .join(", ") || "No items",
            photoUrl: extractOrderImage(order),
            photoAlt: order.items?.[0]?.name || order.orderItems?.[0]?.name || "Order",
            paymentMethod: order.paymentMethod || order.payment?.method || null,
            deliveryPartnerId: order.deliveryPartnerId || null,
            dispatchStatus: order.dispatch?.status || null,
            deliveryPhase: order.deliveryState?.currentPhase || order.deliveryState?.status || null,
            restaurantNote: order.restaurantNote || order.note || null,
          }));

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        // Don't log network errors repeatedly - they're expected if backend is down
        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching out for delivery orders:", error);
        }

        if (isMounted) {
          // Keep what is on screen: one failed refresh (network blip, server restart)
          // used to wipe the list and flash an empty state until the next success.
          setLoading(false);
        }
      }
    };

    // Paint the last known list immediately (layout effect: before first paint),
    // then revalidate. Switching tabs used to show a blank "Loading..." every
    // time even though the same orders were already in memory.
    const primedResponse = restaurantAPI.peekOrdersCache?.();
    if (primedResponse) fetchOrders(primedResponse);
    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]); // Re-fetch only when parent requests it

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Out for delivery
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Out for delivery</h2>
        <span className="text-xs text-gray-500">{orders.length} active</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders out for delivery
        </div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-x-4 md:items-start 2xl:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Empty State Component
function EmptyState({ message = "Temporarily closed" }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-12">
      {/* Store Illustration */}
      <div className="mb-6">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          className="text-gray-300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg">
          {/* Storefront */}
          <rect
            x="40"
            y="80"
            width="120"
            height="80"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Awning */}
          <path
            d="M30 80 L100 50 L170 80"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Doors */}
          <rect
            x="60"
            y="100"
            width="30"
            height="60"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          <rect
            x="110"
            y="100"
            width="30"
            height="60"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Laptop */}
          <rect
            x="70"
            y="140"
            width="40"
            height="25"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="white"
          />
          <text
            x="85"
            y="155"
            fontSize="8"
            fill="currentColor"
            textAnchor="middle">
            CLOSED
          </text>
          {/* Sign */}
          <rect
            x="80"
            y="170"
            width="40"
            height="20"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="white"
          />
        </svg>
      </div>

      {/* Message */}
      <h2 className="text-lg font-semibold text-gray-600 mb-4 text-center">
        {message}
      </h2>

      {/* View Status Button */}
      <button
        onClick={() => {
          // If message is related to rejection/offline, go to status page, otherwise refresh orders
          if (message?.toLowerCase().includes("rejected") || message?.toLowerCase().includes("closed")) {
            window.location.href = "/food/restaurant/status";
          } else {
            window.location.reload();
          }
        }}
        className="bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors">
        View status
      </button>
    </div>
  );
}







