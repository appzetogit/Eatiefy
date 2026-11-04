import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { resolveZoneIdForPartner } from '../../delivery/services/delivery.service.js';
import { DeliverySupportTicket } from '../../delivery/models/supportTicket.model.js';
import { FoodZone } from '../models/zone.model.js';
import { FoodZoneRestaurantSettings } from '../models/zoneRestaurantSettings.model.js';
import { assertZoneCoversLocation, isPointInZone } from '../../shared/zoneLocation.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { FoodOnboardingPayment } from '../../restaurant/models/onboardingPayment.model.js';
import { getRestaurantTypeLabel, normalizeRestaurantType } from '../../shared/restaurantTypes.js';
import {
    assertTicketStatusTransition,
    getAllowedTicketTransitions
} from '../../shared/supportTicketWorkflow.js';
import { FoodCategory } from '../models/category.model.js';
import { FoodItem } from '../models/food.model.js';
import { FoodPricingRule } from '../models/foodPricingRule.model.js';
import { FoodOffer } from '../models/offer.model.js';
import { FoodOfferUsage } from '../models/offerUsage.model.js';
import { FoodRestaurantOffer } from '../../restaurant/models/restaurantOffer.model.js';
import { DeliveryBonusTransaction } from '../models/deliveryBonusTransaction.model.js';
import { FoodEarningAddon } from '../models/earningAddon.model.js';
import { FoodEarningAddonHistory } from '../models/earningAddonHistory.model.js';
import { FoodRestaurantCommission } from '../models/restaurantCommission.model.js';
import { FoodDeliveryCommissionRule } from '../models/deliveryCommissionRule.model.js';
import { FoodFeeSettings } from '../models/feeSettings.model.js';
import { invalidateCommissionRulesCache } from '../../orders/services/riderEarning.service.js';
import { invalidateRestaurantCommissionRulesCache } from '../../orders/services/foodTransaction.service.js';
import { FeedbackExperience } from '../models/feedbackExperience.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { getUserWallet, creditWalletBalance, deductWalletBalance } from '../../user/services/userWallet.service.js';
import { FoodRefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';
import { FoodDeliveryCashLimit } from '../models/deliveryCashLimit.model.js';
import { FoodTopRestaurant } from '../models/topRestaurant.model.js';
import { FoodDeliveryEmergencyHelp } from '../models/deliveryEmergencyHelp.model.js';
import {
    resolveDeliveryCashLimitSettings,
    resolveDeliveryEmergencyHelp,
    updateDeliveryCashLimitSettings,
    updateDeliveryEmergencyHelp,
    loadDeliveryCashLimitByZone,
    loadPartnerZoneIds,
} from './zoneDeliverySettings.service.js';
import { FoodReferralSettings } from '../models/referralSettings.model.js';
import { FoodReferralLog } from '../models/referralLog.model.js';
import { FoodSafetyEmergencyReport } from '../models/safetyEmergencyReport.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { FoodSupportTicket } from '../../user/models/supportTicket.model.js';
import { FoodRestaurantSupportTicket } from '../../restaurant/models/supportTicket.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import {
    toStartOfDayInTimeZone,
    toEndOfDayInTimeZone,
    getWeekRangeInTimeZone,
    getMonthRangeInTimeZone,
    getZonedParts,
    zonedWallTimeToUtc,
} from '../../../../utils/timezone.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { deleteReplacedAssets, deleteStoredAssets, extractAssetUrls, normalizeImageForStorage } from '../../../../services/storage.service.js';
import { deleteFoodImagesIfUnused, removedAssetUrls } from '../../../../services/assetReferences.service.js';
import { FoodRestaurantWithdrawal } from '../../restaurant/models/foodRestaurantWithdrawal.model.js';
import { FoodDeliveryWithdrawal } from '../../delivery/models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryWallet } from '../../delivery/models/deliveryWallet.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import {
    backfillLegacyCategoryWorkflow,
    categoryAllowsFoodType,
    normalizeCategoryFoodTypeScope,
    normalizeDishFoodType,
    serializeCategoryForResponse
} from '../../shared/categoryWorkflow.js';
import {
    formatVeganBlockMessage,
    getVeganFoodTypeBlockReason,
} from '../../shared/veganFoodGuard.js';
import {
    extractRawFoodVariants,
    getFoodAdminPrice,
    getFoodDisplayPrice,
    hasFoodVariants,
    normalizeFoodVariantsInput,
    serializeFoodVariants
} from './foodVariant.service.js';

const parseBooleanLike = (value, fieldName) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on', 'active'].includes(normalized)) return true;
        if (['false', '0', 'no', 'n', 'off', 'inactive'].includes(normalized)) return false;
    }
    throw new ValidationError(`${fieldName} must be a boolean`);
};

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(num) ? num : null;
};

const toRestaurantDisplayId = (mongoId) => {
    const s = String(mongoId || '');
    if (!s) return '';
    if (/^REST\d{6}$/i.test(s)) return s.toUpperCase();
    return `REST${s.slice(-6).padStart(6, '0')}`;
};

/**
 * The delivery partner's display ID ("DP-XXXXXXXX"), derived from the Mongo id
 * exactly as /auth/me and the partner's own ID card do, so admin screens show
 * the same identifier the partner sees. Returns '' when there is no id at all.
 */
const toDeliveryPartnerDisplayId = (partnerId) => {
    const raw = String(partnerId?._id || partnerId || '').trim();
    if (!raw) return '';
    if (/^DP-[A-Z0-9]{8}$/i.test(raw)) return raw.toUpperCase();
    return `DP-${raw.slice(-8).toUpperCase()}`;
};

/**
 * Optional `zoneId` filter of an admin list. Empty or "all" means every zone;
 * anything else must be a valid id, so a bad value is a 400 instead of a crash
 * or a silently unfiltered list.
 */
const parseZoneFilter = (value) => {
    const raw = value == null ? '' : String(value).trim();
    if (!raw || raw.toLowerCase() === 'all') return null;
    if (!mongoose.Types.ObjectId.isValid(raw)) {
        throw new ValidationError('Invalid zoneId');
    }
    return new mongoose.Types.ObjectId(raw);
};

/** Every restaurant assigned to a zone (any status), to filter records that hang off restaurants. */
const getRestaurantIdsInZone = async (zoneOid) => {
    const docs = await FoodRestaurant.find({ zoneId: zoneOid }).select('_id').lean();
    return docs.map((doc) => doc._id);
};

/** Every delivery partner assigned to a zone (any status), to filter records that hang off riders. */
const getDeliveryPartnerIdsInZone = async (zoneOid) => {
    const docs = await FoodDeliveryPartner.find({ zoneId: zoneOid }).select('_id').lean();
    return docs.map((doc) => doc._id);
};

/**
 * Narrows an admin Deliveryman Management list to records of riders in
 * `zoneId` - the rider's own zone, as on the Deliveryman List. Added under
 * $and so it combines with a name/phone search on the same field instead of
 * replacing it. Empty / "all" leaves the filter as it is; a bad id is a 400.
 */
const scopeFilterToRiderZone = async (filter, zoneId, field = 'deliveryPartnerId') => {
    const zoneOid = parseZoneFilter(zoneId);
    if (!zoneOid) return filter;
    const partnerIds = await getDeliveryPartnerIdsInZone(zoneOid);
    filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { [field]: { $in: partnerIds } }];
    return filter;
};

const normalizeRestaurantTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const toHHMM = (hour, minute) => {
        const h = Number(hour);
        const m = Number(minute);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
        if (h < 0 || h > 23 || m < 0 || m > 59) return '';
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return toHHMM(hhmm[1], hhmm[2]);

    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampm) {
        let hour = Number(ampm[1]);
        const minute = Number(ampm[2]);
        const period = ampm[3].toUpperCase();
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';
        if (period === 'AM') hour = hour === 12 ? 0 : hour;
        if (period === 'PM') hour = hour === 12 ? 12 : hour + 12;
        return toHHMM(hour, minute);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return toHHMM(parsed.getHours(), parsed.getMinutes());
    }

    return '';
};

const timeToMinutes = (value) => {
    const normalized = normalizeRestaurantTime(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const validateOpeningClosingTimes = (openingTime, closingTime) => {
    const open = timeToMinutes(openingTime);
    const close = timeToMinutes(closingTime);
    if (open === null || close === null) return;
    // close < open is a valid overnight shift (closes next day).
    if (open === close) {
        throw new ValidationError('Opening time and closing time cannot be same');
    }
};

export async function getRestaurantComplaints(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { type: 'order' };
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.complaintType && query.complaintType !== 'all') filter.issueType = query.complaintType;
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }
    const zoneOid = parseZoneFilter(query.zoneId);
    if (zoneOid) {
        // $and keeps this independent of the restaurantId / search conditions.
        filter.$and = [{ restaurantId: { $in: await getRestaurantIdsInZone(zoneOid) } }];
    }
    if (query.search) {
        const searchRegex = { $regex: query.search, $options: 'i' };
        const restaurantIds = await FoodRestaurant.find({ restaurantName: searchRegex }).select('_id').lean();
        const userIds = await FoodUser.find({ name: searchRegex }).select('_id').lean();
        const orderIds = await FoodOrder.find({ orderId: searchRegex }).select('_id').lean();

        filter.$or = [
            { restaurantId: { $in: restaurantIds.map(r => r._id) } },
            { userId: { $in: userIds.map(u => u._id) } },
            { orderId: { $in: orderIds.map(o => o._id) } },
            { description: searchRegex },
            { issueType: searchRegex }
        ];
    }
    const fromDate = query.fromDate || query.startDate;
    const toDate = query.toDate || query.endDate;
    if (fromDate && toDate) {
        filter.createdAt = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    }

    const [complaints, total] = await Promise.all([
        FoodSupportTicket.find(filter)
            .populate('userId', 'name phone profileImage')
            .populate('restaurantId', 'restaurantName profileImage area city')
            .populate('orderId', 'orderId orderStatus pricing createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodSupportTicket.countDocuments(filter)
    ]);

    return { complaints, total, page, limit };
}

export async function globalSearch(query = '') {
    const term = String(query).trim();
    if (!term) return [];
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };

    const [orders, users, restaurants, items, categories, addons] = await Promise.all([
        FoodOrder.find({
            $or: [{ orderId: regex }, { orderStatus: regex }]
        })
            .limit(5)
            .select('orderId orderStatus createdAt')
            .lean(),
        FoodUser.find({
            $or: [{ name: regex }, { email: regex }, { phone: regex }],
            role: 'USER'
        })
            .limit(5)
            .select('name email phone')
            .lean(),
        FoodRestaurant.find({
            $or: [{ restaurantName: regex }, { ownerName: regex }, { city: regex }]
        })
            .limit(5)
            .select('restaurantName city area status')
            .lean(),
        FoodItem.find({
            $or: [{ name: regex }, { description: regex }]
        })
            .limit(5)
            .select('name description price')
            .lean(),
        FoodCategory.find({ name: regex })
            .limit(3)
            .select('name image')
            .lean(),
        FoodAddon.find({ name: regex })
            .limit(3)
            .select('name price')
            .lean()
    ]);

    const results = [];

    orders.forEach(o => results.push({
        id: o._id,
        type: 'Order',
        title: `#${o.orderId}`,
        description: `Status: ${o.orderStatus}`,
        path: `/admin/food/orders/all?orderId=${o._id}`
    }));

    users.forEach(u => results.push({
        id: u._id,
        type: 'User',
        title: u.name || 'Unnamed',
        description: `${u.email || u.phone || ''}`,
        path: `/admin/food/customers?userId=${u._id}`
    }));

    restaurants.forEach(r => results.push({
        id: r._id,
        type: 'Restaurant',
        title: r.restaurantName,
        description: `${r.area || ''}, ${r.city || ''} (${r.status})`,
        path: `/admin/food/restaurants?restaurantId=${r._id}`
    }));

    items.forEach(i => results.push({
        id: i._id,
        type: 'Product',
        title: i.name,
        description: `Price: â‚¹${i.price}`,
        path: `/admin/food/foods?productId=${i._id}`
    }));

    categories.forEach(c => results.push({
        id: c._id,
        type: 'Category',
        title: c.name,
        description: 'Menu Category',
        path: `/admin/food/categories`
    }));

    addons.forEach(a => results.push({
        id: a._id,
        type: 'Addon',
        title: a.name,
        description: `Price: â‚¹${a.price}`,
        path: `/admin/food/addons`
    }));

    return results;
}

export async function getArchivedAccounts() {
    const [users, restaurants, deliveryPartners] = await Promise.all([
        FoodUser.find({ isActive: false })
            .select('name phone email profileImage createdAt updatedAt deletedAt')
            .lean(),
        FoodRestaurant.find({ status: 'deleted' })
            .select('restaurantName ownerPhone ownerEmail profileImage createdAt updatedAt deletedAt')
            .lean(),
        FoodDeliveryPartner.find({ status: 'deleted' })
            .select('name phone email profilePhoto createdAt updatedAt deletedAt')
            .lean(),
    ]);

    console.log(`[Archived-Debug] Found Inactive Users: ${users.length}, Restaurants: ${restaurants.length}, Delivery: ${deliveryPartners.length}`);

    // Helper to get original phone (remove _deleted_ suffix)
    const getOriginalPhone = (p) => String(p || '').split('_')[0];

    const archived = [
        ...users.map(u => ({
            id: u._id,
            name: u.name || 'Unnamed User',
            phone: u.phone,
            originalPhone: getOriginalPhone(u.phone),
            email: u.email || 'N/A',
            profileImage: u.profileImage,
            role: 'User',
            type: 'user',
            deletedAt: u.deletedAt || u.updatedAt,
            status: 'Deleted'
        })),
        ...restaurants.map(r => ({
            id: r._id,
            name: r.restaurantName,
            phone: r.ownerPhone,
            originalPhone: getOriginalPhone(r.ownerPhone),
            email: r.ownerEmail || 'N/A',
            profileImage: r.profileImage,
            role: 'Restaurant',
            type: 'restaurant',
            deletedAt: r.deletedAt || r.updatedAt,
            status: 'Deleted'
        })),
        ...deliveryPartners.map(d => ({
            id: d._id,
            name: d.name,
            phone: d.phone,
            originalPhone: getOriginalPhone(d.phone),
            email: d.email || 'N/A',
            profileImage: d.profilePhoto,
            role: 'Delivery Partner',
            type: 'delivery',
            deletedAt: d.deletedAt || d.updatedAt,
            status: 'Deleted'
        }))
    ];

    // For each archived entity, check if a NEW account exists with the original phone
    const enhancedArchived = await Promise.all(archived.map(async (acc) => {
        let newAccount = null;
        if (acc.type === 'user') {
            newAccount = await FoodUser.findOne({ phone: acc.originalPhone, isActive: true }).select('createdAt').lean();
        } else if (acc.type === 'restaurant') {
            newAccount = await FoodRestaurant.findOne({ ownerPhone: acc.originalPhone, status: { $ne: 'deleted' } }).select('createdAt').lean();
        } else if (acc.type === 'delivery') {
            newAccount = await FoodDeliveryPartner.findOne({ phone: acc.originalPhone, status: { $ne: 'deleted' } }).select('createdAt').lean();
        }

        return {
            ...acc,
            newAccountCreatedAt: newAccount ? newAccount.createdAt : null
        };
    }));

    // Sort by deletedAt (updatedAt) descending
    return enhancedArchived.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}

export async function updateRestaurantComplaint(id, updateData) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid complaint ID');
    }
    const update = {};
    if (updateData.status) update.status = updateData.status;
    if (updateData.adminResponse !== undefined) update.adminResponse = updateData.adminResponse;

    const updated = await FoodSupportTicket.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true }
    ).lean();

    if (!updated) throw new ValidationError('Complaint not found');
    return updated;
}

export async function getRestaurants(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const status = query.status;
    const filter = {};
    const zoneOid = parseZoneFilter(query.zoneId);
    if (zoneOid) filter.zoneId = zoneOid;
    if (status && ['pending', 'approved', 'rejected', 'banned'].includes(status)) {
        filter.status = status;
    } else {
        filter.status = { $ne: 'deleted' };
    }
    // Optional isActive filter (used by Pricing Management to hide disabled restaurants).
    // Accept the literal strings "true"/"false" or booleans; ignore anything else.
    if (query.isActive === true || query.isActive === 'true') {
        filter.isActive = { $ne: false };
    } else if (query.isActive === false || query.isActive === 'false') {
        filter.isActive = false;
    }
    const [restaurants, total] = await Promise.all([
        FoodRestaurant.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('restaurantName location area city profileImage coverImages status ownerName ownerPhone zoneId rating totalRatings pureVegRestaurant isActive')
            .populate('zoneId', 'name zoneName')
            .lean(),
        FoodRestaurant.countDocuments(filter)
    ]);
    return {
        restaurants: restaurants.map((r) => ({ ...r, restaurantId: toRestaurantDisplayId(r._id) })),
        total,
        page,
        limit,
    };
}

export async function getRestaurantCounts(query = {}) {
    const filter = { status: { $ne: 'deleted' } };
    if (query.zoneId && mongoose.Types.ObjectId.isValid(String(query.zoneId).trim())) {
        filter.zoneId = new mongoose.Types.ObjectId(String(query.zoneId).trim());
    }

    const [stats] = await FoodRestaurant.aggregate([
        { $match: filter },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
                active: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$status', 'approved'] },
                                    { $ne: ['$isActive', false] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },
                inactive: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$status', 'approved'] },
                                    { $eq: ['$isActive', false] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },
                pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
                banned: { $sum: { $cond: [{ $eq: ['$status', 'banned'] }, 1, 0] } }
            }
        }
    ]);

    return {
        total: stats?.total || 0,
        approved: stats?.approved || 0,
        active: stats?.active || 0,
        inactive: stats?.inactive || 0,
        pending: stats?.pending || 0,
        rejected: stats?.rejected || 0,
        banned: stats?.banned || 0
    };
}



const CANCELLED_ORDER_STATUSES = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];
// Broad "in progress" set used by live activity / charts — not the Pending Orders card.
const PENDING_ORDER_STATUSES = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];
// Must match admin Pending Orders page (`listOrdersAdmin` status=pending → orderStatus=created).
const DASHBOARD_PENDING_ORDER_STATUSES = ['created'];
// Confirmed + kitchen stages (pending page is only brand-new `created` orders).
const DASHBOARD_PROCESSING_ORDER_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup'];
// Matches admin Food On The Way page (`listOrdersAdmin` status=food-on-the-way).
const DASHBOARD_IN_TRANSIT_ORDER_STATUSES = ['picked_up', 'reached_drop'];
const DELIVERED_ORDER_STATUS_EXPR = { $eq: ['$orderStatus', 'delivered'] };
/** Same visibility rule as listOrdersAdmin base filter (exclude unpaid online checkouts). */
const ADMIN_VISIBLE_PAYMENT_EXPR = {
    $or: [
        { $in: [{ $toLower: { $ifNull: ['$payment.method', ''] } }, ['cash', 'wallet']] },
        {
            $in: [
                { $toLower: { $ifNull: ['$payment.status', ''] } },
                ['paid', 'authorized', 'captured', 'settled', 'refunded']
            ]
        },
        { $in: ['$orderStatus', CANCELLED_ORDER_STATUSES] }
    ]
};
const IS_CASH_COD_METHOD_EXPR = {
    $in: [
        { $toLower: { $ifNull: ['$payment.method', ''] } },
        ['cash', 'cod', 'cash on delivery']
    ]
};
const COD_AMOUNT_EXPR = {
    $ifNull: [
        {
            $cond: [
                { $gt: [{ $ifNull: ['$payment.amountDue', 0] }, 0] },
                '$payment.amountDue',
                null
            ]
        },
        { $ifNull: ['$pricing.total', 0] }
    ]
};
const OPEN_COD_ORDER_EXPR = {
    $and: [
        IS_CASH_COD_METHOD_EXPR,
        { $ne: ['$orderStatus', 'delivered'] },
        { $not: { $in: ['$orderStatus', CANCELLED_ORDER_STATUSES] } }
    ]
};
const COLLECTED_COD_ORDER_EXPR = {
    $and: [
        IS_CASH_COD_METHOD_EXPR,
        DELIVERED_ORDER_STATUS_EXPR
    ]
};
const DASHBOARD_PLATFORM_FEE_EXPR = { $ifNull: ['$pricing.platformFee', 0] };
const DASHBOARD_DELIVERY_FEE_EXPR = { $ifNull: ['$pricing.deliveryFee', 0] };
const DASHBOARD_RIDER_EARNING_EXPR = { $ifNull: ['$riderEarning', 0] };

const getDateRangeByPeriod = (periodRaw) => {
    const period = String(periodRaw || 'overall').trim().toLowerCase();
    if (!period || period === 'overall' || period === 'all') return null;

    const now = new Date();

    if (period === 'today') {
        return { start: toStartOfDayInTimeZone(now), end: toEndOfDayInTimeZone(now) };
    }

    if (period === 'week') {
        const range = getWeekRangeInTimeZone(now);
        return { start: range.start, end: range.end };
    }

    if (period === 'month') {
        const range = getMonthRangeInTimeZone(now);
        return { start: range.start, end: range.end };
    }

    if (period === 'year') {
        const p = getZonedParts(now);
        return {
            start: zonedWallTimeToUtc({ year: p.year, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 }),
            end: zonedWallTimeToUtc({ year: p.year, month: 12, day: 31, hour: 23, minute: 59, second: 59, ms: 999 }),
        };
    }

    return null;
};

const formatMonthShort = (year, monthIndex) =>
    new Date(year, monthIndex, 1).toLocaleString('en-IN', { month: 'short' });

