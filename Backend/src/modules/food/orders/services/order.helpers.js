import mongoose from 'mongoose';
import { logger } from '../../../../utils/logger.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../../admin/models/food.model.js';
import {
  sendNotificationToOwner,
  sendNotificationToOwners,
  notifyAdminsSafely,
  getNewOrderAlertSound,
} from "../../../../core/notifications/firebase.service.js";
import { getIO, rooms } from '../../../../config/socket.js';
import { config } from '../../../../config/env.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';

export function enqueueOrderEvent(action, payload = {}) {
  try {
    void addOrderJob({ action, ...payload }).catch((err) => {
      logger.warn(`BullMQ enqueue order event failed: ${action} - ${err?.message || err}`);
    });
  } catch (err) {
    logger.warn(`BullMQ enqueue order event failed (sync): ${action} - ${err?.message || err}`);
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_DELIVERY_DISTANCE_KM = 50;

export function assertRestaurantDeliversToZone(
  restaurant,
  { zoneId, orderType, deliveryAddress } = {},
) {
  const type = String(orderType || "delivery").toLowerCase();
  if (type !== "delivery") return;

  const restaurantZoneId = restaurant?.zoneId ? String(restaurant.zoneId) : "";
  const deliveryZoneId = zoneId ? String(zoneId) : "";

  // Same-zone only: never allow Indore user → Punjab restaurant (or missing zone).
  if (restaurantZoneId) {
    if (!deliveryZoneId) {
      throw new ValidationError("Delivery location is outside this restaurant's service zone");
    }
    if (restaurantZoneId !== deliveryZoneId) {
      throw new ValidationError("This restaurant does not deliver to your selected location");
    }
  }

  if (
    restaurant?.location?.coordinates?.length === 2 &&
    deliveryAddress?.location?.coordinates?.length === 2
  ) {
    const [rLng, rLat] = restaurant.location.coordinates;
    const [dLng, dLat] = deliveryAddress.location.coordinates;
    const distanceKm = haversineKm(rLat, rLng, dLat, dLng);
    if (Number.isFinite(distanceKm) && distanceKm > MAX_DELIVERY_DISTANCE_KM) {
      throw new ValidationError("Delivery address is too far from this restaurant");
    }
  }
}

export function generateFourDigitDeliveryOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function sanitizeOrderForExternal(orderDoc) {
  const o = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  delete o.deliveryOtp;
  const dv = o.deliveryVerification;
  if (dv && dv.dropOtp != null) {
    const d = dv.dropOtp;
    o.deliveryVerification = {
      ...dv,
      dropOtp: {
        required: Boolean(d.required),
        verified: Boolean(d.verified),
      },
    };
  }
  o.orderMongoId = (o._id || orderDoc?._id || "").toString();
  // Ensure orderId field for UI always contains the pretty ID
  o.orderId = o.order_id || o.orderMongoId; 
  return o;
}

function deriveBaseFromAppliedPricingRule(price, item = {}) {
  const type = String(item?.appliedPricingType || '').toUpperCase();
  const value = Number(item?.appliedPricingValue);
  const selling = Number(price) || 0;
  if (!Number.isFinite(value) || value <= 0 || selling <= 0) return null;
  if (type === 'PERCENTAGE') {
    return Math.max(0, Math.round((selling / (1 + value / 100)) * 100) / 100);
  }
  if (type === 'FIXED') {
    return Math.max(0, Math.round((selling - value) * 100) / 100);
  }
  return null;
}

/** Unit price the restaurant owns (before admin markup). */
export function resolveRestaurantItemUnitPrice(item = {}) {
  const price = Number(item?.price) || 0;
  const markup = Number(item?.markupAmount) || 0;
  const other = Number(item?.otherPrice) || 0;
  const base = Number(item?.basePrice);
  const hasAdminScope =
    item?.pricingScope && String(item.pricingScope).toUpperCase() !== 'LEGACY';

  if (Number.isFinite(base) && base >= 0) {
    if (markup > 0 || (hasAdminScope && other > base + 0.01) || base < price - 0.01) {
      return base;
    }
    if (Math.abs(base - price) < 0.01) {
      const derived = deriveBaseFromAppliedPricingRule(price, item);
      if (derived != null && derived < price - 0.01) return derived;
    }
    return base;
  }

  if (markup > 0) return Math.max(0, Math.round((price - markup) * 100) / 100);

  const derived = deriveBaseFromAppliedPricingRule(price, item);
  if (derived != null) return derived;

  return price;
}

/**
 * Restaurant-facing order view: show restaurant base as price, but keep
 * admin markup metadata so the accept popup can show "149 + 51 = 200".
 */
/**
 * Pricing fields that exist only for the platform's own books.
 *
 * The admin markup (and the customer price it produces) is between the platform
 * and the customer: the restaurant is paid its own base price, and the rider
 * only collects the customer total. Neither app has any use for the split, and
 * showing it invited the question "who took this ₹14.90 from my bill?".
 * Removing it here - rather than hiding it in one screen - keeps it out of every
 * response, socket event and cached payload those apps receive.
 */
const stripItemFields = (item, fields) => {
  const out = { ...item };
  for (const field of fields) delete out[field];
  return out;
};

const stripPricingFields = (pricing, fields) => {
  if (!pricing || typeof pricing !== 'object') return pricing;
  const out = { ...pricing };
  for (const field of fields) delete out[field];
  return out;
};

/** Admin markup metadata, in every spelling older orders used. */
const MARKUP_ITEM_FIELDS = [
  'markupAmount',
  'lineMarkupTotal',
  'customerPrice',
  'otherPrice',
  'appliedPricingType',
  'appliedPricingValue',
  'pricingScope',
  'pricingRule',
];

/** Who cancelled, read from the cancel status itself. */
export const CANCELLED_BY_FOR_STATUS = {
  cancelled_by_restaurant: 'restaurant',
  cancelled_by_user: 'customer',
  cancelled_by_admin: 'admin',
};

const CANCELLED_BY_FOR_ROLE = { RESTAURANT: 'restaurant', USER: 'customer', ADMIN: 'admin' };

/** Status-history notes that record how a change was made, not why: never shown as a reason. */
const INTERNAL_STATUS_NOTE = /^admin override\b/i;

/**
 * Why, when and by whom a cancelled order was cancelled, as every client shows it.
 *
 * The order's own fields win - the restaurant, customer and admin cancel flows
 * set them. The status history is only a fallback, and its note counts as the
 * reason only when a person wrote it: an admin status override records
 * "Admin override — order status" there, which reached customers as the
 * reason. Who cancelled follows the cancel status before the role that wrote
 * the history, so "cancelled by restaurant" set by support on the restaurant's
 * behalf no longer read "Cancelled by support".
 */
export function deriveCancellationInfo(order = {}) {
  const status = String(order?.orderStatus || order?.status || '');
  if (!status.includes('cancel')) {
    return { cancellationReason: null, cancelledAt: null, cancelledBy: null };
  }
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const cancelHistory = [...history].reverse().find((h) => h?.to?.includes('cancel'));
  const historyNote = String(cancelHistory?.note || '').trim();
  return {
    cancellationReason:
      order?.cancellationReason ||
      (historyNote && !INTERNAL_STATUS_NOTE.test(historyNote) ? historyNote : ''),
    cancelledAt: order?.cancelledAt || cancelHistory?.at || null,
    cancelledBy:
      order?.cancelledBy ||
      CANCELLED_BY_FOR_STATUS[status] ||
      CANCELLED_BY_FOR_ROLE[cancelHistory?.byRole] ||
      'unknown',
  };
}

export function toRestaurantFacingOrder(orderDoc) {
  const order = sanitizeOrderForExternal(orderDoc);
  const pricing = order.pricing || {};
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const customerUnit = Number(item?.price) || 0;
        const restaurantUnit = resolveRestaurantItemUnitPrice(item);
        const qty = Number(item?.quantity) || 1;
        let markupUnit = Number(item?.markupAmount);
        if (!Number.isFinite(markupUnit) || markupUnit < 0) {
          markupUnit = Math.max(0, Math.round((customerUnit - restaurantUnit) * 100) / 100);
        }
        return {
          ...item,
          customerPrice: customerUnit,
          price: restaurantUnit,
          variantPrice: restaurantUnit,
          basePrice: restaurantUnit,
          markupAmount: markupUnit,
          otherPrice: Number(item?.otherPrice) || customerUnit,
          appliedPricingType: item?.appliedPricingType || null,
          appliedPricingValue: item?.appliedPricingValue ?? null,
          pricingScope: item?.pricingScope || item?.pricingRule?.scope || null,
          pricingRule: item?.pricingRule || null,
          lineMarkupTotal: Math.round(markupUnit * qty * 100) / 100,
        };
      })
    : [];

  const computedBaseSubtotal = items.reduce((sum, item) => {
    const unit = Number(item.price) || 0;
    const qty = Number(item.quantity) || 1;
    return sum + unit * qty;
  }, 0);

  const computedMarkupTotal = items.reduce((sum, item) => {
    return sum + (Number(item.lineMarkupTotal) || 0);
  }, 0);

  const storedBase = Number(pricing.baseSubtotal);
  const storedMarkup = Number(pricing.markupTotal);
  const storedSubtotal = Number(pricing.subtotal);
  let restaurantSubtotal = computedBaseSubtotal;
  if (Number.isFinite(storedBase) && storedBase >= 0) {
    restaurantSubtotal = storedBase;
  } else if (
    Number.isFinite(storedSubtotal) &&
    Number.isFinite(storedMarkup) &&
    storedMarkup > 0
  ) {
    restaurantSubtotal = Math.max(0, storedSubtotal - storedMarkup);
  }

  const markupTotal =
    Number.isFinite(storedMarkup) && storedMarkup >= 0
      ? storedMarkup
      : computedMarkupTotal;

  const packagingFee = Number(pricing.packagingFee) || 0;
  const restaurantTotal = Math.max(
    0,
    Math.round((restaurantSubtotal + packagingFee) * 100) / 100,
  );

  const customerNote = order?.restaurantNote || order?.note || "";
  const { cancellationReason, cancelledAt, cancelledBy } = deriveCancellationInfo(order);

  // `markupTotal` is still computed above because the restaurant's own base
  // subtotal is derived from it; it is not part of the response.
  return {
    ...order,
    note: customerNote,
    restaurantNote: customerNote,
    cancellationReason,
    cancelledAt,
    cancelledBy,
    // Prices here are the restaurant's own (base) prices, with no trace of the
    // admin markup or of what the customer was finally charged.
    items: items.map((item) => stripItemFields(item, MARKUP_ITEM_FIELDS)),
    pricing: {
      ...stripPricingFields(pricing, ['markupTotal']),
      subtotal: Math.round(restaurantSubtotal * 100) / 100,
      baseSubtotal: Math.round(restaurantSubtotal * 100) / 100,
      // Restaurant bill excludes delivery / platform fee from their earning total.
      deliveryFee: 0,
      platformFee: 0,
      total: restaurantTotal,
    },
    total: restaurantTotal,
    amount: restaurantTotal,
  };
}

