import mongoose from 'mongoose';
import { getPublicGourmetRestaurants } from '../services/gourmet.service.js';
import { getLandingSettings } from '../services/landingSettings.service.js';
import { FoodHeroBanner } from '../models/heroBanner.model.js';
import { FoodUnder250Banner } from '../models/under250Banner.model.js';
import { FoodDiningBanner } from '../models/diningBanner.model.js';
import { FoodExploreIcon } from '../models/exploreIcon.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { sendResponse } from '../../../../utils/response.js';
import { resolveServiceZone, buildZoneServiceabilityClause } from '../../shared/zoneLocation.js';
import { getRestaurantIdsWithDishes, getRestaurantIdSetWithDishes } from '../../shared/orderableRestaurants.js';

/** Public hero banners for user home: active only, sorted, with linkedRestaurants populated for click-through */
/** Shared by the standalone route and the aggregated /public/app-config payload. */
export const loadPublicHeroBanners = async (zoneId) => {
    let query = { isActive: true };
    if (zoneId) query.zoneId = zoneId;
    else query.zoneId = null;

    const populateLinked = {
        path: 'linkedRestaurantIds',
        select: '_id restaurantName slug area city rating cuisines profileImage pureVegRestaurant zoneId',
        model: 'FoodRestaurant'
    };

    let docs = await FoodHeroBanner.find(query)
        .sort({ sortOrder: 1, createdAt: -1 })
        .populate(populateLinked)
        .lean();

    // Fall back to global banners when the zone has none of its own.
    if (zoneId && docs.length === 0) {
        query.zoneId = null;
        docs = await FoodHeroBanner.find(query)
            .sort({ sortOrder: 1, createdAt: -1 })
            .populate(populateLinked)
            .lean();
    }

    const dishesIdSet = await getRestaurantIdSetWithDishes();
    return (docs || []).map((b) => {
        const { linkedRestaurantIds, ...rest } = b;
        const linkedRestaurants = (Array.isArray(linkedRestaurantIds) ? linkedRestaurantIds : [])
            .filter((r) => r && dishesIdSet.has(String(r._id || r)));
        return {
            ...rest,
            linkedRestaurants,
            imageUrl: b.imageUrl
        };
    });
};

