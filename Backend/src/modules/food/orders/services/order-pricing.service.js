import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { haversineKm, assertRestaurantDeliversToZone } from './order.helpers.js';
import { fetchDrivingDistanceKm } from '../utils/googleMaps.js';
import { resolveFeeSettingsForZone } from '../../admin/services/zoneScopedSettings.service.js';
import { isTakeawayEnabled } from '../../admin/services/moduleAccess.service.js';
import {
  enforceMinimumFoodItemPrices,
  resolveCheckoutItems,
} from './order-item-pricing.service.js';
import { applyRestaurantItemOffers } from './restaurantOfferPricing.service.js';

export async function calculateOrderPricing(userId, dto) {
  const resolved = await resolveCheckoutItems(userId, dto);
  const pricedItems = await enforceMinimumFoodItemPrices(
    resolved.items,
    resolved.restaurantId || dto.restaurantId,
  );

  const restaurantId = resolved.restaurantId || dto.restaurantId;
  if (!restaurantId) throw new ValidationError('Restaurant id required');

  // Restaurant-run offers lower the covered items' prices; everything below
  // (subtotal, tax, coupon, fees, restaurant earning) follows from the items.
  const restaurantOffers = await applyRestaurantItemOffers({ restaurantId, items: pricedItems, dto });
  const items = restaurantOffers.items;

  const restaurant = await FoodRestaurant.findById(restaurantId)
    .select("status location zoneId restaurantName takeawaySettings")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not available");

  // Takeaway needs the admin module on and the restaurant to offer pickup.
  // Checked here so the cart, the Razorpay initiation and order creation all
  // agree: only order creation used to check it, so an online payment for a
  // pickup the restaurant does not offer was taken and the order then failed.
  if (String(dto.orderType || "delivery").toLowerCase() === "takeaway") {
    if (!(await isTakeawayEnabled())) {
      throw new ValidationError("Takeaway is currently unavailable", "TAKEAWAY_UNAVAILABLE");
    }
    if (restaurant.takeawaySettings?.isEnabled !== true) {
      throw new ValidationError("Takeaway is not available for this restaurant", "TAKEAWAY_UNAVAILABLE");
    }
  }

  assertRestaurantDeliversToZone(restaurant, {
    zoneId: dto.zoneId,
    orderType: dto.orderType,
    deliveryAddress: dto.deliveryAddress,
  });

  const couponCode = String(
    dto.couponCode || resolved.couponCode || dto.pricing?.couponCode || "",
  )
    .trim()
    .toUpperCase();

  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
    0,
  );
  const baseSubtotal = items.reduce((sum, it) => {
    const base = Number(it.basePrice);
    const unit = Number.isFinite(base) && base >= 0 ? base : Number(it.price) || 0;
    return sum + unit * (Number(it.quantity) || 1);
  }, 0);
  const markupTotal = items.reduce(
    (sum, it) =>
      sum + Math.max(0, Number(it.markupAmount) || 0) * (Number(it.quantity) || 1),
    0,
  );

  const pricingZoneId = dto.zoneId || restaurant.zoneId || null;
  const feeDoc = await resolveFeeSettingsForZone(pricingZoneId);
  const feeSettings = feeDoc || {
    deliveryFee: 25,
    deliveryFeeRanges: [],
    freeDeliveryUpTo: 0,
    platformFee: 0,
    packagingFee: 0,
    gstRate: 0,
  };

  const basePackagingFee = feeSettings.packagingFee != null ? Number(feeSettings.packagingFee) : 0;
  const packagingFee = dto.orderType === "takeaway" ? 0 : basePackagingFee;
  const platformFee = feeSettings.platformFee != null ? Number(feeSettings.platformFee) : 0;

  const freeUpTo = Number(feeSettings.freeDeliveryUpTo || 0);
  let distanceKm = null;
  if (
    restaurant?.location?.coordinates?.length === 2 &&
    dto?.deliveryAddress?.location?.coordinates?.length === 2
  ) {
    const [rLng, rLat] = restaurant.location.coordinates;
    const [dLng, dLat] = dto.deliveryAddress.location.coordinates;
    const drivingKm = await fetchDrivingDistanceKm(
      { lat: rLat, lng: rLng },
      { lat: dLat, lng: dLng },
    );
    if (Number.isFinite(drivingKm) && drivingKm > 0) {
      distanceKm = drivingKm;
    } else {
      const d = haversineKm(rLat, rLng, dLat, dLng);
      distanceKm = Number.isFinite(d) ? d : null;
    }
  }
  let deliveryFee = 0;
  let deliveryFeeBreakdown = null;
  if (dto.orderType === "takeaway") {
    deliveryFee = 0;
  } else if (
    Number.isFinite(freeUpTo) &&
    freeUpTo > 0 &&
    subtotal >= freeUpTo
  ) {
    deliveryFee = 0;
  } else {
    const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
      ? feeSettings.deliveryFeeRanges
          .map((r) => ({
            min: Number(r?.min),
            max: Number(r?.max),
            fee: Number(r?.fee),
          }))
          .filter(
            (r) =>
              Number.isFinite(r.min) &&
              Number.isFinite(r.max) &&
              Number.isFinite(r.fee) &&
              r.fee >= 0,
          )
          .sort((a, b) => a.min - b.min)
      : [];

    const rawBaseFee = Number(feeSettings.deliveryFee);
    const defaultBaseFee =
      Number.isFinite(rawBaseFee) && rawBaseFee > 0
        ? rawBaseFee
        : ranges.length > 0 && ranges[0].fee > 0
          ? ranges[0].fee
          : 25;

    if (ranges.length > 0 && Number.isFinite(distanceKm) && distanceKm >= 0) {
      const firstRange = ranges[0];
      const lastRange = ranges[ranges.length - 1];

      if (distanceKm < firstRange.min) {
        deliveryFee = firstRange.fee;
        deliveryFeeBreakdown = {
          source: "distance",
          distanceKm,
          minKm: firstRange.min,
          maxKm: firstRange.max,
          fee: firstRange.fee,
        };
      } else if (distanceKm >= lastRange.max) {
        deliveryFee = lastRange.fee;
        deliveryFeeBreakdown = {
          source: "distance",
          distanceKm,
          minKm: lastRange.min,
          maxKm: lastRange.max,
          fee: lastRange.fee,
        };
      } else {
        let matched = null;
        for (let i = 0; i < ranges.length; i += 1) {
          const r = ranges[i];
          const isLast = i === ranges.length - 1;
          const inRange = isLast
            ? distanceKm >= r.min && distanceKm <= r.max
            : distanceKm >= r.min && distanceKm < r.max;
          if (inRange) {
            matched = r;
            break;
          }
          if (distanceKm < r.min) {
            matched = r;
            break;
          }
        }
        const resolved = matched || lastRange;
        deliveryFee = resolved.fee;
        deliveryFeeBreakdown = {
          source: "distance",
          distanceKm,
          minKm: resolved.min,
          maxKm: resolved.max,
          fee: resolved.fee,
        };
      }
    } else {
      deliveryFee = defaultBaseFee;
    }
  }

  const gstRate = feeSettings.gstRate != null ? Number(feeSettings.gstRate) : 0;
  const tax =
    Number.isFinite(gstRate) && gstRate > 0
      ? Math.round(subtotal * (gstRate / 100))
      : 0;

  let discount = 0;
  let appliedCoupon = null;
  // Why the entered code was not applied - shown to the customer instead of a
  // bare "Coupon not applicable".
  let couponError = null;
  const codeRaw = couponCode;

  if (codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({ couponCode: codeRaw }).lean();
    if (!offer) {
      couponError = "Invalid coupon code";
    } else {
      const minOrderValue = Number(offer.minOrderValue);
      const orderType = String(dto.orderType || "delivery").toLowerCase();
      // Only a real order uses up "first order": cancelled ones and online
      // checkouts that were never paid used to disqualify the customer forever.
      const countPlacedOrders = () =>
        FoodOrder.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
          orderStatus: { $nin: ["cancelled_by_user", "cancelled_by_restaurant", "cancelled_by_admin"] },
          $nor: [{ "payment.method": "razorpay", "payment.status": { $nin: ["paid", "refunded"] } }],
        });

      if (offer.status !== "active") {
        couponError = "This coupon is no longer active";
      } else if (offer.startDate && now < new Date(offer.startDate)) {
        couponError = "This coupon is not active yet";
      } else if (offer.endDate && now >= new Date(offer.endDate)) {
        couponError = "This coupon has expired";
      } else if (
        offer.restaurantScope === "selected" &&
        String(offer.restaurantId || "") !== String(restaurantId || "")
      ) {
        couponError = "This coupon is not valid for this restaurant";
      } else if (
        Array.isArray(offer.zoneIds) &&
        offer.zoneIds.length > 0 &&
        // The restaurant's own zone is what gates eligibility — a Zone A coupon
        // never applies to a Zone B restaurant even if the user carts from Zone A.
        !offer.zoneIds.some((z) => String(z) === String(restaurant.zoneId || ""))
      ) {
        couponError = "This coupon is not valid in your area";
      } else if (
        offer.couponType &&
        offer.couponType !== "all" &&
        String(offer.couponType).toLowerCase() !== orderType
      ) {
        couponError = `This coupon is only valid for ${offer.couponType} orders`;
      } else if (Number.isFinite(minOrderValue) && minOrderValue > 0 && subtotal < minOrderValue) {
        couponError = `Add items worth ₹${Math.ceil(minOrderValue - subtotal)} more to use this coupon (minimum order ₹${minOrderValue})`;
      } else if (
        Number(offer.usageLimit) > 0 &&
        Number(offer.usedCount || 0) >= Number(offer.usageLimit)
      ) {
        couponError = "This coupon has reached its usage limit";
      } else if (userId && Number(offer.perUserLimit) > 0) {
        const usage = await FoodOfferUsage.findOne({
          offerId: offer._id,
          userId,
        }).lean();
        if (usage && Number(usage.count) >= Number(offer.perUserLimit)) {
          couponError = "You have already used this coupon the maximum number of times";
        }
      }

      if (
        !couponError &&
        userId &&
        (offer.customerScope === "first-time" || offer.isFirstOrderOnly === true) &&
        (await countPlacedOrders()) > 0
      ) {
        couponError = "This coupon is valid on your first order only";
      }

      if (
        !couponError &&
        (Number(restaurantOffers?.discount) > 0 ||
          (Array.isArray(restaurantOffers?.appliedOffers) && restaurantOffers.appliedOffers.length > 0))
      ) {
        couponError = "Two coupons cannot be applied together. This order already has a restaurant offer/discount.";
      }

      if (!couponError) {
        if (offer.discountType === "percentage") {
          const raw = subtotal * (Number(offer.discountValue) / 100);
          const capped = Number(offer.maxDiscount)
            ? Math.min(raw, Number(offer.maxDiscount))
            : raw;
          discount = Math.max(0, Math.min(subtotal, Math.floor(capped)));
        } else {
          discount = Math.max(
            0,
            Math.min(subtotal, Math.floor(Number(offer.discountValue) || 0)),
          );
        }
        appliedCoupon = { code: codeRaw, discount };
      }
    }
  }

  const total = Math.max(
    0,
    subtotal + packagingFee + deliveryFee + platformFee + tax - discount,
  );

  return {
    pricing: {
      subtotal,
      baseSubtotal: Math.round(baseSubtotal * 100) / 100,
      markupTotal: Math.round(markupTotal * 100) / 100,
      tax,
      packagingFee,
      deliveryFee,
      deliveryFeeBreakdown: deliveryFeeBreakdown || undefined,
      freeDeliveryUpTo: Number.isFinite(freeUpTo) ? freeUpTo : undefined,
      platformFee,
      discount,
      total,
      currency: "INR",
      couponCode: appliedCoupon?.code || codeRaw || null,
      appliedCoupon,
      couponError,
      itemTotalBeforeOffers: restaurantOffers.itemTotalBeforeOffers,
      restaurantOfferDiscount: restaurantOffers.discount,
      restaurantOffers: restaurantOffers.appliedOffers,
      // "Add ₹X more to get ..." nudges for the cart; display only, never charged.
      restaurantOfferHints: restaurantOffers.lockedOffers || [],
    },
    items,
    restaurantId: String(restaurantId),
    restaurantName: restaurant.restaurantName || "",
  };
}
