import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../models/food.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodZone } from '../models/zone.model.js';
import { syncMenuItemApprovalStatus } from '../../restaurant/services/restaurantMenu.service.js';
import { getFoodDisplayPrice, serializeFoodVariants } from './foodVariant.service.js';

const toRestaurantDisplayId = (mongoId) => {
    const s = String(mongoId || '');
    return s.length >= 5 ? s.slice(-5) : s;
};

const BULK_APPROVE_MAX_ITEMS = 500;
const DEFAULT_NOTIFICATION_IMAGE = 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png';

/** Resolves a zone filter once; null when no valid zone is given. */
async function resolveZoneScope(zoneId) {
    if (!zoneId || !mongoose.Types.ObjectId.isValid(String(zoneId))) return null;
    const zoneOid = new mongoose.Types.ObjectId(String(zoneId));
    // Find restaurants in this zone for fallback if older records don't have zoneId yet
    const matchingRestaurants = await FoodRestaurant.find({ zoneId: zoneOid }).select('_id').lean();
    return { zoneOid, restaurantIds: matchingRestaurants.map((r) => r._id) };
}

/** Fresh `$or` clauses per call (query casting may mutate filter objects). */
function zoneScopeOr(scope) {
    return [
        { zoneId: scope.zoneOid },
        { zoneId: null, restaurantId: { $in: scope.restaurantIds } },
        { zoneId: { $exists: false }, restaurantId: { $in: scope.restaurantIds } }
    ];
}

export async function listPendingFoodApprovals(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const foodFilter = { approvalStatus: 'pending' };
    const addonFilter = { approvalStatus: 'pending', isDeleted: { $ne: true } };

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        foodFilter.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
        addonFilter.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
    }

    const zoneScope = await resolveZoneScope(query.zoneId);
    if (zoneScope) {
        foodFilter.$or = zoneScopeOr(zoneScope);
        addonFilter.$or = zoneScopeOr(zoneScope);
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().slice(0, 80);
        const searchRegex = { $regex: term, $options: 'i' };
        if (foodFilter.$or) {
            foodFilter.$and = [
                { $or: foodFilter.$or },
                { $or: [{ name: searchRegex }, { categoryName: searchRegex }] }
            ];
            delete foodFilter.$or;
        } else {
            foodFilter.$or = [
                { name: searchRegex },
                { categoryName: searchRegex }
            ];
        }

        if (addonFilter.$or) {
            addonFilter.$and = [
                { $or: addonFilter.$or },
                { 'draft.name': searchRegex }
            ];
            delete addonFilter.$or;
        } else {
            addonFilter['draft.name'] = searchRegex;
        }
    }

    const [foodList, addonList, foodTotal, addonTotal] = await Promise.all([
        FoodItem.find(foodFilter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .select('restaurantId categoryName name price variants image foodType approvalStatus requestedAt createdAt actionType oldData newData description preparationTime isRecommended zoneId')
            .lean(),
        FoodAddon.find(addonFilter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .select('restaurantId draft isAvailable requestedAt createdAt zoneId')
            .lean(),
        FoodItem.countDocuments(foodFilter),
        FoodAddon.countDocuments(addonFilter),
    ]);

    const restaurantIds = Array.from(new Set([
        ...foodList.map((f) => String(f.restaurantId)),
        ...addonList.map((a) => String(a.restaurantId)),
    ].filter(Boolean)));

    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } }).select('restaurantName zoneId').lean()
        : [];
    const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));
    const restaurantZoneMap = new Map(restaurants.map((r) => [String(r._id), r.zoneId ? String(r.zoneId) : null]));

    const allZoneIds = Array.from(new Set([
        ...foodList.map((f) => f.zoneId ? String(f.zoneId) : restaurantZoneMap.get(String(f.restaurantId))),
        ...addonList.map((a) => a.zoneId ? String(a.zoneId) : restaurantZoneMap.get(String(a.restaurantId)))
    ].filter(Boolean)));

    const zones = allZoneIds.length
        ? await FoodZone.find({ _id: { $in: allZoneIds } }).select('name zoneName serviceLocation').lean()
        : [];
    const zoneMap = new Map(zones.map((z) => [String(z._id), z.name || z.zoneName || z.serviceLocation || 'Zone']));

    const foodRequests = foodList.map((f) => {
        const resolvedZoneId = f.zoneId ? String(f.zoneId) : (restaurantZoneMap.get(String(f.restaurantId)) || '');
        const resolvedZoneName = resolvedZoneId ? (zoneMap.get(resolvedZoneId) || '') : '';
        return {
            _id: f._id,
            id: f._id,
            entityType: 'food',
            type: 'food',
            restaurantName: restaurantMap.get(String(f.restaurantId)) || 'Unknown Restaurant',
            restaurantId: toRestaurantDisplayId(f.restaurantId),
            zoneId: resolvedZoneId,
            zoneName: resolvedZoneName,
            category: f.categoryName || '',
            itemName: f.name,
            foodType: f.foodType || 'Non-Veg',
            sectionName: f.categoryName || '',
            subsectionName: '',
            approvalStatus: f.approvalStatus || 'pending',
            price: getFoodDisplayPrice(f),
            variants: serializeFoodVariants(f.variants),
            image: f.image || '',
            images: f.image ? [f.image] : [],
            requestedAt: f.requestedAt || f.createdAt,
            isActionable: (f.approvalStatus || 'pending') === 'pending',
            actionType: f.actionType,
            oldData: f.oldData,
            newData: f.newData,
            description: f.description || '',
            preparationTime: f.preparationTime || '',
            isRecommended: f.isRecommended === true,
        };
    });

    const addonRequests = addonList.map((a) => {
        const resolvedZoneId = a.zoneId ? String(a.zoneId) : (restaurantZoneMap.get(String(a.restaurantId)) || '');
        const resolvedZoneName = resolvedZoneId ? (zoneMap.get(resolvedZoneId) || '') : '';
        return {
            _id: a._id,
            id: a._id,
            entityType: 'addon',
            type: 'addon',
            restaurantName: restaurantMap.get(String(a.restaurantId)) || 'Unknown Restaurant',
            restaurantId: toRestaurantDisplayId(a.restaurantId),
            zoneId: resolvedZoneId,
            zoneName: resolvedZoneName,
            category: 'Add-on',
            itemName: a.draft?.name || 'Unnamed Add-on',
            foodType: 'Add-on',
            sectionName: 'Add-on',
            subsectionName: '',
            approvalStatus: 'pending',
            price: a.draft?.price ?? 0,
            image: a.draft?.image || (a.draft?.images && a.draft.images[0]) || '',
            images: a.draft?.images || (a.draft?.image ? [a.draft.image] : []),
            requestedAt: a.requestedAt || a.createdAt,
            isActionable: true,
            description: a.draft?.description || '',
        };
    });

    const allRequests = [...foodRequests, ...addonRequests].sort(
        (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );

    const total = foodTotal + addonTotal;
    const requests = allRequests.slice(skip, skip + limit);

    return { requests, page, limit, total };
}

