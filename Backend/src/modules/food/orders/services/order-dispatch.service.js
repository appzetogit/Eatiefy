import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import {
  loadDeliveryCashLimitByZone,
  loadPartnerZoneIds,
} from '../../admin/services/zoneDeliverySettings.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import {
  buildDeliverySocketPayload,
  buildOrderIdentityFilter,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersSafely,
} from './order.helpers.js';
import {
  endVoipCallsSafely,
  getNewOrderAlertSound,
  notifyAdminsSafely,
} from '../../../../core/notifications/firebase.service.js';
import {
  getActiveZoneById,
  isPartnerInsideZone,
  detectZoneIdForPoint,
  isPointInZonePolygon,
} from '../../utils/zoneGeo.js';
import {
  MAX_OFFER_VALIDITY_MS,
  OFFER_TTL_MS,
  expireStaleOffers,
  offerExpiresAt,
} from './delivery-offer.util.js';

/**
 * Offer lifetime, shared by the expiresAt stamp and the re-check delay.
 * Re-exported from delivery-offer.util.js, which clamps it to the ten-minute
 * hard ceiling, so every module reads one value.
 */
export { OFFER_TTL_MS, MAX_OFFER_VALIDITY_MS };

/** Never offer a job farther than this, even inside a large/misdrawn zone. */
const HARD_MAX_OFFER_DISTANCE_KM = 40;

/**
 * Emits one offer to exactly one rider's private room.
 *
 * Two things the previous broadcast did not do:
 *
 *  - `dispatch` carried the whole `offeredTo` array, so every rider who got an
 *    offer also received the ids of every colleague it was offered to. The
 *    recipient now gets their own offer row and nothing else.
 *  - The payload had no addressee, so a client had no way to tell an event meant
 *    for it from one delivered to a room it should no longer be in (a socket
 *    still open on the previous account after a switch, say). `targetPartnerId`
 *    lets the client drop anything that is not its own.
 */
function emitOfferToPartner(io, order, basePayload, partner, expiresAt) {
  if (!io || !partner?.partnerId) return;
  const partnerId = String(partner.partnerId);
  const { dispatch, ...rest } = basePayload;
  const eventPayload = {
    ...rest,
    pickupDistanceKm: partner.distanceKm,
    targetPartnerId: partnerId,
    deliveryPartnerId: partnerId,
    offerCreatedAt: new Date().toISOString(),
    offerExpiresAt: new Date(expiresAt).toISOString(),
    dispatch: {
      status: dispatch?.status,
      offeredTo: [{ partnerId, action: 'offered', expiresAt: new Date(expiresAt) }],
    },
  };
  const roomName = rooms.delivery(partnerId);
  io.to(roomName).emit('new_order', eventPayload);
  io.to(roomName).emit('new_order_available', eventPayload);
}

