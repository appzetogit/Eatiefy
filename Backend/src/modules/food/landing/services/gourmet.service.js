import { FoodGourmetRestaurant } from '../models/gourmetRestaurant.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { getRestaurantIdSetWithDishes } from '../../shared/orderableRestaurants.js';

export const getPublicGourmetRestaurants = async (zoneId) => {
    const docs = await FoodGourmetRestaurant.find({ isActive: true })
        .sort({ priority: 1, createdAt: -1 })
        .lean();

    const restaurantIds = docs.map((d) => d.restaurantId);
    // Restaurants with no orderable dish must never be visible to users.
    const eligibleIdSet = await getRestaurantIdSetWithDishes({ restaurantId: { $in: restaurantIds } });
    const eligibleRestaurantIds = restaurantIds.filter((id) => eligibleIdSet.has(String(id)));

    if (!eligibleRestaurantIds.length) {
        return [];
    }

    const restaurantFilter = { _id: { $in: eligibleRestaurantIds }, status: 'approved' };
    if (zoneId && String(zoneId).trim()) {
        restaurantFilter.zoneId = String(zoneId).trim();
    }

    const restaurants = await FoodRestaurant.find(restaurantFilter)
        .select('restaurantName area city profileImage rating cuisines slug pureVegRestaurant location estimatedDeliveryTime zoneId')
        .lean();

    const restaurantMap = new Map(restaurants.map((r) => [r._id.toString(), r]));

    return docs.map((item) => {
        const r = restaurantMap.get(item.restaurantId.toString());
        if (!r) return null;
        return {
            ...item,
            restaurant: {
                _id: r._id,
                name: r.restaurantName,
                restaurantName: r.restaurantName,
                rating: r.rating || 0,
                profileImage: r.profileImage ? { url: r.profileImage } : null,
                area: r.area,
                city: r.city,
                cuisines: r.cuisines || [],
                slug: r.slug,
                pureVegRestaurant: r.pureVegRestaurant,
                location: r.location,
                estimatedDeliveryTime: r.estimatedDeliveryTime,
                zoneId: r.zoneId
            }
        };
    }).filter(Boolean);
};

