import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { PendingOnlinePayment } from '../models/pendingOnlinePayment.model.js';
// import { paymentSnapshotFromOrder } from './foodOrderPayment.service.js';
import { logger } from '../../../../utils/logger.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { FoodSystemConfig } from '../../admin/models/systemConfig.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodSupportTicket } from '../../user/models/supportTicket.model.js';
import { config } from '../../../../config/env.js';
import {
    createRazorpayOrder,
    verifyPaymentSignature,
    getRazorpayKeyId,
    isRazorpayConfigured,
    initiateRazorpayRefund,
    fetchRazorpayPayment,
    assertRazorpayPaymentMatches,
} from '../helpers/razorpay.helper.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { fetchPolyline, toGeoJsonPoint } from '../utils/googleMaps.js';
import { resolveRiderEarningForDelivery } from './riderEarning.service.js';
import {
  resolveEatiefyIncentiveForOrder,
  combineRiderEarning,
} from '../../admin/services/deliveryIncentive.service.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import { getNewOrderAlertSound } from '../../../../core/notifications/firebase.service.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import { calculateOrderPricing } from './order-pricing.service.js';
import { clearFoodCart } from '../../user/services/foodCart.service.js';
import * as dispatchService from './order-dispatch.service.js';
import * as deliveryService from './order-delivery.service.js';
import * as paymentService from './order-payment.service.js';
import { detectZoneIdForPoint } from '../../utils/zoneGeo.js';
import { isTakeawayEnabled, isDiningEnabled, isTakeawayPayAtPickupEnabled } from '../../admin/services/moduleAccess.service.js';
import {
  enqueueOrderEvent,
  assertRestaurantDeliversToZone,
  generateFourDigitDeliveryOtp,
  sanitizeOrderForExternal,
  toDeliveryFacingOrder,
  toRestaurantFacingOrder,
  enrichOrdersWithFoodImages,
  emitDeliveryDropOtpToUser,
  notifyOwnersSafely,
  notifyOwnerSafely,
  buildOrderIdentityFilter,
  toGeoPoint,
  pushStatusHistory,
  normalizeOrderForClient,
  applyAggregateRating,
  buildDeliverySocketPayload,
  notifyRestaurantNewOrder,
  isStatusAdvance,
  isOtpMatch,
  STATUS_PRIORITY,
  CANCELLED_BY_FOR_STATUS,
} from './order.helpers.js';

// ----- Settings -----
export async function getDispatchSettings() {
  return dispatchService.getDispatchSettings();
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  return dispatchService.updateDispatchSettings(dispatchMode, adminId);
}

// ----- Calculate (server-authoritative prices from DB cart / FoodItem) -----
export async function calculateOrder(userId, dto) {
  return calculateOrderPricing(userId, { ...dto, useCart: dto?.useCart !== false });
}

export async function createOrderFromPendingIntent(rzOrderId, rzPaymentId, rzSignature = "webhook_verified") {
  const intent = await PendingOnlinePayment.findOne({ razorpayOrderId: rzOrderId, consumedAt: null });
  if (!intent) return null;
  const { userId, dto } = intent;
  dto.razorpayOrderId = rzOrderId;
  dto.razorpayPaymentId = rzPaymentId;
  dto.razorpaySignature = rzSignature;

  try {
    // The webhook body was HMAC-verified with the webhook secret, but there is
    // no checkout signature here. createOrder used to demand one, so this
    // recovery path always failed: the customer was charged and no order was
    // created. The payment is still re-fetched from Razorpay and amount-checked.
    const result = await createOrder(userId, dto, { gatewayVerified: true });
    await PendingOnlinePayment.deleteOne({ razorpayOrderId: rzOrderId });
    return result?.order || null;
  } catch (err) {
    logger.error(`[PendingPaymentRecovery] Failed to create order for ${rzOrderId}: ${err?.message || err}`);
    return null;
  }
}

// ----- Initiate online payment (Razorpay) -----
export async function initiateOnlinePayment(userId, dto) {
  // SECURITY: Razorpay amount must come from server-calculated pricing, never client totals.
  // The client sends the delivery location under `address`, but the pricing
  // service reads `deliveryAddress` to compute the distance-based delivery fee.
  // Map it here exactly as createOrder does — otherwise the distance is unknown,
  // the delivery fee collapses to 0, and the customer is charged the item total
  // only (e.g. ₹322 instead of ₹347) while the order is later created for the
  // full amount.
  const priced = await calculateOrderPricing(userId, {
    ...dto,
    useCart: dto?.useCart !== false,
    couponCode: dto?.couponCode || dto?.pricing?.couponCode || "",
    deliveryAddress: dto.address?.location?.coordinates
      ? { location: { coordinates: dto.address.location.coordinates } }
      : dto.deliveryAddress,
  });
  const restaurantId = priced.restaurantId || dto.restaurantId;

  const restaurant = await FoodRestaurant.findById(restaurantId)
    .select("status restaurantName zoneId location isAcceptingOrders takeawaySettings addressLine1 addressLine2 area city state pincode")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved" || restaurant.isAcceptingOrders === false)
    throw new ValidationError("Restaurant not accepting orders");

  try {
    const { assertRestaurantOpenForOrders } = await import(
      "../../restaurant/services/outletTimings.service.js"
    );
    await assertRestaurantOpenForOrders(restaurantId);
  } catch (timingError) {
    if (timingError instanceof ValidationError) throw timingError;
    logger.warn(
      "[OrderInitiate] Outlet timing check skipped for " + restaurantId + ": " + (timingError?.message || timingError)
    );
  }

  const onlineConfig = await FoodSystemConfig.findOne({ key: "online_payment_enabled" }).select("value").lean();
  if (onlineConfig && onlineConfig.value === false) {
    throw new ValidationError("Online payment is currently disabled");
  }

  const normalizedPricing = {
    ...priced.pricing,
    currency: String(priced.pricing?.currency || "INR"),
  };

  const amountPaise = Math.round((normalizedPricing.total ?? 0) * 100);
  if (amountPaise < 100)
    throw new ValidationError("Amount too low for online payment");

  if (!isRazorpayConfigured()) {
    throw new ValidationError("Payment gateway is not configured");
  }

  const tempReceiptId = "rec_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const rzOrder = await createRazorpayOrder(amountPaise, "INR", tempReceiptId);

  const safeDto = {
    ...dto,
    // Items already server-priced; don't re-read cart (may be cleared / race with webhook).
    useCart: false,
    restaurantId,
    restaurantName: priced.restaurantName || dto.restaurantName,
    items: priced.items,
    pricing: normalizedPricing,
    couponCode: normalizedPricing.couponCode || dto.couponCode || "",
  };
  await PendingOnlinePayment.create({
    razorpayOrderId: rzOrder.id,
    userId,
    dto: safeDto,
  });
  // Expiry is handled by the model's TTL index (30 min), not manual cleanup.

  return {
    key: getRazorpayKeyId(),
    orderId: rzOrder.id,
    amount: rzOrder.amount,
    currency: rzOrder.currency || "INR",
  };
}

// ----- Initiate the pay-at-pickup payment for an EXISTING takeaway order -----
// Called when the customer reaches the restaurant and taps "Pay Now". Creates a
// Razorpay order for the amount already owed (server-side, never client), stores
// its id on the order, and returns the gateway params. The actual confirmation
// goes through verifyPayment (reused), which flips the order to paid and only
// THEN notifies the restaurant.
export async function initiatePickupPayment(userId, orderId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");

  if (order.orderType !== "takeaway" || order.payment?.payAtPickup !== true) {
    throw new ValidationError("This order is not a Pay-at-Pickup order");
  }
  if (order.payment?.status === "paid") {
    throw new ValidationError("This order is already paid");
  }
  if (order.payment?.status !== "awaiting_pickup_payment") {
    throw new ValidationError("This order cannot be paid now");
  }
  if (order.orderStatus !== "created") {
    throw new ValidationError("This order cannot be paid now");
  }

  const onlineConfig = await FoodSystemConfig.findOne({ key: "online_payment_enabled" }).select("value").lean();
  if (onlineConfig && onlineConfig.value === false) {
    throw new ValidationError("Online payment is currently disabled");
  }
  if (!isRazorpayConfigured()) {
    throw new ValidationError("Payment gateway is not configured");
  }

  // Amount comes from the stored order, never from the client.
  const amountPaise = Math.round(Number(order.payment?.amountDue ?? order.pricing?.total ?? 0) * 100);
  if (amountPaise < 100) throw new ValidationError("Amount too low for online payment");

  const tempReceiptId = "pickup_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const rzOrder = await createRazorpayOrder(amountPaise, "INR", tempReceiptId);

  // Persist the gateway order id so verifyPayment can bind the payment to it.
  if (!order.payment.razorpay) order.payment.razorpay = {};
  order.payment.razorpay.orderId = rzOrder.id;
  order.markModified("payment");
  await order.save();

  return {
    key: getRazorpayKeyId(),
    orderId: rzOrder.id,
    amount: rzOrder.amount,
    currency: rzOrder.currency || "INR",
  };
}

/**
 * The order a Razorpay payment has already paid for, if any. One payment must
 * pay for exactly one order: without this a single successful checkout
 * (order id + payment id + signature) could be replayed to place the same
 * order again and again for free.
 */
async function findOrderForRazorpayPayment({ rzOrderId, rzPaymentId }) {
  const or = [];
  if (rzPaymentId) or.push({ "payment.razorpay.paymentId": rzPaymentId });
  if (rzOrderId) or.push({ "payment.razorpay.orderId": rzOrderId });
  if (!or.length) return null;
  return FoodOrder.findOne({ $or: or }).lean();
}

function reuseOrderForPayment(existing, userId) {
  if (String(existing.userId) !== String(userId)) {
    throw new ValidationError("This payment has already been used");
  }
  // Same customer retrying (double tap, network retry, webhook raced the app).
  return { order: normalizeOrderForClient(existing), razorpay: null };
}

