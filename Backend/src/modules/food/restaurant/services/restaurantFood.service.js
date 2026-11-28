import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import {
    extractRawFoodVariants,
    getFoodAdminPrice,
    getFoodDisplayPrice,
    hasFoodVariants,
    normalizeFoodVariantsInput,
    toRestaurantFacingFood
} from '../../admin/services/foodVariant.service.js';
import {
    GLOBAL_CATEGORY_FILTER,
    backfillLegacyCategoryWorkflow,
    categoryAllowsFoodType,
    normalizeDishFoodType,
} from '../../shared/categoryWorkflow.js';
import {
    formatVeganBlockMessage,
    getVeganFoodTypeBlockReason,
} from '../../shared/veganFoodGuard.js';
import { normalizeImageForStorage } from '../../../../services/storage.service.js';
import { deleteFoodImagesIfUnused, removedAssetUrls } from '../../../../services/assetReferences.service.js';

const toStr = (v) => (v != null ? String(v).trim() : '');
const APPROVED_CATEGORY_FILTER = [
    { approvalStatus: 'approved' },
    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
];

const normalizeFoodType = (v) => normalizeDishFoodType(v);

const assertFoodTypeAllowedForContent = (foodType, { name, description } = {}) => {
    if (foodType !== 'Vegan') return;
    const reason = getVeganFoodTypeBlockReason({ name, description });
    if (reason.blocked) {
        throw new ValidationError(formatVeganBlockMessage(reason));
    }
};

const getCreateFoodPricing = (body = {}) => {
    const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
    const rawPrice = body.price !== undefined && body.price !== null && body.price !== '' ? Number(body.price) : NaN;
    const hasValidPrice = Number.isFinite(rawPrice) && rawPrice >= 0;

    if (variants.length > 0) {
        return {
            price: getFoodDisplayPrice({ variants }),
            variants
        };
    }

    if (!hasValidPrice) throw new ValidationError('Price is invalid');
    return {
        price: rawPrice,
        variants: []
    };
};

const getUpdatedFoodPricing = (existing = {}, body = {}) => {
    const variantsTouched = body.variants !== undefined || body.variations !== undefined;
    const update = {};

    const rawPrice = body.price !== undefined && body.price !== null && body.price !== '' ? Number(body.price) : NaN;
    const hasValidPrice = Number.isFinite(rawPrice) && rawPrice >= 0;

    if (variantsTouched) {
        const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
        update.variants = variants;

        if (variants.length > 0) {
            update.price = getFoodDisplayPrice({ variants });
            return update;
        }

        if (hasValidPrice) {
            update.price = rawPrice;
            return update;
        }

        const nextBasePrice = Number.isFinite(Number(existing.price)) ? Number(existing.price) : NaN;
        if (!Number.isFinite(nextBasePrice) || nextBasePrice < 0) {
            throw new ValidationError('Base price is required when variants are removed');
        }
        update.price = nextBasePrice;
        return update;
    }

    if (body.price !== undefined) {
        if (!hasValidPrice) throw new ValidationError('Price is invalid');
        update.price = rawPrice;
    }

    return update;
};

const getRestaurantContext = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }

    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('foodType pureVegRestaurant zoneId')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }

    const foodType = restaurant.pureVegRestaurant ? 'Veg' : (restaurant.foodType || 'Mixed');
    return {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        foodType,
        pureVegRestaurant: foodType === 'Veg',
        zoneId: restaurant.zoneId || null,
    };
};

const getAccessibleCategoryFilter = (context) => ({
    $or: [
        { restaurantId: context.restaurantId, $or: APPROVED_CATEGORY_FILTER },
        {
            $and: [
                { $or: GLOBAL_CATEGORY_FILTER },
                { $or: APPROVED_CATEGORY_FILTER }
            ]
        }
    ]
});