export async function getDashboardStats(query = {}) {
    const periodRange = getDateRangeByPeriod(query.period);
    const zoneId = query.zoneId && mongoose.Types.ObjectId.isValid(query.zoneId)
        ? new mongoose.Types.ObjectId(query.zoneId)
        : null;

    const zoneRestaurantIds = zoneId
        ? await FoodRestaurant.find({ zoneId }).distinct('_id')
        : null;

    // Include ALL orders in the period/zone matching Transaction Report and All Orders
    const orderMatch = {};
    if (periodRange) {
        orderMatch.createdAt = { $gte: periodRange.start, $lte: periodRange.end };
    }
    // Zone scope via restaurant (matches Transaction Report + listOrdersAdmin) and direct zoneId.
    if (zoneId) {
        orderMatch.$or = [
            { zoneId: zoneId },
            { restaurantId: { $in: zoneRestaurantIds || [] } }
        ];
    }

    const restaurantMatch = {};
    if (zoneId) {
        restaurantMatch.zoneId = zoneId;
    }

    const zoneScopedRestaurantMatch = zoneId
        ? { restaurantId: { $in: zoneRestaurantIds || [] } }
        : {};

    let deliveryFilter = {};
    if (zoneId) {
        if (mongoose.Types.ObjectId.isValid(String(zoneId))) {
            deliveryFilter = { zoneId: new mongoose.Types.ObjectId(String(zoneId)) };
        }
    }

    const [
        orderTotalsAgg,
        monthlyAgg,
        restaurantsTotal,
        restaurantsPending,
        deliveryTotal,
        deliveryPending,
        foodsTotal,
        addonsTotal,
        customersTotal,
        recentPendingRestaurants,
        recentPendingDelivery,
        recentPendingOrders,
        recentDeliveredOrders,
        recentCancelledOrders,
        recentCustomers,
        restaurantsOnboardedAgg,
        onboardingEarningAgg
    ] = await Promise.all([
        FoodOrder.aggregate([
            { $match: orderMatch },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    delivered: { $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] } },
                    cancelled: {
                        $sum: {
                            $cond: [{ $in: ['$orderStatus', CANCELLED_ORDER_STATUSES] }, 1, 0]
                        }
                    },
                    pending: {
                        $sum: {
                            $cond: [{ $in: ['$orderStatus', PENDING_ORDER_STATUSES] }, 1, 0]
                        }
                    },
                    dashboardPending: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $in: ['$orderStatus', DASHBOARD_PENDING_ORDER_STATUSES] },
                                        ADMIN_VISIBLE_PAYMENT_EXPR
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    dashboardProcessing: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $in: ['$orderStatus', DASHBOARD_PROCESSING_ORDER_STATUSES] },
                                        ADMIN_VISIBLE_PAYMENT_EXPR
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    dashboardInTransit: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $in: ['$orderStatus', DASHBOARD_IN_TRANSIT_ORDER_STATUSES] },
                                        ADMIN_VISIBLE_PAYMENT_EXPR
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    refunded: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: [{ $toLower: { $ifNull: ['$payment.status', ''] } }, 'refunded'] },
                                        {
                                            $not: {
                                                $in: [
                                                    { $toLower: { $ifNull: ['$payment.method', ''] } },
                                                    ['cash', 'cod', 'cash on delivery']
                                                ]
                                            }
                                        }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    revenueTotal: { 
                        $sum: { 
                            $cond: [DELIVERED_ORDER_STATUS_EXPR, { $ifNull: ['$pricing.total', 0] }, 0] 
                        } 
                    },
                    commissionTotal: { 
                        $sum: { 
                            $cond: [DELIVERED_ORDER_STATUS_EXPR, { $ifNull: ['$pricing.restaurantCommission', 0] }, 0] 
                        } 
                    },
                    platformFeeTotal: { 
                        $sum: { 
                            $cond: [DELIVERED_ORDER_STATUS_EXPR, DASHBOARD_PLATFORM_FEE_EXPR, 0] 
                        } 
                    },
                    markupTotal: {
                        $sum: {
                            $cond: [DELIVERED_ORDER_STATUS_EXPR, { $ifNull: ['$pricing.markupTotal', 0] }, 0]
                        }
                    },
                    deliveryFeeTotal: { 
                        $sum: { 
                            $cond: [DELIVERED_ORDER_STATUS_EXPR, DASHBOARD_DELIVERY_FEE_EXPR, 0] 
                        } 
                    },
                    riderEarningTotal: {
                        $sum: {
                            $cond: [DELIVERED_ORDER_STATUS_EXPR, DASHBOARD_RIDER_EARNING_EXPR, 0]
                        }
                    },
                    gstTotal: { 
                        $sum: { 
                            $cond: [DELIVERED_ORDER_STATUS_EXPR, { $ifNull: ['$pricing.tax', 0] }, 0] 
                        } 
                    },
                    // COD pipeline: include pending/processing cash orders (not only delivered)
                    codCollectedTotal: {
                        $sum: {
                            $cond: [COLLECTED_COD_ORDER_EXPR, COD_AMOUNT_EXPR, 0]
                        }
                    },
                    codOpenTotal: {
                        $sum: {
                            $cond: [OPEN_COD_ORDER_EXPR, COD_AMOUNT_EXPR, 0]
                        }
                    },
                    codOpenOrders: {
                        $sum: {
                            $cond: [OPEN_COD_ORDER_EXPR, 1, 0]
                        }
                    },
                    cashOrderCount: {
                        $sum: {
                            $cond: [IS_CASH_COD_METHOD_EXPR, 1, 0]
                        }
                    },
                    onlineOrderCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $not: [IS_CASH_COD_METHOD_EXPR] },
                                        ADMIN_VISIBLE_PAYMENT_EXPR
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    deliveryBoyEarningTotal: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        DELIVERED_ORDER_STATUS_EXPR,
                                        { $ne: [{ $ifNull: ['$dispatch.deliveryPartnerId', null] }, null] }
                                    ]
                                },
                                DASHBOARD_RIDER_EARNING_EXPR,
                                0
                            ]
                        }
                    },
                    // Restaurant earning uses restaurant base (before admin markup)
                    restaurantEarningTotal: {
                        $sum: {
                            $cond: [
                                DELIVERED_ORDER_STATUS_EXPR,
                                {
                                    $max: [
                                        0,
                                        {
                                            $subtract: [
                                                {
                                                    $add: [
                                                        {
                                                            $ifNull: [
                                                                '$pricing.baseSubtotal',
                                                                { $ifNull: ['$pricing.subtotal', 0] },
                                                            ],
                                                        },
                                                        { $ifNull: ['$pricing.packagingFee', 0] }
                                                    ]
                                                },
                                                { $ifNull: ['$pricing.restaurantCommission', 0] }
                                            ]
                                        }
                                    ]
                                },
                                0
                            ]
                        }
                    }
                }
            }
        ]),
        FoodOrder.aggregate([
            {
                $match: {
                    ...orderMatch,
                    createdAt: {
                        $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1),
                        $lte: new Date()
                    }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    orders: { $sum: 1 },
                    revenue: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$pricing.total', 0] }, 0] 
                        } 
                    },
                    commission: {
                        $sum: {
                            $cond: [
                                { $eq: ['$orderStatus', 'delivered'] },
                                { $ifNull: ['$pricing.restaurantCommission', 0] },
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]),
        FoodRestaurant.countDocuments({ ...restaurantMatch, status: 'approved' }),
        FoodRestaurant.countDocuments({ ...restaurantMatch, status: 'pending' }),
        FoodDeliveryPartner.countDocuments({ status: 'approved', ...deliveryFilter }),
        FoodDeliveryPartner.countDocuments({ status: 'pending', ...deliveryFilter }),
        FoodItem.countDocuments({ approvalStatus: 'approved', ...zoneScopedRestaurantMatch }),
        FoodAddon.countDocuments({ approvalStatus: 'approved', isDeleted: { $ne: true }, ...zoneScopedRestaurantMatch }),
        zoneId
            ? FoodOrder.find(orderMatch).distinct('userId').then((ids) => ids.filter(Boolean).length)
            : periodRange
                ? FoodUser.countDocuments({ createdAt: { $gte: periodRange.start, $lte: periodRange.end } })
                : FoodUser.countDocuments({}),
        FoodRestaurant.find({ ...restaurantMatch, status: 'pending' }).sort({ createdAt: -1 }).limit(5).select('restaurantName createdAt').lean(),
        FoodDeliveryPartner.find({ status: 'pending', ...deliveryFilter }).sort({ createdAt: -1 }).limit(5).select('name createdAt').lean(),
        FoodOrder.find({ 
            ...orderMatch,
            orderStatus: { $in: PENDING_ORDER_STATUSES },
        }).sort({ createdAt: -1 }).limit(5).select('orderId createdAt').lean(),
        FoodOrder.find({ ...orderMatch, orderStatus: 'delivered' }).sort({ updatedAt: -1 }).limit(5).select('orderId updatedAt').lean(),
        FoodOrder.find({ 
            ...orderMatch,
            orderStatus: { $in: CANCELLED_ORDER_STATUSES },
        }).sort({ updatedAt: -1 }).limit(5).select('orderId updatedAt').lean(),
        zoneId
            ? FoodOrder.aggregate([
                { $match: { ...orderMatch, userId: { $ne: null } } },
                { $sort: { createdAt: -1 } },
                {
                    $group: {
                        _id: '$userId',
                        createdAt: { $first: '$createdAt' }
                    }
                },
                { $sort: { createdAt: -1 } },
                { $limit: 5 },
                {
                    $lookup: {
                        from: 'food_users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' },
                {
                    $project: {
                        _id: '$user._id',
                        name: '$user.name',
                        createdAt: 1
                    }
                }
            ])
            : FoodUser.find({}).sort({ createdAt: -1 }).limit(5).select('name createdAt').lean(),
        // Restaurants that completed signup in the selected zone/period, by status.
        FoodRestaurant.aggregate([
            {
                $match: {
                    ...restaurantMatch,
                    status: { $ne: 'deleted' },
                    ...(periodRange ? { createdAt: { $gte: periodRange.start, $lte: periodRange.end } } : {})
                }
            },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        // One-time onboarding fees actually collected (verified payments only), by
        // payment date. Zone: the zone recorded at payment, or the restaurant's
        // current zone if it has moved since.
        FoodOnboardingPayment.aggregate([
            {
                $match: {
                    status: 'paid',
                    ...(periodRange ? { paidAt: { $gte: periodRange.start, $lte: periodRange.end } } : {}),
                    ...(zoneId
                        ? { $or: [{ zoneId }, { restaurantId: { $in: zoneRestaurantIds || [] } }] }
                        : {})
                }
            },
            {
                $group: {
                    _id: null,
                    totalPaise: { $sum: { $ifNull: ['$amountPaise', 0] } },
                    payments: { $sum: 1 },
                    originalTotal: { $sum: { $ifNull: ['$pricing.originalPrice', 0] } }
                }
            }
        ])
    ]);

    const onboardingRow = onboardingEarningAgg?.[0] || {};
    const onboardingEarningTotal = Math.round(Number(onboardingRow.totalPaise || 0)) / 100;
    const onboardingEarning = {
        total: onboardingEarningTotal,
        payments: Number(onboardingRow.payments || 0),
        // Offer discount given away versus list price across these payments.
        discount: Math.max(0, Math.round((Number(onboardingRow.originalTotal || 0) - onboardingEarningTotal) * 100) / 100)
    };

    const onboardedByStatus = new Map((restaurantsOnboardedAgg || []).map((row) => [String(row._id || ''), Number(row.count || 0)]));
    const restaurantsOnboarded = {
        total: Array.from(onboardedByStatus.values()).reduce((sum, n) => sum + n, 0),
        live: onboardedByStatus.get('approved') || 0,
        inReview: onboardedByStatus.get('pending') || 0,
        paymentPending: onboardedByStatus.get('payment_pending') || 0,
        rejected: onboardedByStatus.get('rejected') || 0,
        banned: onboardedByStatus.get('banned') || 0
    };

    const liveSignals = [];
    
    (recentPendingRestaurants || []).forEach(r => {
        liveSignals.push({
            type: 'restaurant',
            title: 'New Restaurant Request',
            detail: `${r.restaurantName} is waiting for approval`,
            time: formatTimeAgo(r.createdAt),
            timestamp: r.createdAt
        });
    });

    (recentPendingDelivery || []).forEach(d => {
        liveSignals.push({
            type: 'delivery',
            title: 'New Delivery Partner',
            detail: `${d.name} requested to join`,
            time: formatTimeAgo(d.createdAt),
            timestamp: d.createdAt
        });
    });

    (recentPendingOrders || []).forEach(o => {
        liveSignals.push({
            type: 'order_pending',
            title: 'New Order Received',
            detail: `Order #${o.orderId} is pending`,
            time: formatTimeAgo(o.createdAt),
            timestamp: o.createdAt
        });
    });

    (recentDeliveredOrders || []).forEach(o => {
        liveSignals.push({
            type: 'order_delivered',
            title: 'Order Delivered',
            detail: `Order #${o.orderId} was successful`,
            time: formatTimeAgo(o.updatedAt),
            timestamp: o.updatedAt
        });
    });

    (recentCancelledOrders || []).forEach(o => {
        liveSignals.push({
            type: 'order_cancelled',
            title: 'Order Cancelled',
            detail: `Order #${o.orderId} was cancelled`,
            time: formatTimeAgo(o.updatedAt),
            timestamp: o.updatedAt
        });
    });

    (recentCustomers || []).forEach(c => {
        liveSignals.push({
            type: 'customer',
            title: 'New Customer',
            detail: `${c.name} just registered`,
            time: formatTimeAgo(c.createdAt),
            timestamp: c.createdAt
        });
    });

    // Sort by timestamp and take top 15
    liveSignals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const finalLiveSignals = liveSignals.slice(0, 15);

    let totals = orderTotalsAgg?.[0] || {};

    // IMPORTANT:
    // Gross revenue / fees must come from FoodOrder delivered rows (pricing.total, etc.).
    // Overwriting with FoodTransaction caused undercount (e.g. delivered GMV 5441 vs
    // ledger "captured" sum 4714) because:
    //  - COD txs can remain status "pending" if not synced on delivery
    //  - ledger enum has no "settled"; wrong fields were used for fee cards
    //    (platformFee mapped to platformNetProfit, deliveryFee to riderShare)
    // FoodOrder is what ops manually verify against delivered order totals.

    // Monthly chart: use FoodOrder delivered sums (same source as Gross revenue)
    const finalMonthlyAgg = monthlyAgg || [];

    const now = new Date();
    const monthlyMap = new Map(
        (finalMonthlyAgg || []).map((row) => {
            const key = `${row._id?.year}-${row._id?.month}`;
            return [key, row];
        })
    );

    const monthlyData = [];
    for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const key = `${year}-${month}`;
        const row = monthlyMap.get(key);
        monthlyData.push({
            month: formatMonthShort(year, month - 1),
            orders: Number(row?.orders || 0),
            revenue: Number(row?.revenue || 0),
            commission: Number(row?.commission || 0)
        });
    }

    const commissionTotal = Number(totals.commissionTotal || 0);
    const platformFeeTotal = Number(totals.platformFeeTotal || 0);
    const markupTotal = Number(totals.markupTotal || 0);
    const deliveryFeeTotal = Number(totals.deliveryFeeTotal || 0);
    const riderEarningTotal = Number(totals.riderEarningTotal || 0);
    const gstTotal = Number(totals.gstTotal || 0);
    // Delivery fee kept by platform after paying riders
    const deliveryProfit = Math.max(0, deliveryFeeTotal - riderEarningTotal);
    // Platform Total = Comm + Platform fee + Admin markup + Delivery net + GST
    const totalAdminEarnings =
        Math.round((commissionTotal + platformFeeTotal + markupTotal + deliveryProfit + gstTotal) * 100) / 100;

    return {
        orders: {
            total: Number(totals.totalOrders || 0),
            byStatus: {
                delivered: Number(totals.delivered || 0),
                cancelled: Number(totals.cancelled || 0),
                pending: Number(totals.dashboardPending || 0),
                processing: Number(totals.dashboardProcessing || 0),
                inTransit: Number(totals.dashboardInTransit || 0),
                refunded: Number(totals.refunded || 0)
            }
        },
        revenue: { total: Number(totals.revenueTotal || 0) },
        cod: {
            collected: Number(totals.codCollectedTotal || 0),
            open: Number(totals.codOpenTotal || 0),
            total: Number(totals.codCollectedTotal || 0) + Number(totals.codOpenTotal || 0),
            openOrders: Number(totals.codOpenOrders || 0),
            cashOrders: Number(totals.cashOrderCount || 0),
            onlineOrders: Number(totals.onlineOrderCount || 0)
        },
        commission: { total: commissionTotal },
        platformFee: { total: platformFeeTotal },
        markup: { total: markupTotal },
        deliveryFee: { total: deliveryFeeTotal },
        riderEarnings: { total: riderEarningTotal },
        deliveryBoyEarning: Number(totals.deliveryBoyEarningTotal || 0),
        restaurantEarning: Number(totals.restaurantEarningTotal || 0),
        onboardingEarning,
        gst: { total: gstTotal },
        totalAdminEarnings,
        deliveryProfit,
        restaurants: {
            total: Number(restaurantsTotal || 0),
            pendingRequests: Number(restaurantsPending || 0),
            onboarded: restaurantsOnboarded
        },
        deliveryBoys: {
            total: Number(deliveryTotal || 0),
            pendingRequests: Number(deliveryPending || 0)
        },
        foods: { total: Number(foodsTotal || 0) },
        addons: { total: Number(addonsTotal || 0) },
        customers: { total: Number(customersTotal || 0) },
        orderStats: {
            // Align with /admin/food/orders/pending (created + visible payment only).
            pending: Number(totals.dashboardPending || 0),
            processing: Number(totals.dashboardProcessing || 0),
            completed: Number(totals.delivered || 0)
        },
        monthlyData,
        liveSignals: finalLiveSignals
    };
}

function formatTimeAgo(date) {
    if (!date) return '';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + ' years ago';
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + ' months ago';
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + ' days ago';
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + ' hours ago';
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + ' minutes ago';
    return Math.floor(seconds) + ' seconds ago';
}


export async function getTransactionReport(query = {}) {
    const { fromDate, toDate, zone, restaurant, search, time } = query;
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 5000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const match = {};

    // Prefer explicit ISO range from client; else compute Asia/Kolkata ranges from `time`
    const timeLabel = String(time || '').trim().toLowerCase();
    if (fromDate && toDate) {
        match.createdAt = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    } else if (timeLabel && timeLabel !== 'all time' && timeLabel !== 'all') {
        const now = new Date();
        if (timeLabel === 'today') {
            match.createdAt = {
                $gte: toStartOfDayInTimeZone(now),
                $lte: toEndOfDayInTimeZone(now),
            };
        } else if (timeLabel === 'this week') {
            const range = getWeekRangeInTimeZone(now);
            match.createdAt = { $gte: range.start, $lte: range.end };
        } else if (timeLabel === 'this month') {
            const range = getMonthRangeInTimeZone(now);
            match.createdAt = { $gte: range.start, $lte: range.end };
        }
    }

    const searchRaw = String(search || '').trim().slice(0, 80);
    if (searchRaw) {
        const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escaped, 'i');
        const [matchedUsers, matchedRestaurants] = await Promise.all([
            FoodUser.find({
                $or: [{ name: searchRegex }, { phone: searchRegex }, { email: searchRegex }],
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
            { orderId: searchRegex },
            { order_id: searchRegex },
            { customerName: searchRegex },
        ];
        if (mongoose.Types.ObjectId.isValid(searchRaw)) {
            searchOr.push({ _id: new mongoose.Types.ObjectId(searchRaw) });
        }
        if (matchedUsers.length) {
            searchOr.push({ userId: { $in: matchedUsers.map((u) => u._id) } });
        }
        if (matchedRestaurants.length) {
            searchOr.push({ restaurantId: { $in: matchedRestaurants.map((r) => r._id) } });
        }
        match.$or = searchOr;
    }

    if ((zone && zone !== 'All Zones') || (restaurant && restaurant !== 'All restaurants')) {
        const restFilter = {};

        if (zone && zone !== 'All Zones') {
            if (mongoose.Types.ObjectId.isValid(zone)) {
                restFilter.zoneId = new mongoose.Types.ObjectId(zone);
            } else {
                const matchedZone = await FoodZone.findOne({
                    $or: [{ name: zone }, { zoneName: zone }]
                })
                    .select('_id')
                    .lean();
                if (matchedZone?._id) {
                    restFilter.zoneId = matchedZone._id;
                } else {
                    restFilter.zoneId = new mongoose.Types.ObjectId();
                }
            }
        }

        if (restaurant && restaurant !== 'All restaurants') {
            if (mongoose.Types.ObjectId.isValid(restaurant)) {
                restFilter._id = new mongoose.Types.ObjectId(restaurant);
            } else {
                const restDoc = await FoodRestaurant.findOne({ restaurantName: restaurant })
                    .select('_id')
                    .lean();
                if (restDoc) {
                    restFilter._id = restDoc._id;
                } else {
                    restFilter._id = new mongoose.Types.ObjectId();
                }
            }
        }

        const restaurantsList = await FoodRestaurant.find(restFilter).select('_id').lean();
        match.restaurantId = { $in: restaurantsList.map((r) => r._id) };
    }

    // Source of truth = FoodOrder (same as dashboard GMV). Ledger alone undercounted / drifted.
    const [orders, total, summaryOrders] = await Promise.all([
        FoodOrder.find(match)
            .populate('userId', 'name')
            .populate('restaurantId', 'restaurantName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodOrder.countDocuments(match),
        FoodOrder.find(match)
            .select('pricing orderStatus payment riderEarning dispatch.deliveryPartnerId')
            .lean(),
    ]);

    const orderIds = orders.map((o) => o._id).filter(Boolean);
    const txRows = orderIds.length
        ? await FoodTransaction.find({ orderId: { $in: orderIds } })
            .select('orderId status amounts payment')
            .lean()
        : [];
    const txByOrderId = new Map(txRows.map((t) => [String(t.orderId), t]));

    const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };

    const resolveDisplayStatus = (order, tx) => {
        const os = String(order?.orderStatus || '').toLowerCase();
        const pay = String(order?.payment?.status || tx?.payment?.status || '').toLowerCase();
        const txStatus = String(tx?.status || '').toLowerCase();

        // UI never shows ledger jargon like "captured" / "settled"
        if (pay === 'refunded' || txStatus === 'refunded') return 'Refunded';
        if (os === 'delivered') return 'Delivered';
        if (os.startsWith('cancelled')) return 'Cancelled';
        if (['preparing', 'ready_for_pickup', 'picked_up', 'out_for_delivery'].includes(os)) {
            return 'Processing';
        }
        if (['confirmed', 'accepted'].includes(os)) return 'Confirmed';
        if (
            pay === 'cod_pending' ||
            pay === 'created' ||
            pay === 'pending' ||
            txStatus === 'pending' ||
            os === 'created' ||
            os === 'pending'
        ) {
            return 'Pending';
        }
        // Paid online / wallet but not delivered yet — still in progress
        if (pay === 'paid' || pay === 'authorized' || txStatus === 'captured' || txStatus === 'settled') {
            return 'Processing';
        }
        if (os) {
            return os
                .split('_')
                .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
                .join(' ');
        }
        return 'Pending';
    };

    const transactions = orders.map((order) => {
        const pricing = order.pricing || {};
        const tx = txByOrderId.get(String(order._id));
        const subtotal = toNum(pricing.subtotal);
        const packagingFee = toNum(pricing.packagingFee);
        const deliveryFee = toNum(pricing.deliveryFee);
        const tax = toNum(pricing.tax);
        const discount = toNum(pricing.discount);
        const total = toNum(pricing.total);
        const platformFeeStored = pricing.platformFee;
        const platformFee =
            platformFeeStored !== undefined && platformFeeStored !== null
                ? toNum(platformFeeStored)
                : Math.max(0, total - subtotal - packagingFee - deliveryFee - tax + discount);

        return {
            id: order._id,
            orderId: order.orderId || 'N/A',
            restaurant: order.restaurantId?.restaurantName || 'N/A',
            restaurantId: order.restaurantId?._id || order.restaurantId || null,
            customerName: order.userId?.name || order.customerName || 'Guest',
            totalItemAmount: subtotal,
            restaurantBaseAmount: toNum(pricing.baseSubtotal ?? Math.max(0, subtotal - toNum(pricing.markupTotal))),
            adminMarkup: toNum(pricing.markupTotal),
            itemDiscount: discount,
            couponDiscount: discount,
            couponCode: pricing.couponCode || order.couponCode || null,
            referralDiscount: toNum(pricing.referralDiscount || order.referralDiscount),
            discountedAmount: Math.max(0, subtotal - discount),
            vatTax: tax,
            deliveryCharge: deliveryFee,
            platformFee,
            orderAmount: total,
            status: resolveDisplayStatus(order, tx),
            orderStatus: order.orderStatus || null,
            createdAt: order.createdAt || null,
        };
    });

    let completedTransaction = 0;
    let refundedTransaction = 0;
    let adminEarning = 0;
    let adminCommission = 0;
    let adminPlatformFee = 0;
    let adminMarkup = 0;
    let adminDeliveryNet = 0;
    let adminGst = 0;
    let restaurantEarning = 0;
    let deliverymanEarning = 0;
    const markupByRestaurantMap = new Map();

    for (const order of summaryOrders) {
        const pricing = order.pricing || {};
        const orderTotal = toNum(pricing.total);
        const commission = toNum(pricing.restaurantCommission);
        const platformFee = toNum(pricing.platformFee);
        const deliveryFee = toNum(pricing.deliveryFee);
        const tax = toNum(pricing.tax);
        const rider = toNum(order.riderEarning);
        const subtotal = toNum(pricing.subtotal);
        const baseSubtotal = toNum(pricing.baseSubtotal ?? pricing.subtotal);
        const markupTotal = toNum(pricing.markupTotal);
        const packaging = toNum(pricing.packagingFee);
        const os = String(order.orderStatus || '').toLowerCase();
        const pay = String(order?.payment?.status || '').toLowerCase();
        const deliveryNet = Math.max(0, deliveryFee - rider);
        const restaurantName = order.restaurantId?.restaurantName || 'Unknown';
        const restaurantKey = String(order.restaurantId?._id || order.restaurantId || restaurantName);

        if (os === 'delivered') {
            completedTransaction += orderTotal;
            // Align with dashboard Platform Total components
            adminEarning += commission + platformFee + markupTotal + deliveryNet + tax;
            adminCommission += commission;
            adminPlatformFee += platformFee;
            adminMarkup += markupTotal;
            adminDeliveryNet += deliveryNet;
            adminGst += tax;
            restaurantEarning += Math.max(0, baseSubtotal + packaging - commission);
            if (markupTotal > 0) {
                const prev = markupByRestaurantMap.get(restaurantKey) || {
                    restaurantId: restaurantKey,
                    restaurant: restaurantName,
                    adminMarkup: 0,
                    orders: 0,
                };
                prev.adminMarkup += markupTotal;
                prev.orders += 1;
                markupByRestaurantMap.set(restaurantKey, prev);
            }
            // Same as Delivery Earning page: delivered + assigned partner + riderEarning
            if (order?.dispatch?.deliveryPartnerId) {
                deliverymanEarning += rider;
            }
        }

        const method = String(order?.payment?.method || '').toLowerCase();
        const isCashCod =
            method === 'cash' ||
            method === 'cod' ||
            method === 'cash on delivery';
        // Real money refunds only (online/wallet). Never count COD cancels.
        const isActuallyRefunded = !isCashCod && pay === 'refunded';
        if (isActuallyRefunded) {
            refundedTransaction += orderTotal;
        }
    }

    return {
        transactions,
        summary: {
            completedTransaction: Math.round(completedTransaction * 100) / 100,
            refundedTransaction: Math.round(refundedTransaction * 100) / 100,
            // Same as dashboard "Platform Total"
            adminEarning: Math.round(adminEarning * 100) / 100,
            platformTotal: Math.round(adminEarning * 100) / 100,
            platformTotalBreakdown: {
                commission: Math.round(adminCommission * 100) / 100,
                platformFee: Math.round(adminPlatformFee * 100) / 100,
                markup: Math.round(adminMarkup * 100) / 100,
                deliveryNet: Math.round(adminDeliveryNet * 100) / 100,
                gst: Math.round(adminGst * 100) / 100,
            },
            adminMarkupTotal: Math.round(adminMarkup * 100) / 100,
            markupByRestaurant: [...markupByRestaurantMap.values()]
                .map((row) => ({
                    ...row,
                    adminMarkup: Math.round(row.adminMarkup * 100) / 100,
                }))
                .sort((a, b) => b.adminMarkup - a.adminMarkup),
            restaurantEarning: Math.round(restaurantEarning * 100) / 100,
            deliverymanEarning: Math.round(deliverymanEarning * 100) / 100,
        },
        meta: {
            orderCount: orders.length,
            source: 'food_orders',
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
        },
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
        },
    };
}

export async function getRestaurantReport(query = {}) {
    const parseTimeRange = (timeLabel) => {
        const now = new Date();
        const start = new Date(now);
        const end = new Date(now);

        const value = String(timeLabel || '').trim().toLowerCase();
        if (!value || value === 'all time') return null;

        if (value === 'today') {
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        if (value === 'this week') {
            const day = start.getDay(); // 0=Sun
            const diffToMonday = day === 0 ? 6 : day - 1;
            start.setDate(start.getDate() - diffToMonday);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        if (value === 'this month') {
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        if (value === 'this year') {
            start.setMonth(0, 1);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        return null;
    };

    const formatCurrency = (value) => `\u20B9${Number(value || 0).toFixed(2)}`;

    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 5000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const restaurantFilter = {};
    const allFilter = String(query.all || '').trim().toLowerCase();
    if (allFilter === 'active') {
        restaurantFilter.status = 'approved';
    } else if (allFilter === 'inactive') {
        restaurantFilter.status = { $ne: 'approved' };
    }

    const zoneRaw = String(query.zone || '').trim();
    if (zoneRaw) {
        if (mongoose.Types.ObjectId.isValid(zoneRaw)) {
            restaurantFilter.zoneId = new mongoose.Types.ObjectId(zoneRaw);
        } else {
            const matchedZone = await FoodZone.findOne({
                $or: [{ name: zoneRaw }, { zoneName: zoneRaw }]
            })
                .select('_id')
                .lean();
            if (matchedZone?._id) {
                restaurantFilter.zoneId = matchedZone._id;
            } else {
                return { restaurants: [], total: 0, page, limit };
            }
        }
    }

    const typeRaw = String(query.type || '').trim().toLowerCase();
    if (typeRaw === 'commission') {
        const commissionRows = await FoodRestaurantCommission.find({ status: { $ne: false } })
            .select('restaurantId')
            .lean();
        const commissionRestaurantIds = commissionRows
            .map((row) => row?.restaurantId)
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        if (!commissionRestaurantIds.length) {
            return { restaurants: [], total: 0, page, limit };
        }
        restaurantFilter._id = { $in: commissionRestaurantIds };
    }

    const searchRaw = String(query.search || '').trim();
    if (searchRaw) {
        const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        restaurantFilter.$or = [
            { restaurantName: { $regex: escaped, $options: 'i' } },
            { ownerName: { $regex: escaped, $options: 'i' } },
            { ownerPhone: { $regex: escaped, $options: 'i' } },
            { city: { $regex: escaped, $options: 'i' } },
            { area: { $regex: escaped, $options: 'i' } }
        ];
    }

    const [restaurantDocs, total] = await Promise.all([
        FoodRestaurant.find(restaurantFilter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('restaurantName profileImage rating totalRatings status zoneId')
            .populate('zoneId', 'name zoneName')
            .lean(),
        FoodRestaurant.countDocuments(restaurantFilter)
    ]);

    const restaurantIds = restaurantDocs.map((r) => r._id).filter(Boolean);
    if (!restaurantIds.length) {
        return { restaurants: [], total, page, limit };
    }

    const CANCELLED_ORDER_STATUSES = [
        'cancelled_by_user',
        'cancelled_by_restaurant',
        'cancelled_by_admin',
        'cancelled'
    ];

    const orderCreatedAtFilter = parseTimeRange(query.time);
    const orderMatch = {
        restaurantId: { $in: restaurantIds },
        orderStatus: {
            $nin: CANCELLED_ORDER_STATUSES,
            $not: /cancel/i
        },
        $or: [
            { "payment.method": { $in: ["cash", "wallet"] } },
            { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
        ],
    };
    if (orderCreatedAtFilter) {
        orderMatch.createdAt = orderCreatedAtFilter;
    }

    const [foodsAgg, ordersAgg] = await Promise.all([
        FoodItem.aggregate([
            {
                $match: {
                    restaurantId: { $in: restaurantIds },
                    approvalStatus: 'approved'
                }
            },
            {
                $group: {
                    _id: '$restaurantId',
                    totalFood: { $sum: 1 }
                }
            }
        ]),
        FoodOrder.aggregate([
            { $match: orderMatch },
            {
                $group: {
                    _id: '$restaurantId',
                    totalOrder: { $sum: 1 },
                    totalOrderAmount: { $sum: { $ifNull: ['$pricing.total', 0] } },
                    totalDiscountGiven: { $sum: { $ifNull: ['$pricing.discount', 0] } },
                    totalVATTAX: { $sum: { $ifNull: ['$pricing.tax', 0] } },
                    totalAdminCommissionFromPricing: { $sum: { $ifNull: ['$pricing.restaurantCommission', 0] } },
                    totalAdminCommissionFromPlatformProfit: { $sum: { $ifNull: ['$platformProfit', 0] } },
                    totalAdminCommissionFromPlatformFee: { $sum: { $ifNull: ['$pricing.platformFee', 0] } }
                }
            }
        ])
    ]);

    const foodMap = new Map(foodsAgg.map((x) => [String(x._id), Number(x.totalFood || 0)]));
    const orderMap = new Map(
        ordersAgg.map((x) => [
            String(x._id),
            {
                totalOrder: Number(x.totalOrder || 0),
                totalOrderAmount: Number(x.totalOrderAmount || 0),
                totalDiscountGiven: Number(x.totalDiscountGiven || 0),
                totalVATTAX: Number(x.totalVATTAX || 0),
                totalAdminCommission:
                    Number(x.totalAdminCommissionFromPricing || 0) > 0
                        ? Number(x.totalAdminCommissionFromPricing || 0)
                        : Number(x.totalAdminCommissionFromPlatformProfit || 0) > 0
                            ? Number(x.totalAdminCommissionFromPlatformProfit || 0)
                            : Number(x.totalAdminCommissionFromPlatformFee || 0)
            }
        ])
    );

    const restaurants = restaurantDocs.map((restaurant, index) => {
        const key = String(restaurant._id);
        const counts = orderMap.get(key) || {
            totalOrder: 0,
            totalOrderAmount: 0,
            totalDiscountGiven: 0,
            totalVATTAX: 0,
            totalAdminCommission: 0
        };

        return {
            _id: restaurant._id,
            sl: skip + index + 1,
            icon: restaurant.profileImage || '',
            restaurantName: restaurant.restaurantName || '',
            totalFood: foodMap.get(key) || 0,
            totalOrder: counts.totalOrder,
            totalOrderAmount: formatCurrency(counts.totalOrderAmount),
            totalDiscountGiven: formatCurrency(counts.totalDiscountGiven),
            totalAdminCommission: formatCurrency(counts.totalAdminCommission),
            totalVATTAX: formatCurrency(counts.totalVATTAX),
            averageRatings: Number(restaurant.rating || 0),
            reviews: Number(restaurant.totalRatings || 0),
            status: restaurant.status || 'pending',
            zoneName: restaurant.zoneId?.name || restaurant.zoneId?.zoneName || ''
        };
    });

    return { restaurants, total, page, limit };
}

export async function getTaxReport(query = {}) {
    const { fromDate, toDate, search } = query;
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 5000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const match = {
        orderStatus: 'delivered' // Typically tax is reported on delivered/completed orders
    };

    if (fromDate && toDate) {
        match.createdAt = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    }

    const searchRaw = String(search || '').trim().slice(0, 80);
    const pipeline = [
        { $match: match },
        {
            $group: {
                _id: '$restaurantId',
                totalIncome: { $sum: { $ifNull: ['$pricing.total', 0] } },
                totalTax: { $sum: { $ifNull: ['$pricing.tax', 0] } },
                orderCount: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: 'food_restaurants',
                localField: '_id',
                foreignField: '_id',
                as: 'restaurant'
            }
        },
        { $unwind: { path: '$restaurant', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                incomeSource: { $ifNull: ['$restaurant.restaurantName', 'Unknown Restaurant'] },
                totalIncome: 1,
                totalTax: 1,
                orderCount: 1
            }
        },
    ];

    if (searchRaw) {
        const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pipeline.push({
            $match: {
                incomeSource: { $regex: escaped, $options: 'i' },
            },
        });
    }

    pipeline.push(
        { $sort: { totalTax: -1 } },
        {
            $facet: {
                rows: [{ $skip: skip }, { $limit: limit }],
                totals: [
                    {
                        $group: {
                            _id: null,
                            count: { $sum: 1 },
                            totalIncome: { $sum: '$totalIncome' },
                            totalTax: { $sum: '$totalTax' },
                        },
                    },
                ],
            },
        }
    );

    const [facet] = await FoodOrder.aggregate(pipeline);
    const taxData = facet?.rows || [];
    const totals = facet?.totals?.[0] || { count: 0, totalIncome: 0, totalTax: 0 };

    const reports = taxData.map((item, index) => ({
        sl: skip + index + 1,
        id: item._id,
        incomeSource: item.incomeSource,
        totalIncome: `\u20B9${Number(item.totalIncome || 0).toFixed(2)}`,
        totalTax: `\u20B9${Number(item.totalTax || 0).toFixed(2)}`,
        orderCount: item.orderCount
    }));

    return {
        reports,
        stats: {
            totalIncome: `\u20B9${Number(totals.totalIncome || 0).toFixed(2)}`,
            totalTax: `\u20B9${Number(totals.totalTax || 0).toFixed(2)}`
        },
        pagination: {
            page,
            limit,
            total: Number(totals.count || 0),
            totalPages: Math.ceil(Number(totals.count || 0) / limit) || 1,
        },
    };
}

export async function getTaxReportDetail(restaurantId, query = {}) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Invalid restaurant ID');
    }

    const { fromDate, toDate } = query;
    const match = {
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        orderStatus: 'delivered'
    };

    if (fromDate && toDate) {
        match.createdAt = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    }

    const orders = await FoodOrder.find(match)
        .select('orderId pricing createdAt orderStatus')
        .sort({ createdAt: -1 })
        .lean();

    const restaurant = await FoodRestaurant.findById(restaurantId).select('restaurantName').lean();

    return {
        restaurantName: restaurant?.restaurantName || 'Unknown Restaurant',
        orders: orders.map(o => ({
            id: o._id,
            orderId: o.orderId,
            totalAmount: `\u20B9${(o.pricing?.total || 0).toFixed(2)}`,
            taxAmount: `\u20B9${(o.pricing?.tax || 0).toFixed(2)}`,
            date: o.createdAt
        }))
    };
}

// ----- Customers / Users (admin) -----
export async function getCustomers(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { role: 'USER' };

    if (query.status) {
        if (String(query.status) === 'active') filter.isActive = true;
        if (String(query.status) === 'inactive') filter.isActive = false;
    }

    if (query.joiningDate && String(query.joiningDate).trim()) {
        const d = new Date(String(query.joiningDate));
        if (!Number.isNaN(d.getTime())) {
            const start = new Date(d);
            start.setHours(0, 0, 0, 0);
            const end = new Date(d);
            end.setHours(23, 59, 59, 999);
            filter.createdAt = { $gte: start, $lte: end };
        }
    }

    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { name: { $regex: term, $options: 'i' } },
            { email: { $regex: term, $options: 'i' } },
            { phone: { $regex: term, $options: 'i' } }
        ];
    }

    const sort = {};
    const sortBy = String(query.sortBy || '').trim();
    if (sortBy === 'name-asc') sort.name = 1;
    else if (sortBy === 'name-desc') sort.name = -1;
    else sort.createdAt = -1;

    const [docs, total] = await Promise.all([
        FoodUser.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .select('name email phone countryCode isVerified isActive isCodBlocked createdAt profileImage')
            .lean(),
        FoodUser.countDocuments(filter)
    ]);

    const sanitizeUrl = (s) => {
        if (!s) return '';
        const str = String(s).trim();
        return str.replace(/^`+|`+$/g, '').trim();
    };

    const userIds = docs.map((u) => u._id).filter(Boolean);
    const orderStats = userIds.length > 0
        ? await FoodOrder.aggregate([
            { $match: { userId: { $in: userIds } } },
            {
                $group: {
                    _id: '$userId',
                    totalOrder: { $sum: 1 },
                    totalOrderAmount: { $sum: { $ifNull: ['$pricing.total', 0] } }
                }
            }
        ])
        : [];

    const orderStatsMap = new Map(
        orderStats.map((x) => [
            String(x._id),
            {
                totalOrder: Number(x.totalOrder || 0),
                totalOrderAmount: Number(x.totalOrderAmount || 0)
            }
        ])
    );

    let customers = docs.map((u) => {
        const stats = orderStatsMap.get(String(u._id)) || { totalOrder: 0, totalOrderAmount: 0 };
        return ({
        id: u._id,
        _id: u._id,
        name: u.name || 'Unnamed',
        email: u.email || '',
        phone: u.phone || '',
        profileImage: sanitizeUrl(u.profileImage || ''),
        countryCode: u.countryCode || '+91',
        status: u.isActive !== false,
        isActive: u.isActive !== false,
        isVerified: u.isVerified === true,
        isCodBlocked: u.isCodBlocked === true,
        totalOrder: stats.totalOrder,
        totalOrderAmount: stats.totalOrderAmount,
        joiningDate: u.createdAt,
        createdAt: u.createdAt
        });
    });

    const chooseFirst = parseInt(query.chooseFirst, 10);
    if (Number.isFinite(chooseFirst) && chooseFirst > 0) {
        customers = customers.slice(0, chooseFirst);
    }

    return { customers, total, page, limit };
}

export async function getCustomerById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const u = await FoodUser.findById(id).select('-__v').lean();
    if (!u) return null;
    const customerObjectId = new mongoose.Types.ObjectId(id);
    const orderStats = await FoodOrder.aggregate([
        { $match: { userId: customerObjectId } },
        {
            $group: {
                _id: '$userId',
                totalOrders: { $sum: 1 },
                totalOrderAmount: { $sum: { $ifNull: ['$pricing.total', 0] } },
                totalDeliveredOrders: {
                    $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] }
                },
                totalCancelledOrders: {
                    $sum: {
                        $cond: [{
                            $in: ['$orderStatus', [
                                'cancelled_by_user',
                                'cancelled_by_restaurant',
                                'cancelled_by_admin'
                            ]]
                        }, 1, 0]
                    }
                }
            }
        }
    ]);
    const stats = orderStats?.[0] || {};
    const sanitizeUrl = (s) => {
        if (!s) return '';
        const str = String(s).trim();
        return str.replace(/^`+|`+$/g, '').trim();
    };
    let walletBalance = 0;
    try {
        const wallet = await getUserWallet(id);
        walletBalance = Number(wallet?.balance) || 0;
    } catch (err) {
        logger.warn?.('getCustomerById: failed to load wallet balance', { id, error: err?.message });
    }
    return {
        id: u._id,
        _id: u._id,
        name: u.name || 'Unnamed',
        email: u.email || '',
        phone: u.phone || '',
        profileImage: sanitizeUrl(u.profileImage || ''),
        countryCode: u.countryCode || '+91',
        status: u.isActive !== false,
        isActive: u.isActive !== false,
        isVerified: u.isVerified === true,
        isCodBlocked: u.isCodBlocked === true,
        totalOrders: Number(stats.totalOrders || 0),
        totalOrder: Number(stats.totalOrders || 0),
        totalOrderAmount: Number(stats.totalOrderAmount || 0),
        totalDeliveredOrders: Number(stats.totalDeliveredOrders || 0),
        totalCancelledOrders: Number(stats.totalCancelledOrders || 0),
        walletBalance,
        joiningDate: u.createdAt,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
    };
}

/**
 * Admin add/deduct money from a customer's food wallet. Wraps the user
 * wallet service so the admin side gets its own audit trail (adminId +
 * reason) in the transaction metadata without touching wallet internals.
 */
export async function adjustCustomerWallet(id, { type, amount, reason } = {}, adminUser = null) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid customer id');
    }
    const normalizedType = String(type || '').toLowerCase();
    if (!['credit', 'debit'].includes(normalizedType)) {
        throw new ValidationError('type must be "credit" or "debit"');
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new ValidationError('Amount must be greater than 0');
    }

    const customer = await FoodUser.findById(id).select('name email phone').lean();
    if (!customer) throw new NotFoundError('Customer not found');

    const metadata = {
        source: 'admin_adjustment',
        adminId: adminUser?.id || adminUser?._id || null,
        adminName: adminUser?.name || adminUser?.email || null,
        reason: reason ? String(reason).trim() : ''
    };

    const trimmedReason = reason ? String(reason).trim() : '';
    const description = trimmedReason
        ? `Admin ${normalizedType === 'credit' ? 'credit' : 'deduction'} - ${trimmedReason}`
        : `Admin ${normalizedType === 'credit' ? 'credit' : 'deduction'}`;

    const result = normalizedType === 'credit'
        ? await creditWalletBalance(id, numericAmount, description, metadata)
        : await deductWalletBalance(id, numericAmount, description, metadata);

    return { customer, wallet: result.wallet };
}

export async function updateCustomerStatus(id, isActive) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const updatedDoc = await FoodUser.findByIdAndUpdate(
        id,
        // deletedAt marks a self-deleted account that may be restored at sign-in.
        // An admin decision replaces it, so a blocked account can never be "restored".
        { $set: { isActive: Boolean(isActive), deletedAt: null } },
        { new: true }
    );
    if (!updatedDoc) return null;
    const updated = updatedDoc.toObject();
    if (updated.isActive === false) {
        await FoodRefreshToken.deleteMany({ userId: updated._id });
    }
    return updated;
}

export async function updateCustomerCodStatus(id, isCodBlocked) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const updatedDoc = await FoodUser.findByIdAndUpdate(
        id,
        { $set: { isCodBlocked: Boolean(isCodBlocked) } },
        { new: true }
    );
    if (!updatedDoc) return null;
    return updatedDoc.toObject();
}

/**
 * Push "your account was deleted" to the account's devices. Admin deletions used
 * to send only an email (and nothing when no email was on file), so restaurants,
 * customers and riders just found themselves signed out. Must run BEFORE the
 * device tokens are removed with the account.
 */
