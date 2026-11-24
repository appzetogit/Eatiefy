import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodRestaurantOutletTimings } from '../models/outletTimings.model.js';
import {
    DAY_NAMES,
    getOperatingStatus,
    getTimeRangeError,
    normalizeDayName as normalizeDay,
    normalizeTime as normalizeTimeValue
} from '../utils/operatingHours.js';

const normalizeTime = (value, fallback = '') => normalizeTimeValue(value) || fallback;

const assertValidRestaurantId = (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
};

/**
 * Build a full-week timings array from restaurant-level open/close + openDays.
 * Used on onboarding so registration hours become the default for every day.
 * No hardcoded hours: missing restaurant hours stay empty.
 */
export const buildTimingsFromRestaurantHours = ({ openingTime, closingTime, openDays } = {}) => {
    const open = normalizeTime(openingTime);
    const close = normalizeTime(closingTime);

    const normalizedOpenDays = Array.isArray(openDays)
        ? openDays.map((d) => normalizeDay(d)).filter(Boolean)
        : [];
    // Empty openDays means "all days open" (same as onboarding all selected).
    const openDaySet = normalizedOpenDays.length > 0 ? new Set(normalizedOpenDays) : null;

    return DAY_NAMES.map((day) => {
        const isOpen = openDaySet ? openDaySet.has(day) : true;
        return {
            day,
            isOpen,
            openingTime: isOpen ? open : '',
            closingTime: isOpen ? close : ''
        };
    });
};

/** Open days missing a time fall back to the restaurant's own hours, else stay empty. */
const toClientShape = (doc, restaurant = null) => {
    const timings = Array.isArray(doc?.timings) ? doc.timings : [];
    const map = {};
    for (const day of DAY_NAMES) {
        const found = timings.find((t) => normalizeDay(t?.day) === day);
        const isOpen = found ? found.isOpen !== false : true;
        map[day] = {
            isOpen,
            openingTime: isOpen ? normalizeTime(found?.openingTime, normalizeTime(restaurant?.openingTime)) : '',
            closingTime: isOpen ? normalizeTime(found?.closingTime, normalizeTime(restaurant?.closingTime)) : ''
        };
    }
    return map;
};

/**
 * Restaurant-level summary of a weekly schedule, so screens that read the
 * restaurant's openingTime / closingTime / openDays show the same hours:
 * open days in the stored short form ("Mon"), and the hours most open days use
 * (earliest day wins a tie). Hours are left untouched when every day is closed.
 */