const resolveCategoryForRestaurant = async (context, body = {}) => {
    const categoryIdRaw = toStr(body.categoryId);
    const categoryNameRaw = toStr(body.categoryName);
    const foodType = normalizeFoodType(body.foodType);

    if (!categoryIdRaw && !categoryNameRaw) {
        return { categoryObjectId: undefined, categoryName: '' };
    }

    const baseFilter = {
        ...getAccessibleCategoryFilter(context),
        isActive: { $ne: false }
    };
    if (context.foodType === 'Veg' || context.pureVegRestaurant) {
        baseFilter.foodTypeScope = { $nin: ['Non-Veg', 'non-veg'] };
    } else if (context.foodType === 'Non-Veg') {
        baseFilter.foodTypeScope = { $nin: ['Veg', 'veg'] };
    }

    let category = null;
    if (categoryIdRaw) {
        if (!mongoose.Types.ObjectId.isValid(categoryIdRaw)) {
            throw new ValidationError('Invalid category id');
        }

        category = await FoodCategory.findOne({
            _id: new mongoose.Types.ObjectId(categoryIdRaw),
            ...baseFilter
        }).lean();
    } else {
        const exact = `^${String(categoryNameRaw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
        const matches = await FoodCategory.find({
            ...baseFilter,
            name: { $regex: exact, $options: 'i' }
        })
            .sort({ createdAt: -1 })
            .limit(2)
            .lean();
        if (matches.length > 1) {
            throw new ValidationError('Multiple categories share this name. Please choose a specific category.');
        }
        category = matches[0] || null;
    }

    if (!category?._id) {
        throw new ValidationError('Category not found for this restaurant');
    }

    await backfillLegacyCategoryWorkflow([category]);

    const isOwnPrivateCategory = Boolean(
        category?.restaurantId && String(category.restaurantId) === String(context.restaurantId)
    );
    if (!isOwnPrivateCategory && String(category.approvalStatus || '') !== 'approved') {
        throw new ValidationError('This category is awaiting admin approval');
    }
    if (context.foodType === 'Veg' && String(category.foodTypeScope || '') === 'Non-Veg') {
        throw new ValidationError('Veg restaurants can only use veg categories');
    }
    if (context.foodType === 'Non-Veg' && String(category.foodTypeScope || '') === 'Veg') {
        throw new ValidationError('Non-veg restaurants can only use non-veg categories');
    }
    if (!categoryAllowsFoodType(category.foodTypeScope, foodType)) {
        throw new ValidationError(`This ${category.foodTypeScope} category cannot accept ${foodType} food`);
    }

    return {
        categoryObjectId: category._id,
        categoryName: category.name || '',
        category
    };
};

export async function getRestaurantFoodById(restaurantId, foodId) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    if (!foodId || !mongoose.Types.ObjectId.isValid(String(foodId))) {
        throw new ValidationError('Invalid food id');
    }

    const food = await FoodItem.findOne({
        _id: foodId,
        restaurantId,
    })
        .select('-oldData -newData +adminPrice')
        .lean();

    return food ? toRestaurantFacingFood(food) : null;
}

export async function createRestaurantFood(restaurantId, body = {}) {
    const context = await getRestaurantContext(restaurantId);

    const name = toStr(body.name);
    if (!name) throw new ValidationError('Item name is required');
    if (name.length > 200) throw new ValidationError('Item name is too long');

    const { price, variants } = getCreateFoodPricing(body);

    const description = toStr(body.description);
    // One canonical absolute URL, and never a device-local blob:/data: preview.
    const image = normalizeImageForStorage(body.image);
    const isAvailable = body.isAvailable !== false;
    const foodType = normalizeFoodType(body.foodType);
    if (context.foodType === 'Veg' && foodType !== 'Veg') {
        throw new ValidationError('Veg restaurants can only add veg foods');
    }
    if (context.foodType === 'Non-Veg' && foodType !== 'Non-Veg') {
        throw new ValidationError('Non-veg restaurants can only add non-veg foods');
    }
    const preparationTime = toStr(body.preparationTime);
    const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, { ...body, foodType });

    const doc = await FoodItem.create({
        restaurantId,
        zoneId: context.zoneId || null,
        categoryId: categoryObjectId,
        categoryName: categoryName || '',
        name,
        description,
        price,
        variants,
        image,
        foodType,
        isAvailable,
        isRecommended: body.isRecommended === true,
        preparationTime,
        approvalStatus: 'pending',
        requestedAt: new Date(),
        actionType: 'NEW',
        oldData: null,
        newData: {
            name,
            description,
            price,
            variants,
            image,
            foodType,
            preparationTime,
            categoryName: categoryName || '',
            isRecommended: body.isRecommended === true
        }
    });

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'New Product Approval Request ðŸ”',
            body: `Restaurant has submitted a new item "${doc.name}" for approval.`,
            data: {
                type: 'approval_request',
                subType: 'food',
                id: String(doc._id)
            }
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of new food approval request:', e);
    }

    return toRestaurantFacingFood(doc.toObject());
}

export async function updateRestaurantFood(restaurantId, foodId, body = {}) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    if (!foodId || !mongoose.Types.ObjectId.isValid(String(foodId))) {
        throw new ValidationError('Invalid food id');
    }

    // ⚡ Fast path: isAvailable / isRecommended only — skip heavy context + findOne
    const bodyKeys = Object.keys(body).filter(k => body[k] !== undefined);
    const isSimpleToggle = bodyKeys.length > 0 && bodyKeys.every(k => k === 'isAvailable' || k === 'isRecommended');

    if (isSimpleToggle) {
        const fastUpdate = {};
        if (body.isAvailable !== undefined) fastUpdate.isAvailable = body.isAvailable !== false;
        if (body.isRecommended !== undefined) fastUpdate.isRecommended = body.isRecommended === true;

        const updated = await FoodItem.findOneAndUpdate(
            { _id: foodId, restaurantId },
            { $set: fastUpdate },
            { new: true }
        )
            .select('+adminPrice')
            .lean();

        return toRestaurantFacingFood(updated);
    }

    // Full path for content changes
    const context = await getRestaurantContext(restaurantId);

    const existing = await FoodItem.findOne({ _id: foodId, restaurantId }).select('+adminPrice').lean();
    if (!existing) return null;


    const update = {};

    if (body.name !== undefined) {
        const name = toStr(body.name);
        if (!name) throw new ValidationError('Item name is required');
        if (name.length > 200) throw new ValidationError('Item name is too long');
        update.name = name;
    }
    if (body.description !== undefined) update.description = toStr(body.description);
    if (body.image !== undefined) {
        // The previous file is deleted only after the update below succeeds;
        // deleting it first left the item pointing at a missing image whenever a
        // later validation (diet/category) rejected the save.
        // The app sends the current image back on every save. Only a new value
        // is validated, so an older item with an unusual stored value can still
        // have its price or name edited.
        if (toStr(body.image) !== toStr(existing.image)) {
            update.image = normalizeImageForStorage(body.image);
        }
    }
    Object.assign(update, getUpdatedFoodPricing(existing, body));
    // The app is shown the admin override as the price and sends it back on
    // every save: that is not the restaurant changing its own price.
    const adminPrice = getFoodAdminPrice(existing);
    if (update.price !== undefined && adminPrice != null && Number(update.price) === adminPrice) {
        delete update.price;
    }
    if (body.isAvailable !== undefined) update.isAvailable = body.isAvailable !== false;
    if (body.isRecommended !== undefined) update.isRecommended = body.isRecommended === true;
    if (body.preparationTime !== undefined) update.preparationTime = toStr(body.preparationTime);

    const targetFoodType = body.foodType !== undefined ? normalizeFoodType(body.foodType) : normalizeFoodType(existing.foodType);
    if (context.foodType === 'Veg' && targetFoodType !== 'Veg') {
        throw new ValidationError('Veg restaurants can only have veg foods');
    }
    if (context.foodType === 'Non-Veg' && targetFoodType !== 'Non-Veg') {
        throw new ValidationError('Non-veg restaurants can only have non-veg foods');
    }
    if (body.foodType !== undefined) update.foodType = targetFoodType;

    if (
        body.categoryId !== undefined ||
        body.categoryName !== undefined ||
        body.foodType !== undefined
    ) {
        const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, {
            categoryId: body.categoryId !== undefined ? body.categoryId : existing.categoryId,
            categoryName: body.categoryName !== undefined ? body.categoryName : existing.categoryName,
            foodType: targetFoodType
        });
        update.categoryId = categoryObjectId;
        update.categoryName = categoryName || '';
    }

    // The app's item screen saves the whole item (name, price, image...) even
    // when only "In stock" was switched. Every field sent used to count as an
    // edit, so marking a dish out of stock sent it back to admin approval. Only
    // values that really differ from the stored item are content changes.
    const comparable = (key, value) => {
        if (key === 'variants') {
            return JSON.stringify(
                (Array.isArray(value) ? value : []).map((v) => ({
                    name: String(v?.name || '').trim(),
                    price: Number(v?.price) || 0,
                }))
            );
        }
        if (key === 'price') return Number(value) || 0;
        if (value === null || value === undefined) return '';
        return String(value).trim();
    };
    for (const key of Object.keys(update)) {
        if (key === 'isAvailable' || key === 'isRecommended') continue;
        if (comparable(key, update[key]) === comparable(key, existing[key])) {
            delete update[key];
        }
    }

    // Content-only fields that require admin re-approval
    const contentUpdate = { ...update };
    delete contentUpdate.isAvailable;
    delete contentUpdate.isRecommended;

    const shouldResubmitForApproval = Object.keys(contentUpdate).length > 0;

    if (shouldResubmitForApproval) {
        update.approvalStatus = 'pending';
        update.requestedAt = new Date();
        update.rejectionReason = '';
        update.approvedAt = null;
        update.rejectedAt = null;
        update.actionType = 'UPDATED';
        // Only store safe serializable fields (avoid Buffer/binary spread errors)
        const safeExisting = {
            name: existing.name,
            description: existing.description,
            image: existing.image,
            price: existing.price,
            variants: existing.variants,
            foodType: existing.foodType,
            categoryName: existing.categoryName,
            isRecommended: existing.isRecommended,
            preparationTime: existing.preparationTime,
        };
        update.oldData = safeExisting;
        update.newData = { ...safeExisting, ...contentUpdate };
    }


    // Saved with nothing changed: nothing to write.
    if (Object.keys(update).length === 0) return toRestaurantFacingFood(existing);

    const updated = await FoodItem.findOneAndUpdate(
        { _id: foodId, restaurantId },
        { $set: update },
        { new: true }
    )
        .select('+adminPrice')
        .lean();

    if (updated && update.image !== undefined && existing.image !== update.image) {
        // Only once nothing else (a duplicated dish, an add-on) still shows it.
        await deleteFoodImagesIfUnused(removedAssetUrls(existing.image, update.image));
    }

    if (updated && shouldResubmitForApproval) {
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'Updated Product Approval Request',
                body: `Restaurant has updated and resubmitted "${updated.name}" for approval.`,
                data: {
                    type: 'approval_request',
                    subType: 'food',
                    id: String(updated._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of resubmitted food approval request:', e);
        }
    }

    return toRestaurantFacingFood(updated);
}

export async function deleteRestaurantFood(restaurantId, foodId) {
    if (!foodId || !mongoose.Types.ObjectId.isValid(String(foodId))) {
        throw new ValidationError('Invalid food item id');
    }
    const food = await FoodItem.findOneAndDelete({
        _id: foodId,
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId))
    }).lean();
    if (food) await deleteFoodImagesIfUnused(food.image);
    return food;
}
