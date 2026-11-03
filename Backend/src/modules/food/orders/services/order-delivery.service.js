import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import { resolveDeliveryCashLimitForPartner } from '../../admin/services/zoneDeliverySettings.service.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { buildPaginatedResult, buildPaginationOptions } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { createInboxNotifications } from '../../../../core/notifications/notification.service.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import {
  fetchRazorpayPaymentLink,
  isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import { fetchPolyline, toGeoJsonPoint } from '../utils/googleMaps.js';
import {
  ensureRiderEarningOnOrder,
} from './riderEarning.service.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as dispatchService from './order-dispatch.service.js';
import {
  buildOrderIdentityFilter,
  emitDeliveryDropOtpToUser,
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersSafely,
  pushStatusHistory,
  toDeliveryFacingOrder,
  isStatusAdvance,
} from './order.helpers.js';
import { detectZoneIdForPoint, getActiveZoneById, isPointInZonePolygon } from '../../utils/zoneGeo.js';
import {
  MAX_OFFER_VALIDITY_MS,
  expireStaleOffers,
  findLiveOfferForPartner,
  liveOfferElemMatch,
  offerExpiresAt,
} from './delivery-offer.util.js';

/** Match dispatch hard cap — never list/accept cross-city absurd distances. */
const HARD_MAX_OFFER_DISTANCE_KM = 40;

function normalizeOtpValue(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

function isOtpMatch(expectedOtp, enteredOtp) {
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

const ACTIVE_TRIP_ORDER_STATUSES = ['preparing', 'ready_for_pickup', 'picked_up'];

/** How many orders a rider may carry at once: their zone's value, else the default. */
export async function getMaxConcurrentOrders(deliveryPartnerId = null) {
  const settings = await resolveDeliveryCashLimitForPartner(deliveryPartnerId);
  return settings.maxConcurrentOrders;
}

export async function countActiveTripsForPartner(deliveryPartnerId) {
  if (!deliveryPartnerId) return 0;
  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  return FoodOrder.countDocuments({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $in: ACTIVE_TRIP_ORDER_STATUSES },
  });
}

export async function getPartnerOrderCapacity(deliveryPartnerId) {
  const [max, active] = await Promise.all([
    getMaxConcurrentOrders(deliveryPartnerId),
    countActiveTripsForPartner(deliveryPartnerId),
  ]);
  const remaining = Math.max(0, max - active);
  return { max, active, remaining };
}

async function enrichOrderWithTransaction(order) {
  if (!order) return null;
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const out = toDeliveryFacingOrder(order);
  if (tx) {
    out.paymentMethod = tx.payment?.method || tx.paymentMethod || out.paymentMethod;
    out.payment = tx.payment || out.payment;
    out.pricing = tx.pricing || out.pricing;
    out.amounts = tx.amounts || out.amounts;
    out.transactionStatus = tx.status || out.transactionStatus;
  }
  return out;
}

export async function getActiveTripsDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) {
    throw new ValidationError('Delivery partner ID required');
  }

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const orders = await FoodOrder.find({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $in: ACTIVE_TRIP_ORDER_STATUSES },
  })
    .populate({
      path: 'restaurantId',
      select:
        'restaurantName name phone ownerPhone primaryContactNumber location addressLine1 addressLine2 area city state pincode landmark profileImage',
    })
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ updatedAt: -1 })
    .lean();

  const enriched = await Promise.all(
    (orders || []).map((order) => enrichOrderWithTransaction(order)),
  );
  return enriched.filter(Boolean);
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  const orders = await getActiveTripsDelivery(deliveryPartnerId);
  return orders[0] || null;
}