// ----- Create order -----
export async function createOrder(userId, dto, { gatewayVerified = false } = {}) {
  // Admin module toggles are enforced here too — hiding the UI is not enough to
  // stop a direct API call for a module that has been switched off.
  const requestedOrderType = dto?.orderType || "delivery";
  if (requestedOrderType === "takeaway" && !(await isTakeawayEnabled())) {
    throw new ValidationError("Takeaway is currently unavailable");
  }
  if (requestedOrderType === "dining" && !(await isDiningEnabled())) {
    throw new ValidationError("Dining is currently unavailable");
  }

  // SECURITY: load items from DB cart + recompute fees/coupon server-side.
  const priced = await calculateOrderPricing(userId, {
    ...dto,
    useCart: dto?.useCart !== false,
    couponCode: dto?.couponCode || dto?.pricing?.couponCode || "",
    deliveryAddress: dto.address?.location?.coordinates
      ? { location: { coordinates: dto.address.location.coordinates } }
      : dto.deliveryAddress,
  });
  const verifiedItems = priced.items || [];
  const restaurantId = priced.restaurantId || dto.restaurantId;
  if (!restaurantId) throw new ValidationError("Restaurant id required");
  if (!verifiedItems.length) throw new ValidationError("Your cart is empty");

  const restaurant = await FoodRestaurant.findById(restaurantId)
    .select("status restaurantName zoneId location isAcceptingOrders takeawaySettings addressLine1 addressLine2 area city state pincode")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not accepting orders");
  if (restaurant.isAcceptingOrders === false)
    throw new ValidationError("Restaurant not accepting orders");

  // Enforce weekly outlet timings (Asia/Kolkata) so closed restaurants cannot receive orders.
  try {
    const { assertRestaurantOpenForOrders } = await import(
      "../../restaurant/services/outletTimings.service.js"
    );
    await assertRestaurantOpenForOrders(restaurantId);
  } catch (timingError) {
    if (timingError instanceof ValidationError) throw timingError;
    logger.warn(
      `[OrderCreate] Outlet timing check skipped for ${restaurantId}: ${timingError?.message || timingError}`
    );
  }

  const orderType = dto.orderType || "delivery";
  // "Pay at Pickup (online)": a takeaway order placed now and paid online at the
  // counter. It is online-only (never cash) and must be allowed by BOTH the admin
  // master toggle and the restaurant's own opt-in. Delivery/dining never set this.
  const isPayAtPickup = orderType === "takeaway" && dto.payAtPickup === true;
  if (orderType === "takeaway") {
    if (restaurant.takeawaySettings?.isEnabled === false) {
      throw new ValidationError("Takeaway is not available for this restaurant");
    }
    if (isPayAtPickup) {
      if (!(await isTakeawayPayAtPickupEnabled())) {
        throw new ValidationError("Pay at Pickup is currently unavailable");
      }
      if (restaurant.takeawaySettings?.payAtPickupEnabled !== true) {
        throw new ValidationError("Pay at Pickup is not available for this restaurant");
      }
    }
  }

  assertRestaurantDeliversToZone(restaurant, {
    zoneId: dto.zoneId,
    orderType,
    deliveryAddress: {
      location: dto.address?.location?.coordinates
        ? { coordinates: dto.address.location.coordinates }
        : undefined,
    },
  });


  const settings = await getDispatchSettings();
  const dispatchMode = settings.dispatchMode;

  const deliveryAddress = {
    label: dto.address?.label || "Home",
    name: dto.address?.name || dto.address?.fullName || dto.customerName || "",
    fullName: dto.address?.fullName || dto.address?.name || dto.customerName || "",
    street: dto.address?.street || "",
    additionalDetails: dto.address?.additionalDetails || "",
    houseNumber: dto.address?.houseNumber || "",
    landmark: dto.address?.landmark || "",
    city: dto.address?.city || "",
    state: dto.address?.state || "",
    zipCode: dto.address?.zipCode || "",
    phone: dto.address?.phone || "",
    location: dto.address?.location?.coordinates
      ? { type: "Point", coordinates: dto.address.location.coordinates }
      : undefined,
  };

  // Pay-at-Pickup is always an online (razorpay) order — it is just paid later,
  // so force the method and ignore any client-sent cash/wallet for this mode.
  const paymentMethod = isPayAtPickup
    ? "razorpay"
    : dto.paymentMethod === "card"
      ? "razorpay"
      : dto.paymentMethod;
  const isCash = paymentMethod === "cash";
  const isWallet = paymentMethod === "wallet";

  // Global Customization Toggles Enforcement
  if (isCash) {
    // Takeaway is online-payment only: cash / Pay-at-Pickup is never accepted,
    // regardless of what the client sends. Enforced here (not just in the UI)
    // so a direct API call cannot create an unpaid takeaway order.
    if (orderType === "takeaway") {
      throw new ValidationError("Takeaway orders must be paid online");
    }

    // 1. General COD Toggle (Master switch for non-takeaway)
    if (orderType !== "takeaway") {
      const globalCodConfig = await FoodSystemConfig.findOne({ key: "cod_enabled" }).select("value").lean();
      if (globalCodConfig && globalCodConfig.value === false) {
        throw new ValidationError("Cash on Delivery is currently disabled globally");
      }
    }

    // 2. Mode-specific COD Toggles
    let codEnabledKey = "";
    if (orderType === "takeaway") codEnabledKey = "takeaway_cod_enabled";
    else if (orderType === "delivery") codEnabledKey = "delivery_cod_enabled";
    else if (orderType === "dining") codEnabledKey = "dining_cod_enabled";

    if (codEnabledKey) {
      const codConfig = await FoodSystemConfig.findOne({ key: codEnabledKey }).select("value").lean();
      if (codConfig && codConfig.value === false) {
        throw new ValidationError(`Cash on Delivery is currently disabled for ${orderType} orders`);
      }
    }

    // 3. User-specific COD Auto Blocking
    const featureConfig = await FoodSystemConfig.findOne({ key: "cod_blocking_feature_enabled" }).select("value").lean();
    if (featureConfig && featureConfig.value !== false) { // enabled by default
      const user = await FoodUser.findById(userId).select("isCodBlocked").lean();
      if (user && user.isCodBlocked) {
        throw new ValidationError("Cash on Delivery is blocked for your account due to multiple cancellations.");
      }
    }
  }

  if (isWallet) {
    const walletConfig = await FoodSystemConfig.findOne({ key: "wallet_payment_enabled" }).select("value").lean();
    if (walletConfig && walletConfig.value === false) {
      throw new ValidationError("Wallet payment is currently disabled");
    }
  }

  // SECURITY: ignore client pricing; use server-calculated amounts only.
  const normalizedPricing = {
    subtotal: Number(priced.pricing?.subtotal ?? 0),
    baseSubtotal: Number(priced.pricing?.baseSubtotal ?? priced.pricing?.subtotal ?? 0),
    markupTotal: Number(priced.pricing?.markupTotal ?? 0),
    tax: Number(priced.pricing?.tax ?? 0),
    packagingFee: Number(priced.pricing?.packagingFee ?? 0),
    deliveryFee: orderType === "takeaway" ? 0 : Number(priced.pricing?.deliveryFee ?? 0),
    platformFee: Number(priced.pricing?.platformFee ?? 0),
    discount: Number(priced.pricing?.discount ?? 0),
    total: Number(priced.pricing?.total ?? 0),
    currency: String(priced.pricing?.currency || "INR"),
    couponCode: priced.pricing?.couponCode || null,
    // Record only: restaurant offers are already inside the item prices above.
    restaurantOfferDiscount: Number(priced.pricing?.restaurantOfferDiscount ?? 0),
    restaurantOffers: Array.isArray(priced.pricing?.restaurantOffers) ? priced.pricing.restaurantOffers : [],
  };
  dto.items = verifiedItems;
  dto.restaurantId = String(restaurantId);
  dto.restaurantName = priced.restaurantName || dto.restaurantName || restaurant.restaurantName || "";


  if (paymentMethod === "razorpay" && !isPayAtPickup) {
    const onlineConfig = await FoodSystemConfig.findOne({ key: "online_payment_enabled" }).select("value").lean();
    if (onlineConfig && onlineConfig.value === false) {
      throw new ValidationError("Online payment is currently disabled");
    }

    const rzOrderId = String(dto.razorpayOrderId || "").trim();
    const rzPaymentId = String(dto.razorpayPaymentId || "").trim();
    const rzSignature = String(dto.razorpaySignature || "").trim();

    if (!rzOrderId || !rzPaymentId || !rzSignature) {
      throw new ValidationError("Payment details (razorpayOrderId, razorpayPaymentId, razorpaySignature) are required for online payment");
    }

    const valid = gatewayVerified || verifyPaymentSignature(rzOrderId, rzPaymentId, rzSignature);
    if (!valid) throw new ValidationError("Payment verification failed: Invalid signature");

    const alreadyPlaced = await findOrderForRazorpayPayment({ rzOrderId, rzPaymentId });
    if (alreadyPlaced) return reuseOrderForPayment(alreadyPlaced, userId);

    if (gatewayVerified && !isRazorpayConfigured()) {
      throw new ValidationError("Payment gateway is not configured");
    }
    if (isRazorpayConfigured()) {
      try {
        const rzPayment = await fetchRazorpayPayment(rzPaymentId);
        const expectedPaise = Math.round(Number(normalizedPricing.total ?? 0) * 100);
        assertRazorpayPaymentMatches(rzPayment, {
          orderId: rzOrderId,
          amountPaise: expectedPaise,
        });
      } catch (err) {
        throw new ValidationError(err?.message || "Payment verification failed");
      }
    }
  }

  const computedTotal = Math.max(
    0,
    (Number.isFinite(normalizedPricing.subtotal)
      ? normalizedPricing.subtotal
      : 0) +
      (Number.isFinite(normalizedPricing.tax) ? normalizedPricing.tax : 0) +
      (Number.isFinite(normalizedPricing.packagingFee)
        ? normalizedPricing.packagingFee
        : 0) +
      (Number.isFinite(normalizedPricing.deliveryFee)
        ? normalizedPricing.deliveryFee
        : 0) +
      (Number.isFinite(normalizedPricing.platformFee)
        ? normalizedPricing.platformFee
        : 0) -
      (Number.isFinite(normalizedPricing.discount)
        ? normalizedPricing.discount
        : 0),
  );
  if (
    !Number.isFinite(normalizedPricing.total) ||
    normalizedPricing.total <= 0
  ) {
    normalizedPricing.total = computedTotal;
  }

  // Pay-at-Pickup is razorpay but NOT paid yet, so it must not count as paid here.
  const isPaidOnline = paymentMethod === "razorpay" && !isPayAtPickup;

  const payment = {
    method: paymentMethod,
    status: isPayAtPickup
      ? "awaiting_pickup_payment"
      : isCash
        ? "cod_pending"
        : (isWallet || isPaidOnline)
          ? "paid"
          : "created",
    payAtPickup: isPayAtPickup,
    // Pay-at-Pickup still owes the full total until the customer pays at the counter.
    amountDue: (isWallet || isPaidOnline) ? 0 : (normalizedPricing.total ?? 0),
    razorpay: isPaidOnline ? {
      orderId: String(dto.razorpayOrderId || "").trim(),
      paymentId: String(dto.razorpayPaymentId || "").trim(),
      signature: String(dto.razorpaySignature || "").trim(),
      paidAt: new Date()
    } : {},
    qr: {},
  };

  let distanceKm = null;
  // Zone-wise commission payout (unchanged) + admin Eatiefy incentive on top.
  let riderBaseEarning = 0;
  // Same zone the Delivery Boy Payout rules are resolved for below.
  const eatiefyIncentive = await resolveEatiefyIncentiveForOrder({
    pricing: normalizedPricing,
    orderType,
    zoneId: restaurant?.zoneId || dto.zoneId || null,
  });
  const eatiefyIncentiveAmount = eatiefyIncentive?.amount || 0;
  let riderEarning = combineRiderEarning(riderBaseEarning, eatiefyIncentiveAmount);

  // For Razorpay (online) orders, run geocoding non-blocking so the Razorpay
  // order is created fast and the modal opens instantly. The geocode result is
  // applied to the saved order in the background after the response is sent.
  const isRazorpayOrder = paymentMethod === 'razorpay';

  if (orderType !== 'takeaway') {
    if (isRazorpayOrder) {
      // Fire-and-forget: don't await geocoding for online payment orders.
      // The order will be updated with distance/riderEarning after geocode resolves.
      resolveRiderEarningForDelivery({
        restaurant,
        deliveryAddress: { ...deliveryAddress },
        orderType,
        zoneId: restaurant?.zoneId || dto.zoneId || null,
      })
        .then(async (earningResolved) => {
          try {
            const updateFields = {};
            if (earningResolved.distanceKm != null) {
              const totalRiderEarning = combineRiderEarning(
                earningResolved.riderEarning ?? 0,
                eatiefyIncentiveAmount,
              );
              updateFields['distanceKm'] = earningResolved.distanceKm;
              updateFields['riderBaseEarning'] = earningResolved.riderEarning ?? 0;
              updateFields['riderEarning'] = totalRiderEarning;
              updateFields['pricing.platformProfit'] = Math.max(
                0,
                (normalizedPricing.deliveryFee ?? 0) +
                  (normalizedPricing.platformFee ?? 0) +
                  (normalizedPricing.markupTotal ?? 0) +
                  (normalizedPricing.restaurantCommission ?? 0) -
                  totalRiderEarning,
              );
            }
            if (earningResolved.deliveryGeocoded && earningResolved.deliveryPoint) {
              updateFields['deliveryAddress.location'] = toGeoJsonPoint(earningResolved.deliveryPoint);
            }
            if (Object.keys(updateFields).length > 0) {
              await FoodOrder.updateOne({ _id: order._id }, { $set: updateFields });
            }
            // Backfill restaurant coords when missing
            if (earningResolved.restaurantGeocoded && earningResolved.restaurantPoint) {
              await FoodRestaurant.updateOne(
                {
                  _id: restaurant._id,
                  $or: [
                    { 'location.coordinates': { $exists: false } },
                    { 'location.coordinates': { $size: 0 } },
                    { 'location.coordinates.0': { $exists: false } },
                  ],
                },
                {
                  $set: {
                    location: {
                      ...(restaurant.location || {}),
                      type: 'Point',
                      coordinates: [
                        earningResolved.restaurantPoint.lng,
                        earningResolved.restaurantPoint.lat,
                      ],
                      latitude: earningResolved.restaurantPoint.lat,
                      longitude: earningResolved.restaurantPoint.lng,
                    },
                  },
                },
              ).catch((err) => logger.warn(`Restaurant coord backfill failed: ${err?.message || err}`));
            }
          } catch (err) {
            logger.warn(`Background geocode update failed for order ${order._id}: ${err?.message || err}`);
          }
        })
        .catch((err) => {
          logger.warn(`Background geocode failed for Razorpay order ${order._id}: ${err?.message || err}`);
        });
    } else {
      // COD / wallet: wait for geocode so riderEarning is accurate before saving
      const earningResolved = await resolveRiderEarningForDelivery({
        restaurant,
        deliveryAddress,
        orderType,
        zoneId: restaurant?.zoneId || dto.zoneId || null,
      });
      distanceKm = earningResolved.distanceKm;
      riderBaseEarning = earningResolved.riderEarning;
      riderEarning = combineRiderEarning(riderBaseEarning, eatiefyIncentiveAmount);

      // Persist geocoded delivery coords so later map/dispatch don't miss them again
      if (earningResolved.deliveryGeocoded && earningResolved.deliveryPoint) {
        deliveryAddress.location = toGeoJsonPoint(earningResolved.deliveryPoint);
      }

      // Backfill restaurant coords when missing (helps future orders)
      if (earningResolved.restaurantGeocoded && earningResolved.restaurantPoint) {
        try {
          await FoodRestaurant.updateOne(
            {
              _id: restaurant._id,
              $or: [
                { 'location.coordinates': { $exists: false } },
                { 'location.coordinates': { $size: 0 } },
                { 'location.coordinates.0': { $exists: false } },
              ],
            },
            {
              $set: {
                location: {
                  ...(restaurant.location || {}),
                  type: 'Point',
                  coordinates: [
                    earningResolved.restaurantPoint.lng,
                    earningResolved.restaurantPoint.lat,
                  ],
                  latitude: earningResolved.restaurantPoint.lat,
                  longitude: earningResolved.restaurantPoint.lng,
                },
              },
            },
          );
        } catch (err) {
          logger.warn(`Restaurant coord backfill failed: ${err?.message || err}`);
        }
      }

      if (!distanceKm) {
        logger.warn(
          `Food order: distance still unavailable after geocode; riderEarning=${riderEarning}`,
        );
      }
    }
  }
 
  // Calculate restaurant commission from subtotal
  const { commissionAmount: restaurantCommission } = await foodTransactionService.getRestaurantCommissionSnapshot({
    pricing: normalizedPricing,
    restaurantId: dto.restaurantId
  });

  normalizedPricing.restaurantCommission = restaurantCommission || 0;

  const platformProfit = Math.max(
    0,
    (Number.isFinite(normalizedPricing.deliveryFee) ? normalizedPricing.deliveryFee : 0) +
      (Number.isFinite(normalizedPricing.platformFee) ? normalizedPricing.platformFee : 0) +
      (Number.isFinite(normalizedPricing.markupTotal) ? normalizedPricing.markupTotal : 0) +
      restaurantCommission -
      riderEarning,
  );

  const [restaurantLng, restaurantLat] =
    restaurant?.location?.coordinates?.length === 2
      ? restaurant.location.coordinates
      : [null, null];
  const restaurantGpsZoneId =
    restaurantLat != null && restaurantLng != null
      ? await detectZoneIdForPoint(restaurantLat, restaurantLng)
      : null;

  // Always prefer restaurant GPS zone over client/restaurant.zoneId (prevents cross-city dispatch).
  const resolvedOrderZoneId = restaurantGpsZoneId
    ? new mongoose.Types.ObjectId(restaurantGpsZoneId)
    : restaurant.zoneId
      ? new mongoose.Types.ObjectId(restaurant.zoneId)
      : dto.zoneId
        ? new mongoose.Types.ObjectId(dto.zoneId)
        : undefined;

  const order = new FoodOrder({
    userId: new mongoose.Types.ObjectId(userId),
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    zoneId: resolvedOrderZoneId,
    items: verifiedItems,
    deliveryAddress: orderType === "takeaway" ? undefined : deliveryAddress,
    orderType,
    customerName: dto.customerName || deliveryAddress.fullName || "",
    customerPhone: dto.customerPhone || deliveryAddress.phone || "",
    pricing: normalizedPricing,
    payment,
    orderStatus: "created",
    dispatch: { modeAtCreation: dispatchMode, status: "unassigned" },
    statusHistory: [
      {
        at: new Date(),
        byRole: "SYSTEM",
        from: "",
        to: "created",
        note: "Order placed",
      },
    ],
    note: dto.restaurantNote || dto.note || "",
    restaurantNote: dto.restaurantNote || dto.note || "",
    sendCutlery: dto.sendCutlery !== false,
    deliveryFleet: dto.deliveryFleet || "standard",
    scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    // Persisted so order details / receipts can show the real delivery distance
    // instead of recomputing (or losing) it. Null for takeaway and for online
    // orders until the background geocode fills it in.
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
    riderEarning,
    riderBaseEarning,
    eatiefyIncentive,
    platformProfit,
  });

  let razorpayPayload = null;

  try {
    await order.save();
  } catch (saveErr) {
    // Unique payment id index: a concurrent request with the same payment won.
    if (saveErr?.code === 11000 && paymentMethod === "razorpay") {
      const winner = await findOrderForRazorpayPayment({
        rzOrderId: payment.razorpay?.orderId,
        rzPaymentId: payment.razorpay?.paymentId,
      });
      if (winner) return reuseOrderForPayment(winner, userId);
    }
    throw saveErr;
  }
  if (paymentMethod === "razorpay" && payment.razorpay?.orderId) {
    // The app placed it; the webhook must not create a second copy.
    PendingOnlinePayment.deleteOne({ razorpayOrderId: payment.razorpay.orderId }).catch((err) => {
      logger.warn(`[OrderCreate] Failed to clear pending intent ${payment.razorpay.orderId}: ${err?.message || err}`);
    });
  }

  try {
    await clearFoodCart(userId);
  } catch (cartClearErr) {
    logger.warn("[OrderCreate] Failed to clear food cart for " + userId + ": " + (cartClearErr?.message || cartClearErr));
  }

  if (isWallet) {
    try {
      await userWalletService.deductWalletBalance(userId, order.pricing.total, `Payment for order #${order.order_id || order._id}`, { orderId: order._id, idempotencyKey: `order_payment:${order._id}` });
    } catch (err) {
      // If wallet deduction fails (e.g. insufficient balance), we should not have saved the order or we should delete/cancel it.
      // But since we already saved it, let's at least throw the error so the user knows.
      // Ideally this should be in a transaction.
      await FoodOrder.deleteOne({ _id: order._id });
      throw err;
    }
  }

  // Phase 2: store financials in ledger only.
  await foodTransactionService.createInitialTransaction({
    ...(order.toObject?.() || order),
    pricing: normalizedPricing,
    payment,
  });

  if (paymentMethod === "razorpay" && payment?.razorpay?.orderId) {
    // Audit can still happen here or via FinanceService events
  }

  // Realtime + push notifications.
  try {
    // Notify customer. For online payments, order is created but awaits payment confirmation.
    const isAwaitingOnlinePayment =
      String(paymentMethod || "").toLowerCase() === "razorpay" &&
      String(payment?.status || "").toLowerCase() !== "paid";
    const eventType = isAwaitingOnlinePayment ? 'order_created_pending_payment' : 'order_created';
    await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
      // "Placed", not "Confirmed": the restaurant has not accepted it yet, and
      // may still reject it - "Confirmed" followed by "Cancelled" read as a contradiction.
      title: isPayAtPickup
        ? "Order Placed — Pay at Pickup"
        : isAwaitingOnlinePayment
          ? "Complete Payment to Confirm Order"
          : "Order Placed!",
      body: isPayAtPickup
        ? `Order #${order.order_id || order._id} is placed. Pay online at ${restaurant.restaurantName || "the restaurant"} when you arrive to confirm it and start preparation.`
        : isAwaitingOnlinePayment
          ? `Order #${order.order_id || order._id} is created. Please complete payment to send it to ${restaurant.restaurantName || "the restaurant"}.`
          : `Your order #${order.order_id || order._id} from ${restaurant.restaurantName || "the restaurant"} has been placed and is waiting for the restaurant to accept it.`,
      idempotencyKey: `${eventType}_${order._id}`,
      eventId: `${eventType}_${order._id}`,
      tag: `${eventType}_${order._id}`,
      data: {
        type: eventType,
        orderId: String(order._id),
        orderMongoId: order._id?.toString?.() || "",
        link: `/food/user/orders/${order._id?.toString?.() || ""}`,
        tag: `${eventType}_${order._id}`,
        eventId: `${eventType}_${order._id}`,
      },
    });

    // Restaurant gets new-order request only when payment flow is eligible.
    await notifyRestaurantNewOrder(order);
  } catch {
    // Don't block order placement on socket failures.
  }
  const couponCode = normalizedPricing?.couponCode
    ? String(normalizedPricing.couponCode).trim().toUpperCase()
    : "";
  if (couponCode) {
    const offer = await FoodOffer.findOne({ couponCode }).lean();
    if (offer) {
      await FoodOffer.updateOne({ _id: offer._id }, { $inc: { usedCount: 1 } });
      if (userId) {
        await FoodOfferUsage.updateOne(
          { offerId: offer._id, userId: new mongoose.Types.ObjectId(userId) },
          { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
          { upsert: true },
        );
      }
    }
  }

  const dispatchableStatuses = [
    "preparing",
    "ready_for_pickup",
    "ready",
    "picked_up",
  ];
  if (
    dispatchMode === "auto" &&
    orderType !== "takeaway" &&
    (isCash ||
      order.payment.status === "paid" ||
      order.payment.status === "cod_pending") &&
    dispatchableStatuses.includes(order.orderStatus)
  ) {
    try {
      await tryAutoAssign(order._id);
    } catch {
      // leave unassigned
    }
  }

  const saved = normalizeOrderForClient(order);
  return { order: saved, razorpay: razorpayPayload };
}

