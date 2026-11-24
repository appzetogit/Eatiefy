import mongoose from 'mongoose';
import { FoodSystemConfig } from '../models/systemConfig.model.js';
import { FoodZone } from '../models/zone.model.js';
import { FoodZoneRestaurantSettings } from '../models/zoneRestaurantSettings.model.js';
import { FoodZoneCustomizationSettings } from '../models/zoneCustomizationSettings.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { invalidateMaintenanceModeCache } from '../services/maintenanceMode.service.js';
import { invalidateModuleAccessCache } from '../services/moduleAccess.service.js';

// Customization toggles live in FoodSystemConfig as individual keys.
const CUSTOMIZATION_TOGGLES = [
    {
        key: 'cod_enabled',
        defaultValue: true,
        description: 'Global toggle for COD visibility (Excludes Takeaway)'
    },
    {
        key: 'takeaway_cod_enabled',
        // Takeaway is online-payment only unless an admin explicitly switches this on,
        // so an install that never touched the setting keeps its online-only behaviour.
        defaultValue: false,
        description: 'Global toggle for takeaway COD (cash paid at the restaurant on pickup)'
    },
    {
        key: 'takeaway_pay_at_pickup_enabled',
        // Admin master switch for takeaway "Pay at Pickup" (place now, pay online
        // on arrival). Per-restaurant opt-in (takeawaySettings.payAtPickupEnabled)
        // must ALSO be on for a restaurant to offer it.
        defaultValue: true,
        description: 'Global master toggle for takeaway Pay-at-Pickup (customer places order, pays online at the counter)'
    },
    {
        key: 'delivery_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for delivery COD visibility'
    },
    {
        key: 'dining_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for dining COD visibility'
    },
    {
        key: 'wallet_payment_enabled',
        defaultValue: true,
        description: 'Global toggle for wallet payment availability'
    },
    {
        key: 'online_payment_enabled',
        defaultValue: true,
        description: 'Global toggle for online payment availability'
    },
    {
        key: 'default_location_enabled',
        defaultValue: false,
        description: 'Enforce default Indore location and disable auto-prompt for new users/guests (App Store mode)'
    },
    {
        key: 'cod_blocking_feature_enabled',
        defaultValue: true,
        description: 'Global toggle to enable/disable the automatic COD blocking feature (blocks COD for users with 4 consecutive COD cancellations)'
    },
    {
        key: 'maintenance_mode_enabled',
        defaultValue: false,
        description: 'When enabled, user / restaurant / delivery apps show Under Maintenance (admin stays available)'
    },
    {
        key: 'takeaway_enabled',
        // Takeaway ships enabled, so an install with no stored row keeps working.
        defaultValue: true,
        description: 'When disabled, takeaway routes, tabs and entry points are hidden across every app'
    },
    {
        key: 'dining_enabled',
        // Dining shipped switched off via the old build-time flag; keep that default.
        defaultValue: false,
        description: 'When disabled, dining routes, tabs and entry points are hidden across every app'
    },
    {
        key: 'sweets_enabled',
        defaultValue: false,
        description: 'When disabled, the Sweets & Bakery tab, routes and admin pages are hidden across every app'
    },
    {
        key: 'restaurant_onboarding_razorpay_enabled',
        // Defaults to ON. A missing row (or a failed read) must never let a
        // restaurant skip a fee that is actually being charged.
        defaultValue: true,
        description: 'When disabled, restaurants are not asked for the one-time Razorpay onboarding payment. Admin approval is still required.'
    }
];

function resolveToggleValue(configDoc, defaultValue) {
    if (!configDoc) return defaultValue;
    return configDoc.value === true;
}

function getCustomizationAllowlist() {
    return CUSTOMIZATION_TOGGLES.map(t => t.key);
}

/**
 * The checkout switches an admin can vary per zone. Module-level switches (takeaway /
 * dining / sweets modules, maintenance, default location, onboarding payment) change how
 * the whole app is wired, so they stay platform-wide.
 */
export const ZONE_CUSTOMIZATION_KEYS = [
    'cod_enabled',
    'takeaway_cod_enabled',
    'takeaway_pay_at_pickup_enabled',
    'delivery_cod_enabled',
    'dining_cod_enabled',
    'wallet_payment_enabled',
    'online_payment_enabled'
];