async function getPartnerCashCapacity(deliveryPartnerId) {
  const partnerObjectId = new mongoose.Types.ObjectId(deliveryPartnerId);
  // The rider's own zone limit (zone override, else the default).
  const limitSettings = await resolveDeliveryCashLimitForPartner(deliveryPartnerId);

  const totalCashLimit = Number(limitSettings?.deliveryCashLimit || 0);
  // If limit is not configured, don't block assignments globally.
  if (!Number.isFinite(totalCashLimit) || totalCashLimit <= 0) {
    return {
      totalCashLimit: 0,
      cashInHand: 0,
      availableCashLimit: Number.MAX_SAFE_INTEGER,
      hasCapacity: true,
    };
  }

  const [cashAgg, depositsAgg] = await Promise.all([
    FoodOrder.aggregate([
      {
        $match: {
          'dispatch.deliveryPartnerId': partnerObjectId,
          orderStatus: 'delivered',
        },
      },
      {
        $lookup: {
          from: 'food_transactions',
          localField: '_id',
          foreignField: 'orderId',
          as: 'tx',
        },
      },
      {
        $match: {
          $or: [
            { 'tx.paymentMethod': 'cash' },
            { 'tx': { $size: 0 }, 'payment.method': 'cash' }
          ]
        }
      },
      {
        $group: {
          _id: null,
          grossCashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } },
        },
      },
    ]),
    FoodDeliveryCashDeposit.aggregate([
      {
        $match: {
          deliveryPartnerId: partnerObjectId,
          status: 'Completed',
        },
      },
      {
        $group: {
          _id: null,
          depositedCash: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
  ]);

  const grossCashCollected = Number(cashAgg?.[0]?.grossCashCollected || 0);
  const depositedCash = Number(depositsAgg?.[0]?.depositedCash || 0);
  const cashInHand = Math.max(0, grossCashCollected - depositedCash);
  const availableCashLimit = Math.max(0, totalCashLimit - cashInHand);

  return {
    totalCashLimit,
    cashInHand,
    availableCashLimit,
    hasCapacity: availableCashLimit > 0,
  };
}

function emitOrderUpdate(order, deliveryPartnerId, options = {}) {
  const shouldSendMilestonePush = options?.sendMilestonePush !== false;
  try {
    const io = getIO();
    if (io) {
      const dv =
        order.deliveryVerification?.toObject?.() || order.deliveryVerification;
      const readableId = order.orderId || (order._id ? `FOD-${order._id.toString().slice(-6).toUpperCase()}` : '');
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: readableId,
        displayOrderId: readableId,
        orderStatus: order.orderStatus,
        deliveryState: order.deliveryState,
        deliveryVerification: dv,
        dispatchStatus: order.dispatch?.status,
        deliveryPartnerId: String(deliveryPartnerId || order.dispatch?.deliveryPartnerId || ''),
        updatedAt: new Date().toISOString(),
      };
      io.to(rooms.delivery(deliveryPartnerId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.restaurant(order.restaurantId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);

      const trackingIds = [
        order._id?.toString?.(),
        order.order_id ? String(order.order_id) : '',
        order.orderId ? String(order.orderId) : '',
        readableId,
      ].filter(Boolean);
      for (const tId of new Set(trackingIds)) {
        io.to(rooms.tracking(tId)).emit('order_status_update', payload);
      }
    }

    // Location packets carry the order status; drop the cached assignment so the
    // next GPS fix reflects this transition instead of one up to 10s old.
    // If the order has entered a live-trackable status (e.g. picked_up), publish
    // the rider's latest location immediately with 0ms delay.
    import('../../delivery/services/riderLocation.service.js')
      .then(({ invalidateRiderActiveOrders, publishLastKnownRiderLocation, isLiveTrackableOrderStatus }) => {
        const partner = deliveryPartnerId || order.dispatch?.deliveryPartnerId;
        if (partner) {
          invalidateRiderActiveOrders(partner);
          if (isLiveTrackableOrderStatus(order.orderStatus)) {
            publishLastKnownRiderLocation(partner).catch(() => {});
          }
        }
      })
      .catch(() => {});

    // Only send push notifications for key delivery milestones when explicitly allowed.
    if (!shouldSendMilestonePush) return;

    // Only send push notifications for key delivery milestones
    const status = order.orderStatus;
    if (!['picked_up', 'reached_drop', 'delivered'].includes(status)) return;

    let userTitle = '';
    let userBody = '';
    let riderTitle = '';
    let riderBody = '';

    const orderId = order._id.toString();
    const displayOrderId = order.order_id || orderId;

    if (status === 'picked_up') {
      userTitle = 'Order on the way!';
      userBody = `Partner has picked up your order #${orderId} and is heading your way.`;
      riderTitle = 'Order picked up!';
      riderBody = `You have picked up order #${displayOrderId}. Proceed to the customer location.`;
    } else if (status === 'reached_drop') {
      userTitle = 'Partner nearby!';
      userBody = `Your delivery partner has reached your location for order #${orderId}.`;
      riderTitle = 'Arrived at drop!';
      riderBody = `You have reached the customer location for order #${displayOrderId}.`;
    } else if (status === 'delivered') {
      userTitle = `Order #${orderId} delivered!`;
      userBody = 'Hope you enjoyed your meal! Don\'t forget to rate your experience.';
      riderTitle = 'Delivery successful!';
      riderBody = `Order #${displayOrderId} has been successfully delivered.`;

      if (order.payment?.method === 'cash' || order.paymentMethod === 'cash') {
        riderTitle = 'Payment collected!';
        const amt = order.pricing?.total || order.amounts?.totalCustomerPaid || 0;
        riderBody = `You have collected Rs ${amt} cash for Order #${displayOrderId}.`;
      }
    }

    if (userTitle) {
      void notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: userTitle,
          body: userBody,
          idempotencyKey: `delivery_status_user_${status}_${order._id}`,
          eventId: `delivery_status_user_${status}_${order._id}`,
          tag: `delivery_status_${status}_${order._id}`,
          // Must include notification payload so Android/iOS show tray UI when app is killed
          data: {
            type: 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            orderStatus: status,
            link: `/food/user/orders/${order._id?.toString?.() || ''}`,
            tag: `delivery_status_${status}_${order._id}`,
            eventId: `delivery_status_user_${status}_${order._id}`,
          },
        },
      );
    }

    if (riderTitle) {
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        {
          title: riderTitle,
          body: riderBody,
          dataOnly: true,
          idempotencyKey: `delivery_status_rider_${status}_${order._id}`,
          eventId: `delivery_status_rider_${status}_${order._id}`,
          tag: `delivery_status_${status}_${order._id}`,
          data: {
            type: status === 'delivered' ? 'order_completed' : 'order_status_update',
            orderId: displayOrderId,
            orderMongoId: order._id?.toString?.() || '',
            title: riderTitle,
            body: riderBody,
            paymentMethod: order.payment?.method || order.paymentMethod,
            amountCollected: String(order.pricing?.total || order.amounts?.totalCustomerPaid || 0),
            tag: `delivery_status_${status}_${order._id}`,
            eventId: `delivery_status_rider_${status}_${order._id}`,
          },
        },
      );
    }
  } catch (error) {
    logger.error(`Error emitting delivery order update: ${error?.message || error}`);
  }
}

async function syncRazorpayQrPayment(orderDoc) {
  // Phase 2: FoodTransaction is source of truth; avoid relying on FoodOrder.payment.
  const tx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  const payment = tx?.payment || orderDoc?.payment || null;
  if (!payment) return null;
  if (payment.method !== 'razorpay_qr') return payment;
  if (payment.status === 'paid') return payment;

  const paymentLinkId = payment?.qr?.paymentLinkId;
  if (!paymentLinkId || !isRazorpayConfigured()) return payment;

  let link;
  try {
    link = await fetchRazorpayPaymentLink(paymentLinkId);
  } catch (error) {
    logger.warn(
      `Razorpay payment-link fetch failed for ${paymentLinkId}: ${
        error?.message || error
      }`,
    );
    return orderDoc.payment;
  }

  const linkStatus = String(link?.status || '').toLowerCase();
  if (!linkStatus) return orderDoc.payment;

  await FoodTransaction.updateOne(
    { orderId: orderDoc?._id },
    {
      $set: {
        'payment.qr.status': linkStatus,
        'payment.status': ['paid', 'captured', 'authorized'].includes(linkStatus)
          ? 'paid'
          : ['expired', 'cancelled', 'canceled', 'failed'].includes(linkStatus)
            ? 'failed'
            : (payment.status || 'pending_qr'),
      },
    },
  );

  const updatedTx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  return updatedTx?.payment || payment;
}