async function notifyAccountDeletedByAdmin(ownerType, ownerId, accountLabel) {
    try {
        const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnersSafely([{ ownerType, ownerId: String(ownerId) }], {
            title: 'Account deleted',
            body: `Your Eatiefy ${accountLabel} account has been deleted by the admin. Please contact support if you think this is a mistake.`,
            idempotencyKey: `account_deleted_${ownerType}_${ownerId}`,
            data: {
                type: 'account_deleted',
                ownerType,
                ownerId: String(ownerId)
            }
        });
    } catch (err) {
        logger.warn(`[ADMIN-DELETE] Push to ${ownerType} ${ownerId} failed: ${err?.message || err}`);
    }
}

export async function deleteCustomer(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const user = await FoodUser.findById(id).lean();
    if (!user) return null;

    const recipientEmail = user.email;
    const recipientName = user.name || 'User';

    await notifyAccountDeletedByAdmin('USER', user._id, 'customer');

    if (recipientEmail) {
        try {
            const { sendAccountDeletionEmail } = await import('../../../../utils/email.js');
            await sendAccountDeletionEmail({
                to: recipientEmail,
                name: recipientName,
                accountType: 'User',
                details: [
                    ...(user.phone ? [{ label: 'Registered Phone', value: user.phone }] : [])
                ]
            });
        } catch (emailErr) {
            logger.error(`[DELETE-EMAIL] User ${id} deletion email failed for ${recipientEmail}: ${emailErr?.message || emailErr}`);
        }
    }

    await FoodUser.updateOne(
        { _id: id },
        { isActive: false, deletedAt: new Date(), fcmTokens: [], fcmTokenMobile: [] }
    );
    await FoodRefreshToken.deleteMany({ userId: id });

    return { id: user._id, name: recipientName, email: recipientEmail };
}

export async function getSupportTickets(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const source = String(query.source || 'all').toLowerCase();
    const search = String(query.search || '').trim();

    const userFilter = {};
    const restaurantFilter = {};
    if (query.status && ['open', 'in-progress', 'resolved'].includes(String(query.status))) {
        userFilter.status = String(query.status);
        restaurantFilter.status = String(query.status);
    }
    if (query.type && ['order', 'restaurant', 'other'].includes(String(query.type))) {
        userFilter.type = String(query.type);
    }
    if (query.category && ['orders', 'payments', 'menu', 'restaurant', 'technical', 'other'].includes(String(query.category))) {
        restaurantFilter.category = String(query.category);
    }

    const userSearchOr = [];
    const restaurantSearchOr = [];
    if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        userSearchOr.push(
            { issueType: searchRegex },
            { description: searchRegex }
        );
        restaurantSearchOr.push(
            { issueType: searchRegex },
            { subject: searchRegex },
            { description: searchRegex },
            { orderRef: searchRegex }
        );
        const [restaurantIds, userIds, orderIds] = await Promise.all([
            FoodRestaurant.find({ restaurantName: searchRegex }).select('_id').lean(),
            FoodUser.find({ name: searchRegex }).select('_id').lean(),
            FoodOrder.find({ orderId: searchRegex }).select('_id').lean()
        ]);
        if (restaurantIds.length) {
            const ids = restaurantIds.map((r) => r._id);
            userSearchOr.push({ restaurantId: { $in: ids } });
            restaurantSearchOr.push({ restaurantId: { $in: ids } });
        }
        if (userIds.length) {
            userSearchOr.push({ userId: { $in: userIds.map((u) => u._id) } });
        }
        if (orderIds.length) {
            userSearchOr.push({ orderId: { $in: orderIds.map((o) => o._id) } });
        }
    }
    if (userSearchOr.length) userFilter.$or = userSearchOr;
    if (restaurantSearchOr.length) restaurantFilter.$or = restaurantSearchOr;

    const shouldFetchUser = source === 'all' || source === 'user';
    const shouldFetchRestaurant = source === 'all' || source === 'restaurant';

    const [userList, userTotal, restaurantList, restaurantTotal] = await Promise.all([
        shouldFetchUser
            ? FoodSupportTicket.find(userFilter)
                  .sort({ createdAt: -1 })
                  .skip(source === 'all' ? 0 : skip)
                  .limit(source === 'all' ? limit * page : limit)
                  .populate('userId', 'name phone email')
                  .populate('restaurantId', 'restaurantName city area')
                  .populate({
                      path: 'orderId',
                      select: 'restaurantId',
                      populate: { path: 'restaurantId', select: 'restaurantName city area' }
                  })
                  .lean()
            : Promise.resolve([]),
        shouldFetchUser ? FoodSupportTicket.countDocuments(userFilter) : Promise.resolve(0),
        shouldFetchRestaurant
            ? FoodRestaurantSupportTicket.find(restaurantFilter)
                  .sort({ createdAt: -1 })
                  .skip(source === 'all' ? 0 : skip)
                  .limit(source === 'all' ? limit * page : limit)
                  .populate('restaurantId', 'restaurantName city area')
                  .lean()
            : Promise.resolve([]),
        shouldFetchRestaurant ? FoodRestaurantSupportTicket.countDocuments(restaurantFilter) : Promise.resolve(0)
    ]);

    const mappedUserTickets = userList.map((t) => {
        const user =
            t.userId && typeof t.userId === 'object' && t.userId !== null
                ? {
                      _id: t.userId._id,
                      name: t.userId.name || '',
                      phone: t.userId.phone || '',
                      email: t.userId.email || ''
                  }
                : null;
        const userId =
            t.userId && typeof t.userId === 'object' && t.userId !== null ? String(t.userId._id) : String(t.userId);

        let restaurantDoc = null;
        if (t.restaurantId && typeof t.restaurantId === 'object' && t.restaurantId !== null) {
            restaurantDoc = t.restaurantId;
        } else if (t.orderId && typeof t.orderId === 'object' && t.orderId !== null) {
            const rid = t.orderId.restaurantId;
            if (rid && typeof rid === 'object' && rid !== null) {
                restaurantDoc = rid;
            }
        }

        const restaurant =
            restaurantDoc && typeof restaurantDoc === 'object'
                ? {
                      _id: restaurantDoc._id,
                      name: restaurantDoc.restaurantName || '',
                      city: restaurantDoc.city || '',
                      area: restaurantDoc.area || ''
                  }
                : null;

        const restaurantId =
            restaurant && restaurant._id
                ? String(restaurant._id)
                : t.restaurantId
                ? String(t.restaurantId)
                : t.orderId && typeof t.orderId === 'object' && t.orderId !== null && t.orderId.restaurantId
                ? String(t.orderId.restaurantId)
                : null;

        const restaurantName = restaurant ? restaurant.name : '';

        return {
            _id: t._id,
            source: 'user',
            userId,
            type: t.type,
            orderId: t.orderId || null,
            restaurantId,
            issueType: t.issueType,
            description: t.description,
            status: t.status,
            adminResponse: t.adminResponse,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            user,
            restaurant,
            restaurantName
        };
    });

    const mappedRestaurantTickets = restaurantList.map((t) => {
        const restaurant =
            t.restaurantId && typeof t.restaurantId === 'object'
                ? {
                      _id: t.restaurantId._id,
                      name: t.restaurantId.restaurantName || '',
                      city: t.restaurantId.city || '',
                      area: t.restaurantId.area || ''
                  }
                : null;
        const restaurantId =
            restaurant && restaurant._id ? String(restaurant._id) : t.restaurantId ? String(t.restaurantId) : null;
        return {
            _id: t._id,
            source: 'restaurant',
            userId: null,
            type: 'restaurant-support',
            category: t.category || 'other',
            orderId: null,
            orderRef: t.orderRef || '',
            restaurantId,
            issueType: t.issueType,
            subject: t.subject || '',
            description: t.description,
            priority: t.priority || 'medium',
            status: t.status,
            adminResponse: t.adminResponse,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            user: null,
            restaurant,
            restaurantName: restaurant ? restaurant.name : ''
        };
    });

    let tickets = [];
    let total = 0;
    if (source === 'user') {
        tickets = mappedUserTickets;
        total = userTotal;
    } else if (source === 'restaurant') {
        tickets = mappedRestaurantTickets;
        total = restaurantTotal;
    } else {
        const merged = [...mappedUserTickets, ...mappedRestaurantTickets].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        tickets = merged.slice(skip, skip + limit);
        total = userTotal + restaurantTotal;
    }

    // The admin UI renders its status control from this list, so it can only
    // ever offer moves the backend will accept.
    tickets = tickets.map((ticket) => ({
        ...ticket,
        allowedStatusTransitions: getAllowedTicketTransitions('standard', ticket.status)
    }));

    return { tickets, total, page, limit };
}

export async function updateSupportTicket(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const source = String(body.source || 'user').toLowerCase();
    const model = source === 'restaurant' ? FoodRestaurantSupportTicket : FoodSupportTicket;

    // Read the stored status first: a transition can only be judged against
    // what is actually persisted, not against what the client believes.
    const current = await model.findById(id).select('status').lean();
    if (!current) return null;

    const set = {};
    if (body.status !== undefined && body.status !== null && String(body.status) !== '') {
        assertTicketStatusTransition('standard', current.status, body.status);
        set.status = String(body.status);
    }
    if (typeof body.adminResponse === 'string') {
        set.adminResponse = body.adminResponse;
    }
    if (!Object.keys(set).length) return null;

    const updated = await model.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
    if (!updated) return null;
    return {
        ...updated,
        source: source === 'restaurant' ? 'restaurant' : 'user',
        allowedStatusTransitions: getAllowedTicketTransitions('standard', updated.status)
    };
}

// ----- Restaurant Commission (admin) -----
export async function getRestaurantCommissions(query = {}) {
    const filter = {};
    const zoneOid = parseZoneFilter(query.zoneId);
    if (zoneOid) filter.restaurantId = { $in: await getRestaurantIdsInZone(zoneOid) };

    const list = await FoodRestaurantCommission.find(filter)
        .sort({ createdAt: -1 })
        .populate({
            path: 'restaurantId',
            select: 'restaurantName zoneId',
            populate: { path: 'zoneId', select: 'name zoneName' }
        })
        .lean();

    const commissions = list.map((c, index) => {
        const mongoRestaurantId = c.restaurantId?._id ? String(c.restaurantId._id) : String(c.restaurantId || '');
        const zone = c.restaurantId?.zoneId;
        return {
        _id: c._id,
        sl: index + 1,
        restaurantId: toRestaurantDisplayId(mongoRestaurantId),
        restaurantName: c.restaurantId?.restaurantName || '',
        zoneId: zone?._id ? String(zone._id) : null,
        zoneName: zone?.name || zone?.zoneName || '',
        restaurant: mongoRestaurantId
            ? {
                _id: mongoRestaurantId,
                name: c.restaurantId?.restaurantName || '',
                restaurantId: toRestaurantDisplayId(mongoRestaurantId),
            }
            : null,
        defaultCommission: c.defaultCommission || { type: 'percentage', value: 0 },
        notes: c.notes || '',
        status: c.status !== false
    };
    });

    return { commissions };
}

export async function getRestaurantCommissionBootstrap(query = {}) {
    const zoneId = query.zoneId;
    const [commissionsData, restaurantsData] = await Promise.all([
        getRestaurantCommissions({ zoneId }),
        getRestaurants({ status: 'approved', limit: 1000, page: 1, zoneId })
    ]);

    const commissionByRestaurantId = new Set(
        (commissionsData.commissions || [])
            .map((c) => String(c.restaurant?._id || ''))
            .filter(Boolean)
    );

    const restaurants = (restaurantsData.restaurants || []).map((r) => ({
        _id: r._id,
        name: r.restaurantName || r.name || '',
        restaurantId: toRestaurantDisplayId(r._id),
        ownerName: r.ownerName || '',
        zoneName: r.zoneId?.name || r.zoneId?.zoneName || '',
        hasCommissionSetup: commissionByRestaurantId.has(String(r._id))
    }));

    return { commissions: commissionsData.commissions || [], restaurants };
}

export async function getRestaurantCommissionById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurantCommission.findById(id)
        .populate({ path: 'restaurantId', select: 'restaurantName' })
        .lean();
    if (!doc) return null;
    const mongoRestaurantId = doc.restaurantId?._id ? String(doc.restaurantId._id) : String(doc.restaurantId || '');
    return {
        _id: doc._id,
        restaurantId: toRestaurantDisplayId(mongoRestaurantId),
        restaurant: mongoRestaurantId
            ? {
                _id: mongoRestaurantId,
                name: doc.restaurantId?.restaurantName || '',
                restaurantId: toRestaurantDisplayId(mongoRestaurantId),
            }
            : null,
        restaurantName: doc.restaurantId?.restaurantName || '',
        defaultCommission: doc.defaultCommission || { type: 'percentage', value: 0 },
        notes: doc.notes || '',
        status: doc.status !== false
    };
}

export async function createRestaurantCommission(body) {
    const exists = await FoodRestaurantCommission.findOne({ restaurantId: body.restaurantId }).lean();
    if (exists) {
        throw new ValidationError('Commission already exists for this restaurant');
    }
    const created = await FoodRestaurantCommission.create({
        restaurantId: body.restaurantId,
        defaultCommission: body.defaultCommission || { type: 'percentage', value: 0 },
        notes: body.notes || '',
        status: true
    });
    invalidateRestaurantCommissionRulesCache();
    return created.toObject();
}

export async function updateRestaurantCommission(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const updated = await FoodRestaurantCommission.findByIdAndUpdate(
        id,
        { $set: { defaultCommission: body.defaultCommission, notes: body.notes || '' } },
        { new: true }
    ).lean();
    invalidateRestaurantCommissionRulesCache();
    return updated;
}

export async function deleteRestaurantCommission(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodRestaurantCommission.findByIdAndDelete(id).lean();
    invalidateRestaurantCommissionRulesCache();
    return deleted ? { id } : null;
}

export async function toggleRestaurantCommissionStatus(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurantCommission.findById(id);
    if (!doc) return null;
    doc.status = !Boolean(doc.status);
    await doc.save();
    invalidateRestaurantCommissionRulesCache();
    return doc.toObject();
}

// ----- Delivery Boy Commission Rule (admin) -----
function requireValidZoneId(zoneId) {
    const raw = zoneId != null ? String(zoneId).trim() : '';
    if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
        throw new ValidationError('zoneId is required');
    }
    return raw;
}

export async function getDeliveryCommissionRules(zoneId) {
    const zid = requireValidZoneId(zoneId);
    const list = await FoodDeliveryCommissionRule.find({ zoneId: zid })
        .sort({ createdAt: -1 })
        .lean();
    const commissions = list.map((r, index) => ({
        _id: r._id,
        sl: index + 1,
        zoneId: r.zoneId,
        name: r.name || '',
        minDistance: r.minDistance,
        maxDistance: r.maxDistance ?? null,
        commissionPerKm: r.commissionPerKm,
        basePayout: r.basePayout,
        status: r.status !== false
    }));
    return { commissions };
}

function validateCommissionRuleSet(rules) {
    const active = (rules || []).filter((r) => r && r.status !== false);
    if (!active.length) {
        throw new ValidationError('A base slab with minDistance = 0 is required');
    }
    const baseRules = active.filter((r) => Number(r.minDistance || 0) === 0);
    if (baseRules.length !== 1) {
        throw new ValidationError('A base slab with minDistance = 0 is required');
    }
    const sorted = [...active].sort((a, b) => Number(a.minDistance || 0) - Number(b.minDistance || 0));
    for (let i = 0; i < sorted.length; i += 1) {
        const current = sorted[i];
        const min = Number(current.minDistance || 0);
        const max = current.maxDistance == null ? null : Number(current.maxDistance);
        if (max != null && max <= min) {
            throw new ValidationError('maxDistance must be greater than minDistance');
        }
        if (i > 0) {
            const prev = sorted[i - 1];
            const prevMin = Number(prev.minDistance || 0);
            const prevMax = prev.maxDistance == null ? null : Number(prev.maxDistance);
            const effectivePrevMax = prevMax == null ? Infinity : prevMax;
            if (min < effectivePrevMax) {
                throw new ValidationError('Distance slabs must not overlap');
            }
            if (min === prevMin) {
                throw new ValidationError('Distance slabs must not share the same minDistance');
            }
        }
    }
}

export async function createDeliveryCommissionRule(body) {
    const zid = requireValidZoneId(body.zoneId);
    const zoneExists = await FoodZone.exists({ _id: zid });
    if (!zoneExists) throw new ValidationError('Invalid zoneId');

    const existing = await FoodDeliveryCommissionRule.find({ zoneId: zid }).lean();
    const candidate = [
        ...existing,
        {
            minDistance: body.minDistance,
            maxDistance: body.maxDistance ?? null,
            commissionPerKm: body.commissionPerKm,
            basePayout: body.basePayout,
            status: body.status ?? true
        }
    ];
    validateCommissionRuleSet(candidate);
    const created = await FoodDeliveryCommissionRule.create({
        zoneId: zid,
        name: body.name || '',
        minDistance: body.minDistance,
        maxDistance: body.maxDistance ?? null,
        commissionPerKm: body.commissionPerKm,
        basePayout: body.basePayout,
        status: body.status ?? true
    });
    invalidateCommissionRulesCache(zid);
    return created.toObject();
}

export async function updateDeliveryCommissionRule(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const current = await FoodDeliveryCommissionRule.findById(id).lean();
    if (!current) return null;

    const zid = String(current.zoneId);
    const existing = await FoodDeliveryCommissionRule.find({ zoneId: zid }).lean();
    const candidate = existing.map((r) =>
        String(r._id) === String(id)
            ? {
                  ...r,
                  minDistance: body.minDistance,
                  maxDistance: body.maxDistance ?? null,
                  commissionPerKm: body.commissionPerKm,
                  basePayout: body.basePayout,
                  status: r.status !== false
              }
            : r
    );
    validateCommissionRuleSet(candidate);
    const updated = await FoodDeliveryCommissionRule.findByIdAndUpdate(
        id,
        {
            $set: {
                name: body.name || '',
                minDistance: body.minDistance,
                maxDistance: body.maxDistance ?? null,
                commissionPerKm: body.commissionPerKm,
                basePayout: body.basePayout
            }
        },
        { new: true }
    ).lean();
    invalidateCommissionRulesCache(zid);
    return updated;
}

export async function deleteDeliveryCommissionRule(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodDeliveryCommissionRule.findByIdAndDelete(id).lean();
    if (deleted?.zoneId) invalidateCommissionRulesCache(deleted.zoneId);
    return deleted ? { id } : null;
}

export async function toggleDeliveryCommissionRuleStatus(id, status) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const current = await FoodDeliveryCommissionRule.findById(id).lean();
    if (!current) return null;

    const zid = String(current.zoneId);
    const existing = await FoodDeliveryCommissionRule.find({ zoneId: zid }).lean();
    const candidate = existing.map((r) =>
        String(r._id) === String(id)
            ? { ...r, status: Boolean(status) }
            : r
    );
    // Allow turning off non-base slabs; still enforce one active base slab when enabling/disabling
    if (Boolean(status) === false) {
        const remainingActive = candidate.filter((r) => r.status !== false);
        if (!remainingActive.some((r) => Number(r.minDistance || 0) === 0)) {
            throw new ValidationError('Cannot disable the only active base slab (minDistance = 0)');
        }
    } else {
        validateCommissionRuleSet(candidate);
    }

    const updated = await FoodDeliveryCommissionRule.findByIdAndUpdate(
        id,
        { $set: { status: Boolean(status) } },
        { new: true }
    ).lean();
    invalidateCommissionRulesCache(zid);
    return updated;
}

// ----- Fee Settings (admin) -----
export async function getFeeSettings(zoneId) {
    const zid = requireValidZoneId(zoneId);
    const doc = await FoodFeeSettings.findOne({ zoneId: zid, isActive: true })
        .sort({ createdAt: -1 })
        .lean();
    // If not configured yet, return null so UI does not show defaults automatically.
    return { feeSettings: doc || null };
}

export async function upsertFeeSettings(body) {
    const zid = requireValidZoneId(body.zoneId);
    const zoneExists = await FoodZone.exists({ _id: zid });
    if (!zoneExists) throw new ValidationError('Invalid zoneId');

    // One active fee settings doc per zone.
    const existing = await FoodFeeSettings.findOne({ zoneId: zid }).sort({ createdAt: -1 });
    if (existing) {
        const $set = { zoneId: zid };
        const $unset = {};

        if (body.deliveryFee === null) $unset.deliveryFee = 1;
        else if (body.deliveryFee !== undefined) $set.deliveryFee = body.deliveryFee;

        if (body.deliveryFeeRanges !== undefined) $set.deliveryFeeRanges = body.deliveryFeeRanges;

        if (body.freeDeliveryUpTo === null) $unset.freeDeliveryUpTo = 1;
        else if (body.freeDeliveryUpTo !== undefined) $set.freeDeliveryUpTo = body.freeDeliveryUpTo;

        if (body.platformFee === null) $unset.platformFee = 1;
        else if (body.platformFee !== undefined) $set.platformFee = body.platformFee;

        if (body.packagingFee === null) $unset.packagingFee = 1;
        else if (body.packagingFee !== undefined) $set.packagingFee = body.packagingFee;

        if (body.gstRate === null) $unset.gstRate = 1;
        else if (body.gstRate !== undefined) $set.gstRate = body.gstRate;

        if (body.isActive !== undefined) $set.isActive = body.isActive;
        else $set.isActive = true;

        const update = {};
        if (Object.keys($set).length) update.$set = $set;
        if (Object.keys($unset).length) update.$unset = $unset;
        if (!Object.keys(update).length) return existing.toObject();

        const updated = await FoodFeeSettings.findByIdAndUpdate(existing._id, update, { new: true }).lean();
        return updated;
    }

    const payload = {
        zoneId: zid,
        deliveryFeeRanges: body.deliveryFeeRanges ?? [],
        isActive: body.isActive !== false
    };
    if (body.deliveryFee !== undefined && body.deliveryFee !== null) payload.deliveryFee = body.deliveryFee;
    if (body.freeDeliveryUpTo !== undefined && body.freeDeliveryUpTo !== null) payload.freeDeliveryUpTo = body.freeDeliveryUpTo;
    if (body.platformFee !== undefined && body.platformFee !== null) payload.platformFee = body.platformFee;
    if (body.packagingFee !== undefined && body.packagingFee !== null) payload.packagingFee = body.packagingFee;
    if (body.gstRate !== undefined && body.gstRate !== null) payload.gstRate = body.gstRate;

    const created = await FoodFeeSettings.create(payload);
    return created.toObject();
}

// ----- Referral Settings (admin) -----
export async function getReferralSettings() {
    const doc = await FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    return { referralSettings: doc || null };
}

export async function upsertReferralSettings(body = {}) {
    const existing = await FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (existing) {
        const $set = {};

        if (body.referralRewardUser !== undefined) $set.referralRewardUser = Math.max(0, Number(body.referralRewardUser) || 0);
        if (body.referralCommissionPercent !== undefined) $set.referralCommissionPercent = Math.min(100, Math.max(0, Number(body.referralCommissionPercent) || 0));
        if (body.referralRewardDelivery !== undefined) $set.referralRewardDelivery = Math.max(0, Number(body.referralRewardDelivery) || 0);
        if (body.referralLimitUser !== undefined) $set.referralLimitUser = Math.max(0, Number(body.referralLimitUser) || 0);
        if (body.referralLimitDelivery !== undefined) $set.referralLimitDelivery = Math.max(0, Number(body.referralLimitDelivery) || 0);
        if (body.isActive !== undefined) $set.isActive = Boolean(body.isActive);

        if (!Object.keys($set).length) return existing.toObject();
        const updated = await FoodReferralSettings.findByIdAndUpdate(existing._id, { $set }, { new: true }).lean();
        return updated;
    }

    const created = await FoodReferralSettings.create({
        referralRewardUser: Math.max(0, Number(body.referralRewardUser) || 0),
        referralCommissionPercent: Math.min(100, Math.max(0, Number(body.referralCommissionPercent) || 0)),
        referralRewardDelivery: Math.max(0, Number(body.referralRewardDelivery) || 0),
        referralLimitUser: Math.max(0, Number(body.referralLimitUser) || 0),
        referralLimitDelivery: Math.max(0, Number(body.referralLimitDelivery) || 0),
        isActive: body.isActive !== false
    });
    return created.toObject();
}

// ----- Safety / Emergency Reports (admin) -----
export async function getSafetyEmergencyReports(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.status && ['unread', 'read', 'urgent', 'resolved'].includes(String(query.status))) {
        filter.status = String(query.status);
    }
    if (query.priority && ['low', 'medium', 'high', 'critical'].includes(String(query.priority))) {
        filter.priority = String(query.priority);
    }
    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 120);
        const term = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { userName: { $regex: term, $options: 'i' } },
            { userEmail: { $regex: term, $options: 'i' } },
            { message: { $regex: term, $options: 'i' } }
        ];
    }

    const [list, total] = await Promise.all([
        FoodSafetyEmergencyReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        FoodSafetyEmergencyReport.countDocuments(filter)
    ]);

    return {
        safetyEmergencies: list || [],
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
    };
}

export async function updateSafetyEmergencyStatus(id, status) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid report id');
    const next = String(status);
    if (!['unread', 'read', 'urgent', 'resolved'].includes(next)) throw new ValidationError('Invalid status');
    const updated = await FoodSafetyEmergencyReport.findByIdAndUpdate(
        id,
        { $set: { status: next } },
        { new: true }
    ).lean();
    return updated;
}

export async function updateSafetyEmergencyPriority(id, priority) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid report id');
    const next = String(priority);
    if (!['low', 'medium', 'high', 'critical'].includes(next)) throw new ValidationError('Invalid priority');
    const updated = await FoodSafetyEmergencyReport.findByIdAndUpdate(
        id,
        { $set: { priority: next } },
        { new: true }
    ).lean();
    return updated;
}

export async function deleteSafetyEmergencyReport(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid report id');
    const deleted = await FoodSafetyEmergencyReport.findByIdAndDelete(id).lean();
    return deleted;
}

export async function getContactMessages(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    // Fix old records with 'User' instead of 'FoodUser' for population to work
    await FeedbackExperience.updateMany({ userModel: 'User' }, { $set: { userModel: 'FoodUser' } });

    const filter = {};
    if (query.rating && !isNaN(query.rating)) {
        filter.rating = parseInt(query.rating);
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        
        const [users, restaurants, partners] = await Promise.all([
            FoodUser.find({
                $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }]
            }).select('_id').lean(),
            FoodRestaurant.find({
                $or: [{ restaurantName: searchRegex }, { ownerEmail: searchRegex }, { ownerPhone: searchRegex }]
            }).select('_id').lean(),
            FoodDeliveryPartner.find({
                $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }]
            }).select('_id').lean()
        ]);

        filter.$or = [
            { comment: searchRegex },
            { userId: { $in: [...users.map(u => u._id), ...restaurants.map(r => r._id), ...partners.map(p => p._id)] } }
        ];
    }

    const [list, total] = await Promise.all([
        FeedbackExperience.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId')
            .lean(),
        FeedbackExperience.countDocuments(filter)
    ]);

    const reviews = list.map((doc) => {
        const user = (doc.userId && typeof doc.userId === 'object') ? doc.userId : {};
        return {
            _id: doc._id,
            customer: {
                name: user.name || user.restaurantName || 'Unknown',
                email: user.email || user.ownerEmail || 'N/A',
                phone: user.phone || user.ownerPhone || 'N/A'
            },
            comment: doc.comment || '',
            rating: doc.rating || 0,
            submittedAt: doc.createdAt,
            module: doc.module
        };
    });

    return {
        reviews,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1
        }
    };
}

// ----- Delivery Cash Limit (admin) -----
/**
 * Cash limit, minimum withdrawal and multi-order capacity. Pass the rider's
 * zone: a zone's own values win, the rest follow the platform default (see
 * zoneDeliverySettings.service). Without a zone this is the default.
 */
export async function getDeliveryCashLimitSettings({ zoneId } = {}) {
    return resolveDeliveryCashLimitSettings({ zoneId });
}

/** Platform default, or one zone's overrides when `body.zoneId` is set. */
export async function upsertDeliveryCashLimitSettings(body = {}, adminUser = null) {
    return updateDeliveryCashLimitSettings(body, adminUser);
}

// ----- Top Restaurants (admin curated, per zone + type) -----
const TOP_RESTAURANT_TYPES = ['delivery', 'takeaway'];
const MAX_TOP_RESTAURANTS = 10;

const normalizeTopType = (value) => {
    const t = String(value || 'delivery').trim().toLowerCase();
    return TOP_RESTAURANT_TYPES.includes(t) ? t : 'delivery';
};

/**
 * Returns the candidate restaurants for a zone (+ type) along with each one's
 * current top rank (1-based) if it has been curated. Search is handled on the
 * client so the full candidate set is returned here.
 */
export async function getTopRestaurantsForAdmin(query = {}) {
    const zoneIdRaw = String(query.zoneId || '').trim();
    if (!zoneIdRaw || !mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        throw new ValidationError('A valid zoneId is required');
    }
    const type = normalizeTopType(query.type);
    const zoneObjectId = new mongoose.Types.ObjectId(zoneIdRaw);

    const filter = { status: 'approved', zoneId: zoneObjectId };
    if (type === 'takeaway') {
        filter['takeawaySettings.isEnabled'] = true;
    }

    const [restaurants, topDoc] = await Promise.all([
        FoodRestaurant.find(filter)
            .select('restaurantName location area city profileImage status ownerName ownerPhone zoneId rating totalRatings takeawaySettings')
            .populate('zoneId', 'name zoneName')
            .lean(),
        FoodTopRestaurant.findOne({ zoneId: zoneObjectId, type }).lean(),
    ]);

    const orderedIds = Array.isArray(topDoc?.restaurants) ? topDoc.restaurants.map((id) => String(id)) : [];
    const rankMap = new Map();
    orderedIds.forEach((id, index) => rankMap.set(id, index + 1));

    const withRank = restaurants.map((r) => ({
        ...r,
        rank: rankMap.get(String(r._id)) || null,
    }));

    return {
        type,
        zoneId: zoneIdRaw,
        maxTop: MAX_TOP_RESTAURANTS,
        restaurants: withRank,
    };
}

/**
 * Saves the ordered top-restaurant list for a zone + type. Receives an ordered
 * array of restaurantIds (index 0 = #Top1). Validates that the ids are unique,
 * within the limit, and are approved restaurants in that zone (takeaway-enabled
 * for the takeaway list). The ordering itself encodes the ranks.
 */
export async function saveTopRestaurantsForAdmin(body = {}, adminId = null) {
    const zoneIdRaw = String(body.zoneId || '').trim();
    if (!zoneIdRaw || !mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        throw new ValidationError('A valid zoneId is required');
    }
    const type = normalizeTopType(body.type);
    const zoneObjectId = new mongoose.Types.ObjectId(zoneIdRaw);

    const rawIds = Array.isArray(body.restaurantIds) ? body.restaurantIds : [];
    if (rawIds.length > MAX_TOP_RESTAURANTS) {
        throw new ValidationError(`You can select a maximum of ${MAX_TOP_RESTAURANTS} top restaurants`);
    }

    // Validate ids: valid ObjectIds, no duplicates.
    const ids = [];
    const seen = new Set();
    for (const raw of rawIds) {
        const idStr = String(raw || '').trim();
        if (!mongoose.Types.ObjectId.isValid(idStr)) {
            throw new ValidationError('Invalid restaurant id in top list');
        }
        if (seen.has(idStr)) {
            throw new ValidationError('A restaurant cannot appear twice in the top list');
        }
        seen.add(idStr);
        ids.push(idStr);
    }

    if (ids.length > 0) {
        // Ensure every id is an approved restaurant in this zone (and takeaway-enabled when needed).
        const validFilter = {
            _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
            status: 'approved',
            zoneId: zoneObjectId,
        };
        if (type === 'takeaway') {
            validFilter['takeawaySettings.isEnabled'] = true;
        }
        const validCount = await FoodRestaurant.countDocuments(validFilter);
        if (validCount !== ids.length) {
            throw new ValidationError('One or more selected restaurants are not valid for this zone/type');
        }
    }

    const orderedObjectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

    const updated = await FoodTopRestaurant.findOneAndUpdate(
        { zoneId: zoneObjectId, type },
        { $set: { restaurants: orderedObjectIds, updatedBy: adminId || null } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return {
        zoneId: zoneIdRaw,
        type,
        restaurantIds: (updated?.restaurants || []).map((id) => String(id)),
    };
}

/**
 * Used by the public restaurant list to fetch the curated, ordered ids for a
 * zone + type. Returns [] when nothing is curated so the normal list is shown.
 */
export async function getTopRestaurantIds(zoneId, type) {
    const zoneIdRaw = String(zoneId || '').trim();
    if (!zoneIdRaw || !mongoose.Types.ObjectId.isValid(zoneIdRaw)) return [];
    const normalizedType = normalizeTopType(type);
    const doc = await FoodTopRestaurant.findOne({
        zoneId: new mongoose.Types.ObjectId(zoneIdRaw),
        type: normalizedType,
    }).select('restaurants').lean();
    return Array.isArray(doc?.restaurants) ? doc.restaurants.map((id) => String(id)) : [];
}

// ----- Delivery Emergency Help (admin) -----
/** Emergency numbers for a zone (the rider's), or the platform default without one. */
export async function getDeliveryEmergencyHelp({ zoneId } = {}) {
    return resolveDeliveryEmergencyHelp({ zoneId });
}

/** Platform default (validated as before), or one zone's overrides when `body.zoneId` is set. */
export async function upsertDeliveryEmergencyHelp(body = {}, adminUser = null) {
    return updateDeliveryEmergencyHelp(body, adminUser);
}

export async function getRestaurantReviews(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {
        'ratings.restaurant.rating': { $exists: true, $ne: null }
    };

    const zoneOid = parseZoneFilter(query.zoneId);
    if (zoneOid) {
        // $and keeps this independent of the search $or, which also matches on restaurantId.
        filter.$and = [{ restaurantId: { $in: await getRestaurantIdsInZone(zoneOid) } }];
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        
        const restaurants = await FoodRestaurant.find({
            $or: [{ restaurantName: searchRegex }]
        }).select('_id').lean();
        
        const customers = await FoodUser.find({
            $or: [{ name: searchRegex }, { email: searchRegex }]
        }).select('_id').lean();

        filter.$or = [
            { orderId: searchRegex },
            { 'ratings.restaurant.comment': searchRegex },
            { restaurantId: { $in: restaurants.map(r => r._id) } },
            { userId: { $in: customers.map(c => c._id) } }
        ];
    }

    const [docs, total] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email phone')
            .populate('restaurantId', 'restaurantName')
            .select('orderId userId restaurantId ratings.restaurant createdAt')
            .lean(),
        FoodOrder.countDocuments(filter)
    ]);

    const reviews = docs.map((doc, index) => ({
        sl: skip + index + 1,
        orderId: doc.orderId,
        restaurant: doc.restaurantId?.restaurantName || 'Unknown',
        restaurantId: doc.restaurantId?._id || 'N/A',
        customer: doc.userId?.name || 'Unknown',
        customerId: doc.userId?._id || 'N/A',
        review: doc.ratings?.restaurant?.comment || '',
        rating: doc.ratings?.restaurant?.rating || 0,
        submittedAt: doc.createdAt
    }));

    return { reviews, total, page, limit };
}