export async function approveFoodItem(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid food id');
    }
    const updated = await FoodItem.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'approved', approvedAt: new Date(), rejectedAt: null, rejectionReason: '' } },
        { new: true }
    ).lean();
    if (updated?.restaurantId) {
        // Single DB update; makes user-facing menu reflect approval immediately.
        await syncMenuItemApprovalStatus(updated.restaurantId, updated._id, 'approved', '');

        // Push is fire-and-forget so FCM latency doesn't hold the admin's approve
        // response (a slow response widens the window for stale list refreshes).
        void (async () => {
            try {
                const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
                await notifyOwnersSafely(
                    [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                    {
                        title: 'Dish Approved! 🍲',
                        body: `Your dish "${updated.name}" has been approved and is now visible to customers.`,
                        image: updated.image || 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                        sendToAllDevices: true,
                        data: {
                            type: 'food_approved',
                            foodId: String(updated._id),
                            restaurantId: String(updated.restaurantId),
                            targetUrl: '/food/restaurant',
                            link: '/food/restaurant',
                        }
                    }
                );
            } catch (e) {
                console.error('Failed to send food approval notification:', e);
            }
        })();
    }
    return updated;
}

export async function rejectFoodItem(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid food id');
    }
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (!r) throw new ValidationError('Rejection reason is required');
    if (r.length > 500) throw new ValidationError('Rejection reason is too long');

    const updated = await FoodItem.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'rejected', rejectedAt: new Date(), rejectionReason: r, approvedAt: null } },
        { new: true }
    ).lean();
    if (updated?.restaurantId) {
        await syncMenuItemApprovalStatus(updated.restaurantId, updated._id, 'rejected', r);

        // Fire-and-forget, same reasoning as approveFoodItem.
        void (async () => {
            try {
                const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
                await notifyOwnersSafely(
                    [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                    {
                        title: 'Dish Rejected ❌',
                        body: `Your dish "${updated.name}" was rejected. Reason: ${r}`,
                        image: updated.image || 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                        sendToAllDevices: true,
                        data: {
                            type: 'food_rejected',
                            foodId: String(updated._id),
                            restaurantId: String(updated.restaurantId),
                            reason: r,
                            targetUrl: '/food/restaurant',
                            link: '/food/restaurant',
                        }
                    }
                );
            } catch (e) {
                console.error('Failed to send food rejection notification:', e);
            }
        })();
    }
    return updated;
}