export const getPublicHeroBannersController = async (req, res, next) => {
    try {
        const banners = await loadPublicHeroBanners(req.query?.zoneId);
        return sendResponse(res, 200, 'Hero banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicUnder250BannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        let query = { isActive: true };
        if (zoneId) query.zoneId = zoneId;
        else query.zoneId = null;

        let docs = await FoodUnder250Banner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        if (zoneId && docs.length === 0) {
            query.zoneId = null;
            docs = await FoodUnder250Banner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        }
        return sendResponse(res, 200, 'Under 250 banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

export const getPublicDiningBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        let query = { isActive: true };
        if (zoneId) query.zoneId = zoneId;
        else query.zoneId = null;

        let docs = await FoodDiningBanner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        if (zoneId && docs.length === 0) {
            query.zoneId = null;
            docs = await FoodDiningBanner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        }
        return sendResponse(res, 200, 'Dining banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

/** Shared by the standalone route and the aggregated /public/app-config payload. */
export const loadPublicExploreIcons = async (zoneId) => {
    const globalDocs = await FoodExploreIcon.find({
        $or: [{ zoneId: null }, { zoneId: { $exists: false } }],
        isActive: true
    }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const zoneDocs = zoneId ? await FoodExploreIcon.find({ zoneId, isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean() : [];
    
    const getSlotKey = (doc) => {
        if (!doc) return '';
        if (doc.linkType && doc.linkType !== 'custom') return doc.linkType;
        const lower = String(doc.label || '').toLowerCase().trim();
        const path = String(doc.targetPath || doc.link || '').toLowerCase();
        if (lower.includes('99') || lower.includes('250') || path.includes('under-250')) return 'under-250';
        if (lower.includes('offer') || path.includes('offers')) return 'offers';
        if (lower.includes('gourmet') || path.includes('gourmet')) return 'gourmet';
        if (lower.includes('collection') || lower.includes('favorite') || path.includes('favorite')) return 'collections';
        return lower;
    };

    let docs = [];
    if (!zoneId || zoneDocs.length === 0) {
        docs = globalDocs;
    } else {
        const zoneMap = new Map();
        zoneDocs.forEach(doc => {
            zoneMap.set(getSlotKey(doc), doc);
        });
        
        const usedZoneKeys = new Set();
        for (const gDoc of globalDocs) {
            const key = getSlotKey(gDoc);
            if (zoneMap.has(key)) {
                docs.push(zoneMap.get(key));
                usedZoneKeys.add(key);
            } else {
                docs.push(gDoc);
            }
        }
        
        for (const [key, doc] of zoneMap.entries()) {
            if (!usedZoneKeys.has(key)) {
                docs.push(doc);
            }
        }
        
        docs.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
    }
    return docs.map(({ targetPath, sortOrder, ...rest }) => ({ ...rest, link: targetPath, order: sortOrder }));
};

export const getPublicExploreIconsController = async (req, res, next) => {
    try {
        const items = await loadPublicExploreIcons(req.query?.zoneId);
        return sendResponse(res, 200, 'Explore icons fetched', { items });
    } catch (error) {
        next(error);
    }
};


export const getPublicGourmetController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const docs = await getPublicGourmetRestaurants(zoneId);
        const restaurants = (docs || []).map((d) => ({
            ...(d.restaurant || {}),
            _id: d.restaurant?._id || d.restaurantId,
            priority: d.priority
        })).filter((r) => r && r._id);
        return sendResponse(res, 200, 'Gourmet restaurants fetched', { restaurants });
    } catch (error) {
        next(error);
    }
};

const RESTAURANT_SELECT =
    'restaurantName area city profileImage coverImages menuImages slug rating totalRatings cuisines pureVegRestaurant pureVeganRestaurant isAcceptingOrders isActive openingTime closingTime openDays zoneId location estimatedDeliveryTime estimatedDeliveryTimeMinutes offer';

/** Shared by the standalone route and the aggregated /public/app-config payload. */
export const loadPublicLandingSettings = async (zoneId) => {
    let settings = await getLandingSettings(zoneId);
    let globalSettings = null;

    if (zoneId) {
        globalSettings = await getLandingSettings(null);
        // Merge global settings into zone settings for any missing fields
        settings = {
            ...globalSettings,
            ...settings,
            exploreMoreHeading:
                settings.exploreMoreHeading && settings.exploreMoreHeading !== 'Explore more'
                    ? settings.exploreMoreHeading
                    : globalSettings?.exploreMoreHeading,
            recommendedRestaurantIds:
                settings.recommendedRestaurantIds && settings.recommendedRestaurantIds.length > 0
                    ? settings.recommendedRestaurantIds
                    : globalSettings?.recommendedRestaurantIds || [],
            festBannerImageUrl: settings.festBannerImageUrl ? settings.festBannerImageUrl : globalSettings?.festBannerImageUrl,
            festBannerTopColor: settings.festBannerTopColor ? settings.festBannerTopColor : globalSettings?.festBannerTopColor,
        };
    }

    const ids = settings?.recommendedRestaurantIds || [];
    let serviceZone = null;
    if (zoneId && mongoose.Types.ObjectId.isValid(String(zoneId))) {
        serviceZone = await resolveServiceZone({ zoneId: String(zoneId) });
    }
    const zoneClause = serviceZone
        ? buildZoneServiceabilityClause(serviceZone)
        : (zoneId && mongoose.Types.ObjectId.isValid(String(zoneId))
            ? { zoneId: new mongoose.Types.ObjectId(String(zoneId)) }
            : null);

    // Restaurants with no orderable dish must never be visible to users.
    const restaurantIdsWithDishes = await getRestaurantIdsWithDishes();
    const dishesIdSet = new Set(restaurantIdsWithDishes.map((id) => String(id)));

    let recommendedRestaurants = [];
    const validObjectIds = Array.isArray(ids)
        ? ids
            .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
            .map((id) => new mongoose.Types.ObjectId(String(id)))
            .filter((oid) => dishesIdSet.has(String(oid)))
        : [];

    if (validObjectIds.length > 0) {
        const query = { _id: { $in: validObjectIds }, status: 'approved' };
        if (zoneClause) {
            query.$and = [zoneClause];
        }
        recommendedRestaurants = await FoodRestaurant.find(query)
            .select(RESTAURANT_SELECT)
            .lean();

        // Preserve admin-curated order
        const idOrderMap = new Map(validObjectIds.map((id, idx) => [String(id), idx]));
        recommendedRestaurants.sort((a, b) => {
            const idxA = idOrderMap.has(String(a._id)) ? idOrderMap.get(String(a._id)) : 999;
            const idxB = idOrderMap.has(String(b._id)) ? idOrderMap.get(String(b._id)) : 999;
            return idxA - idxB;
        });
    }

    // Dynamic supplement: Ensure at least 10 high-quality approved restaurants are returned whenever available
    const DESIRED_COUNT = 10;
    if (recommendedRestaurants.length < DESIRED_COUNT) {
        const existingIds = new Set(recommendedRestaurants.map((r) => String(r._id)));
        const existingNames = new Set(
            recommendedRestaurants
                .map((r) => (r.restaurantName || '').toLowerCase().trim())
                .filter(Boolean)
        );

        const candidateIds = restaurantIdsWithDishes.filter((id) => !existingIds.has(String(id)));
        if (candidateIds.length > 0) {
            const fallbackFilter = {
                status: 'approved',
                isAcceptingOrders: { $ne: false },
                _id: { $in: candidateIds },
            };
            if (zoneClause) {
                fallbackFilter.$and = [zoneClause];
            }

            const additionalCandidates = await FoodRestaurant.find(fallbackFilter)
                .sort({ rating: -1, totalRatings: -1, createdAt: -1 })
                .limit(DESIRED_COUNT * 2)
                .select(RESTAURANT_SELECT)
                .lean();

            for (const candidate of additionalCandidates) {
                if (recommendedRestaurants.length >= DESIRED_COUNT) break;
                const normName = (candidate.restaurantName || '').toLowerCase().trim();
                // Avoid adding identical restaurant name duplicate cards
                if (normName && existingNames.has(normName)) continue;
                if (normName) existingNames.add(normName);
                recommendedRestaurants.push(candidate);
            }
        }
    }

    const payload = {
        ...settings,
        recommendedRestaurantIds: recommendedRestaurants.map((r) => String(r._id)),
        recommendedRestaurants,
    };
    return payload;
};

export const getPublicLandingSettingsController = async (req, res, next) => {
    try {
        let zoneId = req.query?.zoneId;
        const lat = req.query?.lat;
        const lng = req.query?.lng;

        if (!zoneId && lat != null && lng != null) {
            const { detectZoneIdForPoint } = await import('../../utils/zoneGeo.js');
            zoneId = await detectZoneIdForPoint(Number(lat), Number(lng));
        }

        const payload = await loadPublicLandingSettings(zoneId);
        return sendResponse(res, 200, 'Landing settings fetched', payload);
    } catch (error) {
        next(error);
    }
};