export async function getRestaurantById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    return FoodRestaurant.findById(id)
        .select('-__v')
        .populate('zoneId', 'name zoneName serviceLocation isActive')
        .lean();
}

function posDeliveredOrderMoneyBreakdown(order) {
    const pricing = order?.pricing || {};
    const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };

    const subtotal = toNum(pricing.subtotal);
    const baseSubtotal = toNum(pricing.baseSubtotal ?? pricing.subtotal);
    const markupTotal = toNum(pricing.markupTotal);
    const packagingFee = toNum(pricing.packagingFee);
    const deliveryFee = toNum(pricing.deliveryFee);
    const tax = toNum(pricing.tax);
    const discount = toNum(pricing.discount);
    const total = toNum(pricing.total);
    const commission = toNum(pricing.restaurantCommission);
    const platformFeeStored = pricing.platformFee;
    const platformFee =
        platformFeeStored !== undefined && platformFeeStored !== null
            ? toNum(platformFeeStored)
            : Math.max(0, total - subtotal - packagingFee - deliveryFee - tax + discount);
    const rider = toNum(order?.riderEarning);
    const riderShare = order?.dispatch?.deliveryPartnerId ? rider : 0;
    const restaurantShare = Math.max(0, baseSubtotal + packagingFee - commission);
    const platformNetProfit = Math.max(0, platformFee + deliveryFee + commission + markupTotal - riderShare);

    return {
        subtotal,
        baseSubtotal,
        markupTotal,
        packagingFee,
        deliveryFee,
        tax,
        discount,
        total,
        commission,
        platformFee,
        riderShare,
        restaurantShare,
        platformNetProfit,
    };
}

export async function getRestaurantAnalytics(restaurantId) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) return null;
    const rId = new mongoose.Types.ObjectId(restaurantId);

    const [restaurant, commissionDoc, orders] = await Promise.all([
        FoodRestaurant.findById(rId).lean(),
        FoodRestaurantCommission.findOne({ restaurantId: rId, status: { $ne: false } }).lean(),
        FoodOrder.find({ restaurantId: rId })
            .select('orderStatus createdAt userId pricing riderEarning dispatch.deliveryPartnerId')
            .lean(),
    ]);

    if (!restaurant) return null;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

    const cancelledOrders = orders.filter((o) => CANCELLED_ORDER_STATUSES.includes(o.orderStatus));
    const deliveredOrders = orders.filter((o) => o.orderStatus === 'delivered');

    const sumBreakdown = (list, pick) =>
        roundMoney(
            (list || []).reduce((sum, order) => sum + (Number(pick(posDeliveredOrderMoneyBreakdown(order))) || 0), 0),
        );

    const totalRevenue = sumBreakdown(deliveredOrders, (b) => b.total);
    const totalCommission = sumBreakdown(deliveredOrders, (b) => b.commission);
    const restaurantEarning = sumBreakdown(deliveredOrders, (b) => b.restaurantShare);
    const restaurantProfit = restaurantEarning;

    const monthlyDelivered = deliveredOrders.filter((o) => {
        const d = new Date(o.createdAt);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const yearlyDelivered = deliveredOrders.filter((o) => {
        const d = new Date(o.createdAt);
        return d.getFullYear() === currentYear;
    });

    const monthlyProfit = sumBreakdown(monthlyDelivered, (b) => b.restaurantShare);
    const yearlyProfit = sumBreakdown(yearlyDelivered, (b) => b.restaurantShare);

    const monthlyProfitByKey = {};
    const yearlyProfitByKey = {};
    for (const order of deliveredOrders) {
        const d = new Date(order.createdAt);
        const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
        const yearKey = String(d.getFullYear());
        const share = posDeliveredOrderMoneyBreakdown(order).restaurantShare;
        monthlyProfitByKey[monthKey] = (monthlyProfitByKey[monthKey] || 0) + share;
        yearlyProfitByKey[yearKey] = (yearlyProfitByKey[yearKey] || 0) + share;
    }
    const activeMonthCount = Object.keys(monthlyProfitByKey).length;
    const activeYearCount = Object.keys(yearlyProfitByKey).length;
    const averageMonthlyProfit =
        activeMonthCount > 0 ? roundMoney(restaurantEarning / activeMonthCount) : 0;
    const averageYearlyProfit =
        activeYearCount > 0 ? roundMoney(restaurantEarning / activeYearCount) : 0;

    const totalOrdersCount = orders.length;
    const avgOrderValue =
        deliveredOrders.length > 0 ? roundMoney(totalRevenue / deliveredOrders.length) : 0;

    const uniqueCustomers = new Set(orders.map((o) => String(o.userId))).size;
    const customerOrderCounts = orders.reduce((acc, o) => {
        const uid = String(o.userId);
        acc[uid] = (acc[uid] || 0) + 1;
        return acc;
    }, {});
    const repeatCustomers = Object.values(customerOrderCounts).filter((count) => count > 1).length;

    const commissionType = commissionDoc?.defaultCommission?.type || 'percentage';
    const commissionValue = Number(commissionDoc?.defaultCommission?.value || 0) || 0;
    const completedSubtotal = sumBreakdown(deliveredOrders, (b) => b.subtotal);
    const computedCommissionPercent =
        commissionType === 'percentage'
            ? commissionValue
            : completedSubtotal > 0
              ? roundMoney((totalCommission / completedSubtotal) * 100)
              : 0;

    const analytics = {
        totalOrders: totalOrdersCount,
        cancelledOrders: cancelledOrders.length,
        completedOrders: deliveredOrders.length,
        averageRating: Number(restaurant.rating || 0),
        totalRatings: Number(restaurant.totalRatings || 0),
        commissionPercentage: computedCommissionPercent,
        monthlyProfit,
        yearlyProfit,
        averageOrderValue: avgOrderValue,
        totalRevenue,
        totalCommission,
        restaurantEarning,
        restaurantProfit,
        monthlyOrders: monthlyDelivered.length,
        yearlyOrders: yearlyDelivered.length,
        averageMonthlyProfit,
        averageYearlyProfit,
        status: restaurant.status === 'approved' ? 'active' : 'inactive',
        joinDate: restaurant.createdAt,
        totalCustomers: uniqueCustomers,
        repeatCustomers,
        cancellationRate: totalOrdersCount > 0 ? roundMoney((cancelledOrders.length / totalOrdersCount) * 100) : 0,
        completionRate: totalOrdersCount > 0 ? roundMoney((deliveredOrders.length / totalOrdersCount) * 100) : 0,
    };

    const paymentSummary = {
        subtotal: sumBreakdown(deliveredOrders, (b) => b.subtotal),
        tax: sumBreakdown(deliveredOrders, (b) => b.tax),
        packagingFee: sumBreakdown(deliveredOrders, (b) => b.packagingFee),
        deliveryFee: sumBreakdown(deliveredOrders, (b) => b.deliveryFee),
        platformFee: sumBreakdown(deliveredOrders, (b) => b.platformFee),
        discount: sumBreakdown(deliveredOrders, (b) => b.discount),
        total: totalRevenue,
        currency: 'INR',
        restaurantShare: restaurantEarning,
        restaurantCommission: totalCommission,
        riderShare: sumBreakdown(deliveredOrders, (b) => b.riderShare),
        platformNetProfit: sumBreakdown(deliveredOrders, (b) => b.platformNetProfit),
    };

    return {
        restaurant: {
            ...restaurant,
            restaurantId: toRestaurantDisplayId(restaurant._id),
        },
        analytics,
        paymentSummary,
    };
}

export async function getRestaurantMenuById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id).select('menu').lean();
    if (!doc) return null;
    return doc.menu || { sections: [] };
}

export async function updateRestaurantMenuById(id, menu) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id);
    if (!doc) return null;
    const sections = Array.isArray(menu?.sections) ? menu.sections : [];
    doc.menu = { sections };
    await doc.save();
    return doc.menu || { sections: [] };
}

export async function getPendingRestaurants(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    // Join requests ask for `status=pending` so pagination and totals count only
    // what the page lists; without it both pending and rejected are returned.
    const status = String(query.status || '').trim().toLowerCase();
    const filter = {
        status: ['pending', 'rejected'].includes(status) ? status : { $in: ['pending', 'rejected'] }
    };
    const zoneOid = parseZoneFilter(query.zoneId);
    if (zoneOid) filter.zoneId = zoneOid;
    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        filter.$or = [
            { restaurantName: searchRegex },
            { ownerName: searchRegex },
            { ownerPhone: searchRegex },
            { ownerEmail: searchRegex },
        ];
    }

    const [restaurants, total] = await Promise.all([
        FoodRestaurant.find(filter)
            .populate('zoneId', 'name zoneName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodRestaurant.countDocuments(filter),
    ]);

    // Admins verify the onboarding fee before approving, so attach each restaurant's
    // payment snapshot (original -> offer -> paid) to the review list.
    const paymentsByRestaurant = new Map();
    if (restaurants.length) {
        const payments = await FoodOnboardingPayment.find({
            restaurantId: { $in: restaurants.map((r) => r._id) },
            status: 'paid'
        }).lean();
        payments.forEach((payment) => paymentsByRestaurant.set(String(payment.restaurantId), payment));
    }

    const list = restaurants.map((r, i) => {
        const payment = paymentsByRestaurant.get(String(r._id)) || null;
        return {
            ...r,
            sl: skip + i + 1,
            zone: r.zoneId?.zoneName || r.zoneId?.name || null,
            restaurantTypeLabel: getRestaurantTypeLabel(r.restaurantType),
            onboardingPaymentDetails: payment
                ? {
                    status: payment.status,
                    originalPrice: payment.pricing?.originalPrice ?? null,
                    offerPrice: payment.pricing?.offerPrice ?? null,
                    finalAmount: payment.pricing?.finalAmount ?? null,
                    offerName: payment.pricing?.offerName || '',
                    currency: payment.pricing?.currency || 'INR',
                    transactionReference: payment.gateway?.razorpayPaymentId || '',
                    gatewayOrderId: payment.gateway?.razorpayOrderId || '',
                    paidAt: payment.paidAt,
                    zoneName: payment.pricing?.zoneName || '',
                    restaurantTypeLabel: getRestaurantTypeLabel(payment.restaurantType)
                }
                : (r.onboardingPayment?.status === 'not_required'
                    ? { status: 'not_required' }
                    : null),
        };
    });

    return { restaurants: list, total, page, limit };
}

export async function updateRestaurantById(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id);
    if (!doc) return null;

    const toStr = (v) => (v != null ? String(v).trim() : '');
    const toFinite = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
    };

    if (body.name !== undefined || body.restaurantName !== undefined) {
        const name = toStr(body.name !== undefined ? body.name : body.restaurantName);
        if (!name) throw new ValidationError('Restaurant name cannot be empty');
        doc.restaurantName = name;
    }

    if (body.ownerName !== undefined) doc.ownerName = toStr(body.ownerName);
    if (body.ownerEmail !== undefined) doc.ownerEmail = toStr(body.ownerEmail).toLowerCase();
    if (body.ownerPhone !== undefined) doc.ownerPhone = toStr(body.ownerPhone);
    if (body.primaryContactNumber !== undefined) doc.primaryContactNumber = toStr(body.primaryContactNumber);

    if (body.pureVegRestaurant !== undefined) {
        doc.pureVegRestaurant = parseBooleanLike(body.pureVegRestaurant, 'pureVegRestaurant');
    }
    if (body.pureVeganRestaurant !== undefined) {
        // DISABLED: validated as before, then forced off — "Pure Vegan" is no
        // longer a selectable menu type. Stored values are left as they are.
        parseBooleanLike(body.pureVeganRestaurant, 'pureVeganRestaurant');
        doc.pureVeganRestaurant = false;
    }
    if (doc.pureVeganRestaurant === true) {
        doc.pureVegRestaurant = true;
    }

    if (body.isAcceptingOrders !== undefined) {
        doc.isAcceptingOrders = parseBooleanLike(body.isAcceptingOrders, 'isAcceptingOrders');
    }

    if (body.cuisines !== undefined) {
        if (Array.isArray(body.cuisines)) {
            doc.cuisines = body.cuisines
                .map((c) => toStr(c))
                .filter(Boolean)
                .slice(0, 50);
        } else if (typeof body.cuisines === 'string') {
            doc.cuisines = body.cuisines
                .split(',')
                .map((c) => toStr(c))
                .filter(Boolean)
                .slice(0, 50);
        } else {
            throw new ValidationError('cuisines must be an array or comma-separated string');
        }
    }

    if (body.openingTime !== undefined) doc.openingTime = normalizeRestaurantTime(body.openingTime) || '';
    if (body.closingTime !== undefined) doc.closingTime = normalizeRestaurantTime(body.closingTime) || '';
    validateOpeningClosingTimes(doc.openingTime, doc.closingTime);
    if (body.openDays !== undefined && Array.isArray(body.openDays)) {
        doc.openDays = body.openDays.map(d => toStr(d)).filter(Boolean);
    }
    if (body.offer !== undefined) doc.offer = toStr(body.offer);

    if (body.estimatedDeliveryTime !== undefined) {
        doc.estimatedDeliveryTime = toStr(body.estimatedDeliveryTime);
    }
    if (body.estimatedDeliveryTimeMinutes !== undefined) {
        const minutes = toFiniteNumber(body.estimatedDeliveryTimeMinutes);
        if (minutes === null) {
            doc.estimatedDeliveryTimeMinutes = undefined;
        } else if (minutes < 0) {
            throw new ValidationError('estimatedDeliveryTimeMinutes must be >= 0');
        } else {
            doc.estimatedDeliveryTimeMinutes = Math.round(minutes);
        }
    }

    // Business & Docs
    if (body.panNumber !== undefined) doc.panNumber = toStr(body.panNumber);
    if (body.nameOnPan !== undefined) doc.nameOnPan = toStr(body.nameOnPan);
    if (body.gstRegistered !== undefined) doc.gstRegistered = parseBooleanLike(body.gstRegistered, 'gstRegistered');
    if (body.gstNumber !== undefined) doc.gstNumber = toStr(body.gstNumber);
    if (body.gstLegalName !== undefined) doc.gstLegalName = toStr(body.gstLegalName);
    if (body.gstAddress !== undefined) doc.gstAddress = toStr(body.gstAddress);
    if (body.fssaiNumber !== undefined) doc.fssaiNumber = toStr(body.fssaiNumber);
    if (body.fssaiExpiry !== undefined) doc.fssaiExpiry = body.fssaiExpiry ? new Date(body.fssaiExpiry) : undefined;

    // Bank Details
    if (body.accountNumber !== undefined) doc.accountNumber = toStr(body.accountNumber);
    if (body.ifscCode !== undefined) doc.ifscCode = toStr(body.ifscCode);
    if (body.accountHolderName !== undefined) doc.accountHolderName = toStr(body.accountHolderName);
    if (body.accountType !== undefined) doc.accountType = toStr(body.accountType);

    // Featured Info
    if (body.featuredDish !== undefined) doc.featuredDish = toStr(body.featuredDish);
    if (body.featuredPrice !== undefined) doc.featuredPrice = toFinite(body.featuredPrice);

    // Images
    const getUrl = (v) => (v && typeof v === 'object' ? v.url : v);
    if (body.profileImage !== undefined) doc.profileImage = toStr(getUrl(body.profileImage)) || undefined;
    if (body.panImage !== undefined) doc.panImage = toStr(getUrl(body.panImage)) || undefined;
    if (body.gstImage !== undefined) doc.gstImage = toStr(getUrl(body.gstImage)) || undefined;
    if (body.fssaiImage !== undefined) doc.fssaiImage = toStr(getUrl(body.fssaiImage)) || undefined;

    if (body.menuImages !== undefined) {
        if (Array.isArray(body.menuImages)) {
            doc.menuImages = body.menuImages.map(m => toStr(getUrl(m))).filter(Boolean);
        } else {
            doc.menuImages = [toStr(getUrl(body.menuImages))].filter(Boolean);
        }
    }

    if (body.takeawaySettings !== undefined && typeof body.takeawaySettings === 'object') {
        doc.takeawaySettings = {
            ...(doc.takeawaySettings?.toObject?.() || doc.takeawaySettings || {}),
            isEnabled: Boolean(body.takeawaySettings.isEnabled),
            // Pay-at-Pickup can only be on when takeaway itself is on.
            payAtPickupEnabled:
                Boolean(body.takeawaySettings.isEnabled) &&
                Boolean(body.takeawaySettings.payAtPickupEnabled),
        };
    }

    // The selected zone must cover the restaurant location being saved.
    await assertZoneCoversLocation(doc.zoneId, doc.location?.latitude, doc.location?.longitude);

    await doc.save();
    return FoodRestaurant.findById(id).select('-__v').populate('zoneId', 'name zoneName serviceLocation isActive').lean();
}

export async function updateRestaurantStatus(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const existing = await FoodRestaurant.findById(id)
        .select('status ownerEmail restaurantName profileImage pendingApprovalType')
        .lean();
    if (!existing) return null;

    const raw = body.status !== undefined ? body.status : body.isActive;
    const isActive = parseBooleanLike(raw, 'status');
    const status = isActive ? 'approved' : 'banned';

    const updated = await FoodRestaurant.findByIdAndUpdate(
        id,
        {
            $set: {
                status,
                approvedAt: isActive ? new Date() : undefined,
                rejectedAt: isActive ? undefined : new Date()
            },
            $unset: {
                rejectionReason: 1
            }
        },
        { new: true, runValidators: false }
    ).lean();

    if (updated && isActive) {
        logger.info(`[ADMIN-STATUS] Restaurant ${id} activated (ban/unban) — triggering approval email/FCM`);
        const isChangesApproval = existing.pendingApprovalType === 'changes';
        await sendRestaurantApprovalNotifications(updated, existing, isChangesApproval);
    }

    return updated;
}

export async function updateRestaurantLocation(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id);
    if (!doc) return null;

    const source = (body.location && typeof body.location === 'object') ? body.location : body;
    const toStr = (v) => (v != null ? String(v).trim() : '');

    const coordinates = Array.isArray(source.coordinates) ? source.coordinates : [];
    const lngFromCoordinates = toFiniteNumber(coordinates[0]);
    const latFromCoordinates = toFiniteNumber(coordinates[1]);
    const latitude = toFiniteNumber(source.latitude ?? latFromCoordinates);
    const longitude = toFiniteNumber(source.longitude ?? lngFromCoordinates);

    const addressLine1 = toStr(source.addressLine1 || source.formattedAddress || source.address);
    const addressLine2 = toStr(source.addressLine2);
    const area = toStr(source.area);
    const city = toStr(source.city);
    const state = toStr(source.state);
    const pincode = toStr(source.pincode || source.zipCode || source.postalCode);
    const landmark = toStr(source.landmark);
    const formattedAddress = toStr(source.formattedAddress || source.address || addressLine1);

    if (!doc.location || typeof doc.location !== 'object') {
        doc.location = { type: 'Point' };
    }
    doc.location.type = 'Point';
    if (latitude !== null && longitude !== null) {
        doc.location.latitude = latitude;
        doc.location.longitude = longitude;
        doc.location.coordinates = [longitude, latitude];
    }
    doc.location.formattedAddress = formattedAddress;
    doc.location.address = toStr(source.address || formattedAddress);
    doc.location.addressLine1 = addressLine1;
    doc.location.addressLine2 = addressLine2;
    doc.location.area = area;
    doc.location.city = city;
    doc.location.state = state;
    doc.location.pincode = pincode;
    doc.location.landmark = landmark;

    // Keep flat fields in sync for legacy readers.
    doc.addressLine1 = addressLine1;
    doc.addressLine2 = addressLine2;
    doc.area = area;
    doc.city = city;
    doc.state = state;
    doc.pincode = pincode;
    doc.landmark = landmark;

    if (body.zoneId !== undefined) {
        const zoneId = String(body.zoneId || '').trim();
        if (!zoneId) {
            doc.zoneId = undefined;
        } else if (!mongoose.Types.ObjectId.isValid(zoneId)) {
            throw new ValidationError('Invalid zoneId');
        } else {
            doc.zoneId = new mongoose.Types.ObjectId(zoneId);
        }
    }

    // The selected zone must cover the restaurant location being saved.
    await assertZoneCoversLocation(doc.zoneId, doc.location?.latitude, doc.location?.longitude);

    await doc.save();
    return FoodRestaurant.findById(id).select('-__v').populate('zoneId', 'name zoneName serviceLocation isActive').lean();
}

// ----- Categories -----
export async function getCategories(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim();
        filter.$or = [{ name: { $regex: term, $options: 'i' } }];
    }
    // Zone filter for admin list.
    if (query.zoneId && String(query.zoneId).trim()) {
        const zid = String(query.zoneId).trim();
        if (mongoose.Types.ObjectId.isValid(zid)) {
            filter.zoneId = new mongoose.Types.ObjectId(zid);
        } else if (zid === 'global') {
            filter.$or = [...(filter.$or || []), { zoneId: { $exists: false } }, { zoneId: null }];
        }
    }
    if (query.approvalStatus) {
        const approvalStatus = String(query.approvalStatus);
        if (approvalStatus === 'pending') {
            filter.$and = [...(filter.$and || []), {
                $or: [
                    { approvalStatus: 'pending' },
                    { approvalStatus: { $exists: false }, isApproved: false }
                ]
            }];
        } else {
            filter.approvalStatus = approvalStatus;
        }
    } else if (query.isApproved !== undefined) {
        if (query.isApproved === true) {
            filter.$and = [...(filter.$and || []), {
                $or: [
                    { approvalStatus: 'approved' },
                    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
                ]
            }];
        } else {
            filter.$and = [...(filter.$and || []), {
                $or: [
                    { approvalStatus: 'pending' },
                    { approvalStatus: { $exists: false }, isApproved: false }
                ]
            }];
        }
    }

    const [list, total] = await Promise.all([
        FoodCategory.find(filter)
            .sort({ sortOrder: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodCategory.countDocuments(filter)
    ]);

    const statsById = await backfillLegacyCategoryWorkflow(list);
    const restaurantIds = Array.from(
        new Set(
            list
                .flatMap((category) => [category?.restaurantId, category?.createdByRestaurantId])
                .map((value) => (value ? String(value) : ''))
                .filter(Boolean)
        )
    );
    const categoryZoneIds = Array.from(
        new Set(list.map((c) => c?.zoneId ? String(c.zoneId) : null).filter(Boolean))
    );

    const [restaurants, zones] = await Promise.all([
        restaurantIds.length
            ? FoodRestaurant.find({ _id: { $in: restaurantIds } })
                .select('restaurantName ownerName ownerPhone')
                .lean()
            : [],
        categoryZoneIds.length
            ? FoodZone.find({ _id: { $in: categoryZoneIds } })
                .select('name zoneName serviceLocation')
                .lean()
            : []
    ]);

    const restaurantMap = new Map(restaurants.map((restaurant) => [String(restaurant._id), restaurant]));
    const zoneMap = new Map(zones.map((zone) => [String(zone._id), zone]));

    const hydratedList = list.map((category) => {
        const zId = category?.zoneId ? String(category.zoneId) : null;
        const zDoc = zId ? zoneMap.get(zId) : null;
        return {
            ...category,
            zoneId: zId,
            zoneName: zDoc ? (zDoc.name || zDoc.zoneName || zDoc.serviceLocation || 'Zone') : (zId ? 'Zone' : 'Unassigned'),
            zone: zDoc || null,
            restaurantId: category?.restaurantId ? restaurantMap.get(String(category.restaurantId)) || category.restaurantId : category.restaurantId,
            createdByRestaurantId: category?.createdByRestaurantId ? restaurantMap.get(String(category.createdByRestaurantId)) || category.createdByRestaurantId : category.createdByRestaurantId
        };
    });
    const categories = hydratedList.map((category) => serializeCategoryForResponse(category, { includeCounts: true, statsById }));

    return { categories, total, page, limit };
}

export async function createCategory(body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('Category name is required');

    if (!body.zoneId || !mongoose.Types.ObjectId.isValid(String(body.zoneId))) {
        throw new ValidationError('A valid Zone selection is mandatory');
    }
    const zoneOid = new mongoose.Types.ObjectId(String(body.zoneId));
    const zoneExists = await FoodZone.exists({ _id: zoneOid, isActive: true });
    if (!zoneExists) {
        throw new ValidationError('Selected zone is invalid, deactivated, or deleted');
    }

    const doc = new FoodCategory({
        name,
        image: typeof body.image === 'string' ? body.image.trim() : '',
        type: typeof body.type === 'string' ? body.type.trim() : '',
        foodTypeScope: normalizeCategoryFoodTypeScope(body.foodTypeScope, 'Both'),
        zoneId: zoneOid,
        isActive: body.isActive !== false,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        // Admin-created categories are globally available immediately.
        approvalStatus: 'approved',
        isApproved: true,
        approvedAt: new Date(),
        rejectionReason: '',
        restaurantId: undefined,
        createdByRestaurantId: undefined
    });
    await doc.save();
    return doc.toObject();
}

export async function approveCategory(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;

    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    doc.approvalStatus = 'approved';
    doc.isApproved = true;
    doc.approvedAt = new Date();
    doc.rejectedAt = undefined;
    doc.rejectionReason = '';
    await doc.save();
    return doc.toObject();
}

export async function rejectCategory(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;
    if (!doc.restaurantId && !doc.createdByRestaurantId) {
        throw new ValidationError('Only restaurant-created categories can be rejected');
    }

    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    doc.approvalStatus = 'rejected';
    doc.isApproved = false;
    doc.rejectionReason = String(reason || '').trim();
    doc.rejectedAt = new Date();
    doc.approvedAt = undefined;
    await doc.save();
    return doc.toObject();
}

export async function makeCategoryGlobal(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;

    if (!doc.restaurantId && !doc.createdByRestaurantId) {
        return doc.toObject();
    }
    if (String(doc.approvalStatus || '') !== 'approved' && doc.isApproved !== true) {
        throw new ValidationError('Only approved categories can be made global');
    }

    doc.createdByRestaurantId = doc.createdByRestaurantId || doc.restaurantId;
    doc.restaurantId = undefined;
    doc.zoneId = undefined;
    doc.approvalStatus = 'approved';
    doc.isApproved = true;
    doc.rejectionReason = '';
    doc.globalizedAt = new Date();
    doc.approvedAt = doc.approvedAt || new Date();
    await doc.save();
    return doc.toObject();
}

export async function updateCategory(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;

    const nextFoodTypeScope = body.foodTypeScope !== undefined
        ? normalizeCategoryFoodTypeScope(body.foodTypeScope, doc.foodTypeScope || 'Both')
        : normalizeCategoryFoodTypeScope(doc.foodTypeScope, 'Both');

    if (body.foodTypeScope !== undefined && nextFoodTypeScope !== 'Both') {
        const incompatibleFoods = await FoodItem.countDocuments({
            categoryId: doc._id,
            foodType: nextFoodTypeScope === 'Veg' ? 'Non-Veg' : { $in: ['Veg', 'Vegan'] }
        });
        if (incompatibleFoods > 0) {
            throw new ValidationError(`This category already has ${incompatibleFoods} food item(s) outside the selected diet scope`);
        }
    }

    if (body.name !== undefined) doc.name = String(body.name || '').trim();
    if (body.image !== undefined) {
        const nextImage = String(body.image || '').trim();
        await deleteReplacedAssets(doc.image, nextImage);
        doc.image = nextImage;
    }
    if (body.type !== undefined) doc.type = String(body.type || '').trim();
    if (body.foodTypeScope !== undefined) doc.foodTypeScope = nextFoodTypeScope;
    if (body.zoneId !== undefined) {
        const raw = String(body.zoneId || '').trim();
        if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
            throw new ValidationError('A valid Zone selection is mandatory');
        }
        const zoneOid = new mongoose.Types.ObjectId(raw);
        const zoneExists = await FoodZone.exists({ _id: zoneOid, isActive: true });
        if (!zoneExists) {
            throw new ValidationError('Selected zone is invalid, deactivated, or deleted');
        }
        doc.zoneId = zoneOid;
    }
    if (body.isActive !== undefined) doc.isActive = body.isActive !== false;
    if (body.sortOrder !== undefined) doc.sortOrder = Number(body.sortOrder) || 0;
    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    await doc.save();
    return doc.toObject();
}

export async function deleteCategory(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const inUse = await FoodItem.countDocuments({ categoryId: id });
    if (inUse > 0) {
        throw new ValidationError('Cannot delete category while it has items');
    }
    const deleted = await FoodCategory.findByIdAndDelete(id).lean();
    if (deleted) await deleteStoredAssets(deleted.image);
    return deleted ? { id } : null;
}

export async function toggleCategoryStatus(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;
    doc.isActive = !doc.isActive;
    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    await doc.save();
    return doc.toObject();
}

// ----- Restaurant Add-ons approval (admin) -----
export async function getRestaurantAddonsAdmin(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: { $ne: true } };

    const approvalStatus = String(query.approvalStatus || '').trim();
    if (approvalStatus && ['pending', 'approved', 'rejected'].includes(approvalStatus)) {
        filter.approvalStatus = approvalStatus;
    }

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        filter.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
    }

    if (query.zoneId && mongoose.Types.ObjectId.isValid(String(query.zoneId))) {
        const zoneOid = new mongoose.Types.ObjectId(String(query.zoneId));
        const matchingRestaurants = await FoodRestaurant.find({ zoneId: zoneOid }).select('_id').lean();
        const matchingRestIds = matchingRestaurants.map((restaurant) => restaurant._id);
        const zoneCondition = {
            $or: [
                { zoneId: zoneOid },
                { zoneId: null, restaurantId: { $in: matchingRestIds } },
                { zoneId: { $exists: false }, restaurantId: { $in: matchingRestIds } }
            ]
        };
        if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, zoneCondition];
            delete filter.$or;
        } else {
            filter.$or = zoneCondition.$or;
        }
    }

    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matchingRestaurantIds = await FoodRestaurant.find({
            restaurantName: { $regex: term, $options: 'i' }
        })
            .select('_id')
            .lean();

        const searchCondition = {
            $or: [
                { 'draft.name': { $regex: term, $options: 'i' } },
                { restaurantId: { $in: matchingRestaurantIds.map((restaurant) => restaurant._id) } }
            ]
        };

        if (filter.$or) {
            filter.$and = [...(filter.$and || []), { $or: filter.$or }, searchCondition];
            delete filter.$or;
        } else if (filter.$and) {
            filter.$and.push(searchCondition);
        } else {
            filter.$or = searchCondition.$or;
        }
    }

    const [list, total] = await Promise.all([
        FoodAddon.find(filter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('restaurantId', 'restaurantName ownerName ownerPhone zoneId')
            .lean(),
        FoodAddon.countDocuments(filter)
    ]);

    const addonZoneIds = Array.from(new Set(
        list.map((a) => a.zoneId ? String(a.zoneId) : (a.restaurantId?.zoneId ? String(a.restaurantId.zoneId) : null)).filter(Boolean)
    ));
    const zones = addonZoneIds.length
        ? await FoodZone.find({ _id: { $in: addonZoneIds } }).select('name zoneName serviceLocation').lean()
        : [];
    const zoneMap = new Map(zones.map((z) => [String(z._id), z.name || z.zoneName || z.serviceLocation || 'Zone']));

    const addons = list.map((a) => {
        const resolvedZoneId = a.zoneId ? String(a.zoneId) : (a.restaurantId?.zoneId ? String(a.restaurantId.zoneId) : null);
        const resolvedZoneName = resolvedZoneId ? (zoneMap.get(resolvedZoneId) || '') : '';
        return {
            id: a._id,
            _id: a._id,
            zoneId: resolvedZoneId,
            zoneName: resolvedZoneName,
            restaurantId: a.restaurantId?._id ? String(a.restaurantId._id) : String(a.restaurantId),
            restaurant: a.restaurantId?._id
                ? {
                    _id: a.restaurantId._id,
                    name: a.restaurantId.restaurantName || '',
                    ownerName: a.restaurantId.ownerName || '',
                    ownerPhone: a.restaurantId.ownerPhone || '',
                    zoneId: a.restaurantId.zoneId ? String(a.restaurantId.zoneId) : null
                }
                : null,
            approvalStatus: a.approvalStatus || 'pending',
            rejectionReason: a.rejectionReason || '',
            requestedAt: a.requestedAt,
            approvedAt: a.approvedAt,
            rejectedAt: a.rejectedAt,
            isAvailable: a.isAvailable !== false,
            draft: a.draft || null,
            published: a.published || null,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt
        };
    });

    return { addons, total, page, limit };
}

