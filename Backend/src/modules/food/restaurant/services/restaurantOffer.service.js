import mongoose from 'mongoose';
import { FoodRestaurantOffer } from '../models/restaurantOffer.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { toRestaurantFacingFood } from '../../admin/services/foodVariant.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { describeOffer, isOfferLiveAt } from '../utils/restaurantOfferEngine.js';
import { invalidateCache } from '../../../../middleware/cache.js';
import { CATALOG_CHANGED_EVENT } from '../../../../middleware/catalogChangeBroadcast.js';
import { getIO } from '../../../../config/socket.js';
import { logger } from '../../../../utils/logger.js';

/** Redis prefix of the public "live offers" endpoint; cleared on every change. */
export const PUBLIC_OFFERS_CACHE_PREFIX = 'restaurant_item_offers';

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Where an offer stands right now, for the restaurant dashboard:
 * live | scheduled (starts later) | off_hours (valid, outside its days/time) | expired | paused.
 */
export const getOfferStatus = (offer, now = new Date()) => {
    // No status = saved before approval existed; like checkout, treat it as awaiting review.
    const approval = offer.approvalStatus || 'pending';
    if (approval === 'rejected') return 'rejected';
    if (approval === 'pending') return 'pending_approval';
    if (offer.isActive === false) return 'paused';
    if (new Date(offer.validTill) < now) return 'expired';
    if (new Date(offer.validFrom) > now) return 'scheduled';
    return isOfferLiveAt(offer, now) ? 'live' : 'off_hours';
};

const toOfferView = (offer, now = new Date()) => {
    const rawItems = Array.isArray(offer.itemIds) && offer.itemIds[0]?._id
        ? offer.itemIds.map((it) => ({ id: String(it._id), _id: String(it._id), name: it.name, price: it.price }))
        : [];
    const rawCategories = Array.isArray(offer.categoryIds) && offer.categoryIds[0]?._id
        ? offer.categoryIds.map((cat) => ({ id: String(cat._id), _id: String(cat._id), name: cat.name }))
        : [];

    return {
        id: String(offer._id),
        _id: String(offer._id),
        restaurantId: String(offer.restaurantId?._id || offer.restaurantId),
        restaurantName: offer.restaurantId?.restaurantName || '',
        title: offer.title,
        name: offer.title,
        description: offer.description || '',
        applicableTo: offer.applicableTo,
        appliesTo: offer.applicableTo,
        itemIds: (offer.itemIds || []).map((it) => (it?._id ? String(it._id) : String(it))),
        items: rawItems,
        dishes: rawItems,
        categoryIds: (offer.categoryIds || []).map((cat) => (cat?._id ? String(cat._id) : String(cat))),
        categories: rawCategories,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        minOrderValue: offer.minOrderValue || 0,
        validFrom: offer.validFrom,
        validTill: offer.validTill,
        activeDays: offer.activeDays || [],
        activeTimeSlot: {
            start: offer.activeTimeSlot?.start || '',
            end: offer.activeTimeSlot?.end || ''
        },
        isActive: offer.isActive !== false,
        approvalStatus: offer.approvalStatus || 'pending',
        rejectionReason: offer.rejectionReason || null,
        approvedAt: offer.approvedAt || null,
        label: describeOffer(offer),
        status: getOfferStatus(offer, now),
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt
    };
};

/**
 * Customer menus refresh on the catalog event, and the public offers cache is dropped
 * so a change shows up immediately. Never fails the request that made the change.
 */
const announceOfferChange = async (restaurantId) => {
    try {
        await invalidateCache(`${PUBLIC_OFFERS_CACHE_PREFIX}:*`);
    } catch (err) {
        logger.warn(`[RestaurantOffers] Cache invalidation failed: ${err?.message || err}`);
    }
    try {
        getIO()?.emit(CATALOG_CHANGED_EVENT, {
            restaurantId: String(restaurantId),
            path: '/item-offers',
            at: Date.now()
        });
    } catch (err) {
        logger.warn(`[RestaurantOffers] Catalog broadcast failed: ${err?.message || err}`);
    }
};