async function filterPartnersByCashLimit(partners = [], options = {}) {
  if (!Array.isArray(partners) || partners.length === 0) return [];
  const requiredAmount = Math.max(0, Number(options.requiredAmount || 0));
  const allowOverLimitFallback = options.allowOverLimitFallback !== false;

  // Each rider's own limit: their zone's value, else the platform default.
  const [cashLimits, zoneByPartner] = await Promise.all([
    loadDeliveryCashLimitByZone(),
    loadPartnerZoneIds(partners.map((p) => p?.partnerId || p?._id)),
  ]);
  const cashLimitFor = (p) => {
    const limit = Number(
      cashLimits.forZone(zoneByPartner.get(String(p?.partnerId || p?._id || ''))).deliveryCashLimit,
    );
    return Number.isFinite(limit) && limit > 0 ? limit : 0;
  };

  // Treat missing/non-positive setting as "no cap" to avoid blocking all dispatch.
  if (partners.every((p) => cashLimitFor(p) <= 0)) {
    return partners.map((p) => ({
      ...p,
      availableCashLimit: Number.MAX_SAFE_INTEGER,
      allowOverLimit: false,
      requiredCashForOrder: requiredAmount,
    }));
  }

  const partnerIds = partners
    .map((p) => p?.partnerId || p?._id)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (partnerIds.length === 0) return [];

  const [cashAgg, depositsAgg] = await Promise.all([
    FoodOrder.aggregate([
      {
        $match: {
          'dispatch.deliveryPartnerId': { $in: partnerIds },
          orderStatus: 'delivered',
          'payment.method': 'cash',
        },
      },
      {
        $group: {
          _id: '$dispatch.deliveryPartnerId',
          grossCashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } },
        },
      },
    ]),
    FoodDeliveryCashDeposit.aggregate([
      {
        $match: {
          deliveryPartnerId: { $in: partnerIds },
          status: 'Completed',
        },
      },
      {
        $group: {
          _id: '$deliveryPartnerId',
          depositedCash: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
  ]);

  const grossCashByPartner = new Map(
    (cashAgg || []).map((row) => [String(row._id), Number(row.grossCashCollected || 0)]),
  );
  const depositedByPartner = new Map(
    (depositsAgg || []).map((row) => [String(row._id), Number(row.depositedCash || 0)]),
  );

  const withCapacity = partners.map((p) => {
    const partnerId = String(p?.partnerId || p?._id || '');
    if (!partnerId) return null;
    const grossCash = grossCashByPartner.get(partnerId) || 0;
    const depositedCash = depositedByPartner.get(partnerId) || 0;
    const cashInHand = Math.max(0, grossCash - depositedCash);
    const totalCashLimit = cashLimitFor(p);
    // A zone without a cap (0) never blocks its riders, as the default never did.
    const availableCashLimit = totalCashLimit > 0
      ? Math.max(0, totalCashLimit - cashInHand)
      : Number.MAX_SAFE_INTEGER;
    return {
      ...p,
      availableCashLimit,
      allowOverLimit: false,
      requiredCashForOrder: requiredAmount,
    };
  }).filter(Boolean);

  // Base block: riders with zero available limit should not receive fresh offers.
  const baseEligible = withCapacity.filter((p) => Number(p.availableCashLimit || 0) > 0);
  if (baseEligible.length === 0) return [];

  if (requiredAmount <= 0) return baseEligible;

  const sufficient = baseEligible.filter(
    (p) => Number(p.availableCashLimit || 0) >= requiredAmount,
  );
  if (sufficient.length > 0) return sufficient;

  if (!allowOverLimitFallback) return [];

  // Fallback: keep order moving by offering to highest available-limit riders.
  return baseEligible
    .slice()
    .sort((a, b) => Number(b.availableCashLimit || 0) - Number(a.availableCashLimit || 0))
    .map((p) => ({
      ...p,
      allowOverLimit: true,
    }));
}

async function listNearbyOnlineDeliveryPartners(
  restaurantId,
  {
    maxKm = 15,
    limit = 25,
    requiredAmount = 0,
    allowOverLimitFallback = true,
    zoneId = null,
  } = {},
) {
  const rId = (restaurantId?._id || restaurantId).toString();
  const restaurant = await FoodRestaurant.findById(rId)
    .select('location zoneId')
    .lean();

  const [rLng, rLat] = restaurant?.location?.coordinates?.length === 2
    ? restaurant.location.coordinates
    : [null, null];

  // Prefer zone from restaurant GPS so a wrong restaurant.zoneId cannot leak cross-city.
  const gpsZoneId =
    rLat != null && rLng != null ? await detectZoneIdForPoint(rLat, rLng) : null;
  const resolvedZoneId =
    gpsZoneId || String(zoneId || restaurant?.zoneId || '').trim() || null;
  const zoneDoc = resolvedZoneId ? await getActiveZoneById(resolvedZoneId) : null;

  // Without a service zone we must not broadcast globally (cross-city leak).
  if (!zoneDoc) {
    logger.warn(
      `listNearbyOnlineDeliveryPartners: no zone for restaurant ${rId}; skipping partner search`,
    );
    return { restaurant: restaurant || null, partners: [] };
  }

  // If restaurant pin is outside the resolved zone polygon, do not dispatch.
  if (
    rLat != null &&
    rLng != null &&
    !isPointInZonePolygon(rLat, rLng, zoneDoc.coordinates || [])
  ) {
    logger.warn(
      `listNearbyOnlineDeliveryPartners: restaurant ${rId} GPS outside zone ${resolvedZoneId}; skipping`,
    );
    return { restaurant: restaurant || null, partners: [] };
  }

  const allowedStatuses =
    process.env.NODE_ENV === 'production' ? ['approved'] : ['approved', 'pending'];
  const STALE_GPS_MS = 2 * 60 * 60 * 1000; // 2 hours window for active online partners
  const offerRadiusKm = Math.min(
    Math.max(Number(maxKm) || 15, 1),
    HARD_MAX_OFFER_DISTANCE_KM,
  );

  const allOnline = await FoodDeliveryPartner.find({
    availabilityStatus: 'online',
    status: { $in: allowedStatuses },
  })
    .select('_id status lastLat lastLng lastLocationAt name zoneId')
    .lean();

  // Zone-first: only partners assigned to this zone (or without zoneId yet) and currently inside the order/restaurant zone.
  const inZonePartners = (allOnline || []).filter((p) => {
    if (p.zoneId && String(p.zoneId) !== String(zoneDoc._id)) return false;
    if (p.lastLat == null || p.lastLng == null) return false;
    if (p.lastLocationAt) {
      const ageMs = Date.now() - new Date(p.lastLocationAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs > STALE_GPS_MS) return false;
    }
    return isPartnerInsideZone(p, zoneDoc);
  });

  if (inZonePartners.length === 0) {
    return { restaurant: restaurant || null, partners: [] };
  }

  let scored = [];
  if (rLat != null && rLng != null) {
    for (const p of inZonePartners) {
      const d = haversineKm(rLat, rLng, p.lastLat, p.lastLng);
      if (Number.isFinite(d) && d <= offerRadiusKm) {
        scored.push({ partnerId: p._id, distanceKm: d, status: p.status });
      }
    }
    scored.sort((a, b) => a.distanceKm - b.distanceKm);
  } else {
    // No restaurant GPS — refuse dispatch rather than guessing city-wide.
    logger.warn(
      `listNearbyOnlineDeliveryPartners: restaurant ${rId} missing GPS; skipping`,
    );
    return { restaurant: restaurant || null, partners: [] };
  }

  const picked = scored.slice(0, Math.max(1, limit));
  if (picked.length === 0) {
    return { restaurant: restaurant || null, partners: [] };
  }

  const cashEligibleFinal = await filterPartnersByCashLimit(picked, {
    requiredAmount,
    allowOverLimitFallback,
  });
  return { restaurant: restaurant || null, partners: cashEligibleFinal };
}

export async function getDispatchSettings() {
  return { dispatchMode: "auto" };
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  // Always set to auto
  await FoodSettings.findOneAndUpdate(
    { key: "dispatch" },
    {
      $set: {
        dispatchMode: "auto",
        updatedBy: { role: "ADMIN", adminId, at: new Date() },
      },
    },
    { upsert: true, new: true },
  );
  return getDispatchSettings();
}

/*
 * How long an order may keep hunting for a rider.
 *
 * The hunt used to have no end: an order nobody could take stayed in the loop
 * for ever, re-offering itself every 30s. From attempt 3 the offer goes to
 * EVERY eligible rider within 40-60km, and riders who were not offered it yet
 * are picked up as they come online - so days-old orders kept ringing riders at
 * random, for orders that could not possibly still be delivered. Past this age
 * the order is left for an admin to assign or cancel by hand; it is not
 * cancelled automatically, and a manual assignment still works.
 */
const MAX_DISPATCH_AGE_MS = Math.max(
  5,
  Number(process.env.DISPATCH_MAX_ORDER_AGE_MINUTES || 120),
) * 60 * 1000;

const dispatchAgeMs = (order) => {
  const placedAt = new Date(order?.createdAt || 0).getTime();
  return Number.isFinite(placedAt) && placedAt > 0 ? Date.now() - placedAt : 0;
};

export async function tryAutoAssign(orderId, options = {}) {
  const attempt = options.attempt || 1;
  const lockTimeout = 55000; // 55 seconds lock interval

  const dispatchableStatuses = new Set([
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'ready',
    'picked_up',
  ]);

  const order = await FoodOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      orderType: 'delivery',
      orderStatus: { $in: Array.from(dispatchableStatuses) },
      // Too old to still be a live delivery: stop hunting (and stop ringing riders).
      createdAt: { $gte: new Date(Date.now() - MAX_DISPATCH_AGE_MS) },
      $or: [
        { 'dispatch.status': 'unassigned' },
        {
          'dispatch.status': 'assigned',
          'dispatch.acceptedAt': { $exists: false },
          'dispatch.assignedAt': { $lt: new Date(Date.now() - lockTimeout) }
        }
      ],
      'dispatch.dispatchingAt': { $exists: false }
    },
    {
      $set: { 'dispatch.dispatchingAt': new Date() }
    },
    { new: true }
  ).populate(['restaurantId', 'userId']);

  if (!order) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (not dispatchable, already dispatching, accepted, older than ${Math.round(MAX_DISPATCH_AGE_MS / 60000)} minutes, or multi-attempt lock active).`);
    return null;
  }

  try {
    const offeredIds = (order.dispatch?.offeredTo || []).map(o => o.partnerId.toString());
    const paymentMethod = String(order.payment?.method || 'cash').toLowerCase();
    const isCashOrder = paymentMethod === 'cash';
    const requiredAmount = isCashOrder ? Number(order?.pricing?.total || 0) : 0;
    
    // RADIUS EXPANSION LOGIC
    // Attempt 1: 15km, Attempt 2: 25km, Attempt 3: 40km, Attempt 4+: 60km
    let maxKm = 15;
    if (attempt === 2) maxKm = 25;
    if (attempt === 3) maxKm = 40;
    if (attempt >= 4) maxKm = 60;

    const searchOptions = {
      maxKm,
      limit: 15,
      requiredAmount,
      allowOverLimitFallback: true,
      zoneId: order.zoneId || order.restaurantId?.zoneId || null,
    };
    const { partners: nearbyPartners } = await listNearbyOnlineDeliveryPartners(
      order.restaurantId,
      searchOptions,
    );

    // Multi-order: skip riders already at their zone's concurrent capacity.
    const [cashLimits, zoneByPartner] = await Promise.all([
      loadDeliveryCashLimitByZone(),
      loadPartnerZoneIds((nearbyPartners || []).map((p) => p.partnerId || p._id)),
    ]);
    const maxConcurrentFor = (id) => cashLimits.forZone(zoneByPartner.get(id)).maxConcurrentOrders;
    const nearbyIds = (nearbyPartners || [])
      .map((p) => p.partnerId || p._id)
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    let activeByPartner = new Map();
    if (nearbyIds.length > 0) {
      const activeAgg = await FoodOrder.aggregate([
        {
          $match: {
            'dispatch.deliveryPartnerId': { $in: nearbyIds },
            'dispatch.status': 'accepted',
            orderStatus: { $in: ['preparing', 'ready_for_pickup', 'picked_up'] },
          },
        },
        { $group: { _id: '$dispatch.deliveryPartnerId', count: { $sum: 1 } } },
      ]);
      activeByPartner = new Map(
        (activeAgg || []).map((row) => [String(row._id), Number(row.count || 0)]),
      );
    }

    const partners = (nearbyPartners || []).filter((p) => {
      const id = String(p.partnerId || p._id || '');
      const active = activeByPartner.get(id) || 0;
      return active < maxConcurrentFor(id);
    });
    
    // TIERED ALERT LOGIC
    // Phase 2: Broadcast to all (Attempt 3+)
    // Phase 3: Admin Alert (Attempt 5+ or roughly 5 mins)
    const isPhase2 = attempt >= 3;
    const isPhase3 = attempt >= 6; // ~6 minutes (60s * 6)

    if (isPhase3) {
      // `attempt` counts retries (30-60s apart), not minutes; report the real age.
      const ageMinutes = Math.round((Date.now() - new Date(order.createdAt || Date.now()).getTime()) / 60000);
      const ageLabel = ageMinutes >= 120 ? `${Math.round(ageMinutes / 60)} hours` : `${ageMinutes} mins`;
      logger.error(`[CRITICAL] Order ${order._id} still has no delivery partner (placed ${ageLabel} ago, dispatch attempt ${attempt}). Triggering Admin Alert (Phase 3).`);
      /*
       * One alert per order per hour. The key used to include `attempt`, so
       * every retry (about every 30s, for as long as the order stays unassigned)
       * was a brand-new event and bypassed de-duplication: an order stuck for
       * days would push "Unassigned Order Crisis!" to every admin device twice
       * a minute. The hour bucket still re-reminds for orders left unresolved.
       */
      const alertBucket = `${order._id}_${Math.floor(Date.now() / 3600000)}`;
      try {
        // 'GLOBAL' was never an admin id (findById failed), so this alert reached nobody.
        await notifyAdminsSafely(
          {
            title: 'Unassigned Order Crisis!',
            body: `Order #${order.order_id || order._id} has had no delivery partner for ${ageLabel}. Manual intervention required!`,
            urgent: true,
            channelId: 'admin_orders',
            link: '/admin/orders/all',
            idempotencyKey: `admin_alert_unassigned_${alertBucket}`,
            eventId: `admin_alert_unassigned_${alertBucket}`,
            tag: `admin_alert_unassigned_${order._id}`,
            data: { type: 'admin_alert_unassigned', orderId: order._id.toString(), link: '/admin/orders/all', targetUrl: '/admin/orders/all', tag: `admin_alert_unassigned_${order._id}`, eventId: `admin_alert_unassigned_${alertBucket}` }
          }
        );
      } catch (err) {
        logger.warn(`Admin notification failed: ${err.message}`);
      }
    }

    const eligible = partners.filter(p => !offeredIds.includes(p.partnerId.toString()));

    if (eligible.length === 0) {
      logger.info(`tryAutoAssign: No NEW eligible partners in ${maxKm}km for order ${order._id}. Restarting hunt...`);

      /*
       * Re-announce only to riders who still hold a LIVE offer on this order.
       *
       * This used to re-emit to every nearby partner, including those whose
       * offer had already been rejected or timed out. That put a card on their
       * screen - ringtone and all - backed by no acceptable offer, so tapping
       * it failed and the card sat there until something else cleared it. The
       * card is now only ever re-sent to a rider the database still says may
       * accept, carrying that offer's real expiry rather than a fresh one.
       */
      const io = getIO();
      if (io && partners.length > 0) {
        const now = new Date();
        const liveOfferByPartner = new Map(
          (order.dispatch?.offeredTo || [])
            .filter((entry) => entry?.action === 'offered' && offerExpiresAt(entry) > now)
            .map((entry) => [String(entry.partnerId), entry]),
        );
        if (liveOfferByPartner.size > 0) {
          const payload = buildDeliverySocketPayload(order, order.restaurantId);
          for (const p of partners) {
            const liveOffer = liveOfferByPartner.get(String(p.partnerId));
            if (!liveOffer) continue;
            emitOfferToPartner(io, order, payload, p, offerExpiresAt(liveOffer));
          }
        }
      }

      // Re-queue itself to keep trying, unless the order is too old to deliver.
      if (dispatchAgeMs(order) >= MAX_DISPATCH_AGE_MS) {
        logger.warn(
          `tryAutoAssign: Order ${order._id} has been unassigned for over ${Math.round(MAX_DISPATCH_AGE_MS / 60000)} minutes. ` +
          'Stopping the automatic hunt - assign or cancel it from the admin panel.',
        );
        return order;
      }

      await addOrderJob({
        action: 'DISPATCH_TIMEOUT_CHECK',
        orderMongoId: order._id.toString(),
        orderId: order._id.toString(),
        attempt: attempt + 1
      }, { delay: 30000 }); // Retry faster (30s) if no one found

      return order;
    }

    const io = getIO();
    const payload = buildDeliverySocketPayload(order, order.restaurantId);

    const phase1Batch = eligible.slice(0, Math.min(3, eligible.length));
    const partnersToRecord = isPhase2 ? eligible : phase1Batch;

    if (isPhase2) {
      logger.info(`[Phase 2] Broadcasting order ${order._id} to ${eligible.length} riders.`);
    } else {
      const lead = phase1Batch[0];
      if (lead) {
        logger.info(`[Phase 1] Offering order ${order._id} to ${phase1Batch.length} riders (lead ${lead.partnerId}, ${lead.distanceKm}km)`);
      }
    }

    /*
     * Persist the offer records BEFORE announcing them.
     *
     * The socket used to fire first and the `offeredTo` rows were written after
     * the push round-trip. A failure in between - or a rider accepting inside
     * that window - left a card on screen that the database had no offer for,
     * which is the same dead-card state the expiry work is meant to eliminate.
     * Writing first means every announcement, socket or push, refers to a row
     * that already carries its own createdAt and expiresAt.
     */
    const offeredAt = new Date();
    const offerExpiry = new Date(
      offeredAt.getTime() + Math.min(OFFER_TTL_MS, MAX_OFFER_VALIDITY_MS),
    );
    const offeredToEntries = partnersToRecord.map(p => ({
      partnerId: p.partnerId,
      at: offeredAt,
      createdAt: offeredAt,
      action: 'offered',
      expiresAt: offerExpiry,
      allowOverLimit: Boolean(p.allowOverLimit),
      requiredCashForOrder: Number(p.requiredCashForOrder || requiredAmount || 0),
    }));

    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    order.dispatch.offeredTo.push(...offeredToEntries);
    await order.save();

    if (io) {
      for (const p of partnersToRecord) {
        emitOfferToPartner(io, order, payload, p, offerExpiry);
      }
    }

    /*
     * Push to EVERY partner who was offered this order, not just the closest.
     *
     * Sockets already went to all of them above, but push used to go only to
     * `lead` - so riders 2..n in phase 1, and every rider in the phase 2
     * broadcast, got a socket-only offer. A socket delivers nothing once the
     * app is backgrounded or the phone is locked, so those riders simply never
     * heard about the order. Push is the only channel that survives that, so it
     * has to cover the same set the offer itself covers.
     *
     * The key stays per-partner: a shared idempotencyKey would let the first
     * send suppress the rest.
     */
    const offerSeconds = Math.round((offerExpiry.getTime() - offeredAt.getTime()) / 1000);
    /*
     * An explicit resend (restaurant pressing "Resend") is a NEW offer round and
     * must reach riders who were already offered this order. The dedup keys below
     * are per (order, partner) and their claims live 24h, so without a per-round
     * value the resend was discarded on BOTH channels — no push and no VoIP ring —
     * while still reporting success. Empty for normal auto-dispatch, which keeps
     * its existing keys byte-for-byte so retries stay deduplicated as before.
     *
     * Only the dedup keys vary. `tag` stays per-order so a new banner replaces the
     * old one rather than stacking, and voipCall.orderKey stays the plain order id
     * because endVoipCallsSafely recomputes the CallKit id from it to hang up.
     */
    const roundSuffix = options.dispatchRound ? `_${options.dispatchRound}` : '';
    await Promise.all(
      partnersToRecord.map(async (p) => {
        try {
          await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: p.partnerId },
            {
              title: 'New order assigned!',
              body: `You have ${offerSeconds} seconds to accept Order #${order.order_id || order._id}.`,
              sound: getNewOrderAlertSound(),
              urgent: true,
              orderAlarm: true,
              sendToAllDevices: true,
              // iPhones registered for VoIP ring as a call for as long as the offer lives.
              voipCall: {
                orderKey: order._id.toString(),
                ring: true,
                ringSeconds: offerSeconds,
                callType: 'delivery_offer',
              },
              // An offer that arrives after it expired can't be accepted; don't ring for it.
              ttlSeconds: Math.max(offerSeconds, 30),
              // Tapping opens the rider feed, where the offer card (with accept) is shown.
              link: '/food/delivery',
              channelId: 'delivery_orders',
              idempotencyKey: `dispatch_offer_${order._id}_${p.partnerId}${roundSuffix}`,
              eventId: `dispatch_offer_${order._id}_${p.partnerId}${roundSuffix}`,
              tag: `dispatch_offer_${order._id}`,
              data: {
                type: 'new_order',
                orderId: order.order_id || order._id.toString(),
                orderMongoId: order._id.toString(),
                // The stamps the offer row actually carries, so a push that is
                // opened late can be discarded by the client without guessing.
                createdAt: offeredAt.toISOString(),
                expiresAt: offerExpiry.toISOString(),
                // Addressee, so a device logged into a different account can
                // recognise the push as not its own and stay silent.
                targetPartnerId: String(p.partnerId),
                link: '/food/delivery',
                targetUrl: '/food/delivery',
                tag: `dispatch_offer_${order._id}`,
                eventId: `dispatch_offer_${order._id}_${p.partnerId}${roundSuffix}`,
              },
            },
          );
        } catch (err) {
          logger.warn(`Push notification failed for partner ${p.partnerId}: ${err.message}`);
        }
      }),
    );
    // Re-check exactly when the offers expire, so there is never a window where
    // the offer is dead but no new candidate has been approached.
    await addOrderJob({
      action: 'DISPATCH_TIMEOUT_CHECK',
      orderMongoId: order._id.toString(),
      orderId: order._id.toString(),
      attempt: attempt + 1
    }, { delay: OFFER_TTL_MS });

    return order;
  } finally {
    await FoodOrder.findByIdAndUpdate(orderId, {
      $unset: { 'dispatch.dispatchingAt': '' },
    });
  }
}


