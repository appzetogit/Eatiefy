import { FoodItem } from '../admin/models/food.model.js';
import { buildActiveCategoryFoodClause } from './inactiveCategories.js';

/**
 * Returns an array of ObjectIds for restaurants that have at least
 * one orderable (approved, available, active category) dish.
 *
 * @param {object} [extraFoodMatch={}] Optional additional filter on FoodItem (e.g. { restaurantId: { $in: [...] } })
 * @returns {Promise<Array<import('mongoose').Types.ObjectId>>}
 */
export async function getRestaurantIdsWithDishes(extraFoodMatch = {}) {
    const listableCategoryClause = await buildActiveCategoryFoodClause();
    const match = {
        isAvailable: true,
        approvalStatus: 'approved',
        ...(listableCategoryClause || {}),
        ...extraFoodMatch,
    };
    return FoodItem.distinct('restaurantId', match);
}

/**
 * Returns a set of string restaurant IDs with orderable dishes for fast in-memory lookups.
 *
 * @param {object} [extraFoodMatch={}]
 * @returns {Promise<Set<string>>}
 */
export async function getRestaurantIdSetWithDishes(extraFoodMatch = {}) {
    const ids = await getRestaurantIdsWithDishes(extraFoodMatch);
    return new Set(ids.map((id) => String(id)));
}