export async function updateRestaurantAddonAdmin(addonId, body) {
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) return null;
    const _id = new mongoose.Types.ObjectId(String(addonId));
    
    const addon = await FoodAddon.findOne({ _id, isDeleted: { $ne: true } });
    if (!addon) return null;

    if (body.zoneId !== undefined) {
        if (!body.zoneId || !mongoose.Types.ObjectId.isValid(String(body.zoneId))) {
            throw new ValidationError('A valid Zone selection is mandatory');
        }
        const zoneOid = new mongoose.Types.ObjectId(String(body.zoneId));
        const zoneExists = await FoodZone.exists({ _id: zoneOid, isActive: true });
        if (!zoneExists) {
            throw new ValidationError('Selected zone is invalid, deactivated, or deleted');
        }
        addon.zoneId = zoneOid;
    }

    const updatePayload = {};
    if (body.name !== undefined) updatePayload.name = String(body.name || '').trim();
    if (body.description !== undefined) updatePayload.description = String(body.description || '').trim();
    if (body.price !== undefined) {
        const p = Number(body.price);
        if (!Number.isFinite(p) || p < 0) throw new ValidationError('Price must be a valid positive number');
        updatePayload.price = p;
    }
    if (body.image !== undefined) updatePayload.image = String(body.image || '').trim();
    if (body.images !== undefined && Array.isArray(body.images)) {
        updatePayload.images = body.images.map(img => typeof img === 'string' ? img : img?.url).filter(Boolean);
    } else if (updatePayload.image) {
        updatePayload.images = [updatePayload.image];
    }

    // Update draft fields
    if (addon.draft) {
        Object.assign(addon.draft, updatePayload);
    } else {
        addon.draft = updatePayload;
    }

    // If already approved, update published state as well
    if (addon.approvalStatus === 'approved') {
        if (addon.published) {
            Object.assign(addon.published, updatePayload);
        } else {
            addon.published = updatePayload;
        }
    }

    if (body.isAvailable !== undefined) {
        addon.isAvailable = body.isAvailable === true;
    }

    await addon.save();
    return addon.toObject();
}

export async function approveRestaurantAddon(addonId) {
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) return null;
    const _id = new mongoose.Types.ObjectId(String(addonId));

    // Use update pipeline to copy draft -> published atomically.
    const updated = await FoodAddon.findOneAndUpdate(
        { _id, isDeleted: { $ne: true } },
        [
            {
                $set: {
                    published: '$draft',
                    approvalStatus: 'approved',
                    approvedAt: '$$NOW',
                    rejectedAt: null,
                    rejectionReason: ''
                }
            }
        ],
        { new: true }
    ).lean();

    if (updated?.restaurantId) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Addon Approved! ✅',
                    body: `Your addon "${updated.published?.name || 'New Addon'}" has been approved and is now live.`,
                    image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    sendToAllDevices: true,
                    data: {
                        type: 'addon_approved',
                        addonId: String(updated._id),
                        restaurantId: String(updated.restaurantId),
                        targetUrl: '/food/restaurant',
                        link: '/food/restaurant',
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send addon approval notification:', e);
        }
    }

    return updated || null;
}

export async function rejectRestaurantAddon(addonId, reason) {
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) return null;
    const _id = new mongoose.Types.ObjectId(String(addonId));
    const rejectionReason = String(reason || '').trim();
    if (!rejectionReason) {
        throw new ValidationError('Rejection reason is required');
    }
    const updated = await FoodAddon.findOneAndUpdate(
        { _id, isDeleted: { $ne: true } },
        {
            $set: {
                approvalStatus: 'rejected',
                rejectionReason,
                rejectedAt: new Date()
            }
        },
        { new: true }
    ).lean();

    if (updated?.restaurantId) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Addon Rejected ❌',
                    body: `Your addon request for "${updated.draft?.name || 'New Addon'}" was rejected. Reason: ${rejectionReason}`,
                    image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    sendToAllDevices: true,
                    data: {
                        type: 'addon_rejected',
                        addonId: String(updated._id),
                        restaurantId: String(updated.restaurantId),
                        reason: rejectionReason,
                        targetUrl: '/food/restaurant',
                        link: '/food/restaurant',
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send addon rejection notification:', e);
        }
    }

    return updated || null;
}

// ----- Foods (separate collection) -----
export async function getFoods(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const filter = {};

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = query.restaurantId;
    }

    if (query.zoneId && mongoose.Types.ObjectId.isValid(String(query.zoneId))) {
        const zoneOid = new mongoose.Types.ObjectId(String(query.zoneId));
        const matchingRestaurants = await FoodRestaurant.find({ zoneId: zoneOid }).select('_id').lean();
        const matchingRestIds = matchingRestaurants.map((restaurant) => restaurant._id);
        const zoneCondition = {
            $or: [
                { zoneId: zoneOid },
                { zoneId: null, restaurantId: { $in: matchingRestIds } },
                { zoneId: { $exists: false }, restaurantId: { $in: matchingRestIds } }
            ]
        };
        if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, zoneCondition];
            delete filter.$or;
        } else {
            filter.$or = zoneCondition.$or;
        }
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim();
        const searchCondition = {
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { categoryName: { $regex: term, $options: 'i' } }
            ]
        };
        if (filter.$or) {
            filter.$and = [...(filter.$and || []), { $or: filter.$or }, searchCondition];
            delete filter.$or;
        } else if (filter.$and) {
            filter.$and.push(searchCondition);
        } else {
            filter.$or = searchCondition.$or;
        }
    }
    if (query.approvalStatus && ['pending', 'approved', 'rejected'].includes(String(query.approvalStatus))) {
        filter.approvalStatus = String(query.approvalStatus);
    }

    const [list, total] = await Promise.all([
        FoodItem.find(filter)
            .select('-oldData -newData +adminPrice')
            .sort({ _id: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodItem.countDocuments(filter)
    ]);

    const validRestaurantIds = Array.from(new Set(
        list.map((f) => String(f.restaurantId)).filter(id => id && mongoose.Types.ObjectId.isValid(id))
    ));
    const restaurants = validRestaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: validRestaurantIds } }).select('restaurantName name foodType pureVegRestaurant zoneId').lean()
        : [];
    const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName || r.name]));
    const restaurantZoneMap = new Map(restaurants.map((r) => [String(r._id), r.zoneId ? String(r.zoneId) : null]));

    const foodZoneIds = Array.from(new Set(
        list.map((f) => f.zoneId ? String(f.zoneId) : (restaurantZoneMap.get(String(f.restaurantId)) || null)).filter(Boolean)
    ));
    const zones = foodZoneIds.length
        ? await FoodZone.find({ _id: { $in: foodZoneIds } }).select('name zoneName serviceLocation').lean()
        : [];
    const zoneMap = new Map(zones.map((z) => [String(z._id), z.name || z.zoneName || z.serviceLocation || 'Zone']));

    const foods = list.map((f) => {
        const resolvedZoneId = f.zoneId ? String(f.zoneId) : (restaurantZoneMap.get(String(f.restaurantId)) || null);
        const resolvedZoneName = resolvedZoneId ? (zoneMap.get(resolvedZoneId) || '') : '';
        return {
            id: f._id,
            _id: f._id,
            restaurantId: f.restaurantId,
            restaurantName: restaurantMap.get(String(f.restaurantId)) || 'Unknown Restaurant',
            zoneId: resolvedZoneId,
            zoneName: resolvedZoneName,
            categoryId: f.categoryId || null,
            categoryName: f.categoryName || '',
            name: f.name,
            description: f.description || '',
            // The restaurant's own price; adminPrice (when set) is what is charged.
            price: getFoodDisplayPrice({ price: f.price, variants: f.variants }),
            adminPrice: getFoodAdminPrice(f),
            variants: serializeFoodVariants(f.variants),
            variations: serializeFoodVariants(f.variants),
            image: f.image || '',
            foodType: f.foodType || 'Non-Veg',
            isAvailable: f.isAvailable !== false,
            isRecommended: f.isRecommended === true,
            preparationTime: f.preparationTime || '',
            approvalStatus: f.approvalStatus || 'approved',
            createdAt: f.createdAt,
            updatedAt: f.updatedAt
        };
    });

    return { foods, total, page, limit };
}