/** Ends the offer call on every rider this order was offered to (accepted / cancelled). */
export function endOfferCallsForOrder(order, reason = 'resolved') {
  const partnerIds = [
    ...new Set(
      (order?.dispatch?.offeredTo || [])
        .map((entry) => String(entry?.partnerId || ''))
        .filter(Boolean),
    ),
  ];
  if (!order?._id || !partnerIds.length) return Promise.resolve();
  return endVoipCallsSafely(
    partnerIds.map((partnerId) => ({ ownerType: 'DELIVERY_PARTNER', ownerId: partnerId })),
    { orderKey: order._id.toString(), reason, data: { orderMongoId: order._id.toString() } },
  );
}

export function notifyOffersExpired(order, partnerIds) {
  if (!partnerIds.length) return;
  // Hang up the offer call on those riders' iPhones (fire-and-forget like the socket below).
  void endVoipCallsSafely(
    partnerIds.map((partnerId) => ({ ownerType: 'DELIVERY_PARTNER', ownerId: String(partnerId) })),
    { orderKey: order._id.toString(), reason: 'expired', data: { orderMongoId: order._id.toString() } },
  );
  try {
    const io = getIO();
    if (!io) return;
    const payload = {
      orderId: order._id.toString(),
      orderMongoId: order._id.toString(),
      reason: 'expired',
    };
    for (const partnerId of partnerIds) {
      io.to(rooms.delivery(partnerId)).emit('delivery_request_expired', {
        ...payload,
        targetPartnerId: String(partnerId),
      });
    }
  } catch (err) {
    logger.warn(`delivery_request_expired emit failed: ${err?.message || err}`);
  }
}