/** Categories a restaurant may target: those its dishes use, plus ones it created. */
const getUsableCategoryIds = async (restaurantId) => {
    const [fromItems, owned] = await Promise.all([
        FoodItem.distinct('categoryId', { restaurantId, categoryId: { $ne: null } }),
        FoodCategory.find({
            $or: [{ restaurantId }, { createdByRestaurantId: restaurantId }]
        }).distinct('_id')
    ]);
    return new Set([...fromItems, ...owned].filter(Boolean).map(String));
};

/** Rejects items or categories that are not this restaurant's. */
const assertOwnedTargets = async (restaurantId, payload) => {
    if (payload.itemIds.length) {
        const owned = await FoodItem.countDocuments({
            _id: { $in: payload.itemIds.map(toObjectId) },
            restaurantId
        });
        if (owned !== payload.itemIds.length) {
            throw new ValidationError('Some selected items are not part of your menu');
        }
    }
    if (payload.categoryIds.length) {
        const usable = await getUsableCategoryIds(restaurantId);
        if (!payload.categoryIds.every((id) => usable.has(String(id)))) {
            throw new ValidationError('Some selected categories are not used by your menu');
        }
    }
};

export async function listRestaurantOffers(restaurantId, { page = 1, limit = 50 } = {}) {
    const filter = { restaurantId: toObjectId(restaurantId) };
    const [offers, total] = await Promise.all([
        FoodRestaurantOffer.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('restaurantId', 'restaurantName logo phone ownerPhone')
            .populate('itemIds', 'name price')
            .populate('categoryIds', 'name')
            .lean(),
        FoodRestaurantOffer.countDocuments(filter)
    ]);
    const now = new Date();
    return {
        offers: offers.map((offer) => toOfferView(offer, now)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
    };
}

/** Dishes and categories the offer form can pick from (what customers can order). */
export async function getRestaurantOfferOptions(restaurantId) {
    const rid = toObjectId(restaurantId);
    const items = await FoodItem.find({ restaurantId: rid, approvalStatus: 'approved' })
        .select('name price adminPrice variants categoryId categoryName isAvailable')
        .sort({ name: 1 })
        .lean();
    const categoryIds = [...new Set(items.map((item) => item.categoryId && String(item.categoryId)).filter(Boolean))];
    const categories = categoryIds.length
        ? await FoodCategory.find({ _id: { $in: categoryIds } }).select('name').sort({ name: 1 }).lean()
        : [];
    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
    return {
        items: items.map((item) => ({
            id: String(item._id),
            name: item.name,
            // The restaurant sees an admin price override as the price, never the override.
            price: toRestaurantFacingFood(item).price,
            isAvailable: item.isAvailable !== false,
            categoryId: item.categoryId ? String(item.categoryId) : null,
            categoryName: categoryNames.get(String(item.categoryId)) || item.categoryName || ''
        })),
        categories: categories.map((category) => ({ id: String(category._id), name: category.name }))
    };
}

export async function createRestaurantOffer(restaurantId, payload) {
    const rid = toObjectId(restaurantId);
    await assertOwnedTargets(rid, payload);
    const created = await FoodRestaurantOffer.create({
        ...payload,
        restaurantId: rid,
        approvalStatus: 'pending',
        rejectionReason: null,
        approvedAt: null,
        approvedBy: null
    });
    const offer = await FoodRestaurantOffer.findById(created._id)
        .populate('restaurantId', 'restaurantName logo phone ownerPhone')
        .populate('itemIds', 'name price')
        .populate('categoryIds', 'name')
        .lean();
    await announceOfferChange(rid);
    return toOfferView(offer || created.toObject());
}

export async function updateRestaurantOffer(restaurantId, offerId, payload) {
    const rid = toObjectId(restaurantId);
    await assertOwnedTargets(rid, payload);
    const offer = await FoodRestaurantOffer.findOneAndUpdate(
        { _id: toObjectId(offerId), restaurantId: rid },
        {
            $set: {
                ...payload,
                approvalStatus: 'pending',
                rejectionReason: null,
                approvedAt: null,
                approvedBy: null
            }
        },
        { new: true, runValidators: true }
    )
        .populate('restaurantId', 'restaurantName logo phone ownerPhone')
        .populate('itemIds', 'name price')
        .populate('categoryIds', 'name')
        .lean();
    if (!offer) throw new NotFoundError('Offer not found');
    await announceOfferChange(rid);
    return toOfferView(offer);
}

/** Sets isActive when given, otherwise flips it - atomically, so rapid taps cannot race. */
export async function toggleRestaurantOffer(restaurantId, offerId, isActive) {
    const rid = toObjectId(restaurantId);
    const filter = { _id: toObjectId(offerId), restaurantId: rid };
    const update = typeof isActive === 'boolean'
        ? { $set: { isActive } }
        : [{ $set: { isActive: { $not: [{ $ifNull: ['$isActive', true] }] } } }];
    const offer = await FoodRestaurantOffer.findOneAndUpdate(filter, update, { new: true }).lean();
    if (!offer) throw new NotFoundError('Offer not found');
    await announceOfferChange(rid);
    return toOfferView(offer);
}

export async function deleteRestaurantOffer(restaurantId, offerId) {
    const rid = toObjectId(restaurantId);
    const offer = await FoodRestaurantOffer.findOneAndDelete({ _id: toObjectId(offerId), restaurantId: rid }).lean();
    if (!offer) throw new NotFoundError('Offer not found');
    await announceOfferChange(rid);
    return { id: String(offer._id) };
}

/**
 * Offers a customer can get from this restaurant right now, with the dishes each one
 * covers already resolved (categories expanded to item ids), so a menu only has to
 * match item ids. Checkout re-evaluates everything server-side regardless.
 * ONLY approved offers are returned to customers!
 */
export async function listLiveRestaurantOffers(restaurantId, now = new Date()) {
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId || ''))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const rid = toObjectId(restaurantId);
    const restaurant = await FoodRestaurant.exists({ _id: rid, status: 'approved' });
    if (!restaurant) throw new NotFoundError('Restaurant not found');

    const offers = (
        await FoodRestaurantOffer.find({
            restaurantId: rid,
            isActive: true,
            approvalStatus: 'approved',
            validFrom: { $lte: now },
            validTill: { $gte: now }
        })
            .sort({ createdAt: -1 })
            .lean()
    ).filter((offer) => isOfferLiveAt(offer, now));
    if (!offers.length) return { offers: [] };

    const categoryIds = [...new Set(offers.flatMap((o) => (o.applicableTo === 'category' ? o.categoryIds : [])).map(String))];
    const specificIds = [...new Set(offers.flatMap((o) => (o.applicableTo === 'specific_items' ? o.itemIds : [])).map(String))];
    const itemFilters = [];
    if (categoryIds.length) itemFilters.push({ categoryId: { $in: categoryIds.map(toObjectId) } });
    if (specificIds.length) itemFilters.push({ _id: { $in: specificIds.map(toObjectId) } });
    const menuItems = itemFilters.length
        ? await FoodItem.find({ restaurantId: rid, approvalStatus: 'approved', $or: itemFilters })
            .select('_id categoryId')
            .lean()
        : [];

    return {
        offers: offers.map((offer) => {
            const covered =
                offer.applicableTo === 'category'
                    ? menuItems.filter((item) => (offer.categoryIds || []).some((id) => String(id) === String(item.categoryId)))
                    : offer.applicableTo === 'specific_items'
                        ? menuItems.filter((item) => (offer.itemIds || []).some((id) => String(id) === String(item._id)))
                        : [];
            return {
                id: String(offer._id),
                title: offer.title,
                description: offer.description || '',
                label: describeOffer(offer),
                discountType: offer.discountType,
                discountValue: offer.discountValue,
                minOrderValue: offer.minOrderValue || 0,
                applicableTo: offer.applicableTo,
                allItems: offer.applicableTo === 'entire_menu',
                itemIds: covered.map((item) => String(item._id)),
                validTill: offer.validTill,
                activeDays: offer.activeDays || [],
                activeTimeSlot: {
                    start: offer.activeTimeSlot?.start || '',
                    end: offer.activeTimeSlot?.end || ''
                }
            };
        })
    };
}

