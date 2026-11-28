import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { withActiveCategoryFilter } from '../../shared/inactiveCategories.js';
import { getRestaurantIdsWithDishes } from '../../shared/orderableRestaurants.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { getFoodDisplayPrice, serializeFoodVariants } from '../../admin/services/foodVariant.service.js';
import mongoose from 'mongoose';

const zoneToPolygon = (zoneDoc) => {
    const coords = Array.isArray(zoneDoc?.coordinates) ? zoneDoc.coordinates : [];
    if (coords.length < 3) return null;
    const ring = coords
        .map((c) => [Number(c.longitude), Number(c.latitude)])
        .filter((pair) => pair.every((n) => Number.isFinite(n)));
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return { type: 'Polygon', coordinates: [ring] };
};

const buildZoneCondition = async (zoneIdRaw) => {
    if (!zoneIdRaw || !mongoose.Types.ObjectId.isValid(zoneIdRaw)) return null;
    const zoneOr = [{ zoneId: new mongoose.Types.ObjectId(zoneIdRaw) }];
    try {
        const zoneDoc = await FoodZone.findById(zoneIdRaw).select('isActive coordinates location').lean();
        if (zoneDoc?.isActive) {
            const polygon = zoneToPolygon(zoneDoc);
            if (polygon) {
                zoneOr.push({ location: { $geoWithin: { $geometry: polygon } } });
            }
        }
    } catch {
        // Ignore zone lookup errors; fall back to zoneId match only.
    }
    return { $or: zoneOr };
};

const mergeAndConditions = (...conditions) => {
    const flat = conditions.filter(Boolean);
    if (flat.length === 0) return {};
    if (flat.length === 1) return flat[0];
    return { $and: flat };
};

/**
 * Unified Search Service
 * Searches for restaurants by name and also searches for food items, 
 * returning matched restaurants with potential dish highlights.
 */