/**
 * Expires every delivery offer that has outlived its window, fleet-wide.
 *
 * The per-order timeout check is scheduled on BullMQ, which is a no-op whenever
 * Redis is disabled or down - and when it never runs, offers keep `action:
 * 'offered'` indefinitely. That is how a rider ends up looking at requests from
 * hours ago that survive logout, refresh and reinstall. This sweep is the
 * backstop: it runs off a plain interval in the server process, needs no queue,
 * and is the reason the ten-minute ceiling holds even with Redis switched off.
 *
 * @returns {Promise<{orders: number, offers: number}>}
 */
export async function sweepExpiredDeliveryOffers() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_OFFER_VALIDITY_MS);

  // Candidates: any order still hunting that holds at least one pending offer
  // which is either past its own expiresAt or simply older than the ceiling.
  const candidates = await FoodOrder.find({
    orderType: 'delivery',
    'dispatch.status': { $ne: 'accepted' },
    'dispatch.offeredTo': {
      $elemMatch: {
        action: 'offered',
        $or: [
          { expiresAt: { $lte: now } },
          { expiresAt: null, createdAt: { $lte: new Date(now.getTime() - OFFER_TTL_MS) } },
          { expiresAt: null, createdAt: null, at: { $lte: cutoff } },
        ],
      },
    },
  })
    .select('dispatch order_id')
    .limit(500);

  let offers = 0;
  let orders = 0;
  for (const order of candidates) {
    const expiredPartnerIds = expireStaleOffers(order, now);
    if (!expiredPartnerIds.length) continue;
    try {
      await order.save();
    } catch (err) {
      logger.warn(`sweepExpiredDeliveryOffers save failed for ${order._id}: ${err?.message || err}`);
      continue;
    }
    orders += 1;
    offers += expiredPartnerIds.length;
    notifyOffersExpired(order, expiredPartnerIds);
  }

  if (orders > 0) {
    logger.info(`[DeliveryOffers] Expired ${offers} stale offer(s) across ${orders} order(s)`);
  }
  return { orders, offers };
}