const resolveAdminFoodCategory = async ({ categoryId, categoryName, foodType, restaurantFoodType }) => {
    let resolvedCategoryId = null;
    let resolvedCategoryName = typeof categoryName === 'string' ? categoryName.trim() : '';
    let categoryDoc = null;

    if (categoryId) {
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            throw new ValidationError('Invalid category id');
        }
        categoryDoc = await FoodCategory.findById(categoryId)
            .select('name foodTypeScope')
            .lean();
        if (!categoryDoc?._id) {
            throw new ValidationError('Category not found');
        }
        resolvedCategoryId = categoryDoc._id;
        resolvedCategoryName = categoryDoc.name || resolvedCategoryName;
    } else if (resolvedCategoryName) {
        categoryDoc = await FoodCategory.findOne({
            name: { $regex: new RegExp(`^${resolvedCategoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        })
            .select('name foodTypeScope')
            .lean();
        if (categoryDoc?._id) {
            resolvedCategoryId = categoryDoc._id;
            resolvedCategoryName = categoryDoc.name || resolvedCategoryName;
        }
    }

    if (!resolvedCategoryName) {
        throw new ValidationError('Category is required');
    }

    if (categoryDoc?.foodTypeScope) {
        if (restaurantFoodType === 'Veg' && String(categoryDoc.foodTypeScope || '') === 'Non-Veg') {
            throw new ValidationError('Veg restaurants can only use veg categories');
        }
        if (restaurantFoodType === 'Non-Veg' && String(categoryDoc.foodTypeScope || '') === 'Veg') {
            throw new ValidationError('Non-veg restaurants can only use non-veg categories');
        }
        if (!categoryAllowsFoodType(categoryDoc.foodTypeScope, foodType)) {
            throw new ValidationError(`This ${categoryDoc.foodTypeScope} category cannot accept ${foodType} food`);
        }
    }

    return {
        categoryId: resolvedCategoryId,
        categoryName: resolvedCategoryName
    };
};

/**
 * Admin price override from the request: undefined = not sent (keep), null =
 * cleared, otherwise a price > 0 that replaces the restaurant's price for
 * customers, carts, orders and the restaurant's own view.
 */
const parseAdminPriceInput = (value) => {
    if (value === undefined) return undefined;
    if (value === null || String(value).trim() === '') return null;
    const adminPrice = Number(value);
    if (!Number.isFinite(adminPrice) || adminPrice <= 0) {
        throw new ValidationError('Admin price must be greater than 0');
    }
    return Math.round(adminPrice * 100) / 100;
};

const assertAdminPriceAllowed = (adminPrice, variants) => {
    if (adminPrice != null && hasFoodVariants({ variants })) {
        throw new ValidationError('Admin price applies only to items without variants. Set variant prices instead.');
    }
};

const getAdminFoodCreatePricing = (body = {}) => {
    const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
    if (variants.length > 0) {
        return {
            price: getFoodDisplayPrice({ variants }),
            variants
        };
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new ValidationError('Price must be greater than 0');
    return {
        price,
        variants: []
    };
};

const getAdminFoodUpdatedPricing = (existing = {}, body = {}) => {
    const variantsTouched = body.variants !== undefined || body.variations !== undefined;
    const existingHasVariants = hasFoodVariants(existing);
    const update = {};

    if (variantsTouched) {
        const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
        update.variants = variants;

        if (variants.length > 0) {
            update.price = getFoodDisplayPrice({ variants });
            return update;
        }

        const nextBasePrice = body.price !== undefined ? Number(body.price) : Number(existingHasVariants ? NaN : existing.price);
        if (!Number.isFinite(nextBasePrice) || nextBasePrice <= 0) {
            throw new ValidationError('Base price must be greater than 0 when variants are removed');
        }
        update.price = nextBasePrice;
        return update;
    }

    if (body.price !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base price for foods with variants');
        }
        const price = Number(body.price);
        if (!Number.isFinite(price) || price <= 0) throw new ValidationError('Price must be greater than 0');
        update.price = price;
    }

    return update;
};

export async function createFood(body) {
    const restaurantId = body.restaurantId;
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Valid restaurantId is required');
    }
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('foodType pureVegRestaurant zoneId')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }

    if (!body.zoneId || !mongoose.Types.ObjectId.isValid(String(body.zoneId))) {
        throw new ValidationError('A valid Zone selection is mandatory');
    }
    const zoneOid = new mongoose.Types.ObjectId(String(body.zoneId));
    const zoneExists = await FoodZone.exists({ _id: zoneOid, isActive: true });
    if (!zoneExists) {
        throw new ValidationError('Selected zone is invalid, deactivated, or deleted');
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('Food name is required');
    const foodType = normalizeDishFoodType(body.foodType);
    const restaurantFoodType = restaurant.foodType || (restaurant.pureVegRestaurant ? 'Veg' : 'Mixed');
    if (restaurantFoodType === 'Veg' && foodType !== 'Veg') {
        throw new ValidationError('Veg restaurants can only add veg foods');
    }
    if (restaurantFoodType === 'Non-Veg' && foodType !== 'Non-Veg') {
        throw new ValidationError('Non-veg restaurants can only add non-veg foods');
    }
    const { price, variants } = getAdminFoodCreatePricing(body);
    const adminPrice = parseAdminPriceInput(body.adminPrice) ?? null;
    assertAdminPriceAllowed(adminPrice, variants);
    const image = normalizeImageForStorage(typeof body.image === 'string' ? body.image : '');

    let categoryName = typeof body.categoryName === 'string' ? body.categoryName.trim() : '';
    if (!categoryName && typeof body.category === 'string') categoryName = body.category.trim();
    const { categoryId, categoryName: resolvedCategoryName } = await resolveAdminFoodCategory({
        categoryId: body.categoryId,
        categoryName,
        foodType,
        restaurantFoodType,
    });

    const doc = new FoodItem({
        restaurantId,
        zoneId: zoneOid,
        categoryId,
        categoryName: resolvedCategoryName,
        name,
        description: typeof body.description === 'string' ? body.description.trim() : '',
        price,
        adminPrice,
        priceOnOtherPlatforms: body.priceOnOtherPlatforms ? Number(body.priceOnOtherPlatforms) : null,
        otherPlatformGst: body.otherPlatformGst !== undefined && body.otherPlatformGst !== null
            ? Number(body.otherPlatformGst)
            : null,
        variants,
        image,
        foodType,
        isAvailable: body.isAvailable !== false,
        isRecommended: body.isRecommended === true,
        preparationTime: typeof body.preparationTime === 'string' ? body.preparationTime.trim() : '',
        approvalStatus: 'approved'
    });
    await doc.save();
    return doc.toObject();
}

export async function updateFood(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodItem.findById(id).select('+adminPrice');
    if (!doc) return null;
    const restaurant = await FoodRestaurant.findById(doc.restaurantId)
        .select('foodType pureVegRestaurant')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }

    if (body.zoneId !== undefined) {
        if (!body.zoneId || !mongoose.Types.ObjectId.isValid(String(body.zoneId))) {
            throw new ValidationError('A valid Zone selection is mandatory');
        }
        const zoneOid = new mongoose.Types.ObjectId(String(body.zoneId));
        const zoneExists = await FoodZone.exists({ _id: zoneOid, isActive: true });
        if (!zoneExists) {
            throw new ValidationError('Selected zone is invalid, deactivated, or deleted');
        }
        doc.zoneId = zoneOid;
    }

    if (body.name !== undefined) doc.name = String(body.name || '').trim();
    if (body.description !== undefined) doc.description = String(body.description || '').trim();
    const restaurantFoodType = restaurant.foodType || (restaurant.pureVegRestaurant ? 'Veg' : 'Mixed');
    const targetFoodType = body.foodType !== undefined
        ? normalizeDishFoodType(body.foodType)
        : normalizeDishFoodType(doc.foodType);
    if (restaurantFoodType === 'Veg' && targetFoodType !== 'Veg') {
        throw new ValidationError('Veg restaurants can only have veg foods');
    }
    if (restaurantFoodType === 'Non-Veg' && targetFoodType !== 'Non-Veg') {
        throw new ValidationError('Non-veg restaurants can only have non-veg foods');
    }
    const pricingUpdate = getAdminFoodUpdatedPricing(doc.toObject(), body);
    if (pricingUpdate.price !== undefined) doc.price = pricingUpdate.price;
    if (pricingUpdate.variants !== undefined) doc.variants = pricingUpdate.variants;
    const requestedAdminPrice = parseAdminPriceInput(body.adminPrice);
    if (requestedAdminPrice !== undefined) {
        assertAdminPriceAllowed(requestedAdminPrice, doc.variants);
        doc.adminPrice = requestedAdminPrice;
    } else if (doc.adminPrice != null && hasFoodVariants({ variants: doc.variants })) {
        // The item now has variants, which are priced individually: an
        // item-level override no longer applies and must not linger hidden.
        doc.adminPrice = null;
    }
    if (body.priceOnOtherPlatforms !== undefined) doc.priceOnOtherPlatforms = body.priceOnOtherPlatforms ? Number(body.priceOnOtherPlatforms) : null;
    if (body.otherPlatformGst !== undefined) {
        doc.otherPlatformGst = body.otherPlatformGst !== null && body.otherPlatformGst !== ''
            ? Number(body.otherPlatformGst)
            : null;
    }
    // The old file is removed only after the save succeeds: deleting it here
    // left the dish pointing at a missing image whenever a later check (diet,
    // category) rejected the update.
    let replacedImages = [];
    if (body.image !== undefined && String(body.image || '').trim() !== String(doc.image || '').trim()) {
        const image = normalizeImageForStorage(body.image);
        replacedImages = removedAssetUrls(doc.image, image);
        doc.image = image;
    }
    if (body.foodType !== undefined) doc.foodType = targetFoodType;
    if (body.isAvailable !== undefined) doc.isAvailable = body.isAvailable !== false;
    if (body.isRecommended !== undefined) doc.isRecommended = body.isRecommended === true;
    if (body.preparationTime !== undefined) doc.preparationTime = String(body.preparationTime || '').trim();
    if (body.categoryId !== undefined || body.categoryName !== undefined || body.category !== undefined || body.foodType !== undefined) {
        const nextCategoryName = body.categoryName !== undefined
            ? String(body.categoryName || '').trim()
            : (body.category !== undefined ? String(body.category || '').trim() : doc.categoryName);
        /*
         * `restaurantFoodType` is what resolveAdminFoodCategory actually takes.
         * This used to pass `pureVegRestaurant` / `pureVeganRestaurant`, which
         * are not declared anywhere in this function, so every admin food update
         * that touched the category or the food type threw
         * "pureVegRestaurant is not defined" before it could save.
         */
        const { categoryId, categoryName } = await resolveAdminFoodCategory({
            categoryId: body.categoryId !== undefined ? body.categoryId : doc.categoryId,
            categoryName: nextCategoryName,
            foodType: targetFoodType,
            restaurantFoodType,
        });
        doc.categoryId = categoryId;
        doc.categoryName = categoryName;
    }
    await doc.save();
    if (replacedImages.length) await deleteFoodImagesIfUnused(replacedImages);
    return doc.toObject();
}

export async function deleteFood(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodItem.findByIdAndDelete(id).lean();
    if (deleted) await deleteFoodImagesIfUnused(deleted.image);
    return deleted ? { id } : null;
}

/** Check for duplicate email, owner phone, or primary contact number across active restaurants */
export async function checkRestaurantDuplicate({ email, phone, primaryContact, excludeRestaurantId } = {}) {
    const errors = {};
    const toStr = (v) => (v != null && v !== undefined ? String(v).trim() : '');
    const cleanEmail = toStr(email).toLowerCase();
    const rawPhone = toStr(phone);
    const phoneDigits = rawPhone.replace(/\D/g, '').slice(-15);
    const phoneLast10 = phoneDigits ? phoneDigits.slice(-10) : '';
    const rawPrimary = toStr(primaryContact);
    const primaryDigits = rawPrimary.replace(/\D/g, '').slice(-15);
    const primaryLast10 = primaryDigits ? primaryDigits.slice(-10) : '';

    const idFilter = excludeRestaurantId && mongoose.Types.ObjectId.isValid(excludeRestaurantId)
        ? { _id: { $ne: new mongoose.Types.ObjectId(excludeRestaurantId) } }
        : {};

    if (cleanEmail) {
        const emailPattern = new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const emailMatch = await FoodRestaurant.findOne({
            ...idFilter,
            ownerEmail: emailPattern,
            status: { $ne: 'deleted' }
        }).select('_id restaurantName ownerEmail').lean();

        if (emailMatch) {
            errors.ownerEmail = 'This email is already registered with another restaurant';
        }
    }

    if (phoneLast10) {
        const phonePattern = new RegExp(`${phoneLast10}$`);
        const phoneMatch = await FoodRestaurant.findOne({
            ...idFilter,
            status: { $ne: 'deleted' },
            $or: [
                { ownerPhoneLast10: phoneLast10 },
                { ownerPhone: { $regex: phonePattern } },
                { ownerPhoneDigits: { $regex: phonePattern } }
            ]
        }).select('_id restaurantName ownerPhone').lean();

        if (phoneMatch) {
            errors.ownerPhone = 'This phone number is already registered with another restaurant';
        }
    }

    if (primaryLast10 && primaryLast10 !== phoneLast10) {
        const primaryPattern = new RegExp(`${primaryLast10}$`);
        const primaryMatch = await FoodRestaurant.findOne({
            ...idFilter,
            status: { $ne: 'deleted' },
            $or: [
                { primaryContactNumber: { $regex: primaryPattern } },
                { ownerPhoneLast10: primaryLast10 },
                { ownerPhone: { $regex: primaryPattern } }
            ]
        }).select('_id restaurantName primaryContactNumber').lean();

        if (primaryMatch) {
            errors.primaryContactNumber = 'This primary contact number is already registered with another restaurant';
        }
    }

    return {
        available: Object.keys(errors).length === 0,
        errors
    };
}

/** Admin creates a restaurant (JSON body with image URLs already uploaded). Single API. */
export async function createRestaurantByAdmin(body) {
    const loc = body.location || {};
    const toStr = (v) => (v != null && v !== undefined ? String(v).trim() : '');
    const toUrl = (v) => (v && (typeof v === 'string' ? v : v.url)) ? (typeof v === 'string' ? v : v.url) : undefined;
    const coordinates = Array.isArray(loc.coordinates) ? loc.coordinates : [];
    const lngFromCoordinates = toFiniteNumber(coordinates[0]);
    const latFromCoordinates = toFiniteNumber(coordinates[1]);
    const latitude = toFiniteNumber(loc.latitude ?? latFromCoordinates);
    const longitude = toFiniteNumber(loc.longitude ?? lngFromCoordinates);
    const menuUrls = Array.isArray(body.menuImages)
        ? body.menuImages.map((m) => toUrl(m)).filter(Boolean)
        : [];

    // No hardcoded hours: the admin form requires both times; missing stays unset.
    const normalizedOpeningTime = normalizeRestaurantTime(body.openingTime) || '';
    const normalizedClosingTime = normalizeRestaurantTime(body.closingTime) || '';
    validateOpeningClosingTimes(normalizedOpeningTime, normalizedClosingTime);

    const doc = {
        restaurantName: toStr(body.restaurantName) || toStr(body.name),
        ownerName: toStr(body.ownerName),
        ownerEmail: toStr(body.ownerEmail),
        ownerPhone: toStr(body.ownerPhone),
        primaryContactNumber: toStr(body.primaryContactNumber) || toStr(body.ownerPhone),
        pureVegRestaurant: body.pureVegRestaurant !== undefined
            ? parseBooleanLike(body.pureVegRestaurant, 'pureVegRestaurant')
            : false,
        // DISABLED: "Pure Vegan" cannot be set on create any more.
        pureVeganRestaurant: body.pureVeganRestaurant !== undefined
            ? (parseBooleanLike(body.pureVeganRestaurant, 'pureVeganRestaurant') && false)
            : false,
        addressLine1: toStr(loc.addressLine1),
        addressLine2: toStr(loc.addressLine2),
        area: toStr(loc.area),
        city: toStr(loc.city),
        state: toStr(loc.state),
        pincode: toStr(loc.pincode),
        landmark: toStr(loc.landmark),
        cuisines: Array.isArray(body.cuisines) ? body.cuisines : [],
        openingTime: normalizedOpeningTime,
        closingTime: normalizedClosingTime,
        openDays: Array.isArray(body.openDays) ? body.openDays : [],
        panNumber: toStr(body.panNumber),
        nameOnPan: toStr(body.nameOnPan),
        gstRegistered: Boolean(body.gstRegistered),
        gstNumber: toStr(body.gstNumber),
        gstLegalName: toStr(body.gstLegalName),
        gstAddress: toStr(body.gstAddress),
        fssaiNumber: toStr(body.fssaiNumber),
        fssaiExpiry: body.fssaiExpiry ? new Date(body.fssaiExpiry) : undefined,
        accountNumber: toStr(body.accountNumber),
        ifscCode: toStr(body.ifscCode),
        accountHolderName: toStr(body.accountHolderName),
        accountType: toStr(body.accountType),
        menuImages: menuUrls,
        profileImage: toUrl(body.profileImage),
        panImage: toUrl(body.panImage),
        gstImage: toUrl(body.gstImage),
        fssaiImage: toUrl(body.fssaiImage),
        estimatedDeliveryTime: toStr(body.estimatedDeliveryTime),
        featuredDish: toStr(body.featuredDish),
        featuredPrice: typeof body.featuredPrice === 'number' ? body.featuredPrice : (parseFloat(body.featuredPrice) || undefined),
        offer: toStr(body.offer),
        diningSettings: body.diningSettings && typeof body.diningSettings === 'object'
            ? {
                isEnabled: Boolean(body.diningSettings.isEnabled),
                maxGuests: Math.max(1, parseInt(body.diningSettings.maxGuests, 10) || 6),
                diningType: toStr(body.diningSettings.diningType) || 'family-dining'
            }
            : undefined,
        status: 'approved',
        approvedAt: new Date()
    };

    if (body.zoneId !== undefined) {
        const zoneId = String(body.zoneId || '').trim();
        if (!zoneId) {
            doc.zoneId = undefined;
        } else if (!mongoose.Types.ObjectId.isValid(zoneId)) {
            throw new ValidationError('Invalid zoneId');
        } else {
            doc.zoneId = new mongoose.Types.ObjectId(zoneId);
        }
    }

    // Business type (family restaurant, cafe, ...), same list as restaurant self-onboarding.
    // Optional here so older admin clients keep working; the admin form requires it.
    const rawRestaurantType = toStr(body.restaurantType);
    if (rawRestaurantType) {
        const restaurantType = normalizeRestaurantType(rawRestaurantType);
        if (!restaurantType) throw new ValidationError('Restaurant type is invalid');
        doc.restaurantType = restaurantType;
    }

    if (latitude !== null && longitude !== null) {
        doc.location = {
            type: 'Point',
            coordinates: [longitude, latitude],
            latitude,
            longitude,
            formattedAddress: toStr(loc.formattedAddress || loc.address || loc.addressLine1),
            address: toStr(loc.address || loc.formattedAddress || loc.addressLine1),
            addressLine1: toStr(loc.addressLine1 || loc.formattedAddress || loc.address),
            addressLine2: toStr(loc.addressLine2),
            area: toStr(loc.area),
            city: toStr(loc.city),
            state: toStr(loc.state),
            pincode: toStr(loc.pincode || loc.zipCode || loc.postalCode),
            landmark: toStr(loc.landmark),
        };
    }

    if (!doc.restaurantName || !doc.ownerName) {
        throw new ValidationError('Restaurant name and owner name are required');
    }
    if (!doc.ownerPhone && !doc.primaryContactNumber) {
        throw new ValidationError('Owner phone or primary contact number is required');
    }

    if (doc.pureVeganRestaurant === true) {
        doc.pureVegRestaurant = true;
    }

    // Verify duplicate email, phone, or contact number before creating
    const duplicateCheck = await checkRestaurantDuplicate({
        email: doc.ownerEmail,
        phone: doc.ownerPhone,
        primaryContact: doc.primaryContactNumber
    });
    if (!duplicateCheck.available) {
        const firstField = Object.keys(duplicateCheck.errors)[0];
        const errorMsg = duplicateCheck.errors[firstField];
        const error = new ValidationError(errorMsg);
        error.statusCode = 409;
        error.field = firstField;
        error.errors = duplicateCheck.errors;
        throw error;
    }

    await assertZoneCoversLocation(doc.zoneId, doc.location?.latitude, doc.location?.longitude);

    let restaurant;
    try {
        restaurant = await FoodRestaurant.create(doc);
    } catch (e) {
        if (e?.code === 11000 || e?.name === 'MongoServerError') {
            const keyPattern = e?.keyPattern || {};
            if (keyPattern.ownerEmail) {
                const err = new ValidationError('This owner email is already registered with another restaurant');
                err.statusCode = 409;
                err.field = 'ownerEmail';
                err.errors = { ownerEmail: err.message };
                throw err;
            }
            if (keyPattern.ownerPhone || keyPattern.ownerPhoneLast10) {
                const err = new ValidationError('This owner phone number is already registered with another restaurant');
                err.statusCode = 409;
                err.field = 'ownerPhone';
                err.errors = { ownerPhone: err.message };
                throw err;
            }
            if (keyPattern.restaurantNameNormalized && keyPattern.ownerPhoneLast10) {
                const err = new ValidationError('A restaurant with this name and owner phone is already registered');
                err.statusCode = 409;
                err.field = 'restaurantName';
                err.errors = { restaurantName: err.message };
                throw err;
            }
        }
        throw e;
    }

    try {
        const { seedOutletTimingsForRestaurant } = await import(
            '../../restaurant/services/outletTimings.service.js'
        );
        await seedOutletTimingsForRestaurant(restaurant._id, {
            openingTime: normalizedOpeningTime,
            closingTime: normalizedClosingTime,
            openDays: doc.openDays || []
        });
    } catch (e) {
        logger.warn(
            `[OutletTimings] Failed to seed timings for admin-created restaurant ${restaurant._id}: ${e?.message || e}`
        );
    }

    return restaurant.toObject();
}

async function sendRestaurantApprovalNotifications(restaurant, existing = {}, isChangesApproval = false) {
    const restaurantId = String(restaurant._id);
    const recipientEmail = String(restaurant.ownerEmail || existing.ownerEmail || '').trim();
    const restaurantName = restaurant.restaurantName || existing.restaurantName || 'your restaurant';

    const pushTitle = isChangesApproval
        ? 'Profile Changes Approved! ✅'
        : 'Congratulations! 🎉';
    const pushBody = isChangesApproval
        ? `Your profile changes for "${restaurantName}" have been approved and are now live.`
        : `Your restaurant "${restaurantName}" has been approved. You can now start receiving orders!`;
    const targetUrl = isChangesApproval
        ? '/food/restaurant'
        : '/food/restaurant/pending-verification';

    logger.info(`[APPROVE-EMAIL] Restaurant ${restaurantId} — ownerEmail=${recipientEmail || 'MISSING'}`);

    // Persist an inbox row first: push/email are best-effort, but the partner panel
    // reads this collection, so it must survive refresh and re-login.
    try {
        const { FoodNotification } = await import('../../../../core/notifications/models/notification.model.js');
        const inboxRow = await FoodNotification.findOneAndUpdate(
            {
                ownerType: 'RESTAURANT',
                ownerId: restaurant._id,
                source: 'RESTAURANT_APPROVAL',
                'metadata.approvalType': isChangesApproval ? 'changes' : 'registration'
            },
            {
                $set: {
                    title: isChangesApproval ? 'Profile Changes Approved' : 'Restaurant Approved',
                    message: pushBody,
                    link: targetUrl,
                    category: 'approval',
                    isRead: false,
                    readAt: null,
                    dismissedAt: null,
                    metadata: {
                        restaurantId,
                        restaurantName,
                        approvalType: isChangesApproval ? 'changes' : 'registration',
                        approvedAt: new Date().toISOString()
                    }
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        logger.info(`[APPROVE-INBOX] Restaurant ${restaurantId} — notification ${inboxRow?._id}`);

        // Nudge any open partner session to refetch the inbox immediately.
        try {
            const io = getIO();
            if (io) {
                io.to(rooms.restaurant(restaurantId)).emit('admin_notification', {
                    id: String(inboxRow?._id || ''),
                    title: inboxRow?.title,
                    message: inboxRow?.message,
                    link: targetUrl,
                    type: isChangesApproval ? 'restaurant_changes_approved' : 'restaurant_approved',
                    createdAt: inboxRow?.createdAt || new Date().toISOString()
                });
            }
        } catch (socketError) {
            logger.warn(`[APPROVE-INBOX] Restaurant ${restaurantId} — socket emit failed: ${socketError?.message || socketError}`);
        }
    } catch (e) {
        logger.error(`[APPROVE-INBOX] Restaurant ${restaurantId} — inbox write failed: ${e?.message || e}`);
    }

    try {
        const { notifyOwnersSafely, listOwnerTokens } = await import('../../../../core/notifications/firebase.service.js');
        const tokens = await listOwnerTokens({ ownerType: 'RESTAURANT', ownerId: restaurant._id });
        logger.info(`[APPROVE-FCM] Restaurant ${restaurantId} — deviceTokens=${tokens.length}${isChangesApproval ? ' (changes)' : ''}`);

        const fcmResult = await notifyOwnersSafely(
            [{ ownerType: 'RESTAURANT', ownerId: restaurant._id }],
            {
                title: pushTitle,
                body: pushBody,
                image: restaurant.profileImage || 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                sendToAllDevices: true,
                data: {
                    type: isChangesApproval ? 'restaurant_changes_approved' : 'restaurant_approved',
                    restaurantId,
                    targetUrl,
                    link: targetUrl,
                }
            }
        );
        const delivered = Array.isArray(fcmResult)
            ? fcmResult.reduce((sum, item) => sum + (item?.successCount || 0), 0)
            : fcmResult?.successCount || 0;
        logger.info(`[APPROVE-FCM] Restaurant ${restaurantId} — pushDelivered=${delivered}`);
    } catch (e) {
        logger.error(`[APPROVE-FCM] Restaurant ${restaurantId} — FCM failed: ${e?.message || e}`);
    }

    if (!recipientEmail) {
        logger.warn(`[APPROVE-EMAIL] Restaurant ${restaurantId} — email skipped (no ownerEmail)`);
        return false;
    }

    try {
        const { sendRestaurantApprovalEmail } = await import('../../../../utils/email.js');
        const emailSent = await sendRestaurantApprovalEmail({
            to: recipientEmail,
            restaurantName,
            restaurantId,
            isChangesApproval
        });
        if (emailSent) {
            logger.info(`[APPROVE-EMAIL] Restaurant ${restaurantId} — email sent to ${recipientEmail}`);
        } else {
            logger.warn(`[APPROVE-EMAIL] Restaurant ${restaurantId} — email FAILED for ${recipientEmail}`);
        }
        return emailSent;
    } catch (e) {
        logger.error(`[APPROVE-EMAIL] Restaurant ${restaurantId} — email error: ${e?.message || e}`);
        return false;
    }
}

async function sendDeliveryApprovalNotifications(partner, existing = {}, isChangesApproval = false) {
    const partnerId = String(partner._id);
    let recipientEmail = String(partner.email || existing.email || '').trim().toLowerCase();
    const partnerName = partner.name || existing.name || 'Partner';

    const pushTitle = isChangesApproval
        ? 'Profile Changes Approved! ✅'
        : 'Welcome Aboard! 🛵';
    const pushBody = isChangesApproval
        ? 'Your delivery profile changes have been approved. You can continue delivering with Eatiefy.'
        : 'Your delivery partner application has been approved. You can now go online and start earning!';
    const targetUrl = isChangesApproval
        ? '/food/delivery'
        : '/food/delivery/pending-verification';

    if (!recipientEmail && mongoose.Types.ObjectId.isValid(partnerId)) {
        const fresh = await FoodDeliveryPartner.findById(partnerId).select('email name').lean();
        recipientEmail = String(fresh?.email || '').trim().toLowerCase();
    }

    logger.info(`[APPROVE-EMAIL] Delivery ${partnerId} — email=${recipientEmail || 'MISSING'}`);

    // Persist an inbox row first: push/email are best-effort, but the partner app
    // reads this collection, so it must survive refresh and re-login.
    try {
        const { FoodNotification } = await import('../../../../core/notifications/models/notification.model.js');
        const inboxRow = await FoodNotification.findOneAndUpdate(
            {
                ownerType: 'DELIVERY_PARTNER',
                ownerId: partner._id,
                source: 'DELIVERY_PARTNER_APPROVAL',
                'metadata.approvalType': isChangesApproval ? 'changes' : 'registration'
            },
            {
                $set: {
                    title: isChangesApproval ? 'Profile Changes Approved' : 'Account Approved',
                    message: pushBody,
                    link: targetUrl,
                    category: 'approval',
                    isRead: false,
                    readAt: null,
                    dismissedAt: null,
                    metadata: {
                        partnerId,
                        partnerName,
                        approvalType: isChangesApproval ? 'changes' : 'registration',
                        approvedAt: new Date().toISOString()
                    }
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        logger.info(`[APPROVE-INBOX] Delivery ${partnerId} — notification ${inboxRow?._id}`);

        // Nudge any open partner session to refetch the inbox immediately.
        try {
            const io = getIO();
            if (io) {
                io.to(rooms.delivery(partnerId)).emit('admin_notification', {
                    id: String(inboxRow?._id || ''),
                    title: inboxRow?.title,
                    message: inboxRow?.message,
                    link: targetUrl,
                    type: isChangesApproval ? 'delivery_changes_approved' : 'delivery_approved',
                    createdAt: inboxRow?.createdAt || new Date().toISOString()
                });
            }
        } catch (socketError) {
            logger.warn(`[APPROVE-INBOX] Delivery ${partnerId} — socket emit failed: ${socketError?.message || socketError}`);
        }
    } catch (e) {
        logger.error(`[APPROVE-INBOX] Delivery ${partnerId} — inbox write failed: ${e?.message || e}`);
    }

    try {
        const { notifyOwnerSafely, listOwnerTokens } = await import('../../../../core/notifications/firebase.service.js');
        const tokens = await listOwnerTokens({ ownerType: 'DELIVERY_PARTNER', ownerId: partner._id });
        logger.info(`[APPROVE-FCM] Delivery ${partnerId} — deviceTokens=${tokens.length}${tokens.length ? ` (platform fields: web+mobile)` : ' — NO TOKENS IN DB'}${isChangesApproval ? ' (changes)' : ''}`);

        if (!tokens.length) {
            logger.warn(`[APPROVE-FCM] Delivery ${partnerId} — push skipped; partner has no FCM token saved`);
        } else {
            const fcmResult = await notifyOwnerSafely(
                { ownerType: 'DELIVERY_PARTNER', ownerId: partner._id },
                {
                    title: pushTitle,
                    body: pushBody,
                    image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    sendToAllDevices: true,
                    data: {
                        type: isChangesApproval ? 'delivery_changes_approved' : 'onboarding_approved',
                        partnerId,
                        targetUrl,
                        link: targetUrl,
                    }
                }
            );
            logger.info(`[APPROVE-FCM] Delivery ${partnerId} — pushDelivered=${fcmResult?.successCount ?? 0}`);
        }
    } catch (e) {
        logger.error(`[APPROVE-FCM] Delivery ${partnerId} — FCM failed: ${e?.message || e}`);
    }

    if (!recipientEmail) {
        logger.warn(`[APPROVE-EMAIL] Delivery ${partnerId} — email skipped (no email)`);
        return false;
    }

    try {
        const { sendDeliveryApprovalEmail } = await import('../../../../utils/email.js');
        const emailSent = await sendDeliveryApprovalEmail({
            to: recipientEmail,
            partnerName,
            partnerId,
            isChangesApproval
        });
        if (emailSent) {
            logger.info(`[APPROVE-EMAIL] Delivery ${partnerId} — email sent to ${recipientEmail}`);
        } else {
            logger.warn(`[APPROVE-EMAIL] Delivery ${partnerId} — email FAILED for ${recipientEmail}`);
        }
        return emailSent;
    } catch (e) {
        logger.error(`[APPROVE-EMAIL] Delivery ${partnerId} — email error: ${e?.message || e}`);
        return false;
    }
}

export async function approveRestaurant(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

    logger.info(`[ADMIN-APPROVE] approveRestaurant service called id=${id}`);

    const existing = await FoodRestaurant.findById(id).select('status ownerEmail restaurantName pendingApprovalType').lean();
    if (!existing) return null;
    const isChangesApproval = existing.pendingApprovalType === 'changes';

    const updated = await FoodRestaurant.findByIdAndUpdate(
        id,
        {
            $set: {
                status: 'approved',
                approvedAt: new Date(),
                pendingApprovalType: 'registration'
            },
            $unset: {
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true, runValidators: false }
    ).lean();

    if (updated) {
        await sendRestaurantApprovalNotifications(updated, existing, isChangesApproval);
    }
    return updated;
}

export async function rejectRestaurant(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

    const existing = await FoodRestaurant.findById(id).select('status ownerEmail pendingApprovalType').lean();
    if (!existing) return null;
    const isChangesRejection = existing.pendingApprovalType === 'changes';
    const trimmedReason = typeof reason === 'string' ? reason.trim() : undefined;

    const updated = await FoodRestaurant.findByIdAndUpdate(
        id,
        {
            $set: {
                status: 'rejected',
                rejectedAt: new Date(),
                rejectionReason: trimmedReason,
                approvedAt: null,
                pendingApprovalType: 'registration'
            }
        },
        { new: true, runValidators: false }
    ).lean();

    if (updated) {
        const recipientEmail = String(updated.ownerEmail || existing.ownerEmail || '').trim();

        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            const rejectTitle = isChangesRejection
                ? 'Profile Changes Rejected ❌'
                : 'Update on Registration 📋';
            const rejectBody = isChangesRejection
                ? `Your profile changes for "${updated.restaurantName}" were rejected. Reason: ${reason || 'Incomplete documents'}.`
                : `Your restaurant registration for "${updated.restaurantName}" has been rejected. Reason: ${reason || 'Incomplete documents'}.`;
            const targetUrl = isChangesRejection ? '/food/restaurant' : '/food/restaurant/pending-verification';
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated._id }],
                {
                    title: rejectTitle,
                    body: rejectBody,
                    image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    sendToAllDevices: true,
                    data: {
                        type: isChangesRejection ? 'restaurant_changes_rejected' : 'restaurant_rejected',
                        restaurantId: String(updated._id),
                        reason: reason || '',
                        targetUrl,
                        link: targetUrl,
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send restaurant rejection notification:', e);
        }

        if (recipientEmail) {
            try {
                const { sendRestaurantRejectionEmail } = await import('../../../../utils/email.js');
                const emailSent = await sendRestaurantRejectionEmail({
                    to: recipientEmail,
                    restaurantName: updated.restaurantName,
                    restaurantId: String(updated._id),
                    reason: updated.rejectionReason || trimmedReason,
                    isChangesRejection
                });
                if (emailSent) {
                    console.info(`Restaurant rejection email sent to ${recipientEmail} for ${updated._id}`);
                } else {
                    console.warn(`Restaurant rejection email was not sent for ${updated._id} (${recipientEmail})`);
                }
            } catch (e) {
                console.error('Failed to send restaurant rejection email:', e);
            }
        }
    }
    return updated;
}

export async function deleteRestaurant(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const restaurantId = new mongoose.Types.ObjectId(id);

    const restaurant = await FoodRestaurant.findById(restaurantId).lean();
    if (!restaurant) return null;

    const recipientEmail = restaurant.ownerEmail || restaurant.email;
    const recipientName = restaurant.restaurantName || restaurant.ownerName || 'Restaurant';

    await notifyAccountDeletedByAdmin('RESTAURANT', restaurantId, 'restaurant partner');

    if (recipientEmail) {
        try {
            const { sendAccountDeletionEmail } = await import('../../../../utils/email.js');
            await sendAccountDeletionEmail({
                to: recipientEmail,
                name: recipientName,
                accountType: 'Restaurant',
                details: [
                    ...(restaurant.ownerPhone ? [{ label: 'Registered Phone', value: restaurant.ownerPhone }] : []),
                    ...(restaurant.city ? [{ label: 'City', value: restaurant.city }] : [])
                ]
            });
        } catch (emailErr) {
            logger.error(`[DELETE-EMAIL] Restaurant ${restaurantId} deletion email failed for ${recipientEmail}: ${emailErr?.message || emailErr}`);
        }
    }

    const [foods, addons, categories] = await Promise.all([
        FoodItem.find({ restaurantId }).select('image').lean(),
        FoodAddon.find({ restaurantId }).select('draft.image draft.images published.image published.images').lean(),
        FoodCategory.find({ restaurantId }).select('image').lean()
    ]);

    const imageUrls = [
        ...extractAssetUrls(restaurant.profileImage),
        ...extractAssetUrls(restaurant.coverImages),
        ...extractAssetUrls(restaurant.menuImages),
        ...extractAssetUrls(restaurant.panImage),
        ...extractAssetUrls(restaurant.gstImage),
        ...extractAssetUrls(restaurant.fssaiImage),
        ...extractAssetUrls(restaurant.upiQrImage),
        ...foods.flatMap((item) => extractAssetUrls(item.image)),
        ...addons.flatMap((addon) => [
            ...extractAssetUrls(addon?.draft?.image),
            ...extractAssetUrls(addon?.draft?.images),
            ...extractAssetUrls(addon?.published?.image),
            ...extractAssetUrls(addon?.published?.images)
        ]),
        ...categories.flatMap((category) => extractAssetUrls(category.image))
    ];

    await Promise.all([
        // Delete all food items
        FoodItem.deleteMany({ restaurantId }),
        // Delete all addons
        FoodAddon.deleteMany({ restaurantId }),
        // Delete restaurant-specific categories
        FoodCategory.deleteMany({ restaurantId }),
        // Delete commissions
        FoodRestaurantCommission.deleteMany({ restaurantId }),
        // Delete withdrawals
        FoodRestaurantWithdrawal.deleteMany({ restaurantId }),
        // Delete support tickets
        FoodRestaurantSupportTicket.deleteMany({ restaurantId }),
        // Delete offers linked to this restaurant
        FoodOffer.deleteMany({ restaurantId, restaurantScope: 'selected' }),
        // Finally delete the restaurant
        FoodRestaurant.findByIdAndDelete(restaurantId)
    ]);

    await deleteStoredAssets(imageUrls);

    return { id: restaurantId };
}

// ----- Offers & Coupons -----
export async function getAllOffers(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        const restaurants = await FoodRestaurant.find({ restaurantName: searchRegex }).select('_id').lean();
        filter.$or = [{ couponCode: searchRegex }];
        if (restaurants.length) {
            filter.$or.push({ restaurantId: { $in: restaurants.map((r) => r._id) } });
        }
    }

    const [list, total] = await Promise.all([
        FoodOffer.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate({ path: 'restaurantId', select: 'restaurantName' })
            .lean(),
        FoodOffer.countDocuments(filter),
    ]);

    const offers = list.map((o, index) => {
        const now = Date.now();
        const endTs = o.endDate ? new Date(o.endDate).getTime() : null;
        const isExpired = Boolean(endTs && now >= endTs);
        const restaurantName =
            o.restaurantScope === 'selected'
                ? (o.restaurantId?.restaurantName || 'Selected Restaurant')
                : 'All Restaurants';

        const discountPercentage = o.discountType === 'percentage' ? Number(o.discountValue) : 0;

        const originalPrice = o.discountType === 'flat-price' ? Number(o.discountValue) : 0;
        const discountedPrice = 0;

        return {
            sl: skip + index + 1,
            offerId: String(o._id),
            dishId: 'all',
            restaurantName,
            dishName: 'All Items',
            couponCode: o.couponCode,
            customerGroup: o.customerScope === 'first-time' ? 'new' : 'all',
            customerScope: o.customerScope || 'all',
            discountType: o.discountType,
            discountPercentage,
            originalPrice,
            discountedPrice,
            status: isExpired ? 'inactive' : (o.status || 'active'),
            showInCart: o.showInCart !== false,
            endDate: o.endDate || null,
            startDate: o.startDate || null,
            // Additional info for admin UI (backward compatible)
            minOrderValue: Number(o.minOrderValue) > 0 ? Number(o.minOrderValue) : null,
            maxDiscount: o.maxDiscount ?? null,
            usageLimit: o.usageLimit ?? null,
            perUserLimit: o.perUserLimit ?? null,
            usedCount: o.usedCount ?? 0,
            isFirstOrderOnly: o.isFirstOrderOnly === true,
            restaurantScope: o.restaurantScope,
            restaurantId: o.restaurantScope === 'selected' ? String(o.restaurantId?._id || o.restaurantId || '') : null,
            couponType: o.couponType || 'all',
            zoneIds: (o.zoneIds || []).map((z) => String(z))
        };
    });

    return { offers, total, page, limit };
}

export async function createAdminOffer(body) {
    const existing = await FoodOffer.findOne({ couponCode: body.couponCode }).lean();
    if (existing) {
        throw new ValidationError('Coupon code already exists');
    }

    const doc = await FoodOffer.create({
        couponCode: body.couponCode,
        discountType: body.discountType,
        discountValue: body.discountValue,
        customerScope: body.customerScope,
        restaurantScope: body.restaurantScope,
        restaurantId: body.restaurantScope === 'selected' ? body.restaurantId : undefined,
        minOrderValue: Number(body.minOrderValue) > 0 ? Number(body.minOrderValue) : null,
        maxDiscount: body.maxDiscount ?? null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? null,
        startDate: body.startDate,
        isFirstOrderOnly: body.isFirstOrderOnly === true,
        endDate: body.endDate,
        status: body.endDate && new Date(body.endDate).getTime() <= Date.now() ? 'inactive' : 'active',
        showInCart: true,
        couponType: body.couponType || 'all',
        zoneIds: Array.isArray(body.zoneIds) ? body.zoneIds : []
    });

    if (doc.restaurantScope === 'selected' && doc.restaurantId) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: doc.restaurantId }],
                {
                    title: 'New Campaign Invitation! Ã°Å¸â€œÂ¢',
                    body: `You have been invited to join a new campaign: "${doc.couponCode}". Check it out now!`,
                    image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    data: {
                        type: 'campaign_invitation',
                        offerId: String(doc._id),
                        couponCode: doc.couponCode
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send campaign invitation notification:', e);
        }
    }

    return doc.toObject();
}

export async function updateAdminOffer(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid offer ID');
    }

    const existing = await FoodOffer.findOne({
        couponCode: body.couponCode,
        _id: { $ne: new mongoose.Types.ObjectId(id) }
    }).lean();
    if (existing) {
        throw new ValidationError('Coupon code already exists');
    }

    const updated = await FoodOffer.findByIdAndUpdate(
        id,
        {
            $set: {
                couponCode: body.couponCode,
                couponType: body.couponType || 'all',
                discountType: body.discountType,
                discountValue: body.discountValue,
                customerScope: body.customerScope,
                restaurantScope: body.restaurantScope,
                restaurantId: body.restaurantScope === 'selected' ? body.restaurantId : undefined,
                minOrderValue: Number(body.minOrderValue) > 0 ? Number(body.minOrderValue) : null,
                maxDiscount: body.maxDiscount ?? null,
                usageLimit: body.usageLimit ?? null,
                perUserLimit: body.perUserLimit ?? null,
                startDate: body.startDate || undefined,
                endDate: body.endDate || undefined,
                isFirstOrderOnly: body.isFirstOrderOnly === true,
                zoneIds: Array.isArray(body.zoneIds) ? body.zoneIds : [],
                status: body.endDate && new Date(body.endDate).getTime() <= Date.now() ? 'inactive' : 'active',
            }
        },
        { new: true }
    ).lean();

    return updated;
}

export async function updateAdminOfferCartVisibility(offerId, itemId, showInCart) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;
    if (!itemId) return null;
    const updated = await FoodOffer.findByIdAndUpdate(
        offerId,
        { $set: { showInCart: Boolean(showInCart) } },
        { new: true }
    ).lean();
    return updated;
}

export async function deleteAdminOffer(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodOffer.findByIdAndDelete(id).lean();
    if (!deleted) return null;
    await FoodOfferUsage.deleteMany({ offerId: new mongoose.Types.ObjectId(id) });
    return { id };
}

export async function expireExpiredOffers() {
    const now = new Date();
    await FoodOffer.updateMany(
        { status: 'active', endDate: { $lte: now } },
        { $set: { status: 'inactive' } }
    );
}
// ----- Delivery join requests -----
export async function getDeliveryJoinRequests(query) {
    const { status = 'pending', page = 1, limit = 1000, search, zone, vehicleType } = query;
    const filter = {};
    if (status === 'pending') filter.status = 'pending';
    else if (status === 'denied' || status === 'rejected') filter.status = 'rejected';
    else filter.status = status;

    const andParts = [];
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        andParts.push({
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { phone: { $regex: term, $options: 'i' } }
            ]
        });
    }
    const requestedZoneId = query.zoneId || (zone && mongoose.Types.ObjectId.isValid(String(zone)) ? zone : null);
    if (requestedZoneId && mongoose.Types.ObjectId.isValid(String(requestedZoneId))) {
        andParts.push({ zoneId: new mongoose.Types.ObjectId(String(requestedZoneId)) });
    } else if (zone && typeof zone === 'string' && zone.trim()) {
        const z = zone.trim();
        const matchedZone = await FoodZone.findOne({
            $or: [
                { name: new RegExp(`^${escapeRegexTerm(z)}$`, 'i') },
                { zoneName: new RegExp(`^${escapeRegexTerm(z)}$`, 'i') },
                { serviceLocation: new RegExp(`^${escapeRegexTerm(z)}$`, 'i') }
            ]
        }).select('_id').lean();
        if (matchedZone) {
            andParts.push({ zoneId: matchedZone._id });
        } else {
            andParts.push({ _id: { $in: [] } });
        }
    }
    if (andParts.length) filter.$and = andParts;
    if (vehicleType && vehicleType.trim()) {
        filter.vehicleType = { $regex: vehicleType.trim(), $options: 'i' };
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    const [list, zoneDocs] = await Promise.all([
        FoodDeliveryPartner.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean(),
        FoodZone.find({}).select('_id name zoneName serviceLocation').lean()
    ]);

    const zoneMap = new Map((zoneDocs || []).map((z) => [String(z._id), z.name || z.zoneName || z.serviceLocation || '']));

    const requests = list.map((doc, index) => {
        const resolvedZoneName = doc.zoneId ? (zoneMap.get(String(doc.zoneId)) || '') : '';
        return {
            _id: doc._id,
            sl: skip + index + 1,
            name: doc.name || '',
            email: doc.email || '',
            phone: doc.phone || '',
            zoneId: doc.zoneId ? String(doc.zoneId) : null,
            zone: resolvedZoneName || doc.city || doc.state || doc.address || '',
            zoneName: resolvedZoneName,
            vehicleType: doc.vehicleType || '',
            status: doc.status === 'rejected' ? 'denied' : doc.status,
            rejectionReason: doc.rejectionReason || undefined,
            profilePhoto: doc.profilePhoto || null,
            profileImage: doc.profilePhoto ? { url: doc.profilePhoto } : null
        };
    });

    return { requests };
}

export function getDeliveryWalletsStub() {
    return {
        wallets: [],
        pagination: { page: 1, limit: 100, total: 0, pages: 0 }
    };
}

// ----- Support tickets -----
export async function getSupportTicketStats(query = {}) {
    // Same zone scope as the ticket list, so the counts match what the table shows.
    const scope = await scopeFilterToRiderZone({}, query.zoneId);
    const [open, inProgress, resolved, closed] = await Promise.all([
        DeliverySupportTicket.countDocuments({ ...scope, status: 'open' }),
        DeliverySupportTicket.countDocuments({ ...scope, status: 'in_progress' }),
        DeliverySupportTicket.countDocuments({ ...scope, status: 'resolved' }),
        DeliverySupportTicket.countDocuments({ ...scope, status: 'closed' })
    ]);
    return {
        total: open + inProgress + resolved + closed,
        open,
        inProgress,
        resolved,
        closed
    };
}

export async function getDeliverySupportTickets(query = {}) {
    const { status, priority, search, page = 1, limit = 100 } = query;
    const filter = {};
    if (status && String(status).trim()) filter.status = String(status).trim();
    if (priority && String(priority).trim()) filter.priority = String(priority).trim();
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        filter.$or = [
            { subject: { $regex: term, $options: 'i' } },
            { description: { $regex: term, $options: 'i' } },
            { ticketId: { $regex: term, $options: 'i' } }
        ];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(500, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(500, Number(limit) || 100));

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId);

    const [list, total] = await Promise.all([
        DeliverySupportTicket.find(filter)
            .populate('deliveryPartnerId', 'name phone email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean(),
        DeliverySupportTicket.countDocuments(filter)
    ]);

    const tickets = list.map((t) => ({
        _id: t._id,
        ticketId: t.ticketId,
        subject: t.subject,
        description: t.description,
        category: t.category,
        priority: t.priority,
        status: t.status,
        adminResponse: t.adminResponse,
        respondedAt: t.respondedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        allowedStatusTransitions: getAllowedTicketTransitions('delivery', t.status),
        deliveryPartner: t.deliveryPartnerId
            ? {
                _id: t.deliveryPartnerId._id,
                name: t.deliveryPartnerId.name || '',
                phone: t.deliveryPartnerId.phone || '',
                email: t.deliveryPartnerId.email || ''
            }
            : null
    }));

    return {
        tickets,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

export async function updateDeliverySupportTicket(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const ticket = await DeliverySupportTicket.findById(id);
    if (!ticket) return null;
    const { status, adminResponse } = body || {};
    if (status !== undefined && status !== null && String(status) !== '') {
        // Judged against the persisted status, and rejected outright when the
        // move is not part of the lifecycle — silently ignoring it used to let
        // the UI believe a change had been saved when it had not.
        assertTicketStatusTransition('delivery', ticket.status, status);
        ticket.status = String(status);
    }
    if (adminResponse !== undefined) {
        ticket.adminResponse = typeof adminResponse === 'string' ? adminResponse.trim() : '';
        if (ticket.adminResponse) ticket.respondedAt = new Date();
    }
    await ticket.save();
    return {
        ...ticket.toObject(),
        allowedStatusTransitions: getAllowedTicketTransitions('delivery', ticket.status)
    };
}

// ----- Delivery partners (approved list) -----
const escapeRegexTerm = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Newest first; `_id` breaks createdAt ties so every query pages identically. */
const DELIVERY_PARTNER_LIST_SORT = { createdAt: -1, _id: -1 };

/**
 * `$or` clauses selecting the delivery partners who work in a zone - any of:
 *  - last known GPS position inside the zone's polygon (where they ride now)
 *  - registered city matching the zone's name / service location
 *  - an order in that zone has been assigned to them
 * A zone none of these match yields a clause matching nobody: an empty zone
 * must list no one, never fall back to every partner.
 */
/**
 * Filter for the approved-partner lists: the Deliveryman List and the wallet
 * figures shown in it. Both endpoints must select - and page through - exactly
 * the same partners, strictly matching zoneId.
 */
async function buildDeliveryPartnerListFilter({ search, zoneId } = {}) {
    const clauses = [{ status: 'approved' }];
    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
        const rx = new RegExp(escapeRegexTerm(term), 'i');
        clauses.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }, { city: rx }, { state: rx }] });
    }
    if (zoneId) {
        if (!mongoose.Types.ObjectId.isValid(String(zoneId))) {
            throw new ValidationError('Invalid zone');
        }
        const zoneOid = new mongoose.Types.ObjectId(String(zoneId));
        clauses.push({ zoneId: zoneOid });
    }
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

export async function getDeliveryPartners(query) {
    const { page = 1, limit = 1000, search, zoneId } = query;
    const filter = await buildDeliveryPartnerListFilter({ search, zoneId });

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    const [list, total, zoneDocs] = await Promise.all([
        FoodDeliveryPartner.find(filter)
            .sort(DELIVERY_PARTNER_LIST_SORT)
            .skip(skip)
            .limit(limitNum)
            .lean(),
        FoodDeliveryPartner.countDocuments(filter),
        FoodZone.find({}).select('_id name zoneName serviceLocation').lean()
    ]);

    const zoneMap = new Map((zoneDocs || []).map((z) => [String(z._id), z.name || z.zoneName || z.serviceLocation || '']));

    // Fetch total orders for these partners in real-time
    const partnerIds = list.map((p) => p._id);
    const orderCounts = await FoodOrder.aggregate([
        {
            $match: {
                'dispatch.deliveryPartnerId': { $in: partnerIds },
                orderStatus: 'delivered'
            }
        },
        {
            $group: {
                _id: '$dispatch.deliveryPartnerId',
                count: { $sum: 1 }
            }
        }
    ]);

    const countsMap = new Map(
        (orderCounts || []).map((c) => [String(c._id), c.count])
    );

    // Average rating computed from actual order ratings (kept consistent with the
    // delivery app's My Reviews; avoids the drifting partner.rating aggregate field).
    const ratingAgg = await FoodOrder.aggregate([
        {
            $match: {
                'dispatch.deliveryPartnerId': { $in: partnerIds },
                'ratings.deliveryPartner.rating': { $exists: true, $ne: null }
            }
        },
        {
            $group: {
                _id: '$dispatch.deliveryPartnerId',
                avg: { $avg: '$ratings.deliveryPartner.rating' },
                count: { $sum: 1 }
            }
        }
    ]);

    const ratingMap = new Map(
        (ratingAgg || []).map((r) => [String(r._id), { avg: Math.round((r.avg || 0) * 10) / 10, count: r.count }])
    );

    const deliveryPartners = list.map((doc, index) => {
        const resolvedZoneName = doc.zoneId ? (zoneMap.get(String(doc.zoneId)) || '') : '';
        return {
            _id: doc._id,
            sl: skip + index + 1,
            name: doc.name || '',
            email: doc.email || '',
            phone: doc.phone || '',
            deliveryId: doc._id ? `DP-${doc._id.toString().slice(-8).toUpperCase()}` : null,
            zoneId: doc.zoneId ? String(doc.zoneId) : null,
            zone: resolvedZoneName || doc.city || doc.state || doc.address || '',
            zoneName: resolvedZoneName,
            vehicleType: doc.vehicleType || '',
            status: doc.status,
            totalOrders: countsMap.get(String(doc._id)) || 0,
            rating: ratingMap.get(String(doc._id))?.avg || 0,
            totalRatings: ratingMap.get(String(doc._id))?.count || 0,
            profilePhoto: doc.profilePhoto || null,
            profileImage: doc.profilePhoto ? { url: doc.profilePhoto } : null
        };
    });

    return {
        deliveryPartners,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

// ----- Delivery partner bonus (admin) -----
function generateBonusTransactionId() {
    const n = Date.now().toString(36).slice(-6).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `BON-${n}${r}`;
}

export async function getDeliveryPartnerBonusTransactions(query = {}) {
    const { page = 1, limit = 1000, search } = query;
    const filter = {};

    // For search (name/phone/email/transactionId) we do a two-step lookup to keep it simple.
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        const partnerIds = await FoodDeliveryPartner.find({
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { phone: { $regex: term, $options: 'i' } },
                { email: { $regex: term, $options: 'i' } }
            ]
        }).select('_id').lean();
        filter.$or = [
            { transactionId: { $regex: term, $options: 'i' } },
            { deliveryPartnerId: { $in: partnerIds.map((p) => p._id) } }
        ];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId);

    const [list, total] = await Promise.all([
        DeliveryBonusTransaction.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate({ path: 'deliveryPartnerId', select: 'name phone email' })
            .lean(),
        DeliveryBonusTransaction.countDocuments(filter)
    ]);

    const transactions = list.map((t, index) => {
        const partner = t.deliveryPartnerId;
        const partnerId = partner?._id ? String(partner._id) : null;
        return {
            sl: skip + index + 1,
            transactionId: t.transactionId,
            deliveryPartnerId: partnerId,
            deliveryId: partnerId ? `DP-${partnerId.slice(-8).toUpperCase()}` : null,
            deliveryman: partner?.name || '',
            amount: t.amount,
            bonus: t.amount, // legacy compatibility
            reference: t.reference || '',
            createdAt: t.createdAt
        };
    });

    return {
        transactions,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

export async function addDeliveryPartnerBonus(body, adminUser) {
    const partner = await FoodDeliveryPartner.findById(body.deliveryPartnerId).lean();
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }
    if (partner.status !== 'approved') {
        throw new ValidationError('Delivery partner must be approved');
    }

    let transactionId = generateBonusTransactionId();
    let exists = await DeliveryBonusTransaction.findOne({ transactionId }).lean();
    while (exists) {
        transactionId = generateBonusTransactionId();
        exists = await DeliveryBonusTransaction.findOne({ transactionId }).lean();
    }

    const created = await DeliveryBonusTransaction.create({
        deliveryPartnerId: body.deliveryPartnerId,
        transactionId,
        amount: body.amount,
        reference: body.reference || '',
        createdByAdminId: adminUser?._id
    });

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: body.deliveryPartnerId },
            {
                title: 'Bonus Credited! Ã°Å¸Å½Å ',
                body: `You have received a bonus of \u20B9${body.amount}. ${body.reference || 'Great job!'}`,
                image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                data: {
                    type: 'bonus_credited',
                    amount: String(body.amount),
                    transactionId: created.transactionId
                }
            }
        );
    } catch (e) {
        console.error('Failed to send bonus notification:', e);
    }

    return created.toObject();
}

// ----- Delivery Earnings (admin) -----
export async function getDeliveryEarnings(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.max(1, Math.min(1000, parseInt(query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    // Align with Transaction Report deliveryman earning:
    // only delivered orders, and only real riderEarning (no deliveryFee fallback).
    const filter = {
        'dispatch.deliveryPartnerId': { $ne: null },
        orderStatus: 'delivered',
    };

    // Date range filters
    const createdAtFilter = {};
    if (query.fromDate) {
        const from = new Date(query.fromDate);
        if (!Number.isNaN(from.getTime())) {
            from.setHours(0, 0, 0, 0);
            createdAtFilter.$gte = from;
        }
    }
    if (query.toDate) {
        const to = new Date(query.toDate);
        if (!Number.isNaN(to.getTime())) {
            to.setHours(23, 59, 59, 999);
            createdAtFilter.$lte = to;
        }
    }

    // Period filters (only when explicit date range is not provided)
    if (!createdAtFilter.$gte && !createdAtFilter.$lte) {
        const period = String(query.period || 'all').trim().toLowerCase();
        const now = new Date();
        if (period === 'today') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            const end = new Date(now);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        } else if (period === 'week') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - start.getDay()); // Sunday
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        } else if (period === 'month') {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        }
    }

    if (createdAtFilter.$gte || createdAtFilter.$lte) {
        filter.createdAt = createdAtFilter;
    }

    if (query.deliveryPartnerId && mongoose.Types.ObjectId.isValid(query.deliveryPartnerId)) {
        filter['dispatch.deliveryPartnerId'] = new mongoose.Types.ObjectId(query.deliveryPartnerId);
    }

    const search = String(query.search || '').trim();
    if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');

        const [partners, restaurants] = await Promise.all([
            FoodDeliveryPartner.find({
                $or: [{ name: regex }, { phone: regex }, { email: regex }]
            }).select('_id').limit(100).lean(),
            FoodRestaurant.find({
                $or: [{ restaurantName: regex }, { name: regex }]
            }).select('_id').limit(100).lean()
        ]);

        const partnerIds = partners.map((p) => p._id);
        const restaurantIds = restaurants.map((r) => r._id);

        filter.$or = [
            { orderId: regex },
            { 'dispatch.deliveryPartnerId': { $in: partnerIds } },
            { restaurantId: { $in: restaurantIds } }
        ];
    }

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId, 'dispatch.deliveryPartnerId');

    const [orders, total, earningsAgg, distinctPartners] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('orderId orderStatus createdAt pricing riderEarning riderBaseEarning eatiefyIncentive deliveryPartnerSettlement dispatch.deliveryPartnerId restaurantId')
            .populate({ path: 'dispatch.deliveryPartnerId', select: 'name phone' })
            .populate({ path: 'restaurantId', select: 'restaurantName name' })
            .lean(),
        FoodOrder.countDocuments(filter),
        FoodOrder.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalEarnings: {
                        $sum: { $ifNull: ['$riderEarning', 0] }
                    },
                    // Eatiefy's incentive on top of the zone payout (admin-funded).
                    totalEatiefyIncentive: {
                        $sum: { $ifNull: ['$eatiefyIncentive.amount', 0] }
                    },
                    totalOrders: { $sum: 1 }
                }
            }
        ]),
        FoodOrder.distinct('dispatch.deliveryPartnerId', filter)
    ]);

    const earnings = orders.map((order) => {
        const partner = order?.dispatch?.deliveryPartnerId;
        // Real rider earning only — never fall back to delivery fee (that is not rider payout)
        const amount = Number(order?.riderEarning || 0) || 0;
        const eatiefyIncentive = Math.max(0, Number(order?.eatiefyIncentive?.amount || 0) || 0);
        const basePayout = order?.riderBaseEarning != null
            ? Math.max(0, Number(order.riderBaseEarning) || 0)
            : Math.max(0, Math.round((amount - eatiefyIncentive) * 100) / 100);

        return {
            transactionId: String(order._id),
            orderId: order.orderId || 'N/A',
            deliveryPartnerId: partner?._id ? String(partner._id) : null,
            deliveryPartnerName: partner?.name || 'N/A',
            deliveryPartnerPhone: partner?.phone || 'N/A',
            restaurantName: order?.restaurantId?.restaurantName || order?.restaurantId?.name || 'N/A',
            amount,
            // amount = basePayout (zone Delivery Boy Payout) + eatiefyIncentive
            basePayout,
            eatiefyIncentive,
            eatiefyIncentivePercent: Number(order?.eatiefyIncentive?.percent || 0) || 0,
            orderTotal: Number(order?.pricing?.total || 0) || 0,
            deliveryFee: Number(order?.pricing?.deliveryFee || 0) || 0,
            orderStatus: order?.orderStatus || 'N/A',
            createdAt: order?.createdAt || null
        };
    });

    const agg = earningsAgg?.[0] || {};
    const totalDeliveryPartners = (distinctPartners || []).filter(Boolean).length;

    return {
        earnings,
        summary: {
            totalDeliveryPartners,
            totalEarnings: Math.round(Number(agg.totalEarnings || 0) * 100) / 100,
            totalEatiefyIncentive: Math.round(Number(agg.totalEatiefyIncentive || 0) * 100) / 100,
            totalBasePayout: Math.round((Number(agg.totalEarnings || 0) - Number(agg.totalEatiefyIncentive || 0)) * 100) / 100,
            totalOrders: Number(agg.totalOrders || 0)
        },
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
        }
    };
}

// ----- Restaurant Earnings (admin) -----
export async function getRestaurantEarnings(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.max(1, Math.min(1000, parseInt(query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const filter = {
        orderStatus: 'delivered',
    };

    // Date range filters
    const createdAtFilter = {};
    if (query.fromDate) {
        const from = new Date(query.fromDate);
        if (!Number.isNaN(from.getTime())) {
            from.setHours(0, 0, 0, 0);
            createdAtFilter.$gte = from;
        }
    }
    if (query.toDate) {
        const to = new Date(query.toDate);
        if (!Number.isNaN(to.getTime())) {
            to.setHours(23, 59, 59, 999);
            createdAtFilter.$lte = to;
        }
    }

    // Period filters (only when explicit date range is not provided)
    if (!createdAtFilter.$gte && !createdAtFilter.$lte) {
        const period = String(query.period || 'all').trim().toLowerCase();
        const now = new Date();
        if (period === 'today') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            const end = new Date(now);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        } else if (period === 'week') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - start.getDay()); // Sunday
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        } else if (period === 'month') {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        }
    }

    if (createdAtFilter.$gte || createdAtFilter.$lte) {
        filter.createdAt = createdAtFilter;
    }

    // Restaurant filter
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    } else {
        // Exclude orders whose restaurant no longer exists in the DB
        const existingRestaurantIds = await FoodRestaurant.distinct('_id');
        filter.restaurantId = { $in: existingRestaurantIds };
    }

    // Zone filter
    if (query.zoneId && query.zoneId !== 'all') {
        const zoneOid = parseZoneFilter(query.zoneId);
        if (zoneOid) {
            const restaurantIds = await getRestaurantIdsInZone(zoneOid);
            const zoneOr = [{ zoneId: zoneOid }];
            if (restaurantIds.length > 0) {
                zoneOr.push({ restaurantId: { $in: restaurantIds } });
            }
            filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: zoneOr }];
        }
    }

    // Search filter
    const search = String(query.search || '').trim();
    if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');

        const restaurants = await FoodRestaurant.find({
            $or: [
                { restaurantName: regex },
                { name: regex },
                { phone: regex },
                { ownerPhone: regex },
                { primaryContactNumber: regex }
            ]
        }).select('_id').limit(200).lean();

        const restaurantIds = restaurants.map((r) => r._id);
        const searchOr = [{ orderId: regex }];
        if (restaurantIds.length > 0) {
            searchOr.push({ restaurantId: { $in: restaurantIds } });
        }
        filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: searchOr }];
    }

    const [orders, total, earningsAgg, distinctRestaurants] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('orderId orderStatus createdAt pricing restaurantId zoneId')
            .populate({
                path: 'restaurantId',
                select: 'restaurantName name phone ownerPhone primaryContactNumber zoneId',
                populate: { path: 'zoneId', select: 'name zoneName' }
            })
            .populate({ path: 'zoneId', select: 'name zoneName' })
            .lean(),
        FoodOrder.countDocuments(filter),
        FoodOrder.aggregate([
            { $match: filter },
            {
                $project: {
                    baseSubtotal: {
                        $ifNull: ['$pricing.baseSubtotal', { $ifNull: ['$pricing.subtotal', 0] }]
                    },
                    packagingFee: { $ifNull: ['$pricing.packagingFee', 0] },
                    commission: { $ifNull: ['$pricing.restaurantCommission', 0] },
                    orderTotal: { $ifNull: ['$pricing.total', 0] }
                }
            },
            {
                $project: {
                    orderTotal: 1,
                    baseSubtotal: 1,
                    packagingFee: 1,
                    commission: 1,
                    restaurantEarning: {
                        $max: [
                            0,
                            {
                                $subtract: [
                                    { $add: ['$baseSubtotal', '$packagingFee'] },
                                    '$commission'
                                ]
                            }
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: '$restaurantEarning' },
                    totalOrders: { $sum: 1 },
                    totalOrderAmount: { $sum: '$orderTotal' },
                    totalFoodAmount: { $sum: '$baseSubtotal' },
                    totalPackagingFee: { $sum: '$packagingFee' },
                    totalCommission: { $sum: '$commission' }
                }
            }
        ]),
        FoodOrder.distinct('restaurantId', filter)
    ]);

    const earnings = orders.map((order) => {
        const restaurant = order?.restaurantId;
        const pricing = order?.pricing || {};
        const baseSubtotal = Number(pricing.baseSubtotal ?? pricing.subtotal ?? 0) || 0;
        const packagingFee = Number(pricing.packagingFee ?? 0) || 0;
        const commission = Number(pricing.restaurantCommission ?? 0) || 0;
        const amount = Math.max(0, Math.round((baseSubtotal + packagingFee - commission) * 100) / 100);
        const zoneName = order?.zoneId?.name || order?.zoneId?.zoneName || restaurant?.zoneId?.name || restaurant?.zoneId?.zoneName || 'N/A';
        const zoneId = order?.zoneId?._id || restaurant?.zoneId?._id || null;
        const restaurantPhone = restaurant?.phone || restaurant?.ownerPhone || restaurant?.primaryContactNumber || 'N/A';

        return {
            transactionId: String(order._id),
            orderId: order.orderId || 'N/A',
            restaurantId: restaurant?._id ? String(restaurant._id) : null,
            restaurantName: restaurant?.restaurantName || restaurant?.name || 'N/A',
            restaurantPhone,
            zoneName,
            zoneId: zoneId ? String(zoneId) : null,
            amount,
            baseSubtotal,
            packagingFee,
            commission,
            orderTotal: Number(pricing.total || 0) || 0,
            orderStatus: order?.orderStatus || 'N/A',
            createdAt: order?.createdAt || null
        };
    });

    const agg = earningsAgg?.[0] || {};
    const totalRestaurants = (distinctRestaurants || []).filter(Boolean).length;

    return {
        earnings,
        summary: {
            totalRestaurants,
            totalEarnings: Math.round(Number(agg.totalEarnings || 0) * 100) / 100,
            totalOrders: Number(agg.totalOrders || 0),
            totalOrderAmount: Math.round(Number(agg.totalOrderAmount || 0) * 100) / 100,
            totalFoodAmount: Math.round(Number(agg.totalFoodAmount || 0) * 100) / 100,
            totalPackagingFee: Math.round(Number(agg.totalPackagingFee || 0) * 100) / 100,
            totalCommission: Math.round(Number(agg.totalCommission || 0) * 100) / 100
        },
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
        }
    };
}

// ----- Earning Addon Offers (admin) -----
export async function getEarningAddons(query = {}) {
    const { page = 1, limit = 20, search } = query;
    const filter = {};

    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        filter.$or = [
            { title: { $regex: term, $options: 'i' } },
            { description: { $regex: term, $options: 'i' } }
        ];
    }

    // A zone's view: offers for that zone plus the ones for every zone - all
    // that its riders can earn. (null also matches offers created before zones.)
    const zoneOid = parseZoneFilter(query.zoneId);
    if (zoneOid) {
        filter.$and = [{ $or: [{ zoneId: zoneOid }, { zoneId: null }] }];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 20));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 20));

    const [list, total] = await Promise.all([
        FoodEarningAddon.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate({ path: 'zoneId', select: 'name zoneName serviceLocation' })
            .lean(),
        FoodEarningAddon.countDocuments(filter)
    ]);

    const now = Date.now();
    const earningAddons = list.map((raw) => {
        const zone = raw.zoneId && typeof raw.zoneId === 'object' ? raw.zoneId : null;
        const a = {
            ...raw,
            zoneId: zone?._id ? String(zone._id) : null,
            zoneName: zone ? zone.name || zone.zoneName || zone.serviceLocation || '' : ''
        };
        const start = a.startDate ? new Date(a.startDate).getTime() : 0;
        const end = a.endDate ? new Date(a.endDate).getTime() : 0;
        const isValid = Boolean(a.status === 'active' && start && end && now >= start && now <= end);
        const isExpired = Boolean(end && now > end);

        return {
            ...a,
            isValid,
            status: isExpired ? 'expired' : (a.status || 'inactive')
        };
    });

    return {
        earningAddons,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

/** The offer's target zone after checking it exists; null = every zone. */
const resolveAddonZoneId = async (zoneId) => {
    if (!zoneId) return null;
    if (!(await FoodZone.exists({ _id: zoneId }))) {
        throw new ValidationError('Selected zone does not exist');
    }
    return new mongoose.Types.ObjectId(String(zoneId));
};

export async function createEarningAddon(body) {
    const zoneId = await resolveAddonZoneId(body.zoneId);
    const created = await FoodEarningAddon.create({
        zoneId,
        title: body.title,
        requiredOrders: body.requiredOrders,
        earningAmount: body.earningAmount,
        startDate: body.startDate,
        endDate: body.endDate,
        maxRedemptions: body.maxRedemptions ?? null,
        status: 'active'
    });
    return created.toObject();
}

export async function updateEarningAddon(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodEarningAddon.findById(id);
    if (!doc) return null;
    doc.title = body.title;
    doc.requiredOrders = body.requiredOrders;
    doc.earningAmount = body.earningAmount;
    doc.startDate = body.startDate;
    doc.endDate = body.endDate;
    doc.maxRedemptions = body.maxRedemptions ?? null;
    if (body.zoneId !== undefined) doc.zoneId = await resolveAddonZoneId(body.zoneId);
    await doc.save();
    return doc.toObject();
}

export async function deleteEarningAddon(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodEarningAddon.findByIdAndDelete(id).lean();
    return deleted ? { id } : null;
}

export async function toggleEarningAddonStatus(id, status) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    return FoodEarningAddon.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean();
}

// ----- Earning Addon History (admin) -----
export async function getEarningAddonHistory(query = {}) {
    const { page = 1, limit = 1000, search } = query;
    const filter = {};

    // Optional search by delivery partner name/phone/email or offer title.
    // Keep it simple and fast: only apply when search is provided.
    let partnerIds = null;
    let offerIds = null;
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        partnerIds = await FoodDeliveryPartner.find({
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { phone: { $regex: term, $options: 'i' } },
                { email: { $regex: term, $options: 'i' } }
            ]
        }).select('_id').lean();
        offerIds = await FoodEarningAddon.find({ title: { $regex: term, $options: 'i' } }).select('_id').lean();
        filter.$or = [
            { deliveryPartnerId: { $in: (partnerIds || []).map((p) => p._id) } },
            { offerId: { $in: (offerIds || []).map((o) => o._id) } }
        ];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId);

    const [list, total] = await Promise.all([
        FoodEarningAddonHistory.find(filter)
            .sort({ completedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate({ path: 'deliveryPartnerId', select: 'name phone email' })
            .populate({ path: 'offerId', select: 'title requiredOrders earningAmount' })
            .lean(),
        FoodEarningAddonHistory.countDocuments(filter)
    ]);

    const history = list.map((h, index) => {
        const partner = h.deliveryPartnerId;
        const offer = h.offerId;
        const partnerId = partner?._id ? String(partner._id) : null;
        return {
            _id: h._id,
            sl: skip + index + 1,
            deliveryPartnerId: partnerId,
            deliveryId: partnerId ? `DP-${partnerId.slice(-8).toUpperCase()}` : null,
            deliveryman: partner?.name || '',
            deliveryPhone: partner?.phone || 'N/A',
            offerTitle: offer?.title || '',
            ordersCompleted: h.ordersCompleted ?? 0,
            ordersRequired: h.ordersRequired ?? offer?.requiredOrders ?? 0,
            earningAmount: h.earningAmount ?? offer?.earningAmount ?? 0,
            totalEarning: h.totalEarning ?? h.earningAmount ?? 0,
            status: h.status || 'pending',
            date: h.completedAt || h.createdAt,
            completedAt: h.completedAt || h.createdAt
        };
    });

    return {
        history,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

export async function creditEarningAddonHistory(historyId, notes) {
    if (!historyId || !mongoose.Types.ObjectId.isValid(historyId)) return null;
    const doc = await FoodEarningAddonHistory.findById(historyId).populate('offerId');
    if (!doc) return null;
    if (doc.status !== 'pending') return doc.toObject();

    const amountToCredit = Number(doc.earningAmount || 0);

    // 1. Update history status
    doc.status = 'credited';
    doc.creditedAt = new Date();
    doc.creditedNotes = typeof notes === 'string' ? notes.trim() : '';
    await doc.save();

    // 2. Credit the wallet
    if (amountToCredit > 0) {
        await FoodDeliveryWallet.findOneAndUpdate(
            { deliveryPartnerId: doc.deliveryPartnerId },
            { $inc: { balance: amountToCredit, totalEarnings: amountToCredit } },
            { upsert: true }
        );

        // 3. Create a transaction for ledger
        try {
            await DeliveryBonusTransaction.create({
                deliveryPartnerId: doc.deliveryPartnerId,
                transactionId: `ADDON-${String(doc._id).slice(-8).toUpperCase()}-${Date.now().toString().slice(-4)}`,
                amount: amountToCredit,
                reference: `Earning Addon: ${doc.offerId?.title || 'Offer Reward'}`
            });
        } catch (txnError) {
            console.error('Failed to create bonus transaction:', txnError);
            // Non-blocking but should be logged.
        }
    }

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: doc.deliveryPartnerId },
            {
                title: 'Incentive Credited! Ã°Å¸Å½Â¯',
                body: `Your incentive for "${doc.offerId?.title || 'Earning Addon'}" has been approved and moved to your pocket.`,
                image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                data: {
                    type: 'incentive_credited',
                    historyId: String(doc._id),
                    amount: String(doc.earningAmount || 0)
                }
            }
        );
    } catch (e) {
        console.error('Failed to send incentive credited notification:', e);
    }

    return doc.toObject();
}

export async function cancelEarningAddonHistory(historyId, reason) {
    if (!historyId || !mongoose.Types.ObjectId.isValid(historyId)) return null;
    const doc = await FoodEarningAddonHistory.findById(historyId).populate('offerId');
    if (!doc) return null;
    if (doc.status !== 'pending') return doc.toObject();
    doc.status = 'cancelled';
    doc.cancelledAt = new Date();
    doc.cancelReason = typeof reason === 'string' ? reason.trim() : '';
    await doc.save();

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: doc.deliveryPartnerId },
            {
                title: 'Incentive Update Ã°Å¸â€œâ€¹',
                body: `Your incentive request for "${doc.offerId?.title || 'Earning Addon'}" was not approved. Reason: ${doc.cancelReason || 'Ineligible'}`,
                image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                data: {
                    type: 'incentive_rejected',
                    historyId: String(doc._id),
                    reason: doc.cancelReason
                }
            }
        );
    } catch (e) {
        console.error('Failed to send incentive rejection notification:', e);
    }

    return doc.toObject();
}

export async function checkEarningAddonCompletions(deliveryPartnerId, _force = false) {
    const now = new Date();
    
    // Only search for active offers that are currently running.
    const activeOffers = await FoodEarningAddon.find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now }
    }).lean();

    if (activeOffers.length === 0) return { completionsFound: 0 };

    let partnerIds = [];
    if (deliveryPartnerId === 'all') {
        const partners = await FoodDeliveryPartner.find({ status: 'approved' }).select('_id').lean();
        partnerIds = partners.map(p => p._id);
    } else if (deliveryPartnerId && mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        partnerIds = [deliveryPartnerId];
    }

    if (partnerIds.length === 0) return { completionsFound: 0 };

    // An offer for one zone is only for that zone's riders.
    const zoneByPartner = activeOffers.some((offer) => offer.zoneId)
        ? await loadPartnerZoneIds(partnerIds)
        : new Map();

    let globalCompletions = 0;

    for (const pId of partnerIds) {
        for (const offer of activeOffers) {
            if (offer.zoneId && zoneByPartner.get(String(pId)) !== String(offer.zoneId)) continue;

            // Find existing history so we don't grant it twice for the same offer.
            const existing = await FoodEarningAddonHistory.findOne({
                deliveryPartnerId: pId,
                offerId: offer._id,
                status: { $in: ['pending', 'credited'] }
            }).lean();

            if (existing) continue;

            // Count orders delivered by this partner during the offer period.
            const orderCount = await FoodOrder.countDocuments({
                'dispatch.deliveryPartnerId': pId,
                orderStatus: 'delivered',
                createdAt: { $gte: offer.startDate, $lte: offer.endDate }
            });

            if (orderCount >= (offer.requiredOrders || 1)) {
                // Requirement met!
                await FoodEarningAddonHistory.create({
                    offerId: offer._id,
                    deliveryPartnerId: pId,
                    ordersCompleted: orderCount,
                    ordersRequired: offer.requiredOrders,
                    earningAmount: offer.earningAmount,
                    totalEarning: offer.earningAmount,
                    status: 'pending',
                    completedAt: now
                });
                
                // Update current redemptions in addon
                await FoodEarningAddon.findByIdAndUpdate(offer._id, { $inc: { currentRedemptions: 1 } });
                
                globalCompletions++;
            }
        }
    }

    return { completionsFound: globalCompletions };
}

export async function getDeliveryPartnerById(id) {
    const partner = await FoodDeliveryPartner.findById(id).lean();
    if (!partner) return null;
    const deliveryId = partner._id ? `DP-${partner._id.toString().slice(-8).toUpperCase()}` : null;

    let zoneDoc = null;
    if (partner.zoneId && mongoose.Types.ObjectId.isValid(String(partner.zoneId))) {
        zoneDoc = await FoodZone.findById(partner.zoneId).select('_id name zoneName serviceLocation').lean();
    }

    // Average rating from actual order ratings (consistent with My Reviews; the
    // stored partner.rating aggregate can drift from real data).
    const ratingAgg = await FoodOrder.aggregate([
        {
            $match: {
                'dispatch.deliveryPartnerId': partner._id,
                'ratings.deliveryPartner.rating': { $exists: true, $ne: null }
            }
        },
        { $group: { _id: null, avg: { $avg: '$ratings.deliveryPartner.rating' }, count: { $sum: 1 } } }
    ]);
    const computedRating = ratingAgg?.[0]?.avg ? Math.round(ratingAgg[0].avg * 10) / 10 : 0;
    const computedTotalRatings = ratingAgg?.[0]?.count || 0;

    const resolvedZoneName = zoneDoc ? (zoneDoc.name || zoneDoc.zoneName || zoneDoc.serviceLocation || '') : '';

    return {
        ...partner,
        zoneId: partner.zoneId ? String(partner.zoneId) : null,
        zoneName: resolvedZoneName,
        zone: resolvedZoneName || partner.city || partner.state || partner.address || '',
        rating: computedRating,
        totalRatings: computedTotalRatings,
        email: partner.email || null,
        deliveryId,
        status: partner.status === 'rejected' ? 'blocked' : partner.status,
        profileImage: partner.profilePhoto ? { url: partner.profilePhoto } : null,
        documents: {
            aadhar: (partner.aadharPhoto || partner.aadharNumber)
                ? { number: partner.aadharNumber || null, document: partner.aadharPhoto || null }
                : null,
            pan: (partner.panPhoto || partner.panNumber)
                ? { number: partner.panNumber || null, document: partner.panPhoto || null }
                : null,
            drivingLicense: partner.drivingLicensePhoto ? { document: partner.drivingLicensePhoto } : null,
            bankDetails:
                partner.bankAccountHolderName || partner.bankAccountNumber || partner.bankIfscCode || partner.bankName
                    ? {
                        accountHolderName: partner.bankAccountHolderName || null,
                        accountNumber: partner.bankAccountNumber || null,
                        ifscCode: partner.bankIfscCode || null,
                        bankName: partner.bankName || null
                    }
                    : null
        },
        location: (partner.address || partner.city || partner.state)
            ? { addressLine1: partner.address, city: partner.city, state: partner.state }
            : null,
        vehicle: (partner.vehicleType || partner.vehicleName || partner.vehicleNumber)
            ? {
                type: partner.vehicleType,
                brand: partner.vehicleName,
                model: partner.vehicleName,
                number: partner.vehicleNumber
            }
            : null
    };
}

export async function getDeliverymanReviews(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {
        'ratings.deliveryPartner.rating': { $exists: true, $ne: null }
    };

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        
        // Find delivery partners matching search
        const partners = await FoodDeliveryPartner.find({
            $or: [
                { name: searchRegex },
                { phone: searchRegex }
            ]
        }).select('_id').lean();
        
        // Find customers matching search
        const customers = await FoodUser.find({
            $or: [
                { name: searchRegex },
                { email: searchRegex }
            ]
        }).select('_id').lean();

        filter.$or = [
            { orderId: searchRegex },
            { 'ratings.deliveryPartner.comment': searchRegex },
            { 'dispatch.deliveryPartnerId': { $in: partners.map(p => p._id) } },
            { userId: { $in: customers.map(c => c._id) } }
        ];
    }

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId, 'dispatch.deliveryPartnerId');

    const [docs, total] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email phone')
            .populate('dispatch.deliveryPartnerId', 'name phone')
            .select('orderId userId dispatch.deliveryPartnerId ratings.deliveryPartner createdAt deliveryState.deliveredAt')
            .lean(),
        FoodOrder.countDocuments(filter)
    ]);

    const reviews = docs.map((doc, index) => ({
        sl: skip + index + 1,
        orderId: doc.orderId,
        deliveryman: doc.dispatch?.deliveryPartnerId?.name || 'Unknown',
        deliverymanId: doc.dispatch?.deliveryPartnerId?._id || 'N/A',
        deliverymanPhone: doc.dispatch?.deliveryPartnerId?.phone || 'N/A',
        customer: doc.userId?.name || 'Unknown',
        customerId: doc.userId?._id || 'N/A',
        customerPhone: doc.userId?.phone || 'N/A',
        review: doc.ratings?.deliveryPartner?.comment || '',
        rating: doc.ratings?.deliveryPartner?.rating || 0,
        submittedAt: doc.createdAt,
        deliveredAt: doc.deliveryState?.deliveredAt
    }));

    return { reviews, total, page, limit };
}

export async function approveDeliveryPartner(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

    logger.info(`[ADMIN-APPROVE] approveDeliveryPartner service called id=${id}`);

    const existing = await FoodDeliveryPartner.findById(id)
        .select('status email name pendingApprovalType zoneId city state address')
        .lean();
    if (!existing) return null;
    const isChangesApproval = existing.pendingApprovalType === 'changes';

    const updateSet = {
        status: 'approved',
        approvedAt: new Date(),
        pendingApprovalType: 'registration'
    };

    if (body?.zoneId && mongoose.Types.ObjectId.isValid(String(body.zoneId))) {
        updateSet.zoneId = new mongoose.Types.ObjectId(String(body.zoneId));
    } else if (!existing.zoneId) {
        const resolved = await resolveZoneIdForPartner({
            city: existing.city,
            address: existing.address,
            state: existing.state
        });
        if (resolved) updateSet.zoneId = resolved;
    }

    const updated = await FoodDeliveryPartner.findByIdAndUpdate(
        id,
        {
            $set: updateSet,
            $unset: {
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true, runValidators: false }
    ).lean();

    if (!updated) return null;

    await sendDeliveryApprovalNotifications(updated, existing, isChangesApproval);

    // Referral crediting: on approval, credit the referrer partner's pocket balance via DeliveryBonusTransaction.
    try {
        const referrerId = updated.referredBy ? String(updated.referredBy) : '';
        if (referrerId && mongoose.Types.ObjectId.isValid(referrerId)) {
            const already = await FoodReferralLog.findOne({ refereeId: updated._id, role: 'DELIVERY_PARTNER' }).lean();
            if (!already) {
                const settingsDoc = await FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
                const reward = Math.max(0, Number(settingsDoc?.referralRewardDelivery) || 0);
                const limit = Math.max(0, Number(settingsDoc?.referralLimitDelivery) || 0);
                const referrer = await FoodDeliveryPartner.findById(referrerId).select('_id referralCount status').lean();

                if (referrer && referrer.status === 'approved' && reward > 0 && limit > 0 && Number(referrer.referralCount || 0) < limit) {
                    const log = await FoodReferralLog.create({
                        referrerId: referrer._id,
                        refereeId: updated._id,
                        role: 'DELIVERY_PARTNER',
                        rewardAmount: reward,
                        status: 'credited'
                    });

                    await Promise.all([
                        FoodDeliveryPartner.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } }),
                        addDeliveryPartnerBonus(
                            { deliveryPartnerId: String(referrer._id), amount: reward, reference: 'Referral bonus' },
                            null
                        )
                    ]);
                } else {
                    await FoodReferralLog.create({
                        referrerId: new mongoose.Types.ObjectId(referrerId),
                        refereeId: updated._id,
                        role: 'DELIVERY_PARTNER',
                        rewardAmount: reward,
                        status: 'rejected',
                        reason: !referrer ? 'referrer_not_found' : reward <= 0 ? 'reward_disabled' : limit <= 0 ? 'limit_disabled' : 'limit_reached'
                    });
                }
            }
        }
    } catch (e) {
        // Never fail approval due to referral errors.
        // eslint-disable-next-line no-console
        console.warn('Referral crediting failed (delivery approval):', e?.message || e);
    }
    return updated;
}

export async function updateDeliveryPartner(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid delivery partner ID');
    }
    const partner = await FoodDeliveryPartner.findById(id);
    if (!partner) {
        throw new NotFoundError('Delivery partner not found');
    }

    const allowedFields = ['name', 'phone', 'email', 'countryCode', 'address', 'city', 'state', 'vehicleType', 'vehicleName', 'vehicleNumber', 'status'];
    for (const f of allowedFields) {
        if (body[f] !== undefined) {
            partner[f] = body[f];
        }
    }

    if (body.zoneId !== undefined) {
        if (body.zoneId && mongoose.Types.ObjectId.isValid(String(body.zoneId))) {
            const z = await FoodZone.findById(body.zoneId).select('_id').lean();
            if (z) partner.zoneId = z._id;
        } else if (!body.zoneId) {
            partner.zoneId = null;
        }
    } else if (body.city !== undefined || body.address !== undefined || body.state !== undefined) {
        const autoZone = await resolveZoneIdForPartner({
            city: partner.city,
            address: partner.address,
            state: partner.state
        });
        if (autoZone) partner.zoneId = autoZone;
    }

    await partner.save();
    return getDeliveryPartnerById(partner._id);
}

export async function rejectDeliveryPartner(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

    const existing = await FoodDeliveryPartner.findById(id).select('status email pendingApprovalType').lean();
    if (!existing) return null;
    const isChangesRejection = existing.pendingApprovalType === 'changes';
    const trimmedReason = typeof reason === 'string' ? reason.trim() : undefined;

    const updated = await FoodDeliveryPartner.findByIdAndUpdate(
        id,
        {
            $set: {
                status: 'rejected',
                rejectedAt: new Date(),
                rejectionReason: trimmedReason,
                approvedAt: null,
                pendingApprovalType: 'registration'
            }
        },
        { new: true }
    ).lean();

    if (updated) {
        const recipientEmail = String(updated.email || existing.email || '').trim();

        try {
            const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
            const rejectTitle = isChangesRejection
                ? 'Profile Changes Rejected ❌'
                : 'Onboarding Update 📋';
            const rejectBody = isChangesRejection
                ? `Your delivery profile changes were rejected. Reason: ${reason || 'Incomplete documents'}.`
                : `Your application to join as a delivery partner was rejected. Reason: ${reason || 'Incomplete documents'}.`;
            const targetUrl = isChangesRejection ? '/food/delivery' : '/food/delivery/pending-verification';
            await notifyOwnerSafely(
                { ownerType: 'DELIVERY_PARTNER', ownerId: updated._id },
                {
                    title: rejectTitle,
                    body: rejectBody,
                    image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    sendToAllDevices: true,
                    data: {
                        type: isChangesRejection ? 'delivery_changes_rejected' : 'onboarding_rejected',
                        partnerId: String(updated._id),
                        reason: reason || '',
                        targetUrl,
                        link: targetUrl,
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send delivery partner rejection notification:', e);
        }

        if (recipientEmail) {
            try {
                const { sendDeliveryRejectionEmail } = await import('../../../../utils/email.js');
                const emailSent = await sendDeliveryRejectionEmail({
                    to: recipientEmail,
                    partnerName: updated.name,
                    partnerId: String(updated._id),
                    reason: updated.rejectionReason || trimmedReason,
                    isChangesRejection
                });
                if (emailSent) {
                    console.info(`Delivery rejection email sent to ${recipientEmail} for ${updated._id}`);
                } else {
                    console.warn(`Delivery rejection email was not sent for ${updated._id} (${recipientEmail})`);
                }
            } catch (e) {
                console.error('Failed to send delivery partner rejection email:', e);
            }
        }
    }
    return updated;
}

// ----- Zones CRUD -----
export async function getZones(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const isActive = query.isActive;
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    const filter = {};
    if (isActive !== undefined && isActive !== '') {
        filter.isActive = isActive === 'true' || isActive === '1';
    }
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { zoneName: { $regex: search, $options: 'i' } },
            { serviceLocation: { $regex: search, $options: 'i' } },
            { country: { $regex: search, $options: 'i' } }
        ];
    }

    const [zones, total] = await Promise.all([
        FoodZone.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        FoodZone.countDocuments(filter)
    ]);
    return { zones, total, page, limit };
}

export async function getZoneById(id) {
    return FoodZone.findById(id).lean();
}

export async function createZone(body) {
    const name = typeof body.name === 'string' ? body.name.trim() : (body.zoneName && body.zoneName.trim()) || '';
    if (!name) return { error: 'Zone name is required' };
    const coordinates = Array.isArray(body.coordinates) ? body.coordinates : [];
    if (coordinates.length < 3) return { error: 'At least 3 coordinates (polygon points) are required' };

    const normalized = coordinates.map((c) => ({
        latitude: Number(c.latitude) || 0,
        longitude: Number(c.longitude) || 0
    }));

    const zone = new FoodZone({
        name,
        zoneName: body.zoneName && body.zoneName.trim() ? body.zoneName.trim() : name,
        country: (body.country && body.country.trim()) || 'India',
        serviceLocation: (body.serviceLocation && body.serviceLocation.trim()) || name,
        unit: body.unit === 'miles' ? 'miles' : 'kilometer',
        coordinates: normalized,
        isActive: body.isActive !== false
    });
    await zone.save();
    return { zone: zone.toObject() };
}

export async function updateZone(id, body) {
    const zone = await FoodZone.findById(id);
    if (!zone) return null;

    if (body.name !== undefined) zone.name = String(body.name).trim();
    if (body.zoneName !== undefined) zone.zoneName = String(body.zoneName).trim();
    if (body.country !== undefined) zone.country = String(body.country).trim();
    if (body.serviceLocation !== undefined) zone.serviceLocation = String(body.serviceLocation).trim();
    if (body.unit !== undefined) zone.unit = body.unit === 'miles' ? 'miles' : 'kilometer';
    if (body.isActive !== undefined) zone.isActive = body.isActive !== false;
    if (Array.isArray(body.coordinates) && body.coordinates.length >= 3) {
        zone.coordinates = body.coordinates.map((c) => ({
            latitude: Number(c.latitude) || 0,
            longitude: Number(c.longitude) || 0
        }));
    }
    if (zone.name) zone.serviceLocation = zone.serviceLocation || zone.name;

    await zone.save();
    return { zone: zone.toObject() };
}

export async function deleteZone(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid zone id');
    }
    const zoneOid = new mongoose.Types.ObjectId(String(id));
    const zone = await FoodZone.findById(zoneOid);
    if (!zone) return null;

    // Restrict deletion if zone is linked to any dependent records
    const [foodCount, addonCount, pricingRuleCount, categoryCount, restaurantCount] = await Promise.all([
        FoodItem.countDocuments({ zoneId: zoneOid }),
        FoodAddon.countDocuments({ zoneId: zoneOid, isDeleted: { $ne: true } }),
        FoodPricingRule.countDocuments({ zoneId: zoneOid, isDeleted: false }),
        FoodCategory.countDocuments({ zoneId: zoneOid }),
        FoodRestaurant.countDocuments({ zoneId: zoneOid })
    ]);

    const blockers = [];
    if (foodCount > 0) blockers.push(`${foodCount} food item(s)`);
    if (addonCount > 0) blockers.push(`${addonCount} add-on(s)`);
    if (pricingRuleCount > 0) blockers.push(`${pricingRuleCount} pricing rule(s)`);
    if (categoryCount > 0) blockers.push(`${categoryCount} category/categories`);
    if (restaurantCount > 0) blockers.push(`${restaurantCount} restaurant(s)`);

    if (blockers.length > 0) {
        throw new ValidationError(
            `Cannot delete zone "${zone.name}" because it is currently assigned to ${blockers.join(', ')}. Please reassign or delete these records first, or deactivate the zone instead.`
        );
    }

    await FoodZone.findByIdAndDelete(zoneOid);
    // Its Restaurant Settings override has nothing left to apply to.
    await FoodZoneRestaurantSettings.deleteOne({ zoneId: zoneOid });
    return { id: String(zoneOid), name: zone.name };
}

// ----- Withdrawals (admin) -----
export async function getWithdrawals(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.status && query.status !== 'all') {
        filter.status = query.status.toLowerCase();
    }
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim();
        if (!Number.isNaN(Number(term))) {
            filter.amount = Number(term);
        } else {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const restaurants = await FoodRestaurant.find({
                restaurantName: { $regex: escaped, $options: 'i' },
            }).select('_id').lean();
            filter.restaurantId = { $in: restaurants.map((r) => r._id) };
        }
    }

    const [withdrawals, total] = await Promise.all([
        FoodRestaurantWithdrawal.find(filter)
            .populate('restaurantId', 'restaurantName profileImage ownerName phone ownerPhone accountHolderName accountNumber ifscCode accountType upiId upiQrImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodRestaurantWithdrawal.countDocuments(filter)
    ]);

    // UI expects status with first letter capitalized, and data in 'requests' key
    const requests = withdrawals.map((w) => ({
        ...w,
        id: w._id,
        restaurantName: w.restaurantId?.restaurantName || 'N/A',
        restaurantIdString: w.restaurantId ? `REST${w.restaurantId._id.toString().slice(-6).padStart(6, '0')}` : 'N/A',
        restaurantBankDetails: {
            accountHolderName: w.restaurantId?.accountHolderName || '',
            accountNumber: w.restaurantId?.accountNumber || '',
            ifscCode: w.restaurantId?.ifscCode || '',
            accountType: w.restaurantId?.accountType || '',
            upiId: w.restaurantId?.upiId || '',
            upiQrImage: w.restaurantId?.upiQrImage || ''
        },
        status: w.status.charAt(0).toUpperCase() + w.status.slice(1)
    }));

    return { requests, total, page, limit };
}

export async function updateWithdrawalStatus(id, { status, adminNote, rejectionReason, transactionId, reason } = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid withdrawal ID');
    
    const reasonText = String(rejectionReason || reason || adminNote || '').trim();
    const nextStatus = String(status || '').toLowerCase();
    if (!['pending', 'approved', 'rejected'].includes(nextStatus)) {
        throw new ValidationError('Invalid withdrawal status');
    }
    if (nextStatus === 'rejected' && !reasonText) {
        throw new ValidationError('A rejection reason is required');
    }

    const update = {
        status: nextStatus,
        adminNote: adminNote || reasonText,
        rejectionReason: reasonText,
        reason: reasonText,
        transactionId,
        processedAt: new Date()
    };

    const updated = await FoodRestaurantWithdrawal.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true }
    ).populate('restaurantId', 'restaurantName').lean();

    if (!updated) throw new ValidationError('Withdrawal request not found');

    // Tell the restaurant: the decision (and the reason for a rejection) was only
    // visible if the owner happened to open the withdrawal history.
    if (nextStatus === 'approved' || nextStatus === 'rejected') {
        try {
            const restaurantId = updated.restaurantId?._id || updated.restaurantId;
            const amountLabel = `₹${Number(updated.amount || 0).toLocaleString('en-IN')}`;
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely([{ ownerType: 'RESTAURANT', ownerId: String(restaurantId) }], {
                title: nextStatus === 'approved' ? 'Withdrawal approved' : 'Withdrawal rejected',
                body: nextStatus === 'approved'
                    ? `Your withdrawal request of ${amountLabel} has been approved.`
                    : `Your withdrawal request of ${amountLabel} was rejected. Reason: ${reasonText}`,
                idempotencyKey: `restaurant_withdrawal_${nextStatus}_${updated._id}`,
                data: {
                    type: `withdrawal_${nextStatus}`,
                    withdrawalId: String(updated._id),
                    reason: nextStatus === 'rejected' ? reasonText : '',
                    link: '/food/restaurant/withdrawal-history'
                }
            });
        } catch (err) {
            logger.warn(`[WITHDRAWAL] Notify restaurant failed for ${id}: ${err?.message || err}`);
        }
    }
    return updated;
}


export async function getDeliveryWithdrawals(query = {}) {
    const limit = parseInt(query.limit, 10) || 100;
    const page = parseInt(query.page, 10) || 1;
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.status && query.status !== 'All') {
        filter.status = query.status.toLowerCase();
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim();
        if (!Number.isNaN(Number(term))) {
            filter.amount = Number(term);
        } else {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const partners = await FoodDeliveryPartner.find({
                $or: [
                    { name: { $regex: escaped, $options: 'i' } },
                    { phone: { $regex: escaped, $options: 'i' } },
                    { profilePartnerId: { $regex: escaped, $options: 'i' } },
                ],
            }).select('_id').lean();
            filter.deliveryPartnerId = { $in: partners.map((p) => p._id) };
        }
    }

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId);

    const [withdrawals, total] = await Promise.all([
        FoodDeliveryWithdrawal.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('deliveryPartnerId', 'name phone profilePartnerId upiId upiQrCode')
            .lean(),
        FoodDeliveryWithdrawal.countDocuments(filter)
    ]);

    const requests = withdrawals.map((w) => {
        // `profilePartnerId` does not exist on the delivery partner model, so
        // this column always rendered "N/A". Derive the real display id from the
        // partner reference on this withdrawal — falling back to the raw id on
        // the withdrawal itself when the partner record is gone (old rows).
        const partnerRef = w.deliveryPartnerId?._id || w.deliveryPartnerId;
        return {
            ...w,
            id: w._id,
            deliveryName: w.deliveryPartnerId?.name || 'N/A',
            deliveryPhone: w.deliveryPartnerId?.phone || 'N/A',
            deliveryIdString: toDeliveryPartnerDisplayId(partnerRef) || 'N/A',
            status: w.status.charAt(0).toUpperCase() + w.status.slice(1)
        };
    });

    return { requests, total, page, limit };
}

export async function updateDeliveryWithdrawalStatus(id, { status, adminNote, rejectionReason, transactionId }) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid withdrawal ID');
    
    const update = {
        status: String(status).toLowerCase(),
        adminNote,
        rejectionReason,
        transactionId,
        processedAt: new Date()
    };

    const updated = await FoodDeliveryWithdrawal.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true }
    ).populate('deliveryPartnerId', 'name phone profilePartnerId').lean();

    if (!updated) throw new ValidationError('Withdrawal request not found');

    // If approved, deduct from wallet balance
    if (status.toLowerCase() === 'approved' || status.toLowerCase() === 'processed') {
        const amount = Number(updated.amount || 0);
        if (amount > 0) {
            await FoodDeliveryWallet.findOneAndUpdate(
                { deliveryPartnerId: updated.deliveryPartnerId?._id || updated.deliveryPartnerId },
                { 
                    $inc: { 
                        balance: -amount,
                        totalSettled: amount 
                    } 
                }
            );
        }
    }

    return updated;
}

/**
 * Wallet figures for the given partners, derived from their ledgers: delivered orders
 * (earnings and COD cash), completed cash deposits, bonuses and withdrawals. The
 * Deliveryman List and the delete-partner guard both read them from here, so the
 * amount an admin sees is the amount the guard checks.
 */
async function computeDeliveryWalletRows(partners) {
    // Each rider's own limit: their zone's value, else the platform default.
    const cashLimits = await loadDeliveryCashLimitByZone();
    const cashLimitFor = (partner) => Number(cashLimits.forZone(partner?.zoneId).deliveryCashLimit) || 0;

    const partnerIds = partners.map(p => new mongoose.Types.ObjectId(p._id)).filter(Boolean);

    let earningsList = [];
    let cashCollectedList = [];
    let cashDepositsList = [];
    let bonusList = [];
    let withdrawalList = [];
    let allWallets = [];

    if (partnerIds.length > 0) {
        [
            earningsList,
            cashCollectedList,
            cashDepositsList,
            bonusList,
            withdrawalList,
            allWallets
        ] = await Promise.all([
            FoodOrder.aggregate([
                { $match: { 'dispatch.deliveryPartnerId': { $in: partnerIds }, orderStatus: 'delivered' } },
                { $group: { _id: '$dispatch.deliveryPartnerId', totalEarned: { $sum: { $ifNull: ['$riderEarning', 0] } } } }
            ]),
            FoodOrder.aggregate([
                {
                    $match: {
                        'dispatch.deliveryPartnerId': { $in: partnerIds },
                        orderStatus: 'delivered',
                        'payment.method': { $in: ['cash', 'cod'] }
                    }
                },
                { $group: { _id: '$dispatch.deliveryPartnerId', cashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } } } }
            ]),
            FoodDeliveryCashDeposit.aggregate([
                {
                    $match: {
                        deliveryPartnerId: { $in: partnerIds },
                        status: 'Completed'
                    }
                },
                { $group: { _id: '$deliveryPartnerId', depositedCash: { $sum: { $ifNull: ['$amount', 0] } } } }
            ]),
            DeliveryBonusTransaction.aggregate([
                { $match: { deliveryPartnerId: { $in: partnerIds } } },
                { $group: { _id: '$deliveryPartnerId', total: { $sum: '$amount' } } }
            ]),
            FoodDeliveryWithdrawal.aggregate([
                { $match: { deliveryPartnerId: { $in: partnerIds } } },
                {
                    $group: {
                        _id: '$deliveryPartnerId',
                        totalWithdrawn: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'approved'] }, { $ifNull: ['$amount', 0] }, 0]
                            }
                        },
                        pendingWithdrawals: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'pending'] }, { $ifNull: ['$amount', 0] }, 0]
                            }
                        }
                    }
                }
            ]),
            FoodDeliveryWallet.find({ deliveryPartnerId: { $in: partnerIds } }).lean()
        ]);
    }

    const earningsMap = new Map(earningsList.map(e => [String(e._id), e.totalEarned]));
    const cashCollectedMap = new Map(cashCollectedList.map(c => [String(c._id), c.cashCollected]));
    const cashDepositsMap = new Map(cashDepositsList.map(d => [String(d._id), d.depositedCash]));
    const bonusMap = new Map(bonusList.map(b => [String(b._id), b.total]));
    const withdrawalMap = new Map(withdrawalList.map(w => [String(w._id), w]));
    const walletMap = new Map(allWallets.map(w => [String(w.deliveryPartnerId), w]));

    const wallets = partners.map((p) => {
        const partnerIdStr = String(p._id);
        const wallet = walletMap.get(partnerIdStr);
        const partnerIdstr = p._id ? `DP-${p._id.toString().slice(-8).toUpperCase()}` : '—';
        
        if (!p._id) {
            return {
                walletId: wallet?._id,
                deliveryId: p._id,
                name: p.name,
                phone: p.phone || '',
                deliveryIdString: partnerIdstr,
                pocketBalance: 0,
                totalCashLimit: cashLimitFor(p),
                remainingCashLimit: cashLimitFor(p),
                cashCollected: 0,
                cashDeposited: 0,
                totalEarning: 0,
                bonus: 0,
                totalWithdrawn: 0,
                cashInHand: 0,
            };
        }

        const totalEarned = Number(earningsMap.get(partnerIdStr)) || 0;
        const grossCashCollected = Number(cashCollectedMap.get(partnerIdStr)) || 0;
        const totalDepositedCash = Number(cashDepositsMap.get(partnerIdStr)) || 0;
        const cashInHand = Math.max(0, grossCashCollected - totalDepositedCash);
        const totalBonus = Number(bonusMap.get(partnerIdStr)) || 0;
        
        const wInfo = withdrawalMap.get(partnerIdStr);
        const totalWithdrawn = Number(wInfo?.totalWithdrawn) || 0;
        const pendingWithdrawals = Number(wInfo?.pendingWithdrawals) || 0;
        const pocketBalance = Math.max(0, (totalEarned + totalBonus) - (totalWithdrawn + pendingWithdrawals));

        return {
            walletId: wallet?._id,
            deliveryId: p._id,
            name: p.name,
            phone: p.phone || '',
            deliveryIdString: partnerIdstr,
            pocketBalance,
            totalCashLimit: cashLimitFor(p),
            remainingCashLimit: Math.max(0, cashLimitFor(p) - cashInHand),
            cashCollected: grossCashCollected,
            cashDeposited: totalDepositedCash,
            totalEarning: totalEarned,
            bonus: totalBonus,
            totalWithdrawn,
            cashInHand,
        };
    });

    return wallets;
}

/**
 * Fetch delivery partner wallets with financial summary
 */
export async function getDeliveryWallets(query = {}) {
    const limit = parseInt(query.limit, 10) || 20;
    const page = parseInt(query.page, 10) || 1;
    const skip = (page - 1) * limit;

    // Same partners, same order as getDeliveryPartners for the same query.
    const filter = await buildDeliveryPartnerListFilter({ search: query.search, zoneId: query.zoneId });

    const [partners, total] = await Promise.all([
        FoodDeliveryPartner.find(filter)
            .sort(DELIVERY_PARTNER_LIST_SORT)
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodDeliveryPartner.countDocuments(filter)
    ]);

    const wallets = await computeDeliveryWalletRows(partners);

    return { 
        wallets, 
        pagination: { 
            total, 
            page, 
            limit, 
            pages: Math.ceil(total / limit) || 1 
        } 
    };
}

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** A rider's job on an order is over once it is delivered or cancelled in any way. */
const isFinishedOrderStatus = (status) => status === 'delivered' || String(status).startsWith('cancelled');

/**
 * Permanently delete a delivery partner (admin).
 *
 * Refused while work or money is still in flight: an order assigned to the rider that
 * is not delivered or cancelled, a withdrawal awaiting approval, or a cash deposit
 * awaiting confirmation. COD cash still in the rider's hand is refused too unless the
 * admin acknowledges writing off that exact amount (`writeOffCashInHand`) — once the
 * rider is gone nothing else could ever settle it.
 *
 * Removes the partner, wallet, login sessions, inbox, support tickets, onboarding
 * draft and uploaded documents, cancels unpaid incentives and releases orders still
 * being offered to them. Orders and money history (withdrawals, cash deposits, bonuses,
 * incentives) stay for accounting; their admin views already show a missing rider as
 * "N/A". Unlike a self-deleted account (status "deleted", restorable at login) nothing
 * is left to restore: the phone can only register again as a new partner.
 */
export async function deleteDeliveryPartner(id, { writeOffCashInHand, adminId } = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid delivery partner id');
    }
    const partnerId = new mongoose.Types.ObjectId(String(id));
    const partner = await FoodDeliveryPartner.findById(partnerId).lean();
    if (!partner) throw new NotFoundError('Delivery partner not found');
    const name = partner.name || 'This delivery partner';

    const finishedStatuses = FoodOrder.schema.path('orderStatus').enumValues.filter(isFinishedOrderStatus);
    const [activeOrders, pendingWithdrawals, pendingCashDeposits, [walletRow]] = await Promise.all([
        FoodOrder.find({
            'dispatch.deliveryPartnerId': partnerId,
            'dispatch.status': { $in: ['assigned', 'accepted'] },
            orderStatus: { $nin: finishedStatuses }
        })
            .select('order_id')
            .lean(),
        FoodDeliveryWithdrawal.countDocuments({ deliveryPartnerId: partnerId, status: 'pending' }),
        FoodDeliveryCashDeposit.countDocuments(
            getManualCashSubmissionFilter({ deliveryPartnerId: partnerId, status: 'Pending' })
        ),
        computeDeliveryWalletRows([partner])
    ]);

    if (activeOrders.length) {
        const refs = activeOrders.map((order) => `#${order.order_id || order._id}`).join(', ');
        throw new ValidationError(
            `${name} is on ${activeOrders.length} active order(s) (${refs}). Let the order be delivered, or cancel/reassign it, before deleting.`,
            'DELIVERY_PARTNER_HAS_ACTIVE_ORDERS'
        );
    }
    if (pendingWithdrawals > 0) {
        throw new ValidationError(
            `${name} has a withdrawal request waiting for approval. Approve or reject it in Delivery Withdrawal first.`,
            'DELIVERY_PARTNER_HAS_PENDING_WITHDRAWAL'
        );
    }
    if (pendingCashDeposits > 0) {
        throw new ValidationError(
            `${name} has a cash deposit waiting for confirmation. Resolve it in Cash Confirmations first.`,
            'DELIVERY_PARTNER_HAS_PENDING_CASH_DEPOSIT'
        );
    }
    const cashInHand = roundMoney(walletRow?.cashInHand);
    if (cashInHand > 0 && roundMoney(writeOffCashInHand) !== cashInHand) {
        const error = new ValidationError(
            `${name} still holds ₹${cashInHand.toLocaleString('en-IN')} of collected COD cash. Deleting the account writes this amount off.`,
            'CASH_IN_HAND_WRITE_OFF_REQUIRED'
        );
        error.statusCode = 409;
        error.cashInHand = cashInHand;
        throw error;
    }

    // End every session first: the auth middleware refuses any token whose user has no
    // refresh session left, so the rider app is signed out on its next request.
    await FoodRefreshToken.deleteMany({ userId: partnerId });

    // Orders still being offered to this rider go back to dispatch now instead of
    // waiting for the offer to time out.
    const { liveOfferElemMatch } = await import('../../orders/services/delivery-offer.util.js');
    const offeredOrders = await FoodOrder.find({
        'dispatch.offeredTo': { $elemMatch: liveOfferElemMatch(partnerId) }
    })
        .select('_id')
        .lean();
    if (offeredOrders.length) {
        const { rejectOrderDelivery } = await import('../../orders/services/order.service.js');
        const released = await Promise.allSettled(
            offeredOrders.map((order) => rejectOrderDelivery(String(order._id), partnerId))
        );
        released.forEach((outcome, index) => {
            if (outcome.status === 'rejected') {
                logger.warn(
                    `[ADMIN-DELETE-DELIVERY] Could not release offer on order ${offeredOrders[index]._id}: ${outcome.reason?.message || outcome.reason}`
                );
            }
        });
    }

    const recipientEmail = partner.email;
    const recipientName = partner.name || 'Delivery Partner';

    await notifyAccountDeletedByAdmin('DELIVERY_PARTNER', partnerId, 'delivery partner');

    if (recipientEmail) {
        try {
            const { sendAccountDeletionEmail } = await import('../../../../utils/email.js');
            await sendAccountDeletionEmail({
                to: recipientEmail,
                name: recipientName,
                accountType: 'Delivery Partner',
                details: [
                    ...(partner.phone ? [{ label: 'Registered Phone', value: partner.phone }] : []),
                    ...(partner.vehicleType ? [{ label: 'Vehicle Type', value: partner.vehicleType }] : [])
                ]
            });
        } catch (emailErr) {
            logger.error(`[DELETE-EMAIL] Delivery Partner ${partnerId} deletion email failed for ${recipientEmail}: ${emailErr?.message || emailErr}`);
        }
    }

    const deleted = await FoodDeliveryPartner.findOneAndDelete({ _id: partnerId }).lean();
    if (!deleted) throw new NotFoundError('Delivery partner not found');

    const [{ FoodNotification }, { clearDeliveryDraft, DELIVERY_DRAFT_FIELDS }, { invalidateRiderActiveOrders }] =
        await Promise.all([
            import('../../../../core/notifications/models/notification.model.js'),
            import('../../delivery/services/deliveryOnboardingDraft.service.js'),
            import('../../delivery/services/riderLocation.service.js')
        ]);
    invalidateRiderActiveOrders(partnerId);

    // The rider's own data goes with the account; history other parties rely on stays.
    const cleanup = await Promise.allSettled([
        FoodDeliveryWallet.deleteMany({ deliveryPartnerId: partnerId }),
        DeliverySupportTicket.deleteMany({ deliveryPartnerId: partnerId }),
        FoodNotification.deleteMany({ ownerType: 'DELIVERY_PARTNER', ownerId: partnerId }),
        FoodEarningAddonHistory.updateMany(
            { deliveryPartnerId: partnerId, status: 'pending' },
            { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Delivery partner deleted' } }
        ),
        clearDeliveryDraft(String(deleted.phone || '').replace(/\D/g, '').slice(-10)),
        deleteStoredAssets([...DELIVERY_DRAFT_FIELDS, 'upiQrCode'].map((field) => deleted[field]))
    ]);
    cleanup.forEach((outcome) => {
        if (outcome.status === 'rejected') {
            logger.warn(
                `[ADMIN-DELETE-DELIVERY] Cleanup step failed for ${partnerId}: ${outcome.reason?.message || outcome.reason}`
            );
        }
    });

    // Close any socket the rider app still holds; all delivery emits target this room.
    try {
        const { getIO, rooms } = await import('../../../../config/socket.js');
        getIO()?.in(rooms.delivery(partnerId)).disconnectSockets(true);
    } catch (err) {
        logger.warn(`[ADMIN-DELETE-DELIVERY] Socket disconnect failed for ${partnerId}: ${err?.message || err}`);
    }

    const pocketBalance = roundMoney(walletRow?.pocketBalance);
    logger.info(
        `[ADMIN-DELETE-DELIVERY] Partner ${partnerId} (${deleted.name || '-'}) deleted by admin ${adminId || 'unknown'}; ` +
        `cash written off ₹${cashInHand}, unpaid pocket balance ₹${pocketBalance}, offers released ${offeredOrders.length}`
    );

    return {
        id: String(partnerId),
        name: deleted.name || '',
        cashWrittenOff: cashInHand,
        pocketBalanceForfeited: pocketBalance
    };
}

/**
 * Fetch cash limit settlement (deposit) transactions
 */
export async function getCashLimitSettlements(query = {}) {
    const limit = parseInt(query.limit, 10) || 20;
    const page = parseInt(query.page, 10) || 1;
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim();
    const statusFilter = String(query.status || '').trim();

    const filter = {};
    if (statusFilter && statusFilter.toLowerCase() !== 'all') {
        filter.status = statusFilter;
    }

    if (search) {
        if (search.startsWith('pay_') || search.startsWith('order_')) {
            filter.$or = [
                { razorpayPaymentId: search },
                { razorpayOrderId: search },
            ];
        } else {
            const partnerIds = await FoodDeliveryPartner.find({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { phone: { $regex: search, $options: 'i' } },
                ],
            })
                .select('_id')
                .lean();
            filter.deliveryPartnerId = { $in: partnerIds.map((p) => p._id) };
        }
    }

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId);

    const [deposits, total] = await Promise.all([
        FoodDeliveryCashDeposit.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('deliveryPartnerId', 'name phone')
            .lean(),
        FoodDeliveryCashDeposit.countDocuments(filter)
    ]);

    const transactions = deposits.map((d) => ({
        id: d._id,
        createdAt: d.createdAt,
        deliveryId: d.deliveryPartnerId?._id,
        deliveryName: d.deliveryPartnerId?.name || 'N/A',
        deliveryPhone: d.deliveryPartnerId?.phone || 'N/A',
        deliveryIdString: d.deliveryPartnerId?.phone || 'N/A',
        amount: Number(d.amount || 0),
        status: d.status,
        paymentMethod: String(d.paymentMethod || 'razorpay').toLowerCase() === 'cash'
            ? 'Cash'
            : 'Razorpay',
        razorpayPaymentId: String(d.paymentMethod || '').toLowerCase() === 'cash'
            ? 'N/A'
            : (d.razorpayPaymentId || '-'),
        razorpayOrderId: d.razorpayOrderId || '-',
    }));

    return { 
        transactions, 
        pagination: { 
            total, 
            page, 
            limit, 
            pages: Math.ceil(total / limit) || 1 
        } 
    };
}

/**
 * Admin confirms or rejects a pending cash deposit submission.
 */
export async function updateCashLimitSettlementStatus(depositId, body = {}, adminUser = null) {
    if (!depositId || !mongoose.Types.ObjectId.isValid(String(depositId))) {
        throw new ValidationError('Invalid settlement id');
    }

    const action = String(body.action || '').trim().toLowerCase();
    if (!['received', 'not_received'].includes(action)) {
        throw new ValidationError('action must be received or not_received');
    }

    const deposit = await FoodDeliveryCashDeposit.findById(depositId);
    if (!deposit) throw new NotFoundError('Settlement not found');

    if (deposit.status !== 'Pending') {
        throw new ValidationError(`Settlement is already ${deposit.status}`);
    }

    if (String(deposit.paymentMethod || '').toLowerCase() !== 'cash') {
        throw new ValidationError('Only cash submissions can be confirmed manually');
    }

    const nextStatus = action === 'received' ? 'Completed' : 'Failed';
    deposit.status = nextStatus;
    deposit.confirmationAction = action;
    deposit.adminId = adminUser?._id || null;
    deposit.adminNote = action === 'received'
        ? 'Cash received and confirmed by admin'
        : 'Cash not received — marked by admin';
    await deposit.save();

    const { getDeliveryPartnerWalletEnhanced, notifyDeliveryPartnerCashDepositStatus } = await import('../../delivery/services/deliveryFinance.service.js');
    const wallet = await getDeliveryPartnerWalletEnhanced(deposit.deliveryPartnerId);

    await notifyDeliveryPartnerCashDepositStatus(deposit.deliveryPartnerId, {
        amount: deposit.amount,
        status: nextStatus,
        wallet,
    });

    return {
        deposit: deposit.toObject(),
        wallet,
    };
}

function getManualCashSubmissionFilter(extra = {}) {
    return {
        paymentMethod: 'cash',
        $or: [
            { razorpayPaymentId: { $exists: false } },
            { razorpayPaymentId: null },
            { razorpayPaymentId: '' },
        ],
        ...extra,
    };
}

export async function countPendingCashConfirmations() {
    return FoodDeliveryCashDeposit.countDocuments(
        getManualCashSubmissionFilter({ status: 'Pending' }),
    );
}

function mapCashConfirmationRow(d) {
    const paymentMethod = 'Cash';
    const confirmationAction = d.confirmationAction || null;
    let actionLabel = null;
    if (confirmationAction === 'received') actionLabel = 'Received';
    if (confirmationAction === 'not_received') actionLabel = 'Not Received';

    let statusLabel = d.status || 'Pending';

    return {
        id: d._id,
        createdAt: d.createdAt,
        deliveryId: d.deliveryPartnerId?._id,
        deliveryName: d.deliveryPartnerId?.name || 'N/A',
        deliveryPhone: d.deliveryPartnerId?.phone || 'N/A',
        deliveryIdString: d.deliveryPartnerId?.phone || 'N/A',
        amount: Number(d.amount || 0),
        status: statusLabel,
        rawStatus: d.status,
        paymentMethod,
        confirmationAction,
        actionLabel,
        razorpayPaymentId: 'N/A',
    };
}

/**
 * Cash submissions that need admin confirmation (paymentMethod = cash, manual submit).
 */
export async function getCashConfirmations(query = {}) {
    const limit = parseInt(query.limit, 10) || 20;
    const page = parseInt(query.page, 10) || 1;
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim();
    const tab = String(query.tab || 'all').trim().toLowerCase();

    const filter = getManualCashSubmissionFilter();

    if (tab === 'pending') {
        filter.status = 'Pending';
    } else if (tab === 'confirmed') {
        filter.confirmationAction = { $in: ['received', 'not_received'] };
    }

    if (search) {
        const partnerIds = await FoodDeliveryPartner.find({
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
            ],
        })
            .select('_id')
            .lean();
        filter.deliveryPartnerId = { $in: partnerIds.map((p) => p._id) };
    }

    // Zone picked on the page: only riders of that zone.
    await scopeFilterToRiderZone(filter, query.zoneId);

    const [deposits, total] = await Promise.all([
        FoodDeliveryCashDeposit.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('deliveryPartnerId', 'name phone')
            .lean(),
        FoodDeliveryCashDeposit.countDocuments(filter),
    ]);

    const transactions = deposits.map(mapCashConfirmationRow);

    return {
        transactions,
        pagination: {
            total,
            page,
            limit,
            pages: Math.ceil(total / limit) || 1,
        },
    };
}

export async function getSidebarBadges() {
    try {
        const [
            pendingRestaurants,
            pendingDeliveryPartners,
            pendingFoods,
            pendingAddons,
            pendingOrders,
            pendingOfflinePayments,
            pendingRestaurantWithdrawals,
            pendingDeliveryWithdrawals,
            openUserSupportTickets,
            openDeliverySupportTickets,
            pendingEarningAddons,
            pendingSafetyReports,
            pendingEmergencyHelp,
            pendingRestaurantComplaints,
            pendingCashConfirmations,
            pendingRestaurantOffers,
        ] = await Promise.all([
            FoodRestaurant.countDocuments({ status: 'pending' }),
            FoodDeliveryPartner.countDocuments({ status: 'pending' }),
            FoodItem.countDocuments({ approvalStatus: 'pending' }),
            FoodAddon.countDocuments({ approvalStatus: 'pending' }),
            FoodOrder.countDocuments({
                orderStatus: 'created',
                $or: [
                    { "payment.method": { $in: ["cash", "wallet"] } },
                    { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } }
                ]
            }),
            FoodOrder.countDocuments({ paymentMethod: 'offline_payment', orderStatus: { $in: ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'pending'] } }),
            FoodRestaurantWithdrawal.countDocuments({ status: 'pending' }),
            FoodDeliveryWithdrawal.countDocuments({ status: 'pending' }),
            FoodSupportTicket.countDocuments({ status: 'open', userId: { $exists: true }, restaurantId: { $exists: false } }),
            DeliverySupportTicket.countDocuments({ status: 'open' }),
            FoodEarningAddonHistory.countDocuments({ status: 'pending' }),
            FoodSafetyEmergencyReport.countDocuments({ status: 'pending' }),
            FoodDeliveryEmergencyHelp.countDocuments({ status: 'pending' }),
            FoodSupportTicket.countDocuments({ type: 'order', status: 'pending' }),
            countPendingCashConfirmations(),
            // Offers saved before approval existed have no status yet: they await review too.
            FoodRestaurantOffer.countDocuments({ approvalStatus: { $in: ['pending', null] } }),
        ]);

        return {
            restaurants: pendingRestaurants,
            deliveryPartners: pendingDeliveryPartners,
            foods: pendingFoods + pendingAddons,
            foodApprovals: pendingFoods,
            orders: pendingOrders,
            offlinePayments: pendingOfflinePayments,
            restaurantWithdrawals: pendingRestaurantWithdrawals,
            deliveryWithdrawals: pendingDeliveryWithdrawals,
            cashConfirmations: pendingCashConfirmations,
            userSupportTickets: openUserSupportTickets,
            deliverySupportTickets: openDeliverySupportTickets,
            earningAddons: pendingEarningAddons,
            safetyReports: pendingSafetyReports,
            emergencyHelp: pendingEmergencyHelp,
            restaurantComplaints: pendingRestaurantComplaints,
            restaurantOffers: pendingRestaurantOffers
        };
    } catch (error) {
        console.error('Error fetching sidebar badges:', error);
        return {};
    }
}