// ----- Verify payment -----
export async function verifyPayment(userId, dto) {
  const identity = buildOrderIdentityFilter(dto.orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.payment.status === "paid")
    return { order: normalizeOrderForClient(order), payment: order.payment };

  const storedOrderId = String(order.payment?.razorpay?.orderId || "").trim();
  const clientOrderId = String(dto.razorpayOrderId || "").trim();
  if (storedOrderId && clientOrderId && storedOrderId !== clientOrderId) {
    throw new ValidationError("Payment does not match this order");
  }

  const valid = verifyPaymentSignature(
    clientOrderId,
    dto.razorpayPaymentId,
    dto.razorpaySignature,
  );
  if (!valid) throw new ValidationError("Payment verification failed");

  // A payment that already settled a different order cannot settle this one too.
  const paidElsewhere = await FoodOrder.exists({
    _id: { $ne: order._id },
    "payment.razorpay.paymentId": String(dto.razorpayPaymentId || "").trim(),
  });
  if (paidElsewhere) throw new ValidationError("This payment has already been used");

  // Bind to Razorpay API: amount + order id + status (defense in depth)
  try {
    const rzPayment = await fetchRazorpayPayment(dto.razorpayPaymentId);
    const expectedPaise = Math.round(Number(order.payment?.amountDue ?? order.pricing?.total ?? 0) * 100);
    assertRazorpayPaymentMatches(rzPayment, {
      orderId: storedOrderId || clientOrderId,
      amountPaise: expectedPaise,
    });
  } catch (err) {
    throw new ValidationError(err?.message || "Payment verification failed");
  }

  // Payment is verified, but the order stays "created" (Pending) so the
  // restaurant/admin still has to accept it — same flow as COD orders.
  order.payment.status = "paid";
  if (!order.payment.razorpay) order.payment.razorpay = {};
  if (!order.payment.razorpay.orderId) order.payment.razorpay.orderId = clientOrderId;
  order.payment.razorpay.paymentId = dto.razorpayPaymentId;
  order.payment.razorpay.signature = dto.razorpaySignature;
  order.markModified("payment");
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from: order.orderStatus,
    to: order.orderStatus,
    note: "Payment verified",
  });
  await order.save();

  await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
    status: 'captured',
    razorpayPaymentId: dto.razorpayPaymentId,
    razorpaySignature: dto.razorpaySignature,
    recordedByRole: "USER",
    recordedById: new mongoose.Types.ObjectId(userId)
  });

  // After online payment is verified, now notify restaurant about the new order.
  await notifyRestaurantNewOrder(order);

  // Notify Customer about payment success
  await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
    title: "Payment Successful",
    body: `We have received your payment of ₹${order.payment.amountDue} for Order #${order._id.toString()}.`,
    idempotencyKey: `payment_success_${order._id}`,
    eventId: `payment_success_${order._id}`,
    tag: `payment_success_${order._id}`,
    data: {
      type: "payment_success",
      orderId: String(order._id.toString()),
      orderMongoId: String(order._id),
      link: `/food/user/orders/${order._id?.toString?.() || ""}`,
      tag: `payment_success_${order._id}`,
      eventId: `payment_success_${order._id}`,
    },
  });

  const settings = await getDispatchSettings();
  const dispatchableStatuses = [
    "preparing",
    "ready_for_pickup",
    "ready",
    "picked_up",
  ];
  if (settings.dispatchMode === "auto" && dispatchableStatuses.includes(order.orderStatus)) {
    try {
      await tryAutoAssign(order._id);
    } catch {}
  }

  return { order: normalizeOrderForClient(order), payment: order.payment };
}

// ----- Auto-assign -----

/**
 * Start or continue a smart cascading dispatch.
 * @param {string} orderId - Mongo ID of the order.
 * @param {object} options - Options (retry count, etc)
 */
export async function tryAutoAssign(orderId, options = {}) {
    return dispatchService.tryAutoAssign(orderId, options);
}

/**
 * Triggered by worker after 60 seconds of zero response.
 */
export async function processDispatchTimeout(orderId, partnerId, options = {}) {
    return dispatchService.processDispatchTimeout(orderId, partnerId, options);
}

// ----- User: list, get, cancel -----
export async function listOrdersUser(userId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    userId: new mongoose.Types.ObjectId(userId),
    // Exclude active online orders that have incomplete payments — but KEEP
    // Pay-at-Pickup orders so the customer can see them and pay at the counter.
    $or: [
      { "payment.method": { $ne: "razorpay" } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded", "awaiting_pickup_payment"] } }
    ]
  };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate(
        "restaurantId",
        "restaurantName profileImage area city location rating totalRatings",
      )
      .populate("dispatch.deliveryPartnerId", "name phone rating totalRatings")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const normalizedDocs = docs.map((doc) => normalizeOrderForClient(doc));
  await enrichOrdersWithFoodImages(normalizedDocs);
  return buildPaginatedResult({
    docs: normalizedDocs,
    total,
    page,
    limit,
  });
}

export async function getOrderById(
  orderId,
  { userId, restaurantId, deliveryPartnerId, admin } = {},
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) {
    // Reserved path words (assigned/active/pending) or empty id — not a real order lookup
    throw new ValidationError("Invalid order id");
  }
  const order = await FoodOrder.findOne(identity)
    .populate(
      "restaurantId",
      "restaurantName ownerPhone profileImage area city location rating totalRatings primaryContactNumber",
    )
    .populate("dispatch.deliveryPartnerId", "name fullName phone phoneNumber rating totalRatings profileImage avatar")
    .populate("userId", "name fullName phone email")
    .select("+deliveryOtp")
    .lean();
  if (!order) throw new NotFoundError("Order not found");

  if (admin) {
    const adminNormalized = normalizeOrderForClient(order);
    await enrichOrdersWithFoodImages([adminNormalized]);
    return adminNormalized;
  }

  const orderUserId = order.userId?._id?.toString() || order.userId?.toString();
  const orderRestaurantId = order.restaurantId?._id?.toString() || order.restaurantId?.toString();
  const orderPartnerId = order.dispatch?.deliveryPartnerId?._id?.toString() || order.dispatch?.deliveryPartnerId?.toString();

  if (userId && orderUserId !== userId.toString())
    throw new ForbiddenError("Not your order");
  if (restaurantId && orderRestaurantId !== restaurantId.toString())
    throw new ForbiddenError("Not your restaurant order");
  if (deliveryPartnerId && orderPartnerId !== deliveryPartnerId.toString())
    throw new ForbiddenError("Not assigned to you");

  // Exclude active online orders that have incomplete payments from user view
  if (userId) {
    const isOnline = String(order.payment?.method || "").toLowerCase() === "razorpay";
    const paymentStatus = String(order.payment?.status || "").toLowerCase();
    const isPaid = ["paid", "authorized", "captured", "settled", "refunded"].includes(paymentStatus);
    // Pay-at-Pickup orders are intentionally online-but-unpaid; the owner must be
    // able to open them to pay at the counter, so they are not hidden.
    const isPayAtPickupAwaiting = paymentStatus === "awaiting_pickup_payment";
    if (isOnline && !isPaid && !isPayAtPickupAwaiting) {
      throw new NotFoundError("Order not found");
    }
  }

  if (deliveryPartnerId) {
    const delOrder = toDeliveryFacingOrder(order);
    await enrichOrdersWithFoodImages([delOrder]);
    return delOrder;
  }
  if (restaurantId) {
    const resOrder = toRestaurantFacingOrder(order);
    await enrichOrdersWithFoodImages([resOrder]);
    return resOrder;
  }

  if (userId) {
    let drop = order.deliveryVerification?.dropOtp || {};
    let secret = String(order.deliveryOtp || "").trim();

    // Self-healing for takeaway orders in active statuses that missed OTP generation
    if (order.orderType === "takeaway" && ["preparing", "ready_for_pickup"].includes(order.orderStatus) && !secret) {
      secret = generateFourDigitDeliveryOtp();
      try {
        await mongoose.model('FoodOrder').updateOne(
          { _id: order._id },
          { 
            $set: { 
              deliveryOtp: secret,
              'deliveryVerification.dropOtp': { required: true, verified: false }
            } 
          }
        );
        drop = { required: true, verified: false };
      } catch (err) {
        logger.warn(`Failed to self-heal takeaway OTP for order ${order._id}: ${err.message}`);
      }
    }

    const out = normalizeOrderForClient(order);
    await enrichOrdersWithFoodImages([out]);
    delete out.deliveryOtp;
    out.deliveryVerification = {
      ...(order.deliveryVerification || {}),
      dropOtp: {
        required: Boolean(drop.required),
        verified: Boolean(drop.verified),
      },
    };
    if (!drop.verified && secret) {
      out.handoverOtp = secret;
    }
    return out;
  }

  return sanitizeOrderForExternal(order);
}