export async function processDispatchTimeout(orderId, partnerId) {
  const order = await FoodOrder.findById(orderId);
  if (!order) return;

  // Never expire offers out from under an order a rider already accepted.
  if (order.dispatch?.status === 'accepted') return;

  const stillAssigned = order.dispatch?.status === 'assigned' &&
    String(order.dispatch?.deliveryPartnerId) === String(partnerId) &&
    !order.dispatch?.acceptedAt;

  if (stillAssigned) {
    logger.info(`Dispatch timeout for partner ${partnerId} on order ${orderId}. Re-trying hunt...`);
    const offer = order.dispatch.offeredTo.find(
      o => String(o.partnerId) === String(partnerId) && o.action === 'offered'
    );
    if (offer) offer.action = 'timeout';

    const alsoExpired = expireStaleOffers(order);
    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    await order.save();

    notifyOffersExpired(order, [...new Set([String(partnerId), ...alsoExpired])]);

    const attempt = (order.dispatch?.offeredTo?.length || 0) + 1;
    await tryAutoAssign(orderId, { attempt });
  } else if (order.dispatch?.status === 'unassigned') {
    // Already unassigned (e.g. a previous timeout, or a normal phase offer that
    // nobody took): retire the dead offers, tell those riders, keep hunting.
    const expiredPartnerIds = expireStaleOffers(order);
    if (expiredPartnerIds.length) {
      await order.save();
      notifyOffersExpired(order, expiredPartnerIds);
    }

    const attempt = (order.dispatch?.offeredTo?.length || 0) + 1;
    await tryAutoAssign(orderId, { attempt });
  }
}