/**
 * Restaurants that currently have pending food/add-on approvals, with counts.
 * Honors the same zone filter as listPendingFoodApprovals.
 */
export async function listPendingApprovalRestaurants(query = {}) {
    const zoneScope = await resolveZoneScope(query.zoneId);
    const foodMatch = { approvalStatus: 'pending' };
    const addonMatch = { approvalStatus: 'pending', isDeleted: { $ne: true } };
    if (zoneScope) {
        foodMatch.$or = zoneScopeOr(zoneScope);
        addonMatch.$or = zoneScopeOr(zoneScope);
    }

    const [foodGroups, addonGroups] = await Promise.all([
        FoodItem.aggregate([{ $match: foodMatch }, { $group: { _id: '$restaurantId', count: { $sum: 1 } } }]),
        FoodAddon.aggregate([{ $match: addonMatch }, { $group: { _id: '$restaurantId', count: { $sum: 1 } } }]),
    ]);

    const counts = new Map();
    const bump = (groups, field) => {
        for (const g of groups) {
            if (!g._id) continue;
            const key = String(g._id);
            const row = counts.get(key) || { foodCount: 0, addonCount: 0 };
            row[field] += g.count;
            counts.set(key, row);
        }
    };
    bump(foodGroups, 'foodCount');
    bump(addonGroups, 'addonCount');

    const ids = [...counts.keys()];
    const restaurants = ids.length
        ? await FoodRestaurant.find({ _id: { $in: ids } }).select('restaurantName').lean()
        : [];
    const nameMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));

    const list = ids.map((id) => {
        const { foodCount, addonCount } = counts.get(id);
        return {
            restaurantId: id,
            displayId: toRestaurantDisplayId(id),
            restaurantName: nameMap.get(id) || 'Unknown Restaurant',
            foodCount,
            addonCount,
            total: foodCount + addonCount,
        };
    }).sort((a, b) => a.restaurantName.localeCompare(b.restaurantName));

    return {
        restaurants: list,
        totalItems: list.reduce((sum, r) => sum + r.total, 0),
    };
}

function toObjectIdList(values, label) {
    const out = new Map();
    for (const v of values) {
        const s = String(v || '');
        if (!mongoose.Types.ObjectId.isValid(s)) throw new ValidationError(`Invalid ${label} id`);
        out.set(s, new mongoose.Types.ObjectId(s));
    }
    return [...out.values()];
}

/** One push per restaurant summarising what a bulk approval published (fire-and-forget). */
function notifyRestaurantsOfBulkApproval(foods, addons) {
    const byRestaurant = new Map();
    const add = (doc, field) => {
        if (!doc?.restaurantId) return;
        const key = String(doc.restaurantId);
        const entry = byRestaurant.get(key) || { restaurantId: doc.restaurantId, foods: [], addons: [] };
        entry[field].push(doc);
        byRestaurant.set(key, entry);
    };
    foods.forEach((f) => add(f, 'foods'));
    addons.forEach((a) => add(a, 'addons'));
    if (!byRestaurant.size) return;

    void (async () => {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            for (const { restaurantId, foods: rFoods, addons: rAddons } of byRestaurant.values()) {
                let payload;
                if (rFoods.length === 1 && rAddons.length === 0) {
                    // Same message as a single approval.
                    const f = rFoods[0];
                    payload = {
                        title: 'Dish Approved! 🍲',
                        body: `Your dish "${f.name}" has been approved and is now visible to customers.`,
                        image: f.image || DEFAULT_NOTIFICATION_IMAGE,
                        data: { type: 'food_approved', foodId: String(f._id) },
                    };
                } else if (rAddons.length === 1 && rFoods.length === 0) {
                    const a = rAddons[0];
                    payload = {
                        title: 'Addon Approved! ✅',
                        body: `Your addon "${a.published?.name || a.draft?.name || 'New Addon'}" has been approved and is now live.`,
                        image: DEFAULT_NOTIFICATION_IMAGE,
                        data: { type: 'addon_approved', addonId: String(a._id) },
                    };
                } else {
                    const parts = [];
                    if (rFoods.length) parts.push(`${rFoods.length} dish${rFoods.length > 1 ? 'es' : ''}`);
                    if (rAddons.length) parts.push(`${rAddons.length} add-on${rAddons.length > 1 ? 's' : ''}`);
                    payload = {
                        title: 'Items Approved! ✅',
                        body: `${parts.join(' and ')} from your menu have been approved and are now visible to customers.`,
                        image: DEFAULT_NOTIFICATION_IMAGE,
                        data: { type: 'food_approved' },
                    };
                }
                await notifyOwnersSafely(
                    [{ ownerType: 'RESTAURANT', ownerId: restaurantId }],
                    {
                        ...payload,
                        sendToAllDevices: true,
                        data: {
                            ...payload.data,
                            restaurantId: String(restaurantId),
                            targetUrl: '/food/restaurant',
                            link: '/food/restaurant',
                        },
                    }
                );
            }
        } catch (e) {
            console.error('Failed to send bulk approval notifications:', e);
        }
    })();
}