export async function getDropOtpUser(orderId, userId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  }).select("+deliveryOtp");
  if (!order) throw new NotFoundError("Order not found");

  const phase = order.deliveryState?.currentPhase;
  const isEligible = phase === "at_drop";

  if (!isEligible) {
    throw new ValidationError(
      "OTP will appear once the delivery partner requests it at your location."
    );
  }

  if (!String(order.deliveryOtp || "").trim()) {
    throw new ValidationError(
      "OTP is not available yet. Ask the delivery partner to request OTP again."
    );
  }

  return { otp: order.deliveryOtp };
}

/**
 * Watchdog: Recovers orders stuck in 'assigned' or 'preparing' status for too long.
 * Should be called on server startup.
 */
export async function recoverStuckOrders() {
  const now = new Date();
  const FIVE_MIN = 5 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;

  try {
    // 1. Stuck in 'assigned' (partner never accepted) for > 2m
    const stuckAssigned = await FoodOrder.find({
      'dispatch.status': 'assigned',
      'dispatch.acceptedAt': { $exists: false },
      'dispatch.assignedAt': { $lt: new Date(now - TWO_MIN) },
      orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant'] }
    });

    if (stuckAssigned.length > 0) {
      logger.info(`Watchdog: Healing ${stuckAssigned.length} stuck assigned orders.`);
      for (const order of stuckAssigned) {
        // Reset status to unassigned and re-trigger auto-assign
        order.dispatch.status = 'unassigned';
        order.dispatch.deliveryPartnerId = null;
        await order.save();
        await tryAutoAssign(order._id);
      }
    }

    // 2. Clear old dispatching locks (cleanup in case of crash)
    await FoodOrder.updateMany(
      { 'dispatch.dispatchingAt': { $lt: new Date(now - FIVE_MIN) } },
      { $unset: { 'dispatch.dispatchingAt': '' } }
    );

  } catch (err) {
    logger.error(`Watchdog recovery error: ${err.message}`);
  }
}

export async function resyncState(userId, role) {
  if (role === "USER") {
    const order = await FoodOrder.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      orderStatus: {
        $nin: [
          "delivered",
          "cancelled_by_user",
          "cancelled_by_restaurant",
          "cancelled_by_admin",
        ],
      },
    })
      .select("+deliveryOtp")
      .sort({ createdAt: -1 })
      .lean();

    if (order) {
      let secret = String(order.deliveryOtp || "").trim();
      let drop = order.deliveryVerification?.dropOtp || {};

      // Self-healing for takeaway orders in active statuses that missed OTP generation
      if (order.orderType === "takeaway" && ["preparing", "ready_for_pickup"].includes(order.orderStatus) && !secret) {
        secret = generateFourDigitDeliveryOtp();
        try {
          await FoodOrder.updateOne(
            { _id: order._id },
            { 
              $set: { 
                deliveryOtp: secret,
                'deliveryVerification.dropOtp': { required: true, verified: false }
              } 
            }
          );
          drop = { required: true, verified: false };
        } catch (err) {
          logger.warn(`Failed to self-heal takeaway OTP in resyncState: ${err.message}`);
        }
      }

      const out = normalizeOrderForClient(order);
      // Re-add handover OTP if order is picked up OR if it's a takeaway order in an active status
      if (
        ((order.deliveryState?.currentPhase === "at_drop" || order.orderStatus === "picked_up") ||
         (order.orderType === "takeaway" && ["preparing", "ready_for_pickup"].includes(order.orderStatus))) &&
        !drop?.verified &&
        secret
      ) {
        out.handoverOtp = secret;
      }
      return { activeOrder: out };
    }
    return { activeOrder: null };
  }

  if (role === "DELIVERY_PARTNER") {
    const activeOrders = await deliveryService.getActiveTripsDelivery(userId);
    const capacity = await deliveryService.getPartnerOrderCapacity(userId);
    return {
      activeOrder: activeOrders[0] || null,
      activeOrders,
      capacity,
    };
  }

  return {};
}

/** Cash cancellations allowed before COD is blocked for a user. */
const COD_CANCELLATION_BLOCK_THRESHOLD = 4;

export async function cancelOrder(orderId, userId, reason, refundDestination = "source") {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");

  // If order is an unpaid online payment order in 'created' status, delete it instead of cancelling
  if (
    order.orderStatus === "created" &&
    String(order.payment?.method || "").toLowerCase() === "razorpay" &&
    String(order.payment?.status || "").toLowerCase() === "created"
  ) {
    await FoodOrder.deleteOne({ _id: order._id });
    await FoodTransaction.deleteOne({ orderId: order._id });
    return null;
  }

  const allowed = ["created", "confirmed"];
  if (!allowed.includes(order.orderStatus))
    throw new ValidationError("Order cannot be cancelled");

  const from = order.orderStatus;
  order.orderStatus = "cancelled_by_user";
  order.cancellationReason = reason || "";
  order.cancelledAt = new Date();
  order.cancelledBy = "customer";
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from,
    to: "cancelled_by_user",
    note: reason || "",
  });

  const paymentMethod = String(order.payment?.method || "cash").toLowerCase();
  const paymentStatus = String(order.payment?.status || "cod_pending").toLowerCase();
  const normalizedRefundDestination =
    String(refundDestination || "source").toLowerCase() === "wallet"
      ? "wallet"
      : "source";
  const hasRefundProcessed =
    String(order.payment?.refund?.status || "none").toLowerCase() === "processed";

  // ✅ NEW: Automated Razorpay Refund on User Cancel
  if (
    paymentStatus === "paid" &&
    paymentMethod === "razorpay" &&
    order.payment?.razorpay?.paymentId &&
    !hasRefundProcessed
  ) {
    try {
      if (normalizedRefundDestination === "wallet") {
        await userWalletService.refundWalletBalance(
          userId,
          order.pricing.total,
          `Refund for cancelled order #${order.order_id || order._id}`,
          { orderId: order._id, source: "order_refund_wallet", idempotencyKey: `order_refund:${order._id}` },
        );
        order.payment.status = "refunded";
        order.payment.refund = {
          status: "processed",
          destination: "wallet",
          amount: order.pricing.total,
          refundId: "",
          processedAt: new Date()
        };
      } else {
        const refundResult = await initiateRazorpayRefund(
          order.payment.razorpay.paymentId,
          order.pricing.total
        );

        if (refundResult.success) {
          order.payment.status = "refunded";
          order.payment.refund = {
            status: "processed",
            destination: "source",
            amount: order.pricing.total,
            refundId: refundResult.refundId,
            processedAt: new Date()
          };
        } else {
          // Log failure but let order cancellation proceed
          order.payment.refund = {
            status: "failed",
            destination: "source",
            amount: order.pricing.total
          };
        }
      }
    } catch (err) {
      console.error(`Refund processing error for Order ${orderId}:`, err);
      order.payment.refund = {
        status: "failed",
        destination: normalizedRefundDestination,
        amount: order.pricing.total,
      };
    }
  } else if (
    paymentStatus === "paid" &&
    paymentMethod === "wallet" &&
    !hasRefundProcessed
  ) {
    try {
      await userWalletService.refundWalletBalance(userId, order.pricing.total, `Refund for cancelled order #${order.order_id || order._id}`, { orderId: order._id, idempotencyKey: `order_refund:${order._id}` });
      order.payment.status = "refunded";
      order.payment.refund = {
        status: "processed",
        destination: "wallet",
        amount: order.pricing.total,
        processedAt: new Date()
      };
    } catch (err) {
      console.error(`Wallet refund processing error for Order ${orderId}:`, err);
      order.payment.refund = { status: "failed", destination: "wallet", amount: order.pricing.total };
    }
  }

  // Persist the cancellation first. Everything below is a side effect, and none of
  // it is worth failing the request the user actually made.
  await order.save();

  // Auto COD blocking: count cash cancellations, block after the 4th.
  //
  // Done as one atomic pipeline update rather than findById + save(): a single
  // round trip, no lost update when two cancels race, and no full-document
  // validation on an unrelated model (a legacy user doc failing validation used
  // to abort the whole cancel).
  try {
    if (paymentMethod === "cash") {
      const featureConfig = await FoodSystemConfig.findOne({ key: "cod_blocking_feature_enabled" })
        .select("value")
        .lean();
      if (!featureConfig || featureConfig.value !== false) { // enabled by default
        await FoodUser.updateOne({ _id: userId }, [
          {
            $set: {
              codCancellationCount: { $add: [{ $ifNull: ["$codCancellationCount", 0] }, 1] },
            },
          },
          {
            $set: {
              // Only ever escalates to blocked — never silently unblocks a user
              // an admin has already cleared.
              isCodBlocked: {
                $cond: [
                  { $gte: ["$codCancellationCount", COD_CANCELLATION_BLOCK_THRESHOLD] },
                  true,
                  { $ifNull: ["$isCodBlocked", false] },
                ],
              },
            },
          },
        ]);
      }
    }
  } catch (err) {
    logger.warn(`cancelOrder COD blocking update failed: ${err?.message || err}`);
  }

  enqueueOrderEvent("order_cancelled_by_user", {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    userId,
    reason: reason || "",
  });

  // Sync transaction status
  try {
    const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
    const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
    const isOnlinePaid =
      finalPaymentMethod === "razorpay" &&
      (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
    await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_user', {
        status: isOnlinePaid ? 'refunded' : 'failed',
        note: `Order cancelled by user: ${reason || "No reason"}`,
        recordedByRole: 'USER',
        recordedById: userId
    });
  } catch (err) {
    logger.warn(`cancelOrder transaction sync failed: ${err?.message || err}`);
  }

  // Notify User and Restaurant about the cancellation
  const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
  const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
  const isOnlinePaid =
    finalPaymentMethod === "razorpay" &&
    (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
  const settledRefundDestination =
    String(order.payment?.refund?.destination || normalizedRefundDestination || "source").toLowerCase() === "wallet"
      ? "wallet"
      : "source";
  const refundDetail = isOnlinePaid
    ? settledRefundDestination === "wallet"
      ? ` Your refund of ₹${order.pricing.total} has been credited to your wallet.`
      : ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.`
    : "";
  
  await notifyOwnersSafely(
    [
      { ownerType: "USER", ownerId: userId },
      { ownerType: "RESTAURANT", ownerId: order.restaurantId },
    ],
    {
      title: "Order Cancelled",
      body: `Order #${order.order_id || order._id} has been cancelled successfully.${refundDetail}`,
      idempotencyKey: `order_cancelled_${order._id}`,
      eventId: `order_cancelled_${order._id}`,
      tag: `order_cancelled_${order._id}`,
      data: {
        type: "order_cancelled",
        orderId: String(order._id.toString()),
        orderMongoId: String(order._id),
        link: `/food/user/orders/${order._id?.toString?.() || ""}`,
        tag: `order_cancelled_${order._id}`,
        eventId: `order_cancelled_${order._id}`,
      },
    },
  );

  // Real-time: status update via socket
  try {
    const io = getIO();
    if (io) {
      // Same shape every other order_status_update emit uses. This one used to
      // send the Mongo id as `orderId` and omit `_id`/`status`, so clients that
      // match on those fields - or print the order number - saw a cancellation
      // they could not tie back to the order on screen.
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order.order_id || order.orderId || order._id.toString(),
        _id: order._id.toString(),
        id: order._id.toString(),
        order_id: order.order_id || order.orderId || order._id.toString(),
        orderStatus: order.orderStatus,
        status: order.orderStatus,
        cancelledBy: order.cancelledBy || "customer",
        cancellationReason: order.cancellationReason || "",
        cancelledAt: order.cancelledAt,
        message: `Order #${order.order_id || order._id} has been cancelled by the customer.`
      };
      // Explicit real-time event for restaurant app popup & state handling
      io.to(rooms.restaurant(order.restaurantId)).emit("order_cancelled_by_user", payload);
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
      io.to(rooms.user(userId)).emit("order_status_update", payload);

      const trackingIds = [
        order._id?.toString?.(),
        order.order_id ? String(order.order_id) : '',
        order.orderId ? String(order.orderId) : '',
        payload.orderId,
      ].filter(Boolean);
      for (const tId of new Set(trackingIds)) {
        io.to(rooms.tracking(tId)).emit("order_status_update", payload);
      }

      if (order.dispatch?.deliveryPartnerId) {
        io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit("order_status_update", payload);
      }
    }
  } catch (err) {
    logger.warn(`cancelOrder socket emit failed: ${err?.message || err}`);
  }

  // The order is already cancelled in the database; a formatting problem must not
  // turn a successful cancellation into a 500 for the caller.
  try {
    return normalizeOrderForClient(order);
  } catch (err) {
    logger.warn(`cancelOrder response normalise failed: ${err?.message || err}`);
    return { _id: order._id, orderStatus: order.orderStatus };
  }
}