export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const now = new Date();
  /*
   * Retire this rider's dead offers before answering.
   *
   * The scheduled timeout check runs on BullMQ, so with Redis off it never
   * fires and offers stay `offered` forever - which is how a request from
   * hours ago survives a logout and reappears on the next login. Expiring on
   * read makes the API self-correcting: whatever the queue did or did not do,
   * this endpoint can only ever return offers still inside their window, and
   * the riders whose offers just died are told so their cards and ringtones
   * stop.
   */
  await expireStaleOffersForPartner(deliveryPartnerId, now);

  const [partnerCapacity, orderCapacity, partner] = await Promise.all([
    getPartnerCashCapacity(deliveryPartnerId),
    getPartnerOrderCapacity(deliveryPartnerId),
    FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('lastLat lastLng lastLocationAt createdAt')
      .lean(),
  ]);
  const cashLimit = {
    blocked: !partnerCapacity.hasCapacity,
    message: !partnerCapacity.hasCapacity
      ? 'Please deposit your amount to get new orders.'
      : '',
    totalCashLimit: Number(partnerCapacity.totalCashLimit || 0),
    cashInHand: Number(partnerCapacity.cashInHand || 0),
    availableCashLimit: Number(partnerCapacity.availableCashLimit || 0),
  };

  const activeOwnOrderFilter = {
    orderType: 'delivery',
    'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(deliveryPartnerId),
    orderStatus: {
      $nin: [
        'delivered',
        'cancelled_by_user',
        'cancelled_by_restaurant',
        'cancelled_by_admin',
      ],
    },
  };

  // Zone-scope new offers: partner must be inside the same service zone as the restaurant GPS.
  const partnerZoneId = await detectZoneIdForPoint(partner?.lastLat, partner?.lastLng);
  const partnerZoneDoc = partnerZoneId ? await getActiveZoneById(partnerZoneId) : null;

  let unassignedOfferFilter = null;
  if (
    partnerCapacity.hasCapacity &&
    orderCapacity.remaining > 0 &&
    partnerZoneId
  ) {
    /*
     * Authorization is the OFFER, not the zone.
     *
     * This used to match every unassigned order in the partner's zone, so any
     * rider in the zone could pull a job the assignment engine never offered
     * them - the REST equivalent of a zone-wide broadcast, undoing the
     * per-partner socket targeting. Zone stays on only as a secondary guard.
     *
     * `liveOfferElemMatch` requires an offer addressed to THIS partner that is
     * still pending and inside its window. Rows with no `expiresAt` used to be
     * waved through as non-expiring - the single biggest source of "old orders
     * are back after login" - and now fall back to their creation stamp, with
     * every offer capped at ten minutes from creation regardless.
     */
    unassignedOfferFilter = {
      orderType: 'delivery',
      'dispatch.status': 'unassigned',
      orderStatus: { $in: ['preparing', 'ready_for_pickup'] },
      zoneId: new mongoose.Types.ObjectId(partnerZoneId),
      'dispatch.offeredTo': {
        $elemMatch: liveOfferElemMatch(deliveryPartnerId, now),
      },
    };
  }

  const filter = unassignedOfferFilter
    ? { $or: [unassignedOfferFilter, activeOwnOrderFilter] }
    : activeOwnOrderFilter;

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name phone email')
      .populate(
        'restaurantId',
        'restaurantName name address phone ownerPhone location profileImage zoneId',
      )
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);

  const orderIds = (docs || []).map((d) => d?._id).filter(Boolean);
  const txRows = orderIds.length
    ? await FoodTransaction.find({ orderId: { $in: orderIds } }).lean()
    : [];
  const txByOrderId = new Map(txRows.map((t) => [String(t.orderId), t]));

  const enriched = (docs || []).map((doc) => {
    const tx = txByOrderId.get(String(doc?._id)) || null;
    if (!tx) return doc;
    return {
      ...doc,
      paymentMethod: tx.payment?.method || tx.paymentMethod || doc.paymentMethod,
      payment: tx.payment || doc.payment,
      pricing: tx.pricing || doc.pricing,
      amounts: tx.amounts || doc.amounts,
      transactionStatus: tx.status || doc.transactionStatus,
    };
  });

  const isRestaurantInPartnerZone = (order) => {
    const coords = order?.restaurantId?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2 || !partnerZoneDoc) return false;
    const [rLng, rLat] = coords;
    return isPointInZonePolygon(rLat, rLng, partnerZoneDoc.coordinates || []);
  };

  const isWithinOfferDistance = (order) => {
    const coords = order?.restaurantId?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return false;
    if (partner?.lastLat == null || partner?.lastLng == null) return false;
    const [rLng, rLat] = coords;
    const d = haversineKm(partner.lastLat, partner.lastLng, rLat, rLng);
    return Number.isFinite(d) && d <= HARD_MAX_OFFER_DISTANCE_KM;
  };

  /*
   * Account floor: an offer made before this rider's account existed cannot be
   * theirs. Offers are already per-partner so this should never fire - it is
   * here so a brand-new account is provably incapable of inheriting anything,
   * whatever a recycled id or a restored backup might do to `offeredTo`.
   */
  const accountCreatedAt = partner?.createdAt ? new Date(partner.createdAt) : null;

  const newOffers = enriched
    .filter((order) => {
      const orderStatus = String(order?.orderStatus || '').toLowerCase();
      const isOwnAccepted =
        String(order?.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId);
      if (isOwnAccepted) return false;

      // Ownership: a live offer addressed to this rider, re-checked in memory
      // so the response can never widen past what the query authorised.
      const liveOffer = findLiveOfferForPartner(order, deliveryPartnerId, now);
      if (!liveOffer) return false;
      if (accountCreatedAt && offerExpiresAt(liveOffer) <= accountCreatedAt) return false;

      return (
        partnerZoneId &&
        isRestaurantInPartnerZone(order) &&
        isWithinOfferDistance(order) &&
        ['preparing', 'ready_for_pickup'].includes(orderStatus)
      );
    })
    .map((order) => {
      const liveOffer = findLiveOfferForPartner(order, deliveryPartnerId, now);
      const expiresAt = offerExpiresAt(liveOffer);
      return {
        ...order,
        // Per-recipient offer window, so the client can hide an expiring card
        // on its own between polls instead of waiting for a socket event.
        targetPartnerId: String(deliveryPartnerId),
        offerCreatedAt: liveOffer?.createdAt || liveOffer?.at || null,
        offerExpiresAt: expiresAt,
        offerExpiresInMs: Math.max(0, expiresAt.getTime() - now.getTime()),
        // Never ship the full offer roster - it names every other rider.
        dispatch: {
          status: order?.dispatch?.status,
          offeredTo: [
            {
              partnerId: String(deliveryPartnerId),
              action: 'offered',
              createdAt: liveOffer?.createdAt || liveOffer?.at || null,
              expiresAt,
            },
          ],
        },
      };
    });

  const acceptedOrders = enriched.filter((order) => {
    const dispatchStatus = String(order?.dispatch?.status || '').toLowerCase();
    const partnerMatch =
      String(order?.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId);
    return dispatchStatus === 'accepted' && partnerMatch;
  });

  /*
   * The raw `docs` list is what older clients read, and it carried the full
   * `offeredTo` roster - every other rider's id, plus dead offers this rider
   * could no longer accept. Each doc is reduced to this rider's own offer row
   * so no response from this endpoint describes anybody else's request.
   */
  const scopedDocs = enriched.map((order) => {
    const ownOffer = (order?.dispatch?.offeredTo || []).find(
      (entry) => String(entry?.partnerId || '') === String(deliveryPartnerId),
    );
    return {
      ...order,
      targetPartnerId: String(deliveryPartnerId),
      dispatch: {
        ...(order?.dispatch || {}),
        offeredTo: ownOffer
          ? [
              {
                partnerId: String(deliveryPartnerId),
                action: ownOffer.action,
                createdAt: ownOffer.createdAt || ownOffer.at || null,
                expiresAt: offerExpiresAt(ownOffer),
              },
            ]
          : [],
      },
    };
  });

  return {
    ...buildPaginatedResult({ docs: scopedDocs, total, page, limit }),
    cashLimit,
    capacity: orderCapacity,
    newOffers,
    acceptedOrders,
  };
}

