import mongoose from 'mongoose';
import { FoodItem } from '../../admin/models/food.model.js';
import { getInactiveCategoryIds } from '../../shared/inactiveCategories.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
  applyOtherPriceToFood,
  loadActivePricingRulesForRestaurants,
} from '../../admin/services/otherPrice.service.js';
import { serializeFoodVariants } from '../../admin/services/foodVariant.service.js';
import {
  buildOrderItemsFromFoodCart,
  loadAddonItemDocs,
} from '../../user/services/foodCart.service.js';

/**
 * Force each food line's charged price from live FoodItem + admin pricing rules.
 * Admin markup lives in price (selling) + basePrice + markupAmount — not otherPrice.
 */
export async function enforceMinimumFoodItemPrices(items = [], restaurantId = null) {
  const foodItems = Array.isArray(items) ? items : [];
  if (!foodItems.length) return foodItems;

  const validIds = [
    ...new Set(
      foodItems
        .map((item) => String(item.itemId || ''))
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const foodDocs = validIds.length
    ? await FoodItem.find({ _id: { $in: validIds } })
        .select(
          // adminPrice: the admin override is what gets charged when set.
          'restaurantId price adminPrice otherPrice priceOnOtherPlatforms variants approvalStatus isAvailable name image foodType categoryId',
        )
        .lean()
    : [];
  // Add-ons are priced from their own collection; shape them like menu items.
  const missingIds = validIds.filter((id) => !foodDocs.some((d) => String(d._id) === String(id)));
  if (missingIds.length) {
    foodDocs.push(...(await loadAddonItemDocs(missingIds)));
  }
  const foodDocMap = new Map(foodDocs.map((doc) => [String(doc._id), doc]));

  const restaurantIds = [
    ...new Set(
      [
        ...(restaurantId ? [String(restaurantId)] : []),
        ...foodDocs.map((d) => String(d.restaurantId || '')),
      ].filter(Boolean),
    ),
  ];
  const pricingRules = await loadActivePricingRulesForRestaurants({
    restaurantIds,
    menuItemIds: foodDocs.map((d) => d._id),
  });

  const expectedRestaurantId = restaurantId ? String(restaurantId) : null;
  const { idSet: inactiveCategoryIds } = await getInactiveCategoryIds();

  for (const item of foodItems) {
    const label = item.name || 'This item';
    const doc = foodDocMap.get(String(item.itemId || ''));
    if (!doc) {
      throw new ValidationError(`"${label}" is no longer available. Please refresh your cart.`);
    }
    if (
      doc.approvalStatus !== 'approved' ||
      doc.isAvailable === false ||
      (doc.categoryId && inactiveCategoryIds.has(String(doc.categoryId)))
    ) {
      throw new ValidationError(`"${label}" is currently unavailable. Please refresh your cart.`);
    }

    if (expectedRestaurantId && String(doc.restaurantId) !== expectedRestaurantId) {
      throw new ValidationError(`"${label}" does not belong to the selected restaurant.`);
    }

    const serializedVariants = serializeFoodVariants(doc.variants || doc.variations || []);
    const hasVariantsInDB = serializedVariants.length > 0;
    if (hasVariantsInDB && !item.variantId) {
      throw new ValidationError(`Please select an option for "${label}" before adding to cart.`);
    }

    const priced = applyOtherPriceToFood(doc, pricingRules);

    let basePrice = Number(priced.basePrice) || Number(doc.price) || 0;
    let liveSellingPrice = Number(priced.price) || basePrice;
    let liveMarkupAmount = Math.max(0, Number(priced.markupAmount) || 0);
    let appliedPricingType = priced.appliedPricingType || null;
    let appliedPricingValue = priced.appliedPricingValue ?? null;
    let pricingScope = priced.pricingScope || null;
    let pricingRule = priced.pricingRule || null;

    if (item.variantId && hasVariantsInDB) {
      const vid = String(item.variantId).trim();
      const variant =
        (priced.variants || []).find(
          (v, index) =>
            String(v.id || '') === vid ||
            String(v._id || '') === vid ||
            `variant-${index}` === vid ||
            String(index) === vid ||
            String(v.name || '').trim().toLowerCase() === vid.trim().toLowerCase(),
        ) ||
        serializedVariants.find(
          (v, index) =>
            String(v.id || '') === vid ||
            String(v._id || '') === vid ||
            `variant-${index}` === vid ||
            String(index) === vid ||
            String(v.name || '').trim().toLowerCase() === vid.trim().toLowerCase(),
        );
      if (!variant) {
        throw new ValidationError(
          `Selected option for "${label}" is no longer available. Please refresh your cart.`,
        );
      }
      const variantBase = Number(variant.basePrice ?? variant.price);
      if (Number.isFinite(variantBase) && variantBase >= 0) {
        basePrice = variantBase;
        liveSellingPrice = Number(variant.price) || variantBase;
        liveMarkupAmount = Math.max(0, Number(variant.markupAmount) || 0);
      } else {
        // Raw DB variant (no rule applied onto this object) — base only.
        basePrice = Number(variant.price) || 0;
        liveSellingPrice = basePrice;
        liveMarkupAmount = 0;
      }
      appliedPricingType = variant.appliedPricingType || appliedPricingType;
      appliedPricingValue = variant.appliedPricingValue ?? appliedPricingValue;
      pricingScope = variant.pricingScope || pricingScope;
      if (!(liveMarkupAmount > 0) && liveSellingPrice > basePrice + 0.01) {
        liveMarkupAmount = Math.round((liveSellingPrice - basePrice) * 100) / 100;
      }
    }

    // Prefer cart pricing snapshot when base matches.
    const snapshotBase = Number(item.basePrice);
    const snapshotMarkup = Math.max(0, Number(item.markupAmount) || 0);
    const snapshotSelling = Number(item.price) || 0;
    // Transition: older carts/orders may still have selling in otherPrice.
    const snapshotOther = Number(item.otherPrice) || 0;
    const hasCartAdminMarkup =
      Number.isFinite(snapshotBase) &&
      snapshotBase >= 0 &&
      (item.pricingScope || item.appliedPricingType) &&
      (snapshotMarkup > 0 ||
        snapshotSelling > snapshotBase + 0.01 ||
        snapshotOther > snapshotBase + 0.01);
    const baseMatchesSnapshot =
      Number.isFinite(snapshotBase) && Math.abs(snapshotBase - basePrice) < 0.01;
    const useCartSnapshot = hasCartAdminMarkup && baseMatchesSnapshot;

    if (useCartSnapshot) {
      basePrice = snapshotBase;
      appliedPricingType = item.appliedPricingType || appliedPricingType;
      appliedPricingValue = item.appliedPricingValue ?? appliedPricingValue;
      pricingScope = item.pricingScope || pricingScope;
      pricingRule = item.pricingRule || pricingRule;
    } else {
      item.appliedPricingType = appliedPricingType;
      item.appliedPricingValue = appliedPricingValue;
      item.pricingScope = pricingScope;
      item.pricingRule = pricingRule;
    }

    item.name = doc.name || item.name;

    let sellingPrice = liveSellingPrice;
    let markupAmount = liveMarkupAmount;
    if (useCartSnapshot) {
      if (snapshotMarkup > 0) {
        markupAmount = snapshotMarkup;
        sellingPrice = Math.round((basePrice + markupAmount) * 100) / 100;
      } else if (snapshotSelling > basePrice + 0.01) {
        sellingPrice = snapshotSelling;
        markupAmount = Math.round((sellingPrice - basePrice) * 100) / 100;
      } else if (snapshotOther > basePrice + 0.01) {
        sellingPrice = snapshotOther;
        markupAmount = Math.round((sellingPrice - basePrice) * 100) / 100;
      } else {
        sellingPrice = basePrice;
        markupAmount = 0;
      }
    }

    const ruleType = String(item.appliedPricingType || appliedPricingType || '').toUpperCase();
    const isAdminMarkup =
      (ruleType === 'PERCENTAGE' || ruleType === 'FIXED') && markupAmount > 0;
    if (!isAdminMarkup) {
      sellingPrice = basePrice;
      markupAmount = 0;
      item.pricingScope = null;
    }

    item.price = sellingPrice;
    item.basePrice = basePrice;
    item.variantPrice = sellingPrice;
    item.otherPrice = 0;
    item.markupAmount = markupAmount;
    if (!item.image && doc.image) item.image = doc.image;
    const docFoodType = String(doc.foodType || '').toLowerCase().trim();
    const isDocVeg = ['veg', 'vegan', 'vegetarian'].includes(docFoodType) || doc.isVeg === true;
    if (item.isVeg == null) {
      item.isVeg = isDocVeg;
      item.isVegan = false;
    }
    if (!item.foodType) {
      item.foodType = doc.foodType === 'Vegan' ? 'Veg' : (doc.foodType || (isDocVeg ? 'Veg' : 'Non-Veg'));
    }
  }

  return foodItems;
}

/**
 * Food checkout prefers DB cart as source of truth when useCart !== false.
 */
export async function resolveCheckoutItems(userId, dto = {}) {
  const useCart = dto.useCart !== false;
  const clientItems = Array.isArray(dto.items) ? dto.items : [];

  if (useCart) {
    const fromCart = await buildOrderItemsFromFoodCart(userId);
    return {
      items: fromCart.items,
      restaurantId: fromCart.restaurantId || dto.restaurantId || null,
      restaurantName: fromCart.restaurantName || dto.restaurantName || '',
      couponCode: String(dto.couponCode || fromCart.couponCode || '').trim(),
    };
  }

  if (!clientItems.length) {
    throw new ValidationError('Your cart is empty');
  }

  return {
    items: clientItems.map((item) => ({
      ...item,
      itemId: String(item.itemId || item.id || ''),
      quantity: Math.max(1, Number(item.quantity) || 1),
    })),
    restaurantId: dto.restaurantId || null,
    restaurantName: dto.restaurantName || '',
    couponCode: String(dto.couponCode || '').trim(),
  };
}