/** Admin: list all restaurant offers across the platform with filtering and restaurant details. */
export async function listRestaurantOffersForAdmin({
    page = 1,
    limit = 20,
    status = 'all',
    search = '',
    restaurantId = ''
} = {}) {
    // Filters shared by the list and the per-status counts (status itself is applied to the list only).
    const baseFilter = {};

    if (restaurantId && mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        baseFilter.restaurantId = toObjectId(restaurantId);
    }

    const term = String(search || '').trim();
    if (term) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const matchingRestaurants = await FoodRestaurant.find({ restaurantName: regex }).select('_id').limit(200).lean();
        baseFilter.$or = [
            { title: regex },
            { description: regex },
            ...(matchingRestaurants.length ? [{ restaurantId: { $in: matchingRestaurants.map((r) => r._id) } }] : [])
        ];
    }

    // Offers saved before approval existed have no status: they count as pending.
    const STATUS_FILTERS = {
        pending: { approvalStatus: { $in: ['pending', null] } },
        approved: { approvalStatus: 'approved' },
        rejected: { approvalStatus: 'rejected' }
    };
    const filter = { ...baseFilter, ...(STATUS_FILTERS[status] || {}) };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [offers, total, all, pending, approved, rejected] = await Promise.all([
        FoodRestaurantOffer.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate('restaurantId', 'restaurantName logo phone ownerPhone primaryContactNumber zoneId')
            .populate('itemIds', 'name price')
            .populate('categoryIds', 'name')
            .lean(),
        FoodRestaurantOffer.countDocuments(filter),
        FoodRestaurantOffer.countDocuments(baseFilter),
        FoodRestaurantOffer.countDocuments({ ...baseFilter, ...STATUS_FILTERS.pending }),
        FoodRestaurantOffer.countDocuments({ ...baseFilter, ...STATUS_FILTERS.approved }),
        FoodRestaurantOffer.countDocuments({ ...baseFilter, ...STATUS_FILTERS.rejected })
    ]);

    const now = new Date();
    return {
        offers: offers.map((offer) => toOfferView(offer, now)),
        // The admin page reads total and counts at the top level (tab badges, pagination).
        total,
        counts: { all, pending, approved, rejected },
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

/** Admin: approve a restaurant offer so customers can use it. */
export async function approveRestaurantOfferByAdmin(offerId, adminId = null) {
    if (!mongoose.Types.ObjectId.isValid(String(offerId || ''))) {
        throw new ValidationError('Invalid offer id');
    }
    const offer = await FoodRestaurantOffer.findByIdAndUpdate(
        toObjectId(offerId),
        {
            $set: {
                approvalStatus: 'approved',
                approvedAt: new Date(),
                approvedBy: adminId ? toObjectId(adminId) : null,
                rejectionReason: null
            }
        },
        { new: true }
    )
        .populate('restaurantId', 'restaurantName logo phone ownerPhone')
        .populate('itemIds', 'name price')
        .populate('categoryIds', 'name')
        .lean();

    if (!offer) throw new NotFoundError('Offer not found');
    await announceOfferChange(offer.restaurantId?._id || offer.restaurantId);
    return toOfferView(offer);
}

/** Admin: reject a restaurant offer with an optional reason. */
export async function rejectRestaurantOfferByAdmin(offerId, reason = '', adminId = null) {
    if (!mongoose.Types.ObjectId.isValid(String(offerId || ''))) {
        throw new ValidationError('Invalid offer id');
    }
    const offer = await FoodRestaurantOffer.findByIdAndUpdate(
        toObjectId(offerId),
        {
            $set: {
                approvalStatus: 'rejected',
                rejectionReason: String(reason || '').trim() || 'Rejected by Admin',
                approvedAt: null,
                approvedBy: adminId ? toObjectId(adminId) : null
            }
        },
        { new: true }
    )
        .populate('restaurantId', 'restaurantName logo phone ownerPhone')
        .populate('itemIds', 'name price')
        .populate('categoryIds', 'name')
        .lean();

    if (!offer) throw new NotFoundError('Offer not found');
    await announceOfferChange(offer.restaurantId?._id || offer.restaurantId);
    return toOfferView(offer);
}

/** Admin: delete a restaurant offer. */
export async function deleteRestaurantOfferByAdmin(offerId) {
    if (!mongoose.Types.ObjectId.isValid(String(offerId || ''))) {
        throw new ValidationError('Invalid offer id');
    }
    const offer = await FoodRestaurantOffer.findByIdAndDelete(toObjectId(offerId)).lean();
    if (!offer) throw new NotFoundError('Offer not found');
    await announceOfferChange(offer.restaurantId);
    return { id: String(offer._id) };
}