/**
 * Admin-triggered Razorpay refund for a paid online order.
 * Status correction + gateway refund — does not re-run cancel automations.
 */
export async function processRefund(orderId, refundAmount) {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        throw new ValidationError('Invalid order id');
    }

    const order = await FoodOrder.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');

    const method = String(order.payment?.method || '').toLowerCase();
    const status = String(order.payment?.status || '').toLowerCase();
    const paymentId = order.payment?.razorpay?.paymentId;
    const alreadyProcessed =
        String(order.payment?.refund?.status || '').toLowerCase() === 'processed';

    if (!['razorpay', 'razorpay_qr'].includes(method)) {
        throw new ValidationError('Refund via Razorpay is only for online payments');
    }
    if (status !== 'paid' && status !== 'refunded') {
        throw new ValidationError('Order payment is not in a refundable paid state');
    }
    if (alreadyProcessed || status === 'refunded') {
        return order;
    }
    if (!paymentId) {
        throw new ValidationError('Razorpay payment id missing on this order');
    }

    const amount = Number(
        refundAmount != null && refundAmount !== ''
            ? refundAmount
            : order.pricing?.total ?? order.payment?.amountDue ?? 0,
    );
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Invalid refund amount');
    }

    const { initiateRazorpayRefund, isRazorpayConfigured } = await import(
        '../../orders/helpers/razorpay.helper.js'
    );
    if (!isRazorpayConfigured()) {
        throw new ValidationError('Razorpay is not configured on this server');
    }

    const refundResult = await initiateRazorpayRefund(paymentId, amount);
    if (!refundResult.success) {
        order.payment.refund = {
            status: 'failed',
            destination: 'source',
            amount,
            refundId: '',
            processedAt: null,
        };
        order.markModified('payment');
        await order.save();
        throw new ValidationError(refundResult.error || 'Razorpay refund failed');
    }

    order.payment.status = 'refunded';
    order.payment.refund = {
        status: 'processed',
        destination: 'source',
        amount,
        refundId: refundResult.refundId || '',
        processedAt: new Date(),
    };
    order.markModified('payment');
    await order.save();

    try {
        await FoodTransaction.updateOne(
            { orderId: order._id },
            {
                $set: { 'payment.status': 'refunded' },
                $push: {
                    history: {
                        kind: 'refunded',
                        amount,
                        at: new Date(),
                        note: `Admin Razorpay refund ${refundResult.refundId || ''}`.trim(),
                        recordedBy: { role: 'ADMIN' },
                    },
                },
            },
        );
    } catch (err) {
        logger.warn(`processRefund ledger sync failed for ${orderId}: ${err?.message || err}`);
    }

    return order;
}