export const searchUnified = async (query = {}, options = {}) => {
    const { 
        q, 
        lat, 
        lng, 
        radiusKm = 20, 
        categoryId, 
        minRating, 
        maxDeliveryTime, 
        isVeg,
        isNonVeg,
        foodType,
        page = 1,
        limit = 20,
        zoneId,
        orderType
    } = query;

    const skip = (page - 1) * limit;
    const term = String(q || '').trim();
    const regex = term ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

    const effectiveOrderType = String(orderType || 'delivery').trim().toLowerCase();

    // Strict zone: only search within the user's detected service zone.
    if (!zoneId || !mongoose.Types.ObjectId.isValid(zoneId)) {
        return {
            success: true,
            data: {
                restaurants: [],
                total: 0,
                page: parseInt(page),
                limit: parseInt(limit),
                zoneFiltered: false
            }
        };
    }

    // 1. Initial Filter (approved status and basic conditions)
    const baseConditions = [{ status: 'approved' }];
    const zoneCondition = await buildZoneCondition(zoneId);
    if (zoneCondition) baseConditions.push(zoneCondition);

    // Restaurants with no orderable dish must never be visible to users.
    const restaurantIdsWithDishes = await getRestaurantIdsWithDishes();
    baseConditions.push({ _id: { $in: restaurantIdsWithDishes } });

    if (foodType) {
        const ft = String(foodType).trim().toLowerCase();
        if (ft === 'veg' || ft === 'pure-veg' || ft === 'pure veg') {
            baseConditions.push({ $or: [{ foodType: 'Veg' }, { pureVegRestaurant: true }] });
        } else if (ft === 'non-veg' || ft === 'non veg') {
            baseConditions.push({ $or: [{ foodType: 'Non-Veg' }, { foodType: 'Mixed' }, { pureVegRestaurant: false }] });
        } else if (ft === 'mixed') {
            baseConditions.push({ foodType: 'Mixed' });
        }
    } else if (isVeg === 'true') {
        baseConditions.push({ $or: [{ foodType: 'Veg' }, { pureVegRestaurant: true }] });
    } else if (isNonVeg === 'true') {
        baseConditions.push({ $or: [{ foodType: 'Non-Veg' }, { foodType: 'Mixed' }, { pureVegRestaurant: false }] });
    }

    if (minRating) {
        baseConditions.push({ rating: { $gte: parseFloat(minRating) } });
    }

    if (maxDeliveryTime) {
        baseConditions.push({ estimatedDeliveryTimeMinutes: { $lte: parseInt(maxDeliveryTime) } });
    }

    if (effectiveOrderType === 'takeaway') {
        baseConditions.push({ 'takeawaySettings.isEnabled': true });
    } else if (effectiveOrderType === 'dining') {
        baseConditions.push({ 'diningSettings.isEnabled': true });
    }

    let restaurantFilter = mergeAndConditions(...baseConditions);

    console.log(`[Search-Service] Querying with term: "${term}", categoryId: "${categoryId}", zoneId: "${zoneId}", orderType: "${effectiveOrderType}"`);
    console.log(`[Search-Service] Final Restaurant Filter:`, JSON.stringify(restaurantFilter));

    let restaurantIds = new Set();
    let restaurantDetailsMap = new Map();
    /** @type {Map<string, Array<{_id: any, name: string, price: number, image: string, foodType: string}>>} */
    const categoryDishesByRestaurant = new Map();

    // 2. Handle Category Filtering (Restaurants don't have categoryId, FoodItems do)
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        const categoryDoc = await FoodCategory.findById(categoryId).select('name').lean();
        let categoryIdsToMatch = [new mongoose.Types.ObjectId(categoryId)];
        if (categoryDoc && categoryDoc.name) {
            const escapedName = categoryDoc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sameNamedCategories = await FoodCategory.find({
                name: { $regex: new RegExp('^' + escapedName + '$', 'i') }
            }).select('_id').lean();
            if (sameNamedCategories.length > 0) {
                categoryIdsToMatch = sameNamedCategories.map(c => c._id);
            }
        }

        // Pull dish fields once so category browse can skip N+1 menu fetches on the client.
        const catFoodItems = await FoodItem.find(await withActiveCategoryFilter({
            categoryId: { $in: categoryIdsToMatch },
            approvalStatus: 'approved',
            isAvailable: { $ne: false },
        }))
            .select('restaurantId name price adminPrice image foodType variants variations')
            .lean();

        for (const food of catFoodItems) {
            const rid = food?.restaurantId?.toString?.();
            if (!rid) continue;
            if (!categoryDishesByRestaurant.has(rid)) {
                categoryDishesByRestaurant.set(rid, []);
            }
            const list = categoryDishesByRestaurant.get(rid);
            if (list.length >= 16) continue;
            list.push({
                _id: food._id,
                name: food.name,
                price: getFoodDisplayPrice(food),
                basePrice: Number(food.price) || getFoodDisplayPrice(food),
                image: food.image || '',
                foodType: food.foodType || 'Non-Veg',
                variants: serializeFoodVariants(food.variants || food.variations || []),
                variations: serializeFoodVariants(food.variants || food.variations || []),
            });
        }

        const catRestaurantIds = [...categoryDishesByRestaurant.keys()];
        if (catRestaurantIds.length > 0) {
            restaurantFilter = mergeAndConditions(
                restaurantFilter,
                { _id: { $in: catRestaurantIds.map(id => new mongoose.Types.ObjectId(id)) } }
            );
        } else {
            // No food items in this category -> No restaurants
            return {
                success: true,
                data: { restaurants: [], total: 0, page: parseInt(page), limit: parseInt(limit) }
            };
        }
    }

    const scopedRestaurants = await FoodRestaurant.find(restaurantFilter).select('_id').lean();
    const allowedRestaurantIds = scopedRestaurants.map((r) => r._id);

    if (allowedRestaurantIds.length === 0) {
        return {
            success: true,
            data: {
                restaurants: [],
                total: 0,
                page: parseInt(page),
                limit: parseInt(limit),
                zoneFiltered: true
            }
        };
    }

    // 3. Search Matching
    if (regex) {
        // A. Search by Restaurant Name / Cuisine
        const nameSearchFilter = mergeAndConditions(restaurantFilter, {
            $or: [
                { restaurantName: { $regex: regex } },
                { cuisines: { $regex: regex } }
            ]
        });

        const matchedRestaurants = await FoodRestaurant.find(nameSearchFilter)
            .limit(limit * 3)
            .lean();

        matchedRestaurants.forEach(r => {
            restaurantIds.add(r._id.toString());
            restaurantDetailsMap.set(r._id.toString(), { ...r, matchType: 'restaurant' });
        });

        // B. Search by Food Item Name / Description / Variants (zone + service scoped)
        const foodFilters = {
            approvalStatus: 'approved',
            isAvailable: { $ne: false },
            restaurantId: { $in: allowedRestaurantIds },
            $or: [
                { name: { $regex: regex } },
                { description: { $regex: regex } },
                { categoryName: { $regex: regex } },
                { 'variants.name': { $regex: regex } }
            ]
        };
        if (isVeg === 'true' || foodType === 'Veg') foodFilters.foodType = { $in: ['Veg', 'Vegan'] };
        else if (isNonVeg === 'true' || foodType === 'Non-Veg') foodFilters.foodType = { $nin: ['Veg', 'Vegan'] };

        await withActiveCategoryFilter(foodFilters);
        const matchedFoods = await FoodItem.find(foodFilters)
            .limit(Math.max(limit * 6, 60))
            .lean();

        const foodByRestaurant = new Map();
        matchedFoods.forEach((food) => {
            const rid = food.restaurantId?.toString();
            if (!rid || foodByRestaurant.has(rid)) return;
            foodByRestaurant.set(rid, food);
        });

        const unmatchedIds = [];
        foodByRestaurant.forEach((food, rid) => {
            if (restaurantDetailsMap.has(rid)) {
                const existing = restaurantDetailsMap.get(rid);
                restaurantDetailsMap.set(rid, {
                    ...existing,
                    matchType: 'food',
                    matchedDish: food.name,
                    matchedDishImage: food.image,
                    matchedDishId: food._id,
                    matchedDishFoodType: food.foodType === 'Vegan' ? 'Veg' : (food.foodType || null),
                    foodType: food.foodType === 'Vegan' ? 'Veg' : (food.foodType || null),
                    isVeg: ['veg', 'vegan'].includes(String(food.foodType || '').toLowerCase()),
                    isVegan: false,
                });
                return;
            }
            unmatchedIds.push(rid);
        });

        if (unmatchedIds.length > 0) {
            const foodRestaurantFilter = mergeAndConditions(
                restaurantFilter,
                { _id: { $in: unmatchedIds.map(id => new mongoose.Types.ObjectId(id)) } }
            );

            const rsForFoods = await FoodRestaurant.find(foodRestaurantFilter).lean();

            rsForFoods.forEach(r => {
                const rid = r._id.toString();
                const food = foodByRestaurant.get(rid);
                if (!food) return;
                restaurantIds.add(rid);
                restaurantDetailsMap.set(rid, {
                    ...r,
                    matchType: 'food',
                    matchedDish: food.name,
                    matchedDishImage: food.image,
                    matchedDishId: food._id,
                    matchedDishFoodType: food.foodType === 'Vegan' ? 'Veg' : (food.foodType || null),
                    foodType: food.foodType === 'Vegan' ? 'Veg' : (food.foodType || null),
                    isVeg: ['veg', 'vegan'].includes(String(food.foodType || '').toLowerCase()),
                    isVegan: false,
                });
            });
        }
    } else {
        // No search text -> List all restaurants matching filters (category/zone)
        const allMatching = await FoodRestaurant.find(restaurantFilter)
            .sort({ rating: -1, createdAt: -1 })
            .limit(limit * 2)
            .lean();
            
        allMatching.forEach(r => {
            restaurantIds.add(r._id.toString());
            restaurantDetailsMap.set(r._id.toString(), r);
        });
    }

    // 4. Final Result Formatting
    let results = Array.from(restaurantDetailsMap.values());

    // Distance sorting (GeoJSON coordinates [lng, lat] or latitude/longitude fields)
    if (lat && lng && results.length > 0) {
        const userLat = Number(lat);
        const userLng = Number(lng);
        const toRad = (deg) => (deg * Math.PI) / 180;
        const haversineKm = (lat1, lng1, lat2, lng2) => {
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lng2 - lng1);
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRad(lat1)) *
                    Math.cos(toRad(lat2)) *
                    Math.sin(dLon / 2) *
                    Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return 6371 * c;
        };

        results.forEach((res) => {
            const coords = res.location?.coordinates;
            const restaurantLat = Number(
                Array.isArray(coords) && coords.length >= 2
                    ? coords[1]
                    : (res.location?.latitude ?? res.latitude),
            );
            const restaurantLng = Number(
                Array.isArray(coords) && coords.length >= 2
                    ? coords[0]
                    : (res.location?.longitude ?? res.longitude),
            );

            if (
                Number.isFinite(userLat) &&
                Number.isFinite(userLng) &&
                Number.isFinite(restaurantLat) &&
                Number.isFinite(restaurantLng)
            ) {
                const km = haversineKm(userLat, userLng, restaurantLat, restaurantLng);
                res.distanceScore = km;
                res.distanceInKm = Math.round(km * 100) / 100;
                res.distance =
                    km >= 1
                        ? `${km.toFixed(1)} km`
                        : `${Math.round(km * 1000)} m`;
            } else {
                res.distanceScore = 999;
                res.distanceInKm = null;
            }
        });
        results.sort((a, b) => (a.distanceScore || 999) - (b.distanceScore || 999));
    }

    // ... (rest of logic up to result formation)
    let pageRestaurants = results.slice(skip, skip + limit);

    if (categoryDishesByRestaurant.size > 0) {
        pageRestaurants = pageRestaurants.map((restaurant) => {
            const rid = restaurant?._id?.toString?.();
            const dishes = rid ? categoryDishesByRestaurant.get(rid) : null;
            if (!Array.isArray(dishes) || dishes.length === 0) return restaurant;
            const first = dishes[0];
            return {
                ...restaurant,
                categoryDishes: dishes,
                matchedDish: first.name,
                matchedDishImage: first.image,
                matchedDishId: first._id,
                matchedDishFoodType: first.foodType === 'Vegan' ? 'Veg' : (first.foodType || null),
                foodType: first.foodType === 'Vegan' ? 'Veg' : (first.foodType || null),
                isVeg: ['veg', 'vegan'].includes(String(first.foodType || '').toLowerCase()),
                isVegan: false,
            };
        });
    }

    const finalResult = {
        success: true,
        data: {
            restaurants: pageRestaurants,
            total: results.length,
            page: parseInt(page),
            limit: parseInt(limit),
            zoneFiltered: !!(zoneId && mongoose.Types.ObjectId.isValid(zoneId))
        }
    };

    return finalResult;
};

