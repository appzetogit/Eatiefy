import { FoodSystemConfig } from '../models/systemConfig.model.js';

const CACHE_TTL_MS = 3000;

// Mirrors the admin customization toggles and their shipped defaults.
const MODULE_KEYS = {
    takeaway: { key: 'takeaway_enabled', defaultValue: true },
    takeawayPayAtPickup: { key: 'takeaway_pay_at_pickup_enabled', defaultValue: true },
    dining: { key: 'dining_enabled', defaultValue: false },
    sweets: { key: 'sweets_enabled', defaultValue: false },
    // Onboarding fee collection. Defaults to true and readFlag also falls back to
    // the default on a config read error, so a DB blip can never silently waive
    // a fee that is meant to be charged.
    restaurantOnboardingPayment: { key: 'restaurant_onboarding_razorpay_enabled', defaultValue: true }
};

const cache = new Map();
const inflight = new Map();

const readFlag = async ({ key, defaultValue }) => {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) {
        return hit.value;
    }

    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
        try {
            const doc = await FoodSystemConfig.findOne({ key }).lean();
            // No stored row means the toggle was never touched: use the default.
            const value = doc ? doc.value === true : defaultValue;
            cache.set(key, { value, at: Date.now() });
            return value;
        } catch {
            // Fail open on config errors so a DB blip cannot take a module down.
            cache.set(key, { value: defaultValue, at: Date.now() });
            return defaultValue;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, promise);
    return promise;
};

export const isTakeawayEnabled = () => readFlag(MODULE_KEYS.takeaway);
export const isDiningEnabled = () => readFlag(MODULE_KEYS.dining);
export const isSweetsEnabled = () => readFlag(MODULE_KEYS.sweets);

/**
 * Admin master switch for takeaway "Pay at Pickup". A restaurant can only offer
 * it when this is on AND its own takeawaySettings.payAtPickupEnabled is on.
 */
export const isTakeawayPayAtPickupEnabled = () => readFlag(MODULE_KEYS.takeawayPayAtPickup);

/**
 * Whether restaurants must complete the one-time Razorpay onboarding payment.
 * Only the restaurant onboarding fee depends on this — customer, order,
 * delivery and refund payments are untouched by it.
 */
export const isRestaurantOnboardingPaymentEnabled = () =>
    readFlag(MODULE_KEYS.restaurantOnboardingPayment);

/** Called after an admin update so the next read reflects the new value. */
export const invalidateModuleAccessCache = () => {
    cache.clear();
};