export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['preparing', 'ready_for_pickup', 'ready'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order.');
  }

  const paymentMethod = String(order.payment?.method || 'cash').toLowerCase();
  const requiredAmount = paymentMethod === 'cash' ? Number(order?.pricing?.total || 0) : 0;
  const preview = await listNearbyOnlineDeliveryPartners(order.restaurantId, {
    maxKm: 15,
    limit: 15,
    requiredAmount,
    allowOverLimitFallback: true,
  });
  const shortlistedCount = Array.isArray(preview?.partners) ? preview.partners.length : 0;

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  await order.save();

  // A deliberate human action, so it must not be swallowed by the 24h dedup
  // claim from the previous offer round (see roundSuffix in tryAutoAssign).
  await tryAutoAssign(order._id, { dispatchRound: `r${Date.now()}` });

  const refreshed = await FoodOrder.findById(order._id)
    .select('dispatch.offeredTo dispatch.status dispatch.deliveryPartnerId')
    .lean();
  const notifiedCount = Array.isArray(refreshed?.dispatch?.offeredTo)
    ? refreshed.dispatch.offeredTo.filter((entry) => entry?.action === 'offered').length
    : 0;
  const notifiedPartnerIds = Array.isArray(refreshed?.dispatch?.offeredTo)
    ? refreshed.dispatch.offeredTo
        .filter((entry) => entry?.action === 'offered' && entry?.partnerId)
        .map((entry) => String(entry.partnerId))
    : [];
  const io = getIO();
  const connectedSocketCount = io
    ? notifiedPartnerIds.reduce((count, pid) => {
        const roomName = rooms.delivery(pid);
        const roomSize = io?.sockets?.adapter?.rooms?.get(roomName)?.size || 0;
        return count + roomSize;
      }, 0)
    : 0;

  return {
    success: true,
    notifiedCount,
    shortlistedCount,
    requiredAmount,
    connectedSocketCount,
    dispatchStatus: refreshed?.dispatch?.status || 'unassigned',
  };
}