/**
 * Order as the delivery partner may see it.
 *
 * The rider needs the customer-facing bill, because for COD that is the cash to
 * collect - but not how it is split between the restaurant and the platform.
 */
export function stripDeliveryPricingInternals(order) {
  if (!order || typeof order !== 'object') return order;
  return {
    ...order,
    items: Array.isArray(order.items)
      ? order.items.map((item) => stripItemFields(item, [...MARKUP_ITEM_FIELDS, 'basePrice']))
      : order.items,
    pricing: stripPricingFields(order.pricing, [
      'markupTotal',
      'baseSubtotal',
      'restaurantCommission',
    ]),
  };
}

export function toDeliveryFacingOrder(orderDoc) {
  return stripDeliveryPricingInternals(sanitizeOrderForExternal(orderDoc));
}

export function emitDeliveryDropOtpToUser(order, plainOtp) {
  try {
    const io = getIO();
    if (!io || !plainOtp || !order?.userId) return;

    const isTakeaway = order?.orderType === "takeaway";
    const message = isTakeaway
      ? "Share this OTP with the restaurant to pick up your order."
      : "Share this OTP with your delivery partner to hand over the order.";

    io.to(rooms.user(order.userId)).emit("delivery_drop_otp", {
      orderMongoId: order._id?.toString?.(),
      orderId: order.order_id || order._id?.toString?.(),
      otp: plainOtp,
      orderType: order?.orderType || "delivery",
      message,
    });
  } catch (e) {
    logger.warn(`emitDeliveryDropOtpToUser failed: ${e?.message || e}`);
  }
}