export async function submitOrderRatings(orderId, userId, dto) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (String(order.orderStatus) !== "delivered") {
    throw new ValidationError("You can rate only delivered orders");
  }

  const hasDeliveryPartner = !!order.dispatch?.deliveryPartnerId;
  if (hasDeliveryPartner && !dto.deliveryPartnerRating) {
    throw new ValidationError("Delivery partner rating is required");
  }

  const restaurantAlreadyRated = Number.isFinite(
    Number(order?.ratings?.restaurant?.rating),
  );
  const deliveryAlreadyRated = Number.isFinite(
    Number(order?.ratings?.deliveryPartner?.rating),
  );
  if (restaurantAlreadyRated || (hasDeliveryPartner && deliveryAlreadyRated)) {
    throw new ValidationError("Ratings already submitted for this order");
  }

  const now = new Date();
  order.ratings = order.ratings || {};
  order.ratings.restaurant = {
    rating: dto.restaurantRating,
    comment: dto.restaurantComment || "",
    ratedAt: now,
  };

  if (hasDeliveryPartner) {
    order.ratings.deliveryPartner = {
      rating: dto.deliveryPartnerRating,
      comment: dto.deliveryPartnerComment || "",
      ratedAt: now,
    };
  }

  await Promise.all([
    applyAggregateRating(
      FoodRestaurant,
      order.restaurantId,
      dto.restaurantRating,
    ),
    hasDeliveryPartner
      ? applyAggregateRating(
          FoodDeliveryPartner,
          order.dispatch.deliveryPartnerId,
          dto.deliveryPartnerRating,
        )
      : Promise.resolve(),
  ]);

    await order.save();
    enqueueOrderEvent('order_ratings_submitted', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        userId,
        restaurantRating: dto.restaurantRating,
        deliveryPartnerRating: hasDeliveryPartner ? dto.deliveryPartnerRating : null
    });
}

export async function updateOrderInstructions(orderId, userId, instructions) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  
  const allowedStatuses = ['created', 'confirmed', 'preparing'];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new ValidationError("Instructions can no longer be updated for this order");
  }

  order.note = String(instructions || "").trim();
  await order.save();
  return order;
}

// ----- Restaurant -----
export async function listOrdersRestaurant(restaurantId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
  };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate("userId", "name phone email profileImage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const mapped = docs.map(d => toRestaurantFacingOrder(d));
  await enrichOrdersWithFoodImages(mapped);
  return buildPaginatedResult({ docs: mapped, total, page, limit });
}

export async function updateOrderStatusRestaurant(
  orderId,
  restaurantId,
  orderStatus,
  note = "",
  preparationTime = 0
) {
  const identity = buildOrderIdentityFilter(orderId);
  let order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).select("+deliveryOtp");
  if (!order) throw new NotFoundError("Order not found");
  const from = order.orderStatus;

  // Backend Guard: If order was already cancelled (e.g. by customer or admin), reject action immediately
  if (from && String(from).includes("cancel")) {
    const cancelMsg = from === "cancelled_by_user"
      ? "Order has already been cancelled by the customer."
      : from === "cancelled_by_admin"
      ? "Order has already been cancelled by admin."
      : "Order has already been cancelled.";
    throw new ValidationError(cancelMsg);
  }

  if (!isStatusAdvance(from, orderStatus)) {
    // If order is already at a further-forward non-cancelled status (e.g. 'preparing' when accepting),
    // treat as success — the outcome is already achieved
    if (!String(from).includes("cancel") && STATUS_PRIORITY[from] > STATUS_PRIORITY[orderStatus]) {
      const resOrder = toRestaurantFacingOrder(order);
      await enrichOrdersWithFoodImages([resOrder]);
      return resOrder;
    }
    throw new ValidationError(
      String(from).includes("cancel")
        ? "Order has already been cancelled."
        : `Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`
    );
  }
  const isCancelling = String(orderStatus).includes("cancel");
  if (isCancelling) {
    const cancellationReasonStr = String(note || "").trim();
    if (!cancellationReasonStr) {
      throw new ValidationError("Cancellation reason is required when cancelling an order");
    }
    order.cancellationReason = cancellationReasonStr;
    order.cancelledAt = new Date();
    order.cancelledBy = "restaurant";
  }
  order.orderStatus = orderStatus;

  if (preparationTime !== undefined && preparationTime !== null && preparationTime > 0) {
    order.preparationTime = preparationTime;
  }

  if ((orderStatus === "confirmed" || orderStatus === "preparing") && !order.acceptedAt) {
    order.acceptedAt = new Date();
  }

  // Generate OTP for Takeaway when status changes to preparing or ready_for_pickup
  if (["preparing", "ready_for_pickup"].includes(orderStatus) && order.orderType === "takeaway") {
    if (!order.deliveryOtp) {
      order.deliveryOtp = generateFourDigitDeliveryOtp();
    }
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() || order.deliveryVerification || {}),
      dropOtp: { required: true, verified: false },
    };
    order.markModified('deliveryVerification');
    order.markModified('deliveryVerification.dropOtp');
  }

  pushStatusHistory(order, {
    byRole: "RESTAURANT",
    byId: restaurantId,
    from,
    to: orderStatus,
    note: note || ""
  });
  // Only persist if nobody moved the order meanwhile. Two accepts fired together
  // (double tap, two devices) used to both save and both run dispatch and
  // notifications; now the second one resolves to the already-updated order.
  order.$where = { orderStatus: from };
  try {
    await order.save();
    // Later re-saves in this function (refund bookkeeping) must not re-check the old status.
    order.$where = null;
  } catch (err) {
    // DocumentNotFoundError: the status guard failed. VersionError: the history
    // array changed underneath us. Both mean another update won the race.
    if (err?.name !== "DocumentNotFoundError" && err?.name !== "VersionError") throw err;
    const latest = await FoodOrder.findOne({
      ...identity,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
    });
    if (!latest) throw new NotFoundError("Order not found");
    if (latest.orderStatus && String(latest.orderStatus).includes("cancel")) {
      const cancelMsg = latest.orderStatus === "cancelled_by_user"
        ? "Order has already been cancelled by the customer."
        : latest.orderStatus === "cancelled_by_admin"
        ? "Order has already been cancelled by admin."
        : "Order has already been cancelled.";
      throw new ValidationError(cancelMsg);
    }
    if (
      latest.orderStatus === orderStatus ||
      (!String(latest.orderStatus).includes("cancel") && STATUS_PRIORITY[latest.orderStatus] > STATUS_PRIORITY[orderStatus])
    ) {
      const resOrder = toRestaurantFacingOrder(latest);
      await enrichOrdersWithFoodImages([resOrder]);
      return resOrder;
    }
    throw new ValidationError(
      `Order status changed to '${latest.orderStatus}' while updating. Please refresh and try again.`
    );
  }

  // If takeaway and in an active status, emit the OTP to the user
  if (["preparing", "ready_for_pickup"].includes(orderStatus) && order.orderType === "takeaway" && order.deliveryOtp) {
    emitDeliveryDropOtpToUser(order, order.deliveryOtp);
  }

  // Custom messages / titles for status updates
  let title = `Order ${order._id.toString()} updated`;
  let body = `Status changed to ${String(orderStatus).replace(/_/g, " ")}`;

  // Fetch restaurant name for rich notifications
  let restaurantNameStr = "the restaurant";
  try {
    const restaurantDoc = await FoodRestaurant.findById(order.restaurantId).select("restaurantName").lean();
    if (restaurantDoc?.restaurantName) restaurantNameStr = restaurantDoc.restaurantName;
  } catch (_) {}

  const isTakeawayOrder = order.orderType === "takeaway";
  const orderDisplayId = order.order_id || order._id.toString();

  if (orderStatus === "confirmed") {
    if (isTakeawayOrder) {
      title = "Order Accepted — Get Ready to Pick Up";
      body = `Great news! ${restaurantNameStr} has accepted your takeaway order #${orderDisplayId}. Your food will be ready for pickup in approximately 20–30 minutes. We'll notify you the moment it's ready.`;
    } else {
      title = "Order Accepted!";
      body = `${restaurantNameStr} has accepted your order #${orderDisplayId} and is starting to prepare it. Estimated delivery time: 30–45 minutes.`;
    }
  } else if (orderStatus === "preparing") {
    if (isTakeawayOrder) {
      title = "Your Food is Being Prepared";
      body = `${restaurantNameStr} is now preparing your takeaway order #${orderDisplayId}. We'll ping you as soon as it's ready for pickup.`;
    } else {
      title = "Food is being prepared";
      body = "Your food is currently being prepared by the restaurant.";
    }
  } else if (orderStatus === "ready_for_pickup") {
    if (isTakeawayOrder) {
      title = "Your Order is Ready for Pickup";
      body = `Your takeaway order #${orderDisplayId} from ${restaurantNameStr} is ready! Please head to the restaurant and show your Order ID at the counter.`;
    } else {
      title = "Food is ready";
      body = `Your order #${orderDisplayId} is packed and ready. Your delivery partner will pick it up shortly.`;
    }
  } else if (String(orderStatus).includes("cancel")) {
    const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
    const refundDetail = isOnlinePaid ? ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.` : "";
    const reasonText = order.cancellationReason ? ` Reason: ${order.cancellationReason}.` : "";
    
    title = "Order Cancelled";
    body = `Unfortunately, your order has been cancelled by the restaurant.${reasonText}${refundDetail}`;
  }

  // Real-time: status update to restaurant room.
  try {
    const io = getIO();
    if (io) {
      console.log(
        `[DEBUG] Emitting status update to restaurant ${restaurantId} and user ${order.userId}: ${orderStatus}`,
      );
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        displayOrderId: order.order_id || order._id.toString(),
        orderStatus: order.orderStatus,
        cancellationReason: order.cancellationReason || "",
        ...(String(order.orderStatus || "").includes("cancel")
          ? { cancelledBy: order.cancelledBy || "restaurant", cancelledAt: order.cancelledAt || null }
          : {}),
        // Assignment context, so a restaurant status change (e.g. ready) never
        // makes the customer's screen forget a rider is already on the job.
        dispatchStatus: order.dispatch?.status,
        deliveryPartnerId: order.dispatch?.deliveryPartnerId
          ? String(order.dispatch.deliveryPartnerId)
          : null,
        deliveryState: order.deliveryState,
        updatedAt: new Date().toISOString(),
        title,
        message: body,
      };
      
      const restRoom = rooms.restaurant(restaurantId);
      const userRoom = rooms.user(order.userId);
      
      console.log(`[DEBUG] Emitting order_status_update to rooms: ${restRoom}, ${userRoom}`);
      io.to(restRoom).emit("order_status_update", payload);
      io.to(userRoom).emit("order_status_update", payload);

      const trackingIds = [
        order._id?.toString?.(),
        order.order_id ? String(order.order_id) : '',
        order.orderId ? String(order.orderId) : '',
        payload.displayOrderId,
      ].filter(Boolean);
      for (const tId of new Set(trackingIds)) {
        io.to(rooms.tracking(tId)).emit("order_status_update", payload);
      }
      
      // Notify assigned rider via socket if they exist
      const assignedRiderId = order.dispatch?.deliveryPartnerId;
      if (assignedRiderId) {
          const riderRoom = rooms.delivery(assignedRiderId);
          console.log(`[DEBUG] Emitting order_status_update to rider room: ${riderRoom}`);
          io.to(riderRoom).emit("order_status_update", payload);
      }
    }

    const notifyList = [
      { ownerType: "USER", ownerId: order.userId },
      { ownerType: "RESTAURANT", ownerId: restaurantId },
    ];

    const assignedRiderId = order.dispatch?.deliveryPartnerId;
    const displayOrderId = order.order_id || order._id.toString();

    let riderTitle = `Order #${displayOrderId} updated`;
    let riderBody = `The order status is now ${String(orderStatus).replace(/_/g, " ")}.`;

    if (String(orderStatus).includes("cancel")) {
      riderTitle = "Order Cancelled ❌";
      riderBody = `Order #${displayOrderId} has been cancelled. Please stop your current task.`;
      
      // Sync transaction status
      try {
        const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
        await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_restaurant', {
            status: isOnlinePaid ? 'refunded' : 'failed',
            note: `Order cancelled by restaurant/admin`,
            recordedByRole: 'RESTAURANT',
            recordedById: restaurantId
        });
      } catch (err) {
        logger.warn(`updateOrderStatusRestaurant transaction sync failed: ${err?.message || err}`);
      }
    }

    await notifyOwnersSafely(
      notifyList,
      {
        title: title,
        body: body,
        idempotencyKey: `order_status_${orderStatus}_${order._id}`,
        eventId: `order_status_${orderStatus}_${order._id}`,
        tag: `order_status_${orderStatus}_${order._id}`,
        data: {
          type: "order_status_update",
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.() || "",
          orderStatus: String(orderStatus || ""),
          link: `/food/user/orders/${order._id?.toString?.() || ""}`,
          tag: `order_status_${orderStatus}_${order._id}`,
          eventId: `order_status_${orderStatus}_${order._id}`,
        },
      },
    );

    if (assignedRiderId) {
      await notifyOwnerSafely(
        { ownerType: "DELIVERY_PARTNER", ownerId: assignedRiderId },
        {
          title: riderTitle,
          body: riderBody,
          image: "https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png",
          idempotencyKey: `order_status_rider_${orderStatus}_${order._id}`,
          eventId: `order_status_rider_${orderStatus}_${order._id}`,
          tag: `order_status_${orderStatus}_${order._id}`,
          data: {
            type: "order_status_update",
            orderId: displayOrderId,
            orderMongoId: order._id?.toString?.() || "",
            orderStatus: String(orderStatus || ""),
            title: riderTitle,
            body: riderBody,
            link: "/food/delivery",
            tag: `order_status_${orderStatus}_${order._id}`,
            eventId: `order_status_rider_${orderStatus}_${order._id}`,
          },
        },
      );
    }
  } catch (err) {
    console.error("[DEBUG] Error emitting status update to restaurant:", err);
  }

  // Real-time: delivery request / ready notifications.
  // NOTE: Takeaway orders never need delivery dispatch — guard all delivery logic.
  try {
    const io = getIO();
    if (io) {
      // Restaurant accept moves the order into preparing/confirmed.
      // Only delivery orders get a rider — takeaway & dining are excluded.
      if (
        (String(orderStatus) === "preparing" || String(orderStatus) === "confirmed") &&
        order.orderType === "delivery"
      ) {
        console.log(
          `[DEBUG] Order ${order._id.toString()} status changed to '${orderStatus}'. Triggering central delivery dispatch.`,
        );
        
        try {
            await tryAutoAssign(order._id);
            // Refresh local order state after assignment search
            order = await FoodOrder.findById(order._id); 
        } catch (err) {
            console.error(`[DEBUG] Auto-assign in updateOrderStatusRestaurant failed:`, err);
        }
      }

      // When ready for pickup -> ping assigned delivery partner.
      // TAKEAWAY GUARD: No delivery partner involved in takeaway orders.
      if (
        String(orderStatus) === 'ready_for_pickup' &&
        String(from) !== 'ready_for_pickup' &&
        order.orderType !== 'takeaway'
      ) {
          console.log(`[DEBUG] Order ${order._id.toString()} changed to 'ready_for_pickup'.`);
          const assignedId = order.dispatch?.deliveryPartnerId?.toString?.() || order.dispatch?.deliveryPartnerId;
          if (assignedId) {
              console.log(`[DEBUG] Notifying assigned partner ${assignedId} that order is ready.`);
              const restaurant = await FoodRestaurant.findById(order.restaurantId).select('restaurantName location addressLine1 area city state').lean();
              const payload = buildDeliverySocketPayload(order, restaurant);
              logger.info(
                `[DeliveryDispatch] Emitting order_ready to ${rooms.delivery(assignedId)} for order ${order._id.toString()}`,
              );
              io.to(rooms.delivery(assignedId)).emit('order_ready', payload);
          } else {
              console.log(`[DEBUG] Order ${order._id.toString()} is ready (delivery) but no partner assigned.`);
          }
      }
    }
  } catch (err) {
      console.error('[DEBUG] Error in delivery notification logic:', err);
  }

    enqueueOrderEvent('restaurant_order_status_updated', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        restaurantId,
        from,
        to: orderStatus
    });

    // ✅ NEW: Automated Razorpay Refund on Restaurant Cancel
    // Triggers if the restaurant sets status to a cancelled state (e.g., cancelled_by_restaurant)
    if (
      String(orderStatus).includes("cancel") &&
      order.payment.status === "paid" &&
      order.payment.method === "razorpay" &&
      order.payment.razorpay?.paymentId &&
      (!order.payment.refund || order.payment.refund.status !== "processed")
    ) {
      try {
        const refundResult = await initiateRazorpayRefund(
          order.payment.razorpay.paymentId,
          order.pricing.total
        );

        if (refundResult.success) {
          order.payment.status = "refunded";
          order.payment.refund = {
            status: "processed",
            amount: order.pricing.total,
            refundId: refundResult.refundId,
            processedAt: new Date()
          };
        } else {
          // Record failure so admin knows a manual refund might be needed
          order.payment.refund = {
            status: "failed",
            amount: order.pricing.total
          };
        }
      } catch (err) {
        console.error(`Automated refund failed for Order ${order._id.toString()} (Restaurant Cancel):`, err);
        order.payment.refund = { status: "failed", amount: order.pricing.total };
      }
      // Re-save order with updated payment status
      await order.save();
    } else if (
      String(orderStatus).includes("cancel") &&
      order.payment.status === "paid" &&
      order.payment.method === "wallet" &&
      (!order.payment.refund || order.payment.refund.status !== "processed")
    ) {
      try {
        await userWalletService.refundWalletBalance(order.userId, order.pricing.total, `Refund for order #${order.order_id || order._id} cancelled by restaurant`, { orderId: order._id, idempotencyKey: `order_refund:${order._id}` });
        order.payment.status = "refunded";
        order.payment.refund = {
          status: "processed",
          amount: order.pricing.total,
          processedAt: new Date()
        };
      } catch (err) {
        console.error(`Wallet refund processing error for Order ${order._id.toString()}:`, err);
        order.payment.refund = { status: "failed", amount: order.pricing.total };
      }
      // Re-save order with updated payment status
      await order.save();
    }

    const resOrder = toRestaurantFacingOrder(order);
    await enrichOrdersWithFoodImages([resOrder]);
    return resOrder;
}