/**
 * Approve many pending items at once. Two modes:
 *  - { items: [{ id, entityType: 'food' | 'addon' }] }  (max BULK_APPROVE_MAX_ITEMS)
 *  - { restaurantIds: [...] } or { allRestaurants: true }, optional { zoneId }
 * Only items still pending are touched, with the same field updates as the
 * single approve endpoints; anything already processed is reported as skipped.
 */
export async function bulkApprovePending(input = {}) {
    let foodIds = [];
    let addonIds = [];

    if (Array.isArray(input.items)) {
        if (!input.items.length) throw new ValidationError('Select at least one item to approve');
        if (input.items.length > BULK_APPROVE_MAX_ITEMS) {
            throw new ValidationError(`You can approve at most ${BULK_APPROVE_MAX_ITEMS} items at once`);
        }
        const foods = [];
        const addons = [];
        for (const item of input.items) {
            const type = String(item?.entityType || 'food');
            if (type === 'addon') addons.push(item?.id);
            else if (type === 'food') foods.push(item?.id);
            else throw new ValidationError('Invalid item type');
        }
        foodIds = toObjectIdList(foods, 'food');
        addonIds = toObjectIdList(addons, 'add-on');
    } else if (input.allRestaurants === true || Array.isArray(input.restaurantIds)) {
        const restaurantOids = input.allRestaurants === true
            ? null
            : toObjectIdList(input.restaurantIds, 'restaurant');
        if (restaurantOids && !restaurantOids.length) {
            throw new ValidationError('Select at least one restaurant');
        }
        const zoneScope = await resolveZoneScope(input.zoneId);
        const foodFilter = { approvalStatus: 'pending' };
        const addonFilter = { approvalStatus: 'pending', isDeleted: { $ne: true } };
        if (restaurantOids) {
            foodFilter.restaurantId = { $in: restaurantOids };
            addonFilter.restaurantId = { $in: restaurantOids };
        }
        if (zoneScope) {
            foodFilter.$or = zoneScopeOr(zoneScope);
            addonFilter.$or = zoneScopeOr(zoneScope);
        }
        const [foods, addons] = await Promise.all([
            FoodItem.find(foodFilter).select('_id').lean(),
            FoodAddon.find(addonFilter).select('_id').lean(),
        ]);
        foodIds = foods.map((f) => f._id);
        addonIds = addons.map((a) => a._id);
    } else {
        throw new ValidationError('Choose items or restaurants to approve');
    }

    // A unique stamp identifies exactly which documents this call approved.
    const stamp = new Date();
    await Promise.all([
        foodIds.length
            ? FoodItem.updateMany(
                { _id: { $in: foodIds }, approvalStatus: 'pending' },
                { $set: { approvalStatus: 'approved', approvedAt: stamp, rejectedAt: null, rejectionReason: '' } }
            )
            : null,
        addonIds.length
            ? FoodAddon.updateMany(
                { _id: { $in: addonIds }, approvalStatus: 'pending', isDeleted: { $ne: true } },
                // Same draft -> published copy as approveRestaurantAddon.
                [{ $set: { published: '$draft', approvalStatus: 'approved', approvedAt: stamp, rejectedAt: null, rejectionReason: '' } }]
            )
            : null,
    ]);

    const [approvedFoods, approvedAddons] = await Promise.all([
        foodIds.length
            ? FoodItem.find({ _id: { $in: foodIds }, approvalStatus: 'approved', approvedAt: stamp })
                .select('_id restaurantId name image').lean()
            : [],
        addonIds.length
            ? FoodAddon.find({ _id: { $in: addonIds }, approvalStatus: 'approved', approvedAt: stamp })
                .select('_id restaurantId published.name draft.name').lean()
            : [],
    ]);

    notifyRestaurantsOfBulkApproval(approvedFoods, approvedAddons);

    const requestedCount = foodIds.length + addonIds.length;
    const approvedCount = approvedFoods.length + approvedAddons.length;
    return {
        requestedCount,
        approvedCount,
        skippedCount: requestedCount - approvedCount,
        approvedFoodIds: approvedFoods.map((f) => String(f._id)),
        approvedAddonIds: approvedAddons.map((a) => String(a._id)),
    };
}