/**
 * Fetch Admin-only categories
 */
export const getAdminCategories = async (query = {}) => {
    const zoneId = query.zoneId;

    let approvedCategoryIds = [];
    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
        const zoneRestaurants = await FoodRestaurant.find({
            zoneId: new mongoose.Types.ObjectId(zoneId),
            status: 'approved'
        }).select('_id').lean();
        const zoneRestaurantIds = zoneRestaurants.map(r => r._id);
        
        approvedCategoryIds = await FoodItem.distinct('categoryId', {
            approvalStatus: 'approved',
            restaurantId: { $in: zoneRestaurantIds },
            categoryId: { $ne: null }
        });
    } else {
        approvedCategoryIds = await FoodItem.distinct('categoryId', {
            approvalStatus: 'approved',
            categoryId: { $ne: null }
        });
    }

    if (!approvedCategoryIds.length) {
        return [];
    }

    const filter = { 
        _id: { $in: approvedCategoryIds },
        isActive: true, 
        isApproved: true,
        $and: [
            {
                $or: [
                    { restaurantId: { $exists: false } },
                    { restaurantId: null },
                    { restaurantId: { $eq: undefined } }
                ]
            }
        ]
    };

    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
        filter.$and.push({
            $or: [
                { zoneId: new mongoose.Types.ObjectId(zoneId) },
                { zoneId: { $exists: false } },
                { zoneId: null }
            ]
        });
    } else {
        filter.$and.push({
            $or: [
                { zoneId: { $exists: false } },
                { zoneId: null }
            ]
        });
    }

    const list = await FoodCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean();

    // Deduplicate in memory
    const groups = {};
    for (const cat of list) {
        const key = String(cat.name || '').toLowerCase().trim();
        if (!key) continue;
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(cat);
    }

    const deduplicated = [];
    for (const key of Object.keys(groups)) {
        const group = groups[key];
        if (group.length === 1) {
            deduplicated.push(group[0]);
            continue;
        }

        group.sort((a, b) => {
            const aZoneMatch = zoneId && String(a.zoneId) === String(zoneId);
            const bZoneMatch = zoneId && String(b.zoneId) === String(zoneId);
            if (aZoneMatch && !bZoneMatch) return -1;
            if (!aZoneMatch && bZoneMatch) return 1;

            const aGlobal = !a.zoneId;
            const bGlobal = !b.zoneId;
            if (aGlobal && !bGlobal) return -1;
            if (!aGlobal && bGlobal) return 1;

            const aHasImg = !!a.image;
            const bHasImg = !!b.image;
            if (aHasImg && !bHasImg) return -1;
            if (!aHasImg && bHasImg) return 1;

            const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : 0;
            const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : 0;
            if (aOrder !== bOrder) return aOrder - bOrder;

            const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return bTime - aTime;
        });

        deduplicated.push(group[0]);
    }

    deduplicated.sort((a, b) => {
        const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : 0;
        const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });

    return deduplicated;
};