export const summarizeWeeklyTimings = (timings = []) => {
    const openRows = DAY_NAMES.map((day) => timings.find((t) => normalizeDay(t?.day) === day))
        .filter((row) => row && row.isOpen !== false);
    const summary = { openDays: openRows.map((row) => normalizeDay(row.day).slice(0, 3)) };

    const counts = new Map();
    for (const row of openRows) {
        const open = normalizeTime(row.openingTime);
        const close = normalizeTime(row.closingTime);
        if (!open || !close) continue;
        const key = `${open}-${close}`;
        const entry = counts.get(key) || { openingTime: open, closingTime: close, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
    }
    let best = null;
    for (const entry of counts.values()) {
        if (!best || entry.count > best.count) best = entry;
    }
    if (best) {
        summary.openingTime = best.openingTime;
        summary.closingTime = best.closingTime;
    }
    return summary;
};

/**
 * Persist weekly outlet timings for a restaurant (create if missing).
 * Does not overwrite an existing document unless `overwrite` is true.
 */
export async function seedOutletTimingsForRestaurant(
    restaurantId,
    { openingTime, closingTime, openDays } = {},
    { overwrite = false } = {}
) {
    assertValidRestaurantId(restaurantId);

    const timings = buildTimingsFromRestaurantHours({ openingTime, closingTime, openDays });

    if (!overwrite) {
        const existing = await FoodRestaurantOutletTimings.findOne({ restaurantId }).select('timings').lean();
        if (existing) {
            return { outletTimings: toClientShape(existing), seeded: false };
        }
    }

    const doc = await FoodRestaurantOutletTimings.findOneAndUpdate(
        { restaurantId },
        { $set: { timings } },
        { upsert: true, new: true, setDefaultsOnInsert: true, projection: 'timings updatedAt' }
    ).lean();

    return { outletTimings: toClientShape(doc), seeded: true };
}

export async function getOutletTimingsForRestaurant(restaurantId) {
    assertValidRestaurantId(restaurantId);
    const [doc, restaurant] = await Promise.all([
        FoodRestaurantOutletTimings.findOne({ restaurantId }).select('timings updatedAt').lean(),
        FoodRestaurant.findById(restaurantId).select('openingTime closingTime openDays').lean()
    ]);
    if (doc) {
        return { outletTimings: toClientShape(doc, restaurant), persisted: true };
    }

    // No weekly row yet — use restaurant-level onboarding hours.

    const timings = buildTimingsFromRestaurantHours({
        openingTime: restaurant?.openingTime,
        closingTime: restaurant?.closingTime,
        openDays: restaurant?.openDays
    });

    return { outletTimings: toClientShape({ timings }, restaurant), persisted: false };
}

export async function upsertOutletTimingsForRestaurant(restaurantId, outletTimings) {
    assertValidRestaurantId(restaurantId);
    if (!outletTimings || typeof outletTimings !== 'object' || Array.isArray(outletTimings)) {
        throw new ValidationError('outletTimings must be an object keyed by day name');
    }

    // A day that is open but omits a time uses the restaurant's own hours (older clients).
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('openingTime closingTime openDays')
        .lean();

    const resolveTime = (day, label, raw, fallback) => {
        const hasValue = raw !== undefined && raw !== null && String(raw).trim() !== '';
        const normalized = normalizeTime(raw);
        if (hasValue && !normalized) {
            throw new ValidationError(`${day}: Invalid ${label}`);
        }
        const value = normalized || normalizeTime(fallback);
        if (!value) {
            throw new ValidationError(`${day}: ${label[0].toUpperCase()}${label.slice(1)} is required`);
        }
        return value;
    };

    const timings = DAY_NAMES.map((day) => {
        const src = outletTimings[day] && typeof outletTimings[day] === 'object' ? outletTimings[day] : {};
        const isOpen = src.isOpen !== false;
        if (!isOpen) return { day, isOpen, openingTime: '', closingTime: '' };
        const openingTime = resolveTime(day, 'opening time', src.openingTime, restaurant?.openingTime);
        const closingTime = resolveTime(day, 'closing time', src.closingTime, restaurant?.closingTime);
        // closing < opening is a valid overnight shift; only identical times are rejected.
        const rangeError = getTimeRangeError(openingTime, closingTime);
        if (rangeError) {
            throw new ValidationError(`${day}: ${rangeError}`);
        }
        return { day, isOpen, openingTime, closingTime };
    });

    const doc = await FoodRestaurantOutletTimings.findOneAndUpdate(
        { restaurantId },
        { $set: { timings } },
        { upsert: true, new: true, setDefaultsOnInsert: true, projection: 'timings updatedAt' }
    ).lean();

    // Keep restaurant-level hours in step with the weekly schedule.
    const summary = summarizeWeeklyTimings(timings);
    const summaryChanged =
        summary.openDays.join(',') !== (Array.isArray(restaurant?.openDays) ? restaurant.openDays.join(',') : '') ||
        (summary.openingTime !== undefined && summary.openingTime !== normalizeTime(restaurant?.openingTime)) ||
        (summary.closingTime !== undefined && summary.closingTime !== normalizeTime(restaurant?.closingTime));
    if (restaurant && summaryChanged) {
        await FoodRestaurant.updateOne({ _id: restaurantId }, { $set: summary });
    }

    return { outletTimings: toClientShape(doc), persisted: true };
}

/**
 * Timezone-aware open/closed state for a restaurant, including overnight
 * shifts carried over from the previous day. Backend source of truth.
 */
export async function getRestaurantOperatingStatus(restaurantId, now = new Date()) {
    assertValidRestaurantId(restaurantId);

    const [timingsDoc, restaurant] = await Promise.all([
        FoodRestaurantOutletTimings.findOne({ restaurantId }).select('timings').lean(),
        FoodRestaurant.findById(restaurantId).select('openingTime closingTime openDays').lean()
    ]);

    return getOperatingStatus({ timings: timingsDoc?.timings, restaurant }, now);
}

/**
 * Shared open-now check (outlet day schedule → restaurant opening/closing).
 * Used by order create so backend matches user-side availability.
 */
export async function assertRestaurantOpenForOrders(restaurantId, now = new Date()) {
    const status = await getRestaurantOperatingStatus(restaurantId, now);

    if (!status.isOpen) {
        throw new ValidationError(
            status.reason === 'day-closed' ? 'Restaurant is closed today' : 'Restaurant is currently closed'
        );
    }

    return true;
}