/**
 * Marks this rider's expired offers as timed out and tells them, on read.
 *
 * Bounded to orders this partner actually holds a pending offer on, so it stays
 * a cheap indexed lookup on every available-orders poll rather than a scan.
 */
async function expireStaleOffersForPartner(deliveryPartnerId, now = new Date()) {
  try {
    const cutoff = new Date(now.getTime() - MAX_OFFER_VALIDITY_MS);
    const stale = await FoodOrder.find({
      'dispatch.status': { $ne: 'accepted' },
      'dispatch.offeredTo': {
        $elemMatch: {
          partnerId: new mongoose.Types.ObjectId(String(deliveryPartnerId)),
          action: 'offered',
          $or: [{ expiresAt: { $lte: now } }, { expiresAt: null, at: { $lte: cutoff } }],
        },
      },
    })
      .select('dispatch')
      .limit(50);

    for (const order of stale) {
      const expiredPartnerIds = expireStaleOffers(order, now);
      if (!expiredPartnerIds.length) continue;
      await order.save();
      dispatchService.notifyOffersExpired(order, expiredPartnerIds);
    }
  } catch (err) {
    // Never fail the rider's feed because the cleanup pass tripped; the
    // read-side filter already refuses to return an expired offer.
    logger.warn(`expireStaleOffersForPartner failed: ${err?.message || err}`);
  }
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

  const existingOrder = await FoodOrder.findOne(identity)
    .select('pricing payment dispatch orderStatus zoneId restaurantId')
    .populate({ path: 'restaurantId', select: 'zoneId location' })
    .lean();
  if (!existingOrder) throw new NotFoundError('Order not found');

  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
    .select('lastLat lastLng lastLocationAt')
    .lean();
  const partnerZoneId = await detectZoneIdForPoint(partner?.lastLat, partner?.lastLng);
  const restaurantCoords = existingOrder?.restaurantId?.location?.coordinates;
  const restaurantZoneId =
    Array.isArray(restaurantCoords) && restaurantCoords.length >= 2
      ? await detectZoneIdForPoint(restaurantCoords[1], restaurantCoords[0])
      : String(existingOrder?.zoneId || existingOrder?.restaurantId?.zoneId || '').trim() || null;
  const orderZoneId = String(
    restaurantZoneId || existingOrder?.zoneId || existingOrder?.restaurantId?.zoneId || '',
  ).trim();

  const alreadyAcceptedByPartnerEarly =
    existingOrder?.dispatch?.status === 'accepted' &&
    String(existingOrder?.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId);

  if (!alreadyAcceptedByPartnerEarly) {
    if (!partnerZoneId || !orderZoneId || partnerZoneId !== orderZoneId) {
      throw new ForbiddenError('This order is outside your service zone');
    }
    if (
      Array.isArray(restaurantCoords) &&
      restaurantCoords.length >= 2 &&
      partner?.lastLat != null &&
      partner?.lastLng != null
    ) {
      const d = haversineKm(
        partner.lastLat,
        partner.lastLng,
        restaurantCoords[1],
        restaurantCoords[0],
      );
      if (!Number.isFinite(d) || d > HARD_MAX_OFFER_DISTANCE_KM) {
        throw new ForbiddenError('This order is too far from your current location');
      }
    }
  }

  const paymentMethod = String(existingOrder?.payment?.method || 'cash').toLowerCase();
  const isCashOrder = paymentMethod === 'cash';
  const orderAmount = Math.max(0, Number(existingOrder?.pricing?.total || 0));
  const offeredEntry = (existingOrder?.dispatch?.offeredTo || []).find(
    (entry) => String(entry?.partnerId || '') === String(deliveryPartnerId),
  );
  const canBypassCashLimit = Boolean(offeredEntry?.allowOverLimit);

  const partnerCapacity = await getPartnerCashCapacity(deliveryPartnerId);
  const hasAmountCapacity = Number(partnerCapacity.availableCashLimit || 0) >= orderAmount;

  if (isCashOrder && !hasAmountCapacity && !canBypassCashLimit) {
    throw new ValidationError('Cash limit is not enough for this order amount. Please deposit your amount to get orders.');
  }

  if (!partnerCapacity.hasCapacity && !canBypassCashLimit) {
    throw new ValidationError('Cash limit reached. Please deposit your amount to get orders.');
  }

  const orderCapacity = await getPartnerOrderCapacity(deliveryPartnerId);
  const alreadyAcceptedByPartner = alreadyAcceptedByPartnerEarly;

  if (!alreadyAcceptedByPartner && orderCapacity.remaining <= 0) {
    throw new ValidationError('Maximum concurrent orders reached');
  }

  const now = new Date();
  const acceptedStatuses = ['preparing', 'ready_for_pickup', 'picked_up'];
  const cancellableStatuses = [
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
  ];

  const statusHistoryEntry = {
    byRole: 'DELIVERY_PARTNER',
    byId: partnerId,
    from: 'dispatchable',
    to: 'accepted',
    note: 'Delivery partner accepted order',
    at: now,
  };

  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      orderType: 'delivery',
      orderStatus: { $in: acceptedStatuses },
      $or: [
        {
          'dispatch.status': 'unassigned',
          /*
           * A rider may only claim an order actually offered to them, and only
           * while that offer is live. Kept inside the same atomic filter as the
           * status guard so the concurrency guarantee is unchanged: two riders
           * racing still produce exactly one winner.
           */
          'dispatch.offeredTo': { $elemMatch: liveOfferElemMatch(deliveryPartnerId, now) },
        },
        {
          'dispatch.status': 'assigned',
          'dispatch.deliveryPartnerId': partnerId,
        },
      ],
    },
    {
      $set: {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        'dispatch.assignedAt': now,
        'dispatch.acceptedAt': now,
      },
      $push: {
        statusHistory: statusHistoryEntry,
      },
    },
    { new: true },
  ).populate('restaurantId userId');

  if (!order) {
    const existing = await FoodOrder.findOne(identity)
      .select('orderStatus dispatch')
      .lean();

    if (!existing) throw new NotFoundError('Order not found');
    if (cancellableStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order was cancelled');
    }
    if (existing.orderStatus === 'delivered') {
      throw new ValidationError('Order already delivered');
    }
    if (!acceptedStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order not ready for delivery assignment');
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId)
    ) {
      const acceptedOrder = await FoodOrder.findOne(identity)
        .populate('restaurantId userId');
      return acceptedOrder
        ? toDeliveryFacingOrder(acceptedOrder)
        : null;
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)
    ) {
      throw new ForbiddenError('Order already accepted by another partner');
    }

    // Still unassigned means the claim failed on the offer guard, not the race.
    if (existing.dispatch?.status === 'unassigned') {
      const offer = (existing.dispatch?.offeredTo || []).find(
        (entry) => String(entry?.partnerId || '') === String(deliveryPartnerId),
      );
      if (!offer) {
        throw new ForbiddenError('This order was not offered to you');
      }
      if (offer.action === 'rejected') {
        throw new ValidationError('You already declined this order');
      }
      throw new ValidationError('This delivery request has expired');
    }

    throw new ValidationError('Order is no longer available to accept');
  }

  try {
    const before = Number(order.riderEarning || 0);
    await ensureRiderEarningOnOrder(order);
    if (Number(order.riderEarning || 0) > before) {
      await order.save();
    }
  } catch (err) {
    logger.warn(`ensureRiderEarningOnOrder on accept failed: ${err?.message || err}`);
  }

  const responseOrder = toDeliveryFacingOrder(order);

  // Hang up the offer call on every rider it rang for, the winner included
  // (they may have accepted in the app while the call was still ringing).
  void dispatchService.endOfferCallsForOrder(order, 'claimed');

  // Notify other riders IMMEDIATELY — do not wait for Firebase/polyline work
  try {
    const io = getIO();
    if (io) {
      /*
       * Only the riders this order was actually offered to need to drop the
       * card, and each is told in their own room.
       *
       * This used to go to `all_delivery` - a fleet-wide room every delivery
       * socket joins - which handed the id of an order to hundreds of riders it
       * was never offered to. Same failure mode as a zone broadcast: visibility
       * decided by membership of a shared room rather than by who holds the
       * offer. The recipient list now comes from `dispatch.offeredTo`.
       *
       * The payload stays anonymous (it used to name the winning rider to the
       * whole fleet); only the winner's own copy is flagged `claimedByYou`,
       * which is what suppresses their "accepted by another rider" toast.
       */
      const winnerId = String(deliveryPartnerId);
      const claimedPayload = {
        orderId: order._id.toString(),
        orderMongoId: order._id?.toString?.(),
        message: 'This request accepted by another rider',
      };
      const offeredPartnerIds = new Set(
        (order.dispatch?.offeredTo || [])
          .map((entry) => String(entry?.partnerId || ''))
          .filter(Boolean),
      );
      offeredPartnerIds.delete(winnerId);
      for (const partnerId of offeredPartnerIds) {
        io.to(rooms.delivery(partnerId)).emit('order_claimed', {
          ...claimedPayload,
          targetPartnerId: partnerId,
        });
      }
      io.to(rooms.delivery(winnerId)).emit('order_claimed', {
        ...claimedPayload,
        targetPartnerId: winnerId,
        claimedByYou: true,
      });
      logger.info(
        `[DeliveryDispatch] Broadcasted order_claimed immediately for order ${order._id.toString()}`,
      );

      // Carries the assignment itself, not just the order status: the order is
      // still `preparing` at this point, so without dispatch/rider fields the
      // customer's tracking screen had no way to show "rider assigned" until
      // its next poll.
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        displayOrderId: order.order_id || order._id.toString(),
        orderStatus: order.orderStatus,
        dispatchStatus: order.dispatch?.status,
        deliveryPartnerId: String(deliveryPartnerId),
        deliveryState: order.deliveryState,
        updatedAt: new Date().toISOString(),
      };
      io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', payload);
      io.to(rooms.restaurant(order.restaurantId)).emit('order_status_update', payload);
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }
  } catch (error) {
    logger.error(`Error emitting order_claimed on accept: ${error?.message || error}`);
  }

  // Start live tracking now: the customer sees the rider's real position the
  // moment they accept, and the next fixes reach this order without cache lag.
  import('../../delivery/services/riderLocation.service.js')
    .then(({ publishLastKnownRiderLocation }) => publishLastKnownRiderLocation(deliveryPartnerId))
    .catch((err) => logger.warn(`[RiderLocation] accept publish failed: ${err?.message || err}`));

  void (async () => {
    try {
      const rest = order.restaurantId;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      const restLoc = rest?.location?.coordinates;

      if (restLoc?.[0] && userLoc?.[0]) {
        const polyline = await fetchPolyline(
          { lat: restLoc[1], lng: restLoc[0] },
          { lat: userLoc[1], lng: userLoc[0] },
        );

        const db = getFirebaseDB();
        if (db) {
          const orderRef = db.ref(`active_orders/${order._id.toString()}`);
          await orderRef
            .set({
              polyline,
              lat: restLoc[1],
              lng: restLoc[0],
              boy_lat: restLoc[1],
              boy_lng: restLoc[0],
              restaurant_lat: restLoc[1],
              restaurant_lng: restLoc[0],
              customer_lat: userLoc[1],
              customer_lng: userLoc[0],
              status: 'accepted',
              last_updated: Date.now(),
            })
            .catch((error) =>
              logger.error(`Firebase orderRef set error: ${error.message}`),
            );
        }
      }
    } catch (error) {
      logger.error(
        `Error initializing Firebase order tracking: ${error?.message || error}`,
      );
    }

    try {
      await foodTransactionService.updateTransactionRider(order._id, deliveryPartnerId);
    } catch (error) {
      logger.error(
        `Error updating delivery rider transaction for ${order._id}: ${
          error?.message || error
        }`,
      );
    }

    try {
      await notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: `Delivery partner assigned`,
          body: `A delivery partner has accepted Order #${order._id.toString()}.`,
          idempotencyKey: `delivery_accepted_user_${order._id}`,
          eventId: `delivery_accepted_user_${order._id}`,
          tag: `delivery_accepted_${order._id}`,
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/user/orders',
            tag: `delivery_accepted_${order._id}`,
            eventId: `delivery_accepted_user_${order._id}`,
          },
        },
      );

      await notifyOwnerSafely(
        { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
        {
          title: `Rider assigned`,
          body: `Order #${order._id.toString()} is now assigned to a delivery partner.`,
          idempotencyKey: `delivery_accepted_restaurant_${order._id}`,
          eventId: `delivery_accepted_restaurant_${order._id}`,
          tag: `delivery_accepted_${order._id}`,
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/restaurant/orders',
            tag: `delivery_accepted_${order._id}`,
            eventId: `delivery_accepted_restaurant_${order._id}`,
          },
        },
      );
    } catch (error) {
      logger.error(
        `Error notifying delivery acceptance for ${order._id}: ${
          error?.message || error
        }`,
      );
    }
  })();

  enqueueOrderEvent('delivery_accepted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dispatchStatus: order.dispatch?.status,
    orderStatus: order.orderStatus,
  });

  return responseOrder;
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');

  const isAssignedToPartner =
    order.dispatch.deliveryPartnerId?.toString() === deliveryPartnerId.toString();
  const offer = order.dispatch.offeredTo.find(
    (item) =>
      String(item.partnerId) === String(deliveryPartnerId) &&
      item.action === 'offered',
  );

  /*
   * A rider may decline any order offered to them, not only one formally
   * assigned to them.
   *
   * During the normal phase-1/phase-2 hunt `dispatch.status` stays `unassigned`
   * and `deliveryPartnerId` stays null, so the old assignment-only check threw
   * "Not your order" for every decline made from the offer card. The reject
   * never reached the database, the offer stayed `offered`, and the request came
   * straight back on the next poll or refresh - a dismissed card that would not
   * stay dismissed.
   */
  if (!isAssignedToPartner && !offer) {
    throw new ForbiddenError('Not your order');
  }
  if (order.dispatch.status === 'accepted' && !isAssignedToPartner) {
    throw new ForbiddenError('Order already accepted by another partner');
  }

  if (offer) offer.action = 'rejected';

  // Only surrender the assignment if this rider actually held it; clearing it
  // for an offer-stage decline would wipe another rider's acceptance.
  if (isAssignedToPartner) {
    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = undefined;
    order.dispatch.assignedAt = undefined;
    order.dispatch.acceptedAt = undefined;
  }
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from: 'assigned',
    to: 'unassigned',
    note: 'Rejected',
  });
  await order.save();

  enqueueOrderEvent('delivery_rejected', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });

  // A rider dropping an order they had accepted moves the customer's screen
  // back from "rider arriving" to "preparing"; tell them now rather than on
  // their next poll. Offer-stage declines change nothing the customer sees.
  if (isAssignedToPartner) {
    try {
      const io = getIO();
      if (io && order.userId) {
        io.to(rooms.user(order.userId)).emit('order_status_update', {
          orderMongoId: order._id.toString(),
          orderId: order._id.toString(),
          displayOrderId: order.order_id || order._id.toString(),
          orderStatus: order.orderStatus,
          dispatchStatus: order.dispatch.status,
          deliveryPartnerId: null,
          deliveryState: order.deliveryState,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.warn(`reject user emit failed: ${err?.message || err}`);
    }
  }

  void dispatchService
    .tryAutoAssign(order._id)
    .catch((error) =>
      logger.error(`SmartDispatch: Auto-assign after reject failed: ${error.message}`),
    );

  return order.toObject();
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  if (order.orderStatus === 'delivered') {
    throw new ValidationError('Order already delivered');
  }

  const currentPhase = order.deliveryState?.currentPhase || '';
  const currentStatus = order.deliveryState?.status || '';
  if (currentPhase === 'at_pickup' || currentStatus === 'reached_pickup') {
    return order.toObject();
  }

  const from = currentStatus || currentPhase || order.orderStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_pickup',
    status: 'reached_pickup',
    reachedPickupAt: order.deliveryState?.reachedPickupAt || new Date(),
  };
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'reached_pickup',
    note: 'Reached pickup location',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);

  try {
    const restaurant = await FoodRestaurant.findById(order.restaurantId)
      .select('restaurantName')
      .lean();
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('name')
      .lean();

    const orderMongoId = String(order._id?.toString?.() || order._id || '');
    const eventKey = `restaurant:rider_arrived:${orderMongoId}`;
    const notificationTag = `restaurant-rider-${orderMongoId}`;

    await notifyOwnersSafely(
      [{ ownerType: 'RESTAURANT', ownerId: order.restaurantId }],
      {
        title: 'Rider arrived!',
        body: `${partner?.name || 'The delivery partner'} has arrived at ${
          restaurant?.restaurantName || 'your restaurant'
        } to pick up Order #${order._id.toString()}.`,
        idempotencyKey: eventKey,
        eventId: eventKey,
        tag: notificationTag,
        data: {
          type: 'rider_arrived',
          eventId: eventKey,
          idempotencyKey: eventKey,
          tag: notificationTag,
          orderId: String(order._id.toString()),
          orderMongoId: String(order._id),
          partnerName: partner?.name || '',
        },
      },
    );
  } catch (error) {
    logger.error(
      `Error notifying restaurant about rider arrival for ${order._id}: ${
        error?.message || error
      }`,
    );
  }

  enqueueOrderEvent('reached_pickup', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    orderStatus: order.orderStatus,
    deliveryPhase: order.deliveryState?.currentPhase,
    deliveryStatus: order.deliveryState?.status,
  });
  return order.toObject();
}