/**
 * Manually re-trigger delivery partner search for a restaurant order.
 * Only allowed if status is preparing/ready and no partner has accepted yet.
 */
export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
    return dispatchService.resendDeliveryNotificationRestaurant(orderId, restaurantId);
    const order = await FoodOrder.findOne({
        _id: new mongoose.Types.ObjectId(orderId),
        restaurantId: new mongoose.Types.ObjectId(restaurantId)
    });

    if (!order) throw new NotFoundError('Order not found');

    // Delivery resend is allowed only after restaurant acceptance.
    const activeStatuses = ['preparing', 'ready_for_pickup', 'ready'];
    if (!activeStatuses.includes(order.orderStatus)) {
        throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
    }

    // Guard: don't disrupt an active assignment that was already accepted
    if (order.dispatch?.status === 'accepted') {
        throw new ValidationError('A delivery partner has already accepted this order.');
    }

    // Reset dispatch state to unassigned to allow tryAutoAssign to start fresh
    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    // Clear previously offered partners to give everyone a fresh chance when resending manually.
    order.dispatch.offeredTo = [];
    
    await order.save();

    // Trigger smart dispatch logic immediately
    await tryAutoAssign(order._id);

    return { success: true };
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  return deliveryService.getCurrentTripDelivery(deliveryPartnerId);
}

export async function getActiveTripsDelivery(deliveryPartnerId) {
  return deliveryService.getActiveTripsDelivery(deliveryPartnerId);
}

export async function getPartnerOrderCapacity(deliveryPartnerId) {
  return deliveryService.getPartnerOrderCapacity(deliveryPartnerId);
}

// ----- Delivery: available, accept, reject, status -----
export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  return deliveryService.listOrdersAvailableDelivery(deliveryPartnerId, query);
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.acceptOrderDelivery(orderId, deliveryPartnerId);
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.rejectOrderDelivery(orderId, deliveryPartnerId);
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedPickupDelivery(orderId, deliveryPartnerId);
}

/**
 * Slide to confirm pickup (Bill uploaded)
 */
export async function confirmPickupDelivery(
  orderId,
  deliveryPartnerId,
  billImageUrl,
) {
  return deliveryService.confirmPickupDelivery(
    orderId,
    deliveryPartnerId,
    billImageUrl,
  );
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedDropDelivery(orderId, deliveryPartnerId);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  return deliveryService.verifyDropOtpDelivery(orderId, deliveryPartnerId, otp);
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  return deliveryService.completeDelivery(orderId, deliveryPartnerId, body);
}



export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  return deliveryService.updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus);
}

// ----- COD QR collection -----
export async function createCollectQr(
  orderId,
  deliveryPartnerId,
  customerInfo = {},
) {
  return paymentService.createCollectQr(orderId, deliveryPartnerId, customerInfo);
}

export async function getPaymentStatus(orderId, deliveryPartnerId) {
  return paymentService.getPaymentStatus(orderId, deliveryPartnerId);
}