/** A zone id as an ObjectId, or null when absent / malformed (never throws). */
function toZoneObjectId(value) {
    const raw = value == null ? '' : String(value).trim();
    if (!raw || raw === 'all' || raw === 'global') return null;
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

/** The booleans a zone document overrides, limited to keys that may vary by zone. */
function readZoneToggleOverrides(zoneDoc) {
    const out = {};
    for (const key of ZONE_CUSTOMIZATION_KEYS) {
        const value = zoneDoc?.overrides?.[key];
        if (typeof value === 'boolean') out[key] = value;
    }
    return out;
}

/** Platform-wide values (stored value, else the built-in default) for every toggle. */
async function loadGlobalCustomizationSettings() {
    const keys = getCustomizationAllowlist();
    const docs = await FoodSystemConfig.find({ key: { $in: keys } }).lean();
    const map = new Map(docs.map(d => [d.key, d]));

    const data = {};
    for (const t of CUSTOMIZATION_TOGGLES) {
        data[t.key] = resolveToggleValue(map.get(t.key) || null, t.defaultValue);
    }
    return data;
}

/**
 * Shared by the standalone route, the aggregated /public/app-config payload and order
 * checkout. Without `zoneId` this is the platform-wide setting, exactly as before; with
 * a zone, every payment switch that zone overrides wins and the rest follow the default.
 */
export async function loadCustomizationSettings({ zoneId } = {}) {
    const data = await loadGlobalCustomizationSettings();
    const zoneOid = toZoneObjectId(zoneId);
    if (!zoneOid) return data;
    const zoneDoc = await FoodZoneCustomizationSettings.findOne({ zoneId: zoneOid }).lean();
    return { ...data, ...readZoneToggleOverrides(zoneDoc) };
}

export async function getCustomizationSettings(req, res) {
    res.json({ success: true, data: await loadCustomizationSettings({ zoneId: req.query?.zoneId }) });
}

/**
 * Admin: everything the zone scope of the page needs - the zone's effective values, the
 * platform defaults, which switches this zone overrides, and every zone that overrides
 * something (so the zone picker can mark them).
 */
export async function getZoneCustomizationSettings(req, res, next) {
    try {
        const zoneOid = toZoneObjectId(req.query?.zoneId);
        const [defaults, zoneDocs] = await Promise.all([
            loadGlobalCustomizationSettings(),
            FoodZoneCustomizationSettings.find({}).lean()
        ]);
        const zoneDoc = zoneOid ? zoneDocs.find((doc) => String(doc.zoneId) === String(zoneOid)) || null : null;
        const overrides = readZoneToggleOverrides(zoneDoc);

        res.json({
            success: true,
            data: {
                zoneId: zoneOid ? String(zoneOid) : null,
                zoneKeys: ZONE_CUSTOMIZATION_KEYS,
                defaults,
                settings: { ...defaults, ...overrides },
                overridden: Object.fromEntries(ZONE_CUSTOMIZATION_KEYS.map((key) => [key, key in overrides])),
                zonesWithOverrides: zoneDocs
                    .filter((doc) => Object.keys(readZoneToggleOverrides(doc)).length > 0)
                    .map((doc) => String(doc.zoneId))
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Admin: set (true / false) or clear (null) one or more payment switches for a zone.
 * A cleared switch follows the platform default again.
 */
export async function updateZoneCustomizationSettings(req, res, next) {
    try {
        const body = req.body ?? {};
        const zoneOid = toZoneObjectId(body.zoneId);
        if (!zoneOid) throw new ValidationError('A valid zoneId is required');
        if (!(await FoodZone.exists({ _id: zoneOid }))) throw new ValidationError('Zone not found');

        const provided = ZONE_CUSTOMIZATION_KEYS.filter((key) => body[key] !== undefined);
        if (provided.length === 0) {
            throw new ValidationError(`Provide at least one of: ${ZONE_CUSTOMIZATION_KEYS.join(', ')}`);
        }
        for (const key of provided) {
            if (body[key] !== null && typeof body[key] !== 'boolean') {
                throw new ValidationError(`${key} must be true, false or null (follow default)`);
            }
        }

        const $set = {
            zoneId: zoneOid,
            updatedBy: { role: req.user?.role || 'ADMIN', adminId: req.user?.userId, at: new Date() }
        };
        const $unset = {};
        for (const key of provided) {
            if (body[key] === null) $unset[`overrides.${key}`] = '';
            else $set[`overrides.${key}`] = body[key];
        }

        await FoodZoneCustomizationSettings.findOneAndUpdate(
            { zoneId: zoneOid },
            { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return getZoneCustomizationSettings({ query: { zoneId: String(zoneOid) } }, res, next);
    } catch (error) {
        next(error);
    }
}

export async function updateCustomizationSettings(req, res) {
    const body = req.body ?? {};
    const allowlist = new Set(getCustomizationAllowlist());

    const updates = [];
    for (const [key, value] of Object.entries(body)) {
        if (!allowlist.has(key)) continue;
        if (typeof value !== 'boolean') {
            throw new ValidationError(`${key} must be a boolean`);
        }
        const meta = CUSTOMIZATION_TOGGLES.find(t => t.key === key);
        updates.push({ key, value, description: meta?.description });
    }

    if (updates.length === 0) {
        throw new ValidationError(`No valid customization keys provided. Allowed: ${getCustomizationAllowlist().join(', ')}`);
    }

    await Promise.all(
        updates.map(u =>
            FoodSystemConfig.findOneAndUpdate(
                { key: u.key },
                {
                    $set: {
                        key: u.key,
                        value: u.value,
                        description: u.description,
                        updatedBy: {
                            role: req.user?.role || 'ADMIN',
                            adminId: req.user?._id,
                            at: new Date()
                        }
                    }
                },
                { upsert: true, new: true }
            )
        )
    );

    if (updates.some((u) =>
        u.key === 'takeaway_enabled' ||
        u.key === 'dining_enabled' ||
        u.key === 'sweets_enabled' ||
        u.key === 'restaurant_onboarding_razorpay_enabled'
    )) {
        invalidateModuleAccessCache();
    }

    const maintenanceUpdate = updates.find((u) => u.key === 'maintenance_mode_enabled');
    if (maintenanceUpdate) {
        invalidateMaintenanceModeCache(maintenanceUpdate.value === true);
    }

    const keys = getCustomizationAllowlist();
    const docs = await FoodSystemConfig.find({ key: { $in: keys } }).lean();
    const map = new Map(docs.map(d => [d.key, d]));

    const data = {};
    for (const t of CUSTOMIZATION_TOGGLES) {
        data[t.key] = resolveToggleValue(map.get(t.key) || null, t.defaultValue);
    }

    res.json({ success: true, data });
}

export async function getTakeawayCodStatus(req, res) {
    const toggleMeta = CUSTOMIZATION_TOGGLES.find(t => t.key === 'takeaway_cod_enabled');
    const config = await FoodSystemConfig.findOne({ key: 'takeaway_cod_enabled' }).lean();
    const takeawayCodEnabled = resolveToggleValue(config, toggleMeta?.defaultValue ?? true);
    
    res.json({
        success: true,
        enabled: takeawayCodEnabled,
        data: { takeaway_cod_enabled: takeawayCodEnabled }
    });
}

const RESTAURANT_SETTINGS = {
    deliveryAcceptOrderTimeMinutes: {
        key: 'restaurant_delivery_accept_order_time_minutes',
        min: 1,
        max: 60,
        description: 'Minutes a restaurant has to accept a new delivery order before auto-rejection'
    },
    takeawayAcceptOrderTimeMinutes: {
        key: 'restaurant_takeaway_accept_order_time_minutes',
        min: 1,
        max: 60,
        description: 'Minutes a restaurant has to accept a new takeaway order before auto-rejection'
    }
};

const LEGACY_ACCEPT_ORDER_TIME_KEY = 'restaurant_accept_order_time_minutes';

/** Used when an admin has never configured an accept window. */
const DEFAULT_ACCEPT_ORDER_TIME_MINUTES = 10;

function parseAcceptOrderTimeMinutes(value, fieldName = 'acceptOrderTimeMinutes') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new ValidationError(`${fieldName} must be a number between 1 and 60`);
    }
    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 60) {
        throw new ValidationError(`${fieldName} must be between 1 and 60`);
    }
    return rounded;
}

function readStoredAcceptOrderMinutes(configValue) {
    if (configValue == null) return null;
    try {
        return parseAcceptOrderTimeMinutes(configValue);
    } catch {
        return null;
    }
}

const ACCEPT_TIME_FIELDS = Object.keys(RESTAURANT_SETTINGS);

/** Empty / "all" / "global" select the platform default; anything else must be a zone id. */
function parseSettingsZoneId(value) {
    const raw = value == null ? '' : String(value).trim();
    if (!raw || raw === 'all' || raw === 'global') return null;
    if (!mongoose.Types.ObjectId.isValid(raw)) {
        throw new ValidationError('Invalid zoneId');
    }
    return new mongoose.Types.ObjectId(raw);
}

/** Minutes a zone overrides for `field`, or null when the zone follows the default. */
function readZoneOverride(zoneDoc, field) {
    return readStoredAcceptOrderMinutes(zoneDoc?.[field] ?? null);
}

function applyZoneOverride(defaults, zoneDoc) {
    const effective = { ...defaults };
    for (const field of ACCEPT_TIME_FIELDS) {
        const minutes = readZoneOverride(zoneDoc, field);
        if (minutes != null) effective[field] = minutes;
    }
    return effective;
}

function hasZoneOverride(zoneDoc) {
    return ACCEPT_TIME_FIELDS.some((field) => readZoneOverride(zoneDoc, field) != null);
}

/**
 * Effective accept windows. For a zone, every value that zone overrides wins and
 * the rest fall back to the platform default; without a zone (or for a zone with
 * no override) this is exactly the platform default.
 */
export async function resolveRestaurantSettings({ zoneId } = {}) {
    const zoneOid = parseSettingsZoneId(zoneId);
    const [defaults, zoneDoc] = await Promise.all([
        resolveDefaultRestaurantSettings(),
        zoneOid ? FoodZoneRestaurantSettings.findOne({ zoneId: zoneOid }).lean() : null
    ]);
    return applyZoneOverride(defaults, zoneDoc);
}

/**
 * Platform defaults plus every zone override in two queries, for callers that
 * handle orders from many zones at once (the server-side accept timeout sweep).
 */
export async function loadRestaurantSettingsByZone() {
    const [defaults, zoneDocs] = await Promise.all([
        resolveDefaultRestaurantSettings(),
        FoodZoneRestaurantSettings.find({}).lean()
    ]);
    const byZone = new Map(
        zoneDocs
            .filter(hasZoneOverride)
            .map((doc) => [String(doc.zoneId), applyZoneOverride(defaults, doc)])
    );
    return {
        defaults,
        hasZoneOverrides: byZone.size > 0,
        all: [defaults, ...byZone.values()],
        forZone: (zoneId) => (zoneId ? byZone.get(String(zoneId)) : null) || defaults
    };
}

async function resolveDefaultRestaurantSettings() {
    const keys = [
        RESTAURANT_SETTINGS.deliveryAcceptOrderTimeMinutes.key,
        RESTAURANT_SETTINGS.takeawayAcceptOrderTimeMinutes.key,
        LEGACY_ACCEPT_ORDER_TIME_KEY
    ];
    const docs = await FoodSystemConfig.find({ key: { $in: keys } }).lean();
    const map = new Map(docs.map((d) => [d.key, d]));

    const legacyMinutes = map.get(LEGACY_ACCEPT_ORDER_TIME_KEY)?.value ?? null;

    let deliveryAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(
        map.get(RESTAURANT_SETTINGS.deliveryAcceptOrderTimeMinutes.key)?.value ?? null
    );
    let takeawayAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(
        map.get(RESTAURANT_SETTINGS.takeawayAcceptOrderTimeMinutes.key)?.value ?? null
    );

    if (deliveryAcceptOrderTimeMinutes == null && legacyMinutes != null) {
        deliveryAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(legacyMinutes);
    }
    if (takeawayAcceptOrderTimeMinutes == null && legacyMinutes != null) {
        takeawayAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(legacyMinutes);
    }

    // An install where an admin never set these must still show the accept /
    // reject popup — returning null used to suppress it entirely.
    if (deliveryAcceptOrderTimeMinutes == null) {
        deliveryAcceptOrderTimeMinutes = DEFAULT_ACCEPT_ORDER_TIME_MINUTES;
    }
    if (takeawayAcceptOrderTimeMinutes == null) {
        takeawayAcceptOrderTimeMinutes = DEFAULT_ACCEPT_ORDER_TIME_MINUTES;
    }

    return { deliveryAcceptOrderTimeMinutes, takeawayAcceptOrderTimeMinutes };
}

/**
 * What the admin page needs for one scope: the effective values (top level, same
 * shape as before), the platform defaults, which values the zone overrides, and
 * every zone that has an override so the zone picker can mark them.
 */
async function buildAdminRestaurantSettings(zoneOid) {
    const [defaults, zoneDocs] = await Promise.all([
        resolveDefaultRestaurantSettings(),
        FoodZoneRestaurantSettings.find({}).lean()
    ]);
    const zoneDoc = zoneOid
        ? zoneDocs.find((doc) => String(doc.zoneId) === String(zoneOid)) || null
        : null;

    return {
        ...applyZoneOverride(defaults, zoneDoc),
        zoneId: zoneOid ? String(zoneOid) : null,
        defaults,
        overridden: Object.fromEntries(
            ACCEPT_TIME_FIELDS.map((field) => [field, readZoneOverride(zoneDoc, field) != null])
        ),
        zoneOverrides: zoneDocs.filter(hasZoneOverride).map((doc) => ({
            zoneId: String(doc.zoneId),
            ...Object.fromEntries(ACCEPT_TIME_FIELDS.map((field) => [field, readZoneOverride(doc, field)]))
        }))
    };
}

/** Public: effective accept windows, for one zone when `?zoneId=` is given. */
export async function getRestaurantSettings(req, res, next) {
    try {
        const data = await resolveRestaurantSettings({ zoneId: req.query?.zoneId });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

export async function getAdminRestaurantSettings(req, res, next) {
    try {
        const data = await buildAdminRestaurantSettings(parseSettingsZoneId(req.query?.zoneId));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/** The signed-in restaurant's windows, resolved from its own zone. */
export async function getCurrentRestaurantSettings(req, res, next) {
    try {
        const restaurant = await FoodRestaurant.findById(req.user?.userId).select('zoneId').lean();
        const zoneId = restaurant?.zoneId ? String(restaurant.zoneId) : null;
        const data = await resolveRestaurantSettings({ zoneId });
        res.json({ success: true, data: { ...data, zoneId } });
    } catch (error) {
        next(error);
    }
}

/**
 * Without `zoneId` this updates the platform default, as before. With `zoneId`
 * it sets that zone's override; sending `null` for a value clears the override
 * so the zone follows the default again.
 */
export async function updateRestaurantSettings(req, res, next) {
    try {
        const body = req.body ?? {};
        const zoneOid = parseSettingsZoneId(body.zoneId);
        const provided = ACCEPT_TIME_FIELDS.filter((field) => body[field] !== undefined);
        if (provided.length === 0) {
            throw new ValidationError(
                'Provide deliveryAcceptOrderTimeMinutes and/or takeawayAcceptOrderTimeMinutes (1-60)'
            );
        }

        const updatedBy = {
            role: req.user?.role || 'ADMIN',
            adminId: req.user?.userId,
            at: new Date()
        };

        if (zoneOid) {
            // Validate everything before writing so a bad value never saves half an update.
            const $set = { updatedBy };
            for (const field of provided) {
                $set[field] = body[field] === null ? null : parseAcceptOrderTimeMinutes(body[field], field);
            }
            if (!(await FoodZone.exists({ _id: zoneOid }))) {
                throw new ValidationError('Selected zone does not exist');
            }

            const zoneDoc = await FoodZoneRestaurantSettings.findOneAndUpdate(
                { zoneId: zoneOid },
                { $set },
                { upsert: true, new: true, runValidators: true }
            ).lean();

            // A zone with nothing overridden is the default; drop the empty row, but
            // only while it is still empty so a concurrent save is never lost.
            if (!hasZoneOverride(zoneDoc)) {
                await FoodZoneRestaurantSettings.deleteOne({
                    _id: zoneDoc._id,
                    ...Object.fromEntries(ACCEPT_TIME_FIELDS.map((field) => [field, null]))
                });
            }
        } else {
            const updates = provided.map((field) => ({
                ...RESTAURANT_SETTINGS[field],
                value: parseAcceptOrderTimeMinutes(body[field], field)
            }));
            await Promise.all(
                updates.map((u) =>
                    FoodSystemConfig.findOneAndUpdate(
                        { key: u.key },
                        { $set: { key: u.key, value: u.value, description: u.description, updatedBy } },
                        { upsert: true, new: true }
                    )
                )
            );
        }

        res.json({ success: true, data: await buildAdminRestaurantSettings(zoneOid) });
    } catch (error) {
        next(error);
    }
}