export async function confirmPickupDelivery(orderId, deliveryPartnerId, billImageUrl) {
  if (!billImageUrl || typeof billImageUrl !== 'string' || !billImageUrl.trim()) {
    throw new ValidationError('Bill photo is required before confirming pickup');
  }

  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  const nextStatus = 'picked_up';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  order.orderStatus = nextStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'en_route_to_delivery',
    status: 'picked_up',
    pickedUpAt: new Date(),
    billImageUrl,
  };

  // OTP should be generated/sent only when rider explicitly requests it at drop.

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'picked_up',
    note: 'Order picked up',
  });

  try {
    await ensureRiderEarningOnOrder(order);
  } catch (err) {
    logger.warn(`ensureRiderEarningOnOrder on pickup failed: ${err?.message || err}`);
  }

  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('picked_up', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    billImageUrl: billImageUrl || null,
  });
  return order.toObject();
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    emitOrderUpdate(order, deliveryPartnerId);
    return toDeliveryFacingOrder(order);
  }

  const alreadyAtDrop =
    order.deliveryState?.currentPhase === 'at_drop' ||
    order.deliveryState?.status === 'reached_drop';
  const fromPhase =
    order.deliveryState?.status ||
    order.deliveryState?.currentPhase ||
    order.orderStatus ||
    '';

  const existingOtp = String(order.deliveryOtp || '').trim();

  // Idempotency: if already reached drop and OTP exists, avoid duplicate push notifications.
  if (alreadyAtDrop && existingOtp) {
    const hasDropOtpMeta = Boolean(order.deliveryVerification?.dropOtp);
    if (!hasDropOtpMeta) {
      order.deliveryVerification = {
        ...(order.deliveryVerification?.toObject?.() ||
          order.deliveryVerification ||
          {}),
        dropOtp: { required: true, verified: false },
      };
      await order.save();
    }
    // Rider explicitly requested OTP again at drop, re-emit same OTP without regenerating.
    emitDeliveryDropOtpToUser(order, existingOtp);
    return toDeliveryFacingOrder(order);
  }

  if (!existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
  }

  if (!order.deliveryVerification?.dropOtp) {
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_drop',
    status: 'reached_drop',
    reachedDropAt: order.deliveryState?.reachedDropAt || new Date(),
  };

  if (!alreadyAtDrop) {
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: fromPhase,
      to: 'reached_drop',
      note: 'Reached drop location',
    });
  }

  await order.save();

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || '').trim());
  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('reached_drop', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dropOtpRequired: order.deliveryVerification?.dropOtp?.required ?? true,
    dropOtpVerified: order.deliveryVerification?.dropOtp?.verified ?? false,
  });
  return toDeliveryFacingOrder(order);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const otpStr = normalizeOtpValue(otp);
  if (!otpStr) throw new ValidationError('OTP is required');

  if (!order.deliveryVerification?.dropOtp?.required) {
    const hasSecretOtp = Boolean(normalizeOtpValue(order.deliveryOtp));
    if (!hasSecretOtp) {
      throw new ValidationError(
        'OTP verification is not active for this order. Confirm reached drop first.',
      );
    }

    if (!order.deliveryVerification) order.deliveryVerification = {};
    order.deliveryVerification.dropOtp = {
      required: true,
      verified: false,
      ...(order.deliveryVerification?.dropOtp || {}),
    };
    order.markModified('deliveryVerification.dropOtp');
    await order.save();
  }
  if (order.deliveryVerification?.dropOtp?.verified) {
    return { order: toDeliveryFacingOrder(order) };
  }

  if (!isOtpMatch(order.deliveryOtp, otpStr)) {
    throw new ValidationError(
      'Invalid OTP. Ask the customer for the code shown in their app.',
    );
  }

  if (!order.deliveryVerification) order.deliveryVerification = { dropOtp: {} };
  order.deliveryVerification.dropOtp.verified = true;
  order.markModified('deliveryVerification.dropOtp.verified');
  await order.save();

  // OTP verification does not advance order status; suppress milestone push to avoid duplicates.
  emitOrderUpdate(order, deliveryPartnerId, { sendMilestonePush: false });
  enqueueOrderEvent('drop_otp_verified', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });
  return { order: toDeliveryFacingOrder(order) };
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const { otp, ratings, paymentMethod: selectedPaymentMethod } = body;

  // 1. Handover OTP Verification
  if (
    otp &&
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified
  ) {
    const orderWithSecret = await FoodOrder.findById(order._id).select('+deliveryOtp');
    if (isOtpMatch(orderWithSecret?.deliveryOtp, otp)) {
      order.deliveryVerification.dropOtp.verified = true;
      order.markModified('deliveryVerification.dropOtp.verified');
    } else {
      throw new ValidationError('Invalid handover OTP provided.');
    }
  }

  if (
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified &&
    !otp
  ) {
    throw new ValidationError(
      'Customer handover OTP is required. Verify the OTP from the customer before completing delivery.',
    );
  }

  const from = order.orderStatus;
  const nextStatus = 'delivered';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  
  // 2. Financial Context Resolution
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const prevPayStatus = String(tx?.payment?.status || order?.payment?.status || 'cod_pending');
  const payMethod = String(tx?.payment?.method || order?.payment?.method || order?.paymentMethod || 'cash');

  /**
   * Final Payment Method Logic:
   * - If rider chose 'qr', we force 'razorpay_qr'.
   * - If rider chose 'cash', we force 'cash'. 
   * - Otherwise, we keep the original method.
   */
  let finalPayMethod = payMethod;
  if (selectedPaymentMethod === 'qr') finalPayMethod = 'razorpay_qr';
  else if (selectedPaymentMethod === 'cash') finalPayMethod = 'cash';

  // 3. QR Payment Verification (Blocking)
  if (finalPayMethod === 'razorpay_qr') {
    const syncedPayment = await syncRazorpayQrPayment(order);
    if (String(syncedPayment?.status || '').toLowerCase() !== 'paid') {
      throw new ValidationError('Please wait for the customer to complete the QR payment. Payment not verified yet.');
    }
  }

  // 3b. Atomically claim this status transition. `order` was loaded with a plain
  // `findOne` above and everything past this point (earning backfill, status
  // history, ledger update, `.save()`) runs against that in-memory copy. Two
  // concurrent completion calls for the same order (double-tap, client retry,
  // a duplicate webhook) both pass the `isStatusAdvance` check above before
  // either persists anything. This update can only match for one of them —
  // `orderStatus: from` stops matching the instant the winner's update lands —
  // so the loser fails fast here instead of re-running earning/ledger/
  // notification side effects a second time.
  const claimed = await FoodOrder.findOneAndUpdate(
    { _id: order._id, orderStatus: from },
    { $set: { orderStatus: '__completing__' } },
  );
  if (!claimed) {
    throw new ValidationError(`Order is already being completed or was already marked '${nextStatus}'.`);
  }

  // 4. Backfill rider earning if missing (geocode coords + commission rules)
  try {
    await ensureRiderEarningOnOrder(order);
  } catch (err) {
    logger.warn(
      `ensureRiderEarningOnOrder failed for ${order._id}: ${err?.message || err}`,
    );
  }

  // Update memory object before saving order so that DB is correctly updated
  if (!order.payment) order.payment = {};
  order.payment.status = 'paid';
  order.payment.method = finalPayMethod;

  // 5. Update Order State
  order.orderStatus = 'delivered';
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'delivered',
    status: 'delivered',
    deliveredAt: new Date(),
  };

  if (ratings) {
    order.ratings = {
      ...(order.ratings?.toObject?.() || order.ratings || {}),
      ...ratings,
    };
  }

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'delivered',
    note: `Delivery completed using ${finalPayMethod}.`,
  });

  try {
    await order.save();
  } catch (saveErr) {
    // Release the claim so the order isn't stuck in the transient sentinel status.
    await FoodOrder.updateOne({ _id: order._id, orderStatus: '__completing__' }, { $set: { orderStatus: from } }).catch(() => {});
    throw saveErr;
  }

  // Reset COD Cancellation Count on any successful delivery
  if (order.userId) {
    try {
      const user = await FoodUser.findById(order.userId);
      if (user) {
        user.codCancellationCount = 0;
        await user.save();
      }
    } catch (err) {
      logger.error('Failed to reset COD cancellation count:', err.message);
    }
  }

  // Create inbox notifications for user and restaurant
  try {
    const orderId = order.orderId || order._id.toString();
    const notifs = [];
    if (order.userId) {
      notifs.push({
        ownerType: 'USER',
        ownerId: order.userId,
        title: `Order #${orderId} Delivered!`,
        message: 'Your order has been delivered. Enjoy your meal!',
        category: 'order',
        source: 'ORDER_UPDATE',
      });
    }
    if (order.restaurantId) {
      notifs.push({
        ownerType: 'RESTAURANT',
        ownerId: order.restaurantId,
        title: `Order #${orderId} Delivered`,
        message: 'The order has been successfully delivered to the customer.',
        category: 'order',
        source: 'ORDER_UPDATE',
      });
    }
    if (notifs.length) await createInboxNotifications({ notifications: notifs });
  } catch (notifErr) {
    logger.warn('Failed to create delivered notifications:', notifErr?.message);
  }

  // 6. Update Financial Ledger (FoodTransaction)
  // This triggers the sync back to FoodOrder.payment.method which updates the Rider's Cash Limit (if cash) or Pocket (always).
  const ledgerKind =
    finalPayMethod === 'cash' 
      ? 'cod_marked_paid_on_delivery' 
      : (finalPayMethod === 'razorpay_qr' ? 'cod_collect_qr_settled' : 'payment_snapshot_sync');

  try {
    await foodTransactionService.updateTransactionStatus(order._id, ledgerKind, {
      status: 'captured', // This marks payment as 'paid'
      paymentMethod: finalPayMethod,
      recordedByRole: 'DELIVERY_PARTNER',
      recordedById: deliveryPartnerId,
      note: `Rider finalized payment as ${finalPayMethod}. Order is now delivered.`,
    });
  } catch (txErr) {
    logger.error(`Failed to update transaction status for order ${order._id}:`, txErr);
  }

  emitOrderUpdate(order, deliveryPartnerId);
  
  enqueueOrderEvent('delivery_completed', {
    orderMongoId: order._id?.toString?.(),
    orderId: order.orderId || order._id.toString(),
    deliveryPartnerId,
    payMethod: finalPayMethod,
    prevPayStatus,
    paymentStatus: 'paid'
  });

  return toDeliveryFacingOrder(order);
}


export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
      throw new ValidationError(`Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`);
  }
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: orderStatus,
  });
  await order.save();

  enqueueOrderEvent('delivery_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    from,
    to: orderStatus,
  });
  return order.toObject();
}