// ----- Admin -----
export async function listOrdersAdmin(query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {};

  const rawStatus =
    typeof query.status === "string" ? query.status.trim().toLowerCase() : "";
  const cancelledBy =
    typeof query.cancelledBy === "string"
      ? query.cancelledBy.trim().toLowerCase()
      : "";
  const restaurantIdRaw =
    typeof query.restaurantId === "string" ? query.restaurantId.trim() : "";
  const startDateRaw =
    typeof query.startDate === "string" ? query.startDate.trim() : "";
  const endDateRaw =
    typeof query.endDate === "string" ? query.endDate.trim() : "";
  const minAmountRaw =
    typeof query.minAmount === "string" ? query.minAmount.trim() : "";
  const maxAmountRaw =
    typeof query.maxAmount === "string" ? query.maxAmount.trim() : "";
  const orderTypeRaw =
    typeof query.orderType === "string" ? query.orderType.trim().toLowerCase() : "";

  if (orderTypeRaw && ["delivery", "takeaway", "dining"].includes(orderTypeRaw)) {
    filter.orderType = orderTypeRaw;
  }

  if (rawStatus && rawStatus !== "all") {
    switch (rawStatus) {
      case "pending":
        filter.orderStatus = "created";
        break;
      case "accepted":
        filter.orderStatus = "confirmed";
        break;
      case "processing":
        filter.orderStatus = { $in: ["confirmed", "preparing", "ready_for_pickup"] };
        break;
      case "food-on-the-way":
        filter.orderStatus = "picked_up";
        break;
      case "delivered":
        filter.orderStatus = "delivered";
        break;
      case "canceled":
      case "cancelled":
        filter.orderStatus = {
          $in: [
            "cancelled_by_user",
            "cancelled_by_restaurant",
            "cancelled_by_admin",
          ],
        };
        break;
      case "restaurant-cancelled":
        filter.orderStatus = "cancelled_by_restaurant";
        break;
      case "payment-failed":
        filter["payment.status"] = "failed";
        break;
      case "refunded":
        filter["payment.status"] = "refunded";
        break;
      case "offline-payments":
        filter["payment.method"] = "cash";
        filter.orderStatus = { $in: ["created", "confirmed", "delivered"] };
        break;
      case "scheduled":
        filter.scheduledAt = { $ne: null };
        break;
      default:
        break;
    }
  }

  if (cancelledBy) {
    if (cancelledBy === "restaurant") {
      filter.orderStatus = "cancelled_by_restaurant";
    } else if (cancelledBy === "user" || cancelledBy === "customer") {
      filter.orderStatus = "cancelled_by_user";
    }
  }

  if (restaurantIdRaw) {
    if (mongoose.Types.ObjectId.isValid(restaurantIdRaw)) {
      filter.restaurantId = new mongoose.Types.ObjectId(restaurantIdRaw);
    } else {
      // Frontend passes restaurant name as restaurantId in the filter
      const restaurantDoc = await FoodRestaurant.findOne({ 
        restaurantName: new RegExp(`^${restaurantIdRaw}$`, 'i') 
      }).select('_id').lean();
      
      if (restaurantDoc) {
        filter.restaurantId = restaurantDoc._id;
      } else {
        // If name doesn't match any restaurant, ensure query returns nothing
        filter.restaurantId = new mongoose.Types.ObjectId();
      }
    }
  }

  const userIdRaw =
    typeof query.userId === "string" ? query.userId.trim() : "";
  if (userIdRaw && mongoose.Types.ObjectId.isValid(userIdRaw)) {
    filter.userId = new mongoose.Types.ObjectId(userIdRaw);
  }

  // Zone = the zone of the order's restaurant. Empty / "all" means every zone; a
  // malformed id is a 400 rather than a silently unfiltered list.
  const zoneIdRaw =
    typeof query.zoneId === "string" ? query.zoneId.trim() : "";
  if (zoneIdRaw && zoneIdRaw.toLowerCase() !== "all") {
    if (!mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
      throw new ValidationError("Invalid zoneId");
    }
    const zoneRestaurantIds = (
      await FoodRestaurant.find({ zoneId: new mongoose.Types.ObjectId(zoneIdRaw) })
        .select("_id")
        .lean()
    ).map((r) => r._id);
    if (filter.restaurantId) {
      // Restaurant and zone together: a restaurant outside the zone has no orders in it.
      const selected = filter.restaurantId;
      if (!zoneRestaurantIds.some((id) => id.equals(selected))) {
        filter.restaurantId = { $in: [] };
      }
    } else {
      filter.restaurantId = { $in: zoneRestaurantIds };
    }
  }

  if (startDateRaw || endDateRaw) {
    const createdAt = {};
    const start = startDateRaw ? new Date(startDateRaw) : null;
    const end = endDateRaw ? new Date(endDateRaw) : null;
    if (start && !Number.isNaN(start.getTime())) {
      createdAt.$gte = start;
    }
    if (end && !Number.isNaN(end.getTime())) {
      // Ensure the end date covers the entire day until 23:59:59.999
      end.setUTCHours(23, 59, 59, 999);
      createdAt.$lte = end;
    }
    if (Object.keys(createdAt).length > 0) {
      filter.createdAt = createdAt;
    }
  }

  // Amount range filtering with validation to ensure non-negative values
  if (minAmountRaw) {
    const minAmount = parseFloat(minAmountRaw);
    if (Number.isFinite(minAmount) && minAmount >= 0) {
      filter["pricing.total"] = filter["pricing.total"] || {};
      filter["pricing.total"].$gte = minAmount;
    }
  }

  if (maxAmountRaw) {
    const maxAmount = parseFloat(maxAmountRaw);
    if (Number.isFinite(maxAmount) && maxAmount >= 0) {
      filter['pricing.total'] = filter['pricing.total'] || {};
      filter['pricing.total'].$lte = maxAmount;
    }
  }

  // Global search across all matching orders (not just current page)
  const searchRaw = String(query.search || '').trim().slice(0, 80);
  if (searchRaw) {
    const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escaped, 'i');

    const [matchedUsers, matchedRestaurants] = await Promise.all([
      FoodUser.find({
        $or: [
          { name: searchRegex },
          { phone: searchRegex },
          { email: searchRegex },
        ],
      })
        .select('_id')
        .limit(100)
        .lean(),
      FoodRestaurant.find({
        $or: [
          { restaurantName: searchRegex },
          { ownerPhone: searchRegex },
          { primaryContactNumber: searchRegex },
        ],
      })
        .select('_id')
        .limit(100)
        .lean(),
    ]);

    const searchOr = [
      { order_id: searchRegex },
      { orderId: searchRegex },
      { customerName: searchRegex },
      { 'deliveryAddress.phone': searchRegex },
      { 'deliveryAddress.name': searchRegex },
    ];

    if (mongoose.Types.ObjectId.isValid(searchRaw)) {
      searchOr.push({ _id: new mongoose.Types.ObjectId(searchRaw) });
    }

    if (matchedUsers.length > 0) {
      searchOr.push({ userId: { $in: matchedUsers.map((u) => u._id) } });
    }
    if (matchedRestaurants.length > 0) {
      searchOr.push({ restaurantId: { $in: matchedRestaurants.map((r) => r._id) } });
    }

    if (/^\d+(\.\d+)?$/.test(searchRaw)) {
      const asNum = Number(searchRaw);
      if (Number.isFinite(asNum)) {
        searchOr.push({ 'pricing.total': asNum });
      }
    }

    const baseFilter = { ...filter };
    Object.keys(filter).forEach((key) => {
      delete filter[key];
    });
    Object.assign(filter, {
      $and: [baseFilter, { $or: searchOr }],
    });
  }

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .select("+deliveryOtp")
      .populate("userId", "name phone email")
      .populate("restaurantId", "restaurantName area city ownerPhone")
      .populate("dispatch.deliveryPartnerId", "name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const paginated = buildPaginatedResult({ docs: docs.map(d => normalizeOrderForClient(d)), total, page, limit });

  let statusCounts = null;
  const wantCounts =
    query.includeStatusCounts === true ||
    query.includeStatusCounts === "1" ||
    String(query.includeStatusCounts || "").toLowerCase() === "true";
  if (wantCounts) {
    const grouped = await FoodOrder.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            orderStatus: "$orderStatus",
            paymentStatus: "$payment.status",
            scheduled: { $cond: [{ $ifNull: ["$scheduledAt", false] }, true, false] },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    statusCounts = {
      total,
      Scheduled: 0,
      Pending: 0,
      Accepted: 0,
      Processing: 0,
      "Food On The Way": 0,
      Delivered: 0,
      Canceled: 0,
      "Payment Failed": 0,
      Refunded: 0,
    };

    for (const row of grouped) {
      const os = String(row?._id?.orderStatus || "").toLowerCase();
      const pay = String(row?._id?.paymentStatus || "").toLowerCase();
      const count = Number(row.count || 0);
      if (row?._id?.scheduled) statusCounts.Scheduled += count;
      if (pay === "failed") statusCounts["Payment Failed"] += count;
      if (pay === "refunded") statusCounts.Refunded += count;
      if (!os || os === "created" || os === "confirmed") statusCounts.Pending += count;
      else if (os === "preparing" || os === "ready_for_pickup") statusCounts.Processing += count;
      else if (os === "picked_up" || os === "out_for_delivery") statusCounts["Food On The Way"] += count;
      else if (os === "delivered") statusCounts.Delivered += count;
      else if (os.startsWith("cancelled")) statusCounts.Canceled += count;
    }
  }

  // Order Detect Delivery dashboard cards — global counts (not current page)
  let detectDeliveryCounts = null;
  const wantDetectCounts =
    query.includeDetectDeliveryCounts === true ||
    query.includeDetectDeliveryCounts === "1" ||
    String(query.includeDetectDeliveryCounts || "").toLowerCase() === "true";
  if (wantDetectCounts) {
    const detectGrouped = await FoodOrder.aggregate([
      { $match: filter },
      {
        $addFields: {
          _os: { $toLower: { $ifNull: ["$orderStatus", ""] } },
          _phase: { $ifNull: ["$deliveryState.currentPhase", ""] },
          _ds: { $ifNull: ["$deliveryState.status", ""] },
          _hasPartner: {
            $cond: [{ $ifNull: ["$dispatch.deliveryPartnerId", false] }, true, false],
          },
          _hasOrderIdConfirm: {
            $cond: [{ $ifNull: ["$deliveryState.orderIdConfirmedAt", false] }, true, false],
          },
        },
      },
      {
        $addFields: {
          detectStatus: {
            $switch: {
              branches: [
                {
                  case: {
                    $in: [
                      "$_os",
                      [
                        "cancelled",
                        "cancelled_by_user",
                        "cancelled_by_restaurant",
                        "cancelled_by_admin",
                      ],
                    ],
                  },
                  then: "Rejected",
                },
                { case: { $eq: ["$_os", "delivered"] }, then: "Ordered Delivered" },
                {
                  case: { $in: ["$_phase", ["at_delivery", "at_drop"]] },
                  then: "Reached Drop",
                },
                {
                  case: { $eq: ["$_phase", "at_pickup"] },
                  then: "Delivery Boy Reached Pickup",
                },
                {
                  case: {
                    $or: [
                      { $eq: ["$_ds", "order_confirmed"] },
                      { $eq: ["$_phase", "en_route_to_delivery"] },
                      { $eq: ["$_hasOrderIdConfirm", true] },
                      { $in: ["$_os", ["picked_up", "out_for_delivery"]] },
                    ],
                  },
                  then: "Order ID Accepted",
                },
                {
                  case: { $eq: ["$_hasPartner", true] },
                  then: "Delivery Boy Assigned",
                },
                {
                  case: {
                    $in: [
                      "$_os",
                      ["confirmed", "preparing", "ready_for_pickup", "ready"],
                    ],
                  },
                  then: "Restaurant Accepted",
                },
                {
                  case: { $in: ["$_os", ["created", "pending", ""]] },
                  then: "Ordered",
                },
              ],
              default: "Ordered",
            },
          },
        },
      },
      { $group: { _id: "$detectStatus", count: { $sum: 1 } } },
    ]);

    detectDeliveryCounts = {
      total,
      Ordered: 0,
      "Restaurant Accepted": 0,
      Rejected: 0,
      "Delivery Boy Assigned": 0,
      "Delivery Boy Reached Pickup": 0,
      "Order ID Accepted": 0,
      "Reached Drop": 0,
      "Ordered Delivered": 0,
    };
    for (const row of detectGrouped) {
      const key = String(row?._id || "");
      if (Object.prototype.hasOwnProperty.call(detectDeliveryCounts, key)) {
        detectDeliveryCounts[key] = Number(row.count || 0);
      }
    }
  }

  return {
    ...paginated,
    orders: paginated.data,
    ...(statusCounts ? { statusCounts } : {}),
    ...(detectDeliveryCounts ? { detectDeliveryCounts } : {}),
  };
}

export async function assignDeliveryPartnerAdmin(
  orderId,
  deliveryPartnerId,
  adminId,
) {
  const order = await FoodOrder.findById(orderId);
  if (!order) throw new NotFoundError("Order not found");
  if (order.dispatch.status === "accepted")
    throw new ValidationError("Order already accepted by partner");

  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
    .select("status")
    .lean();
  if (!partner || partner.status !== "approved")
    throw new ValidationError("Delivery partner not available");

    order.dispatch.status = 'assigned';
    order.dispatch.deliveryPartnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    order.dispatch.assignedAt = new Date();
    pushStatusHistory(order, { byRole: 'ADMIN', byId: adminId, from: order.dispatch.status, to: 'assigned' });
    await order.save();
    enqueueOrderEvent('delivery_partner_assigned', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        deliveryPartnerId,
        adminId
    });
    // Nothing consumes the queued event above (and the queue is unavailable without
    // Redis), so the assigned rider was never told. Push directly from the server.
    void notifyOwnersSafely(
      [{ ownerType: "DELIVERY_PARTNER", ownerId: String(deliveryPartnerId) }],
      {
        title: "New order assigned!",
        body: `Order #${order.order_id || order._id} has been assigned to you.`,
        sound: getNewOrderAlertSound(),
        urgent: true,
        channelId: "delivery_orders",
        link: "/food/delivery",
        idempotencyKey: `admin_assign_${order._id}_${deliveryPartnerId}`,
        eventId: `admin_assign_${order._id}_${deliveryPartnerId}`,
        tag: `dispatch_offer_${order._id}`,
        data: {
          type: "new_order",
          orderId: order.order_id || order._id.toString(),
          orderMongoId: order._id.toString(),
          targetPartnerId: String(deliveryPartnerId),
          link: "/food/delivery",
          targetUrl: "/food/delivery",
          tag: `dispatch_offer_${order._id}`,
          eventId: `admin_assign_${order._id}_${deliveryPartnerId}`,
        },
      },
    );
    return normalizeOrderForClient(order);
}

export async function deleteOrderAdmin(orderId, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity).lean();
  if (!order) throw new NotFoundError("Order not found");

  // Keep support tickets but detach deleted order reference.
  await Promise.all([
    FoodSupportTicket.updateMany(
      { orderId: order._id },
      { $set: { orderId: null } },
    ),
    FoodTransaction.deleteOne({
      $or: [{ orderId: order._id }, { orderReadableId: String(order._id.toString()) }],
    }),
    FoodOrder.deleteOne({ _id: order._id }),
  ]);

  // Remove realtime tracking node if present.
  try {
    const db = getFirebaseDB();
    if (db && order?.orderId) {
      await db.ref(`active_orders/${order._id.toString()}`).remove();
    }
  } catch (err) {
    logger.warn(`Delete order firebase cleanup failed: ${err?.message || err}`);
  }

  // Notify connected apps so stale UI entries can disappear without refresh.
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: String(order._id),
        orderId: String(order._id.toString() || ""),
        deletedBy: "ADMIN",
        adminId: adminId ? String(adminId) : null,
      };

      if (order.userId) io.to(rooms.user(order.userId)).emit("order_deleted", payload);
      if (order.restaurantId) io.to(rooms.restaurant(order.restaurantId)).emit("order_deleted", payload);
      if (order.dispatch?.deliveryPartnerId) {
        io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit("order_deleted", payload);
      }
    }
  } catch (err) {
    logger.warn(`Delete order socket emit failed: ${err?.message || err}`);
  }

  enqueueOrderEvent("order_deleted_by_admin", {
    orderMongoId: String(order._id),
    orderId: String(order._id.toString() || ""),
    adminId: adminId ? String(adminId) : null,
  });

  return {
    deleted: true,
    orderId: String(order._id.toString() || ""),
    orderMongoId: String(order._id),
  };
}

export async function completeTakeawayOrderRestaurant(orderId, restaurantId, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).select("+deliveryOtp");
  if (!order) throw new NotFoundError("Order not found");

  if (order.orderType !== "takeaway") {
    throw new ValidationError("Only takeaway orders can be completed via restaurant verification");
  }

  if (order.orderStatus === "delivered") {
    return normalizeOrderForClient(order);
  }

  if (!["preparing", "ready_for_pickup"].includes(order.orderStatus)) {
    throw new ValidationError("Order must be ready for pickup or being prepared to be completed");
  }

  const existingOtp = String(order.deliveryOtp || "").trim();
  if (!isOtpMatch(existingOtp, otp)) {
    throw new ValidationError("Invalid OTP");
  }

  const from = order.orderStatus;
  order.orderStatus = "delivered";
  if (!order.deliveryVerification) {
    order.deliveryVerification = {};
  }
  order.deliveryVerification.dropOtp = {
    required: true,
    verified: true,
    code: existingOtp
  };
  
  order.deliveredAt = new Date();
  
  pushStatusHistory(order, {
    byRole: "RESTAURANT",
    byId: restaurantId,
    from,
    to: "delivered",
    note: "Takeaway order completed. OTP verified successfully."
  });

  await order.save();

  // Reset COD Cancellation Count on any successful delivery
  if (order.userId) {
    const user = await FoodUser.findById(order.userId);
    if (user) {
      user.codCancellationCount = 0;
      await user.save();
    }
  }

  // Sync to FoodTransaction ledger
  await foodTransactionService.updateTransactionStatus(order._id, 'takeaway_completed_and_paid', {
    status: 'captured',
    recordedByRole: 'RESTAURANT',
    recordedById: restaurantId,
    note: 'Takeaway order completed and OTP verified.'
  });

  // Fetch updated order to get synced fields
  const updatedOrder = await FoodOrder.findById(order._id).lean();

  // Real-time: status update via socket to restaurant and user
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order.order_id || order._id.toString(),
        orderStatus: "delivered",
        title: "Takeaway Order Picked Up",
        message: "You have picked up your order successfully. Enjoy your meal!",
      };
      io.to(rooms.restaurant(restaurantId)).emit("order_status_update", payload);
      io.to(rooms.user(order.userId)).emit("order_status_update", payload);

      const trackingIds = [
        order._id?.toString?.(),
        order.order_id ? String(order.order_id) : '',
        order.orderId ? String(order.orderId) : '',
        payload.orderId,
      ].filter(Boolean);
      for (const tId of new Set(trackingIds)) {
        io.to(rooms.tracking(tId)).emit("order_status_update", payload);
      }
    }

    await notifyOwnersSafely(
      [
        { ownerType: "USER", ownerId: order.userId },
        { ownerType: "RESTAURANT", ownerId: restaurantId },
      ],
      {
        title: "Takeaway Order Picked Up",
        body: "Your order has been picked up and marked as completed.",
        idempotencyKey: `takeaway_picked_up_${order._id}`,
        eventId: `takeaway_picked_up_${order._id}`,
        tag: `takeaway_picked_up_${order._id}`,
        data: {
          type: "order_status_update",
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.() || "",
          orderStatus: "delivered",
          link: `/food/user/orders/${order._id?.toString?.() || ""}`,
          tag: `takeaway_picked_up_${order._id}`,
          eventId: `takeaway_picked_up_${order._id}`,
        },
      }
    );
  } catch (err) {
    logger.warn(`completeTakeawayOrderRestaurant notifications failed: ${err?.message || err}`);
  }

  enqueueOrderEvent('restaurant_order_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    restaurantId,
    from,
    to: 'delivered'
  });

  return normalizeOrderForClient(updatedOrder || order);
}