export async function notifyOwnersSafely(targets, payload) {
  try {
    await sendNotificationToOwners(targets, payload);
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnerSafely(target, payload) {
  try {
    await sendNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

/** Path segments that must never be treated as an order id (legacy Flutter polls). */
export const RESERVED_DELIVERY_ORDER_PATHS = new Set([
  "assigned",
  "active",
  "pending",
  "current",
  "available",
]);

export function buildOrderIdentityFilter(orderIdOrMongoId) {
  const raw = String(orderIdOrMongoId || "").trim();
  if (!raw) return null;
  // Prevent GET /orders/assigned|active|pending from becoming orderId lookups → 404 spam
  if (RESERVED_DELIVERY_ORDER_PATHS.has(raw.toLowerCase())) return null;
  if (mongoose.isValidObjectId(raw))
    return { _id: new mongoose.Types.ObjectId(raw) };

  // Search BOTH underscore and camelCase variants for robust lookup
  return {
    $or: [
      { order_id: raw },
      { orderId: raw },
    ],
  };
}

export function toGeoPoint(lat, lng) {
  if (lat == null || lng == null) return undefined;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { type: "Point", coordinates: [b, a] };
}

export function pushStatusHistory(order, { byRole, byId, from, to, note = "" }) {
  order.statusHistory.push({
    at: new Date(),
    byRole,
    byId: byId || undefined,
    from,
    to,
    note,
  });
}

export function normalizeOrderForClient(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const mongoId = (order._id || orderDoc?._id || "").toString();
  const displayId = order.order_id || mongoId;
  const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const lastHistory = statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : null;
  const { cancellationReason, cancelledAt, cancelledBy } = deriveCancellationInfo(order);

  return {
    ...order,
    orderMongoId: mongoId,
    orderId: displayId,
    status: order?.orderStatus || order?.status || "",
    deliveredAt:
      order?.deliveryState?.deliveredAt || order?.deliveredAt || null,
    deliveryPartnerId:
      order?.dispatch?.deliveryPartnerId || order?.deliveryPartnerId || null,
    rating: order?.ratings?.restaurant?.rating ?? order?.rating ?? null,
    restaurantNote: order?.restaurantNote || order?.note || "",
    note: order?.restaurantNote || order?.note || "",
    cancellationReason,
    cancelledAt,
    cancelledBy,
    adminStatusNote: (lastHistory && lastHistory.byRole === 'ADMIN' && lastHistory.note?.includes('Admin override'))
      ? `${lastHistory.note} from ${lastHistory.from} to ${lastHistory.to}`
      : null,
    deliveryState: {
      ...(order?.deliveryState || {}),
      currentLocation: order?.lastRiderLocation?.coordinates?.length >= 2 ? {
        lat: order.lastRiderLocation.coordinates[1],
        lng: order.lastRiderLocation.coordinates[0],
        at: order?.lastRiderLocationAt ? new Date(order.lastRiderLocationAt).getTime() : null
      } : (order?.deliveryState?.currentLocation || null)
    }
  };
}

export async function applyAggregateRating(model, entityId, newRating) {
  if (!entityId) return;
  const doc = await model.findById(entityId).select("rating totalRatings");
  if (!doc) return;

  const totalRatings = Number(doc.totalRatings || 0);
  const currentAverage = Number(doc.rating || 0);
  const nextTotal = totalRatings + 1;
  const nextAverage = Number(
    ((currentAverage * totalRatings + Number(newRating)) / nextTotal).toFixed(1),
  );

  doc.totalRatings = nextTotal;
  doc.rating = nextAverage;
  await doc.save();
}

/**
 * One-line customer address for the restaurant and rider screens: the house /
 * flat number first, the landmark right after the street.
 */
export function formatCustomerAddressLine(deliveryAddress = {}) {
  const landmark = String(deliveryAddress?.landmark || '').trim().replace(/^near\s+/i, '');
  return [
    deliveryAddress?.houseNumber,
    deliveryAddress?.street,
    deliveryAddress?.additionalDetails,
    landmark ? `Near ${landmark}` : '',
    deliveryAddress?.city,
    deliveryAddress?.state,
    deliveryAddress?.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(', ');
}

export function buildDeliverySocketPayload(orderDoc, restaurantDoc = null) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const restaurant = restaurantDoc || order?.restaurantId || null;
  const restaurantLocation = restaurant?.location || {};
  const deliveryAddress = order?.deliveryAddress || {};

  return {
    orderMongoId:
      orderDoc?._id?.toString?.() || order?._id?.toString?.() || order?._id,
    orderId: order?.order_id || order?._id?.toString?.(),
    status: orderDoc?.orderStatus || order?.orderStatus,
    items: Array.isArray(order?.items)
      ? order.items.map((item) => stripItemFields(item, [...MARKUP_ITEM_FIELDS, 'basePrice']))
      : order?.items || [],
    pricing: stripPricingFields(order?.pricing, [
      'markupTotal',
      'baseSubtotal',
      'restaurantCommission',
    ]),
    total: order?.pricing?.total,
    payment: order?.payment,
    paymentMethod: order?.payment?.method,
    restaurantId:
      order?.restaurantId?._id?.toString?.() ||
      order?.restaurantId?.toString?.() ||
      order?.restaurantId,
    restaurantName: restaurant?.restaurantName || order?.restaurantName,
    restaurantAddress:
      [
        restaurant?.addressLine1,
        restaurant?.addressLine2,
        restaurant?.area,
        restaurant?.city,
        restaurant?.state,
        restaurant?.pincode,
      ]
        .filter(Boolean)
        .join(', ') ||
      restaurantLocation?.address ||
      restaurantLocation?.formattedAddress ||
      "",
    restaurantPhone:
      restaurant?.primaryContactNumber ||
      restaurant?.ownerPhone ||
      restaurant?.phone ||
      "",
    restaurantLocation: {
      latitude: restaurantLocation?.latitude,
      longitude: restaurantLocation?.longitude,
      address:
        [
          restaurant?.addressLine1,
          restaurant?.addressLine2,
          restaurant?.area,
          restaurant?.city,
          restaurant?.state,
          restaurant?.pincode,
        ]
          .filter(Boolean)
          .join(', ') ||
        restaurantLocation?.address ||
        restaurantLocation?.formattedAddress ||
        "",
      area: restaurantLocation?.area || restaurant?.area || "",
      city: restaurantLocation?.city || restaurant?.city || "",
      state: restaurantLocation?.state || restaurant?.state || "",
    },
    deliveryAddress: order?.deliveryAddress,
    customerAddress: formatCustomerAddressLine(deliveryAddress),
    customerName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    customerPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    userName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    userPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    note: order?.note || "",
    riderEarning: order?.riderEarning || 0,
    // Never fall back to customer deliveryFee — that is not rider payout
    earnings: Number(order?.riderEarning || 0) || 0,
    // Breakdown of riderEarning: zone-wise base + Eatiefy incentive
    riderBaseEarning:
      order?.riderBaseEarning != null
        ? Number(order.riderBaseEarning) || 0
        : Number(order?.riderEarning || 0) || 0,
    eatiefyIncentiveAmount: Number(order?.eatiefyIncentive?.amount || 0) || 0,
    eatiefyIncentivePercent: Number(order?.eatiefyIncentive?.percent || 0) || 0,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    deliveryFleet: order?.deliveryFleet,
    dispatch: order?.dispatch,
    createdAt: order?.createdAt,
    updatedAt: order?.updatedAt,
  };
}

export function canExposeOrderToRestaurant(orderLike) {
  const method = String(orderLike?.payment?.method || "").toLowerCase();
  const status = String(orderLike?.payment?.status || "").toLowerCase();
  if (["cash", "wallet"].includes(method)) return true;
  return ["paid", "authorized", "captured", "settled"].includes(status);
}

/** Orders scheduled further ahead than this do not ring yet (same lead as the restaurant app). */
export const RESTAURANT_SCHEDULED_RING_LEAD_MS = 15 * 60 * 1000;

export function isRestaurantOrderDueToRing(orderLike, now = Date.now()) {
  const scheduledAt = orderLike?.scheduledAt ? new Date(orderLike.scheduledAt).getTime() : NaN;
  return !Number.isFinite(scheduledAt) || scheduledAt <= now + RESTAURANT_SCHEDULED_RING_LEAD_MS;
}

const getRestaurantOrderIdentity = (orderDoc) => {
  const orderMongoId = String(orderDoc._id?.toString?.() || orderDoc._id || '');
  const displayOrderId = String(orderDoc.order_id || orderDoc.orderId || orderMongoId);
  return {
    orderMongoId,
    displayOrderId,
    restaurantId: String(orderDoc.restaurantId?._id || orderDoc.restaurantId || ""),
    eventKey: `restaurant:new_order:${orderMongoId || displayOrderId}`,
    notificationTag: `restaurant-order-${displayOrderId || orderMongoId}`,
  };
};

/**
 * Push for an order awaiting the restaurant's decision. Ring 1 is the first
 * push; each repeat (restaurantOrderAlarm.service) gets its own idempotency key
 * so it is actually delivered, but keeps the tag, so the phone replaces the
 * notification instead of stacking one per ring.
 */
/** How long one VoIP call rings on the restaurant's iPhone before the alarm re-rings it. */
export const getRestaurantVoipRingMs = () => config.voipRestaurantRingSeconds * 1000;

/**
 * True when this ring should start a new VoIP call: none placed yet, or the
 * last one has finished ringing. In between, the call is still on screen.
 */
export function isRestaurantVoipCallDue(orderLike, now = Date.now()) {
  const last = orderLike?.restaurantAlarm?.lastVoipCallAt;
  const lastMs = last ? new Date(last).getTime() : NaN;
  return !Number.isFinite(lastMs) || now - lastMs >= getRestaurantVoipRingMs();
}

/**
 * `voipRing`: whether this push starts a VoIP call on the restaurant's iPhones
 * (true) or a call placed earlier is still ringing (false). Orders not due to
 * ring yet (scheduled) never call.
 */
export function buildRestaurantNewOrderPush(orderDoc, { ringSeq = 1, now = Date.now(), voipRing = true } = {}) {
  const { orderMongoId, displayOrderId, restaurantId, eventKey, notificationTag } =
    getRestaurantOrderIdentity(orderDoc);
  const pushKey = ringSeq > 1 ? `${eventKey}:ring:${ringSeq}` : eventKey;
  const isDueToRing = isRestaurantOrderDueToRing(orderDoc, now);
  return {
    ...(isDueToRing
      ? {
          voipCall: {
            orderKey: orderMongoId || displayOrderId,
            ring: voipRing,
            ringSeconds: config.voipRestaurantRingSeconds,
            callType: "restaurant_new_order",
          },
        }
      : {}),
    title: "🔔 New order received",
    body: `Order #${displayOrderId} is waiting for review.`,
    sound: getNewOrderAlertSound(),
    urgent: true,
    // Android installs that render the alarm themselves get it data-only.
    orderAlarm: true,
    channelId: "restaurant_orders",
    sendToAllDevices: true,
    // The restaurant app lives under /food/restaurant; its dashboard shows the
    // new-order popup with accept/reject. "/restaurant/orders/…" was not a route.
    link: "/food/restaurant",
    idempotencyKey: pushKey,
    eventId: pushKey,
    tag: notificationTag,
    data: {
      type: "new_order",
      eventId: pushKey,
      idempotencyKey: pushKey,
      orderEventId: eventKey,
      tag: notificationTag,
      orderId: displayOrderId,
      orderMongoId: orderMongoId,
      // Addressee + state, so the app rings only for its own restaurant's
      // new orders (a device token can still be tied to another account).
      restaurantId,
      orderStatus: String(orderDoc.orderStatus || ""),
      // "1": ring until answered. "0": a scheduled order not due yet — notify only.
      alarm: isDueToRing ? "1" : "0",
      ringSeq: String(ringSeq),
      sentAt: String(now),
      link: "/food/restaurant",
      targetUrl: "/food/restaurant",
    },
  };
}

/** Tells alarm-capable phones the order no longer awaits the restaurant: stop ringing. */
export function buildRestaurantOrderAlarmStopPush(orderDoc) {
  const { orderMongoId, displayOrderId, restaurantId, eventKey, notificationTag } =
    getRestaurantOrderIdentity(orderDoc);
  const stopKey = `${eventKey}:resolved`;
  return {
    title: "Order update",
    body: `Order #${displayOrderId} is no longer waiting.`,
    dataOnly: true,
    alarmTokensOnly: true,
    idempotencyKey: stopKey,
    eventId: stopKey,
    tag: notificationTag,
    data: {
      type: "new_order_resolved",
      eventId: stopKey,
      orderEventId: eventKey,
      tag: notificationTag,
      orderId: displayOrderId,
      orderMongoId,
      restaurantId,
      orderStatus: String(orderDoc.orderStatus || ""),
    },
  };
}

export async function notifyRestaurantNewOrder(orderDoc) {
  try {
    if (!orderDoc || !canExposeOrderToRestaurant(orderDoc)) return;

    // Start the accept window when the restaurant first actually receives the order
    // (for online payments that is after payment, not at checkout). The alarm
    // starts with it: this first push is ring 1, repeated until it is answered.
    if (!orderDoc.restaurantNotifiedAt) {
      const notifiedAt = new Date();
      const FoodOrderModel = mongoose.models.FoodOrder;
      if (FoodOrderModel && orderDoc._id) {
        const res = await FoodOrderModel.updateOne(
          { _id: orderDoc._id, restaurantNotifiedAt: null },
          {
            $set: {
              restaurantNotifiedAt: notifiedAt,
              restaurantAlarm: {
                active: true,
                startedAt: notifiedAt,
                lastRingAt: notifiedAt,
                ringCount: 1,
                // The push below starts the VoIP call when the order is due to ring.
                lastVoipCallAt: isRestaurantOrderDueToRing(orderDoc, notifiedAt.getTime()) ? notifiedAt : null,
                stoppedAt: null,
              },
            },
          },
        );
        if (res?.modifiedCount) {
          orderDoc.restaurantNotifiedAt = notifiedAt;
        } else {
          const stored = await FoodOrderModel.findById(orderDoc._id).select("restaurantNotifiedAt").lean();
          if (stored?.restaurantNotifiedAt) orderDoc.restaurantNotifiedAt = stored.restaurantNotifiedAt;
        }
      }
    }

    const { orderMongoId, displayOrderId, eventKey, notificationTag } = getRestaurantOrderIdentity(orderDoc);

    const io = getIO();
    if (io) {
      // Same identity the push carries, so the socket fallback and the push
      // resolve to one notification on the device instead of two.
      const payload = {
        ...toRestaurantFacingOrder(orderDoc),
        eventId: eventKey,
        idempotencyKey: eventKey,
        notificationTag,
      };
      await enrichOrdersWithFoodImages([payload]);
      logger.info(
        `[RestaurantOrders] Emitting new_order to ${rooms.restaurant(orderDoc.restaurantId)} for order ${orderMongoId}`,
      );
      io.to(rooms.restaurant(orderDoc.restaurantId)).emit("new_order", payload);
      const adminOrderPayload = {
        ...payload,
        orderId: displayOrderId,
        orderMongoId,
        orderStatus: orderDoc.orderStatus || "pending",
        restaurantName: orderDoc.restaurantName || payload?.restaurantName || "",
      };
      io.to(rooms.admins()).emit("admin_new_order", adminOrderPayload);
      io.to(rooms.admins()).emit("new_order", adminOrderPayload);
    }

    await notifyOwnersSafely(
      [{ ownerType: "RESTAURANT", ownerId: orderDoc.restaurantId }],
      buildRestaurantNewOrderPush(orderDoc),
    );

    // Admins get a server push for every new order too (previously none existed).
    const adminEventKey = `admin:new_order:${orderMongoId || displayOrderId}`;
    await notifyAdminsSafely({
      title: "New order placed",
      body: `Order #${displayOrderId} has been placed.`,
      sound: getNewOrderAlertSound(),
      urgent: true,
      channelId: "admin_orders",
      link: "/admin/orders/all",
      idempotencyKey: adminEventKey,
      eventId: adminEventKey,
      tag: `admin-order-${displayOrderId || orderMongoId}`,
      data: {
        type: "admin_new_order",
        eventId: adminEventKey,
        orderId: displayOrderId,
        orderMongoId,
        link: "/admin/orders/all",
        targetUrl: "/admin/orders/all",
      },
    });
  } catch {
    // Do not block order/payment flow if notification fails.
  }
}

export const STATUS_PRIORITY = {
  created: 10,
  confirmed: 20,
  preparing: 30,
  ready_for_pickup: 40,
  reached_pickup: 50,
  picked_up: 60,
  reached_drop: 70,
  delivered: 80,
  cancelled_by_user: 100,
  cancelled_by_restaurant: 100,
  cancelled_by_admin: 100,
};

/**
 * Returns true if the next status is a valid forward progression from the current status.
 * Prevents "reversing" order status (e.g. from Preparing back to Created).
 */
export function isStatusAdvance(current, next) {
  // If current status is missing, it's effectively 'created' or start of flow
  if (!current) return true;
  
  const currentPrio = STATUS_PRIORITY[current] || 0;
  const nextPrio = STATUS_PRIORITY[next] || 0;

  // Terminal states (100) cannot transition to anything else
  if (currentPrio >= 100) return false;
  
  // Delivered (80) cannot transition to anything (except maybe cancellation if allowed, but here we say no)
  if (currentPrio === 80) return false;

  // Special case: Cancellation is almost always an advance unless already delivered
  if (nextPrio === 100 && currentPrio < 80) return true;

  return nextPrio > currentPrio;
}

export function normalizeOtpValue(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

export function isOtpMatch(expectedOtp, enteredOtp) {
  const expected = normalizeOtpValue(expectedOtp);
  const entered = normalizeOtpValue(enteredOtp);
  if (!expected || !entered) return false;
  if (entered === expected) return true;

  // Accept last 4 digits if client sends prefixed/padded OTP.
  if (expected.length === 4 && entered.length > 4) {
    return entered.slice(-4) === expected;
  }

  return false;
}

export async function enrichOrdersWithFoodImages(orders) {
  if (!orders) return orders;
  const list = Array.isArray(orders) ? orders : [orders];
  if (list.length === 0) return orders;

  const missingItemIds = [];
  const missingItemNames = [];

  for (const order of list) {
    const items = order?.items || order?.orderItems || [];
    for (const item of items) {
      if (!item.image && !item.imageUrl) {
        const idStr = String(item.itemId || item.id || item._id || '').trim();
        if (idStr && mongoose.Types.ObjectId.isValid(idStr)) {
          missingItemIds.push(idStr);
        }
        if (item.name) {
          missingItemNames.push(String(item.name).trim());
        }
      }
    }
  }

  if (missingItemIds.length === 0 && missingItemNames.length === 0) {
    return orders;
  }

  const foodDocsMap = new Map();
  const foodDocsByName = new Map();

  try {
    if (missingItemIds.length > 0) {
      const foods = await FoodItem.find({ _id: { $in: missingItemIds } })
        .select('_id image foodType name restaurantId')
        .lean();
      for (const f of foods) {
        if (f.image) {
          foodDocsMap.set(String(f._id), f.image);
          if (f.name) {
            const restId = String(f.restaurantId || '');
            const lowerName = String(f.name).toLowerCase().trim();
            if (restId) foodDocsByName.set(`${restId}_${lowerName}`, f.image);
            if (!foodDocsByName.has(lowerName)) {
              foodDocsByName.set(lowerName, f.image);
            }
          }
        }
      }
    }

    if (missingItemNames.length > 0) {
      const uniqueNames = [...new Set(missingItemNames.map(n => n.toLowerCase().trim()))];
      const regexConditions = uniqueNames.map(n => ({
        name: { $regex: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }));
      if (regexConditions.length > 0) {
        const foods = await FoodItem.find({ $or: regexConditions })
          .select('_id image foodType name restaurantId')
          .lean();
        for (const f of foods) {
          if (f.image) {
            const restId = String(f.restaurantId || '');
            const lowerName = String(f.name).toLowerCase().trim();
            if (restId) foodDocsByName.set(`${restId}_${lowerName}`, f.image);
            if (!foodDocsByName.has(lowerName)) {
              foodDocsByName.set(lowerName, f.image);
            }
          }
        }
      }
    }

    for (const order of list) {
      const items = order?.items || order?.orderItems || [];
      const restId = String(order.restaurantId?._id || order.restaurantId || '');
      for (const item of items) {
        if (!item.image && !item.imageUrl) {
          const idStr = String(item.itemId || item.id || item._id || '').trim();
          const byId = idStr ? foodDocsMap.get(idStr) : null;
          if (byId) {
            item.image = byId;
          } else if (item.name) {
            const lowerName = String(item.name).toLowerCase().trim();
            const byRestAndName = restId ? foodDocsByName.get(`${restId}_${lowerName}`) : null;
            const byName = foodDocsByName.get(lowerName);
            item.image = byRestAndName || byName || '';
          }
        }
      }
    }
  } catch (enrichErr) {
    logger.warn(`[enrichOrdersWithFoodImages] Error enriching food images: ${enrichErr?.message || enrichErr}`);
  }

  return orders;
}