export async function acceptOrderAdmin(orderId, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");

  const from = order.orderStatus;

  // Already cancelled — cannot accept
  if (from && from.includes("cancelled")) {
    throw new ValidationError(`Order already cancelled (${from}). Cannot accept.`);
  }
  // Already accepted/further — idempotent return
  if (from === "confirmed" || from === "preparing" || (STATUS_PRIORITY[from] > STATUS_PRIORITY["preparing"])) {
    return normalizeOrderForClient(order);
  }

  // Admin accept moves the order straight into "preparing" (same as a restaurant
  // accept) so that delivery dispatch starts automatically and the order does not
  // get stuck in "confirmed".
  order.orderStatus = "preparing";
  order.acceptedAt = new Date();

  pushStatusHistory(order, {
    byRole: "ADMIN",
    byId: adminId,
    from,
    to: "preparing",
    note: "Order accepted by admin"
  });

  await order.save();

  // Real-time notification
  try {
    const io = getIO();
    if (io) {
      const restaurantPayload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order.orderId || order._id.toString(),
        _id: order._id.toString(),
        orderStatus: order.orderStatus,
        status: order.orderStatus,
        acceptedBy: "admin",
        title: "Order Accepted! 🧑‍🍳",
        message: `Order accepted by admin`,
      };
      const userPayload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order.orderId || order._id.toString(),
        _id: order._id.toString(),
        orderStatus: order.orderStatus,
        status: order.orderStatus,
        title: "Order Confirmed!",
        message: `Your order has been confirmed and is being prepared.`,
      };
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", restaurantPayload);
      io.to(rooms.user(order.userId)).emit("order_status_update", userPayload);

      const trackingIds = [
        order._id?.toString?.(),
        order.order_id ? String(order.order_id) : '',
        order.orderId ? String(order.orderId) : '',
        userPayload.orderId,
      ].filter(Boolean);
      for (const tId of new Set(trackingIds)) {
        io.to(rooms.tracking(tId)).emit("order_status_update", userPayload);
      }
    }
  } catch (_) {}

  // Auto-assign a delivery rider now that the order is in "preparing".
  // Only delivery orders get dispatched — takeaway & dining have no rider.
  try {
    if (order.orderType === "delivery") {
      await dispatchService.tryAutoAssign(order._id);
    }
  } catch (err) {
    logger.warn(`Admin accept order auto-assign rider failed: ${err.message}`);
  }

  return normalizeOrderForClient(order);
}

export async function rejectOrderAdmin(orderId, reason, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");

  const from = order.orderStatus;

  // Already cancelled — idempotent
  if (from && from.includes("cancelled")) {
    return normalizeOrderForClient(order);
  }
  // Already beyond pending (confirmed/preparing etc.) — cannot reject
  if (from && STATUS_PRIORITY[from] > STATUS_PRIORITY["confirmed"]) {
    throw new ValidationError(`Order is already in '${from}' state. Cannot reject now.`);
  }

  order.orderStatus = "cancelled_by_admin";

  pushStatusHistory(order, {
    byRole: "ADMIN",
    byId: adminId,
    from,
    to: "cancelled_by_admin",
    note: reason || "Order rejected by admin"
  });

  await order.save();

  // Sync transaction status
  try {
    const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
    await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_admin', {
        status: isOnlinePaid ? 'refunded' : 'failed',
        note: reason || `Order rejected by admin`,
        recordedByRole: 'ADMIN',
        recordedById: adminId
    });
  } catch (_) {}

  // Real-time notification
  try {
    const io = getIO();
    if (io) {
      const restaurantPayload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order.orderId || order._id.toString(),
        _id: order._id.toString(),
        orderStatus: order.orderStatus,
        status: order.orderStatus,
        title: "Order Cancelled ❌",
        message: reason || "Order rejected by admin",
      };
      const userPayload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order.orderId || order._id.toString(),
        _id: order._id.toString(),
        orderStatus: order.orderStatus,
        status: order.orderStatus,
        title: "Order Cancelled ❌",
        message: reason || "Your order has been cancelled.",
      };
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", restaurantPayload);
      io.to(rooms.user(order.userId)).emit("order_status_update", userPayload);

      const trackingIds = [
        order._id?.toString?.(),
        order.order_id ? String(order.order_id) : '',
        order.orderId ? String(order.orderId) : '',
        userPayload.orderId,
      ].filter(Boolean);
      for (const tId of new Set(trackingIds)) {
        io.to(rooms.tracking(tId)).emit("order_status_update", userPayload);
      }
    }
  } catch (_) {}

  return normalizeOrderForClient(order);
}

/**
 * Admin override: update order and/or payment status independently.
 * Status correction only — does not run rider payout / refund automations.
 */
export async function updateOrderStatusesAdmin(
  orderId,
  adminId,
  { orderStatus, paymentStatus, cancellationReason } = {},
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const hasOrderStatus = orderStatus != null && String(orderStatus).trim() !== "";
  const hasPaymentStatus = paymentStatus != null && String(paymentStatus).trim() !== "";
  if (!hasOrderStatus && !hasPaymentStatus) {
    throw new ValidationError("Provide orderStatus and/or paymentStatus to update");
  }

  const ORDER_STATUS_ALIASES = {
    pending: "created",
    created: "created",
    accepted: "confirmed",
    confirmed: "confirmed",
    processing: "preparing",
    preparing: "preparing",
    "ready for pickup": "ready_for_pickup",
    ready_for_pickup: "ready_for_pickup",
    "food on the way": "picked_up",
    picked_up: "picked_up",
    reached_pickup: "reached_pickup",
    reached_drop: "reached_drop",
    delivered: "delivered",
    canceled: "cancelled_by_admin",
    cancelled: "cancelled_by_admin",
    cancelled_by_admin: "cancelled_by_admin",
    "cancelled by restaurant": "cancelled_by_restaurant",
    cancelled_by_restaurant: "cancelled_by_restaurant",
    "cancelled by user": "cancelled_by_user",
    cancelled_by_user: "cancelled_by_user",
  };

  const PAYMENT_STATUS_ALIASES = {
    pending: "__pending__",
    unpaid: "__pending__",
    "not collected": "cod_pending",
    "cod pending": "cod_pending",
    collected: "paid",
    paid: "paid",
    failed: "failed",
    refunded: "refunded",
    cod_pending: "cod_pending",
    created: "created",
    authorized: "authorized",
    pending_qr: "pending_qr",
  };

  const ALLOWED_ORDER = new Set([
    "created",
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "reached_pickup",
    "picked_up",
    "reached_drop",
    "delivered",
    "cancelled_by_user",
    "cancelled_by_restaurant",
    "cancelled_by_admin",
  ]);

  const ALLOWED_PAYMENT = new Set([
    "cod_pending",
    "created",
    "authorized",
    "paid",
    "failed",
    "refunded",
    "pending_qr",
  ]);

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");

  let nextOrderStatus = null;
  if (hasOrderStatus) {
    const key = String(orderStatus).trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
    const keyRaw = String(orderStatus).trim().toLowerCase();
    nextOrderStatus =
      ORDER_STATUS_ALIASES[key] ||
      ORDER_STATUS_ALIASES[keyRaw] ||
      (ALLOWED_ORDER.has(keyRaw) ? keyRaw : null);
    if (!nextOrderStatus || !ALLOWED_ORDER.has(nextOrderStatus)) {
      throw new ValidationError(`Invalid order status: ${orderStatus}`);
    }
  }

  let nextPaymentStatus = null;
  if (hasPaymentStatus) {
    const key = String(paymentStatus).trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
    const keyRaw = String(paymentStatus).trim().toLowerCase();
    let mapped =
      PAYMENT_STATUS_ALIASES[key] ||
      PAYMENT_STATUS_ALIASES[keyRaw] ||
      (ALLOWED_PAYMENT.has(keyRaw) ? keyRaw : null);
    if (mapped === "__pending__") {
      const method = String(order.payment?.method || "").toLowerCase();
      mapped = method === "cash" || method === "cod" ? "cod_pending" : "created";
    }
    if (!mapped || !ALLOWED_PAYMENT.has(mapped)) {
      throw new ValidationError(`Invalid payment status: ${paymentStatus}`);
    }
    nextPaymentStatus = mapped;
  }

  const fromOrder = order.orderStatus;
  const fromPayment = order.payment?.status;

  if (nextOrderStatus && nextOrderStatus !== fromOrder) {
    order.orderStatus = nextOrderStatus;
    pushStatusHistory(order, {
      byRole: "ADMIN",
      byId: adminId,
      from: fromOrder,
      to: nextOrderStatus,
      note: "Admin override — order status",
    });

    /*
     * A cancel set here is a cancel the customer sees, so it carries what the
     * restaurant and customer cancel flows record: who cancelled (from the
     * status admin picked) and the reason admin gave. It recorded neither, so
     * the customer was shown "Cancelled by support" and the internal
     * "Admin override" note as the reason. Restoring a cancelled order clears
     * them, so a later cancel never shows a stale reason.
     */
    if (nextOrderStatus.includes("cancel")) {
      order.cancelledBy = CANCELLED_BY_FOR_STATUS[nextOrderStatus] || "admin";
      order.cancelledAt = new Date();
      order.cancellationReason = String(cancellationReason || "").trim();
    } else if (String(fromOrder || "").includes("cancel")) {
      order.cancelledBy = "";
      order.cancelledAt = null;
      order.cancellationReason = "";
    }

    if (!order.deliveryState) order.deliveryState = {};

    if (nextOrderStatus === "delivered") {
      if (!order.deliveryState.deliveredAt) {
        order.deliveryState.deliveredAt = new Date();
      }
      order.deliveryState.currentPhase = "delivered";

      try {
        const finalPayMethod = order.payment?.method || 'cash';
        const ledgerKind =
          finalPayMethod === 'cash' || finalPayMethod === 'wallet' || finalPayMethod === 'cod'
            ? 'cod_marked_paid_on_delivery' 
            : (finalPayMethod === 'razorpay_qr' ? 'cod_collect_qr_settled' : 'payment_snapshot_sync');

        await foodTransactionService.updateTransactionStatus(order._id, ledgerKind, {
          status: 'captured',
          paymentMethod: finalPayMethod,
          recordedByRole: 'ADMIN',
          recordedById: adminId,
          note: `Admin marked order delivered.`,
        });
      } catch (err) {
        console.error(`[AdminStatusSync] Error syncing transaction for order ${order._id}:`, err);
      }
    } else if (nextOrderStatus === "picked_up" || nextOrderStatus === "reached_drop") {
      order.deliveryState.currentPhase =
        nextOrderStatus === "reached_drop" ? "at_drop" : "en_route_to_delivery";
    } else if (nextOrderStatus === "ready_for_pickup" || nextOrderStatus === "reached_pickup") {
      order.deliveryState.currentPhase =
        nextOrderStatus === "reached_pickup" ? "at_pickup" : "en_route_to_pickup";
    }
  }

  if (nextPaymentStatus && order.payment && nextPaymentStatus !== fromPayment) {
    order.payment.status = nextPaymentStatus;
    pushStatusHistory(order, {
      byRole: "ADMIN",
      byId: adminId,
      from: fromPayment || "",
      to: nextPaymentStatus,
      note: "Admin override — payment status",
    });
  }

  await order.save();

  // Reset COD Cancellation Count if marked delivered
  if (nextOrderStatus === "delivered" && order.userId) {
    const user = await FoodUser.findById(order.userId);
    if (user) {
      user.codCancellationCount = 0;
      await user.save();
    }
  }

  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order.orderId || order._id.toString(),
        _id: order._id.toString(),
        orderStatus: order.orderStatus,
        status: order.orderStatus,
        paymentStatus: order.payment?.status,
        // Same cancel details the restaurant's cancel event carries, so the
        // customer's screen shows who cancelled and why straight away.
        ...(String(order.orderStatus || "").includes("cancel")
          ? {
              cancellationReason: order.cancellationReason || "",
              cancelledBy: order.cancelledBy || "",
              cancelledAt: order.cancelledAt || null,
            }
          : {}),
        title: "Order updated by admin",
        message: "Admin updated order status",
      };
      if (order.restaurantId) {
        io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
      }
      if (order.userId) {
        io.to(rooms.user(order.userId)).emit("order_status_update", payload);
      }
      const trackingIds = [
        order._id?.toString?.(),
        order.order_id ? String(order.order_id) : '',
        order.orderId ? String(order.orderId) : '',
        payload.orderId,
      ].filter(Boolean);
      for (const tId of new Set(trackingIds)) {
        io.to(rooms.tracking(tId)).emit("order_status_update", payload);
      }
    }
  } catch (_) {}

  return normalizeOrderForClient(order);
}

