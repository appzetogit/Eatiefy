import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import {
    registerRestaurantController,
    listApprovedRestaurantsController,
    getApprovedRestaurantController,
    listPublicOffersController,
    getCurrentRestaurantController,
    updateRestaurantProfileController,
    updateRestaurantAcceptingOrdersController,
    updateCurrentRestaurantDiningSettingsController,
    updateCurrentRestaurantTakeawaySettingsController,
    uploadRestaurantProfileImageController,
    uploadRestaurantMenuImageController,
    uploadRestaurantCoverImagesController,
    uploadRestaurantMenuImagesController,
    getRestaurantComplaintsController,
    listRestaurantsUnder250Controller,
    createDiningRequestController,
    getPendingDiningRequestController,
    createRestaurantDiningCategoryController,
    getRestaurantVerificationStatusController
} from '../controllers/restaurant.controller.js';
import {
    createRestaurantSupportTicketController,
    listRestaurantSupportTicketsController
} from '../controllers/supportTicket.controller.js';
import {
    createWithdrawalRequestController,
    listMyWithdrawalsController
} from '../controllers/withdrawal.controller.js';
import {
    listCategoriesController,
    createCategoryController,
    updateCategoryController,
    setCategoryActiveController,
    deleteCategoryController
} from '../controllers/restaurantCategory.controller.js';
import { getMenuController, updateMenuController, updateCategoryOrderController, getPublicRestaurantMenuController } from '../controllers/restaurantMenu.controller.js';
import { getPublicRestaurantAddonsController } from '../controllers/publicAddons.controller.js';
import * as feedbackExperienceController from '../../admin/controllers/feedbackExperience.controller.js';
import { getCurrentRestaurantSettings } from '../../admin/controllers/systemConfig.controller.js';
import {
    getOutletTimingsByRestaurantIdController,
    getCurrentRestaurantOutletTimingsController,
    upsertCurrentRestaurantOutletTimingsController
} from '../controllers/outletTimings.controller.js';
import {
    getRestaurantFoodByIdController,
    createRestaurantFoodController,
    updateRestaurantFoodController,
    deleteRestaurantFoodController
} from '../controllers/restaurantFood.controller.js';
import {
    listAddonsController,
    createAddonController,
    updateAddonController,
    deleteAddonController
} from '../controllers/restaurantAddon.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { sendError } from '../../../../utils/response.js';
import { getRestaurantFinanceController } from '../controllers/restaurantFinance.controller.js';
import {
    getOnboardingPaymentQuoteController,
    createOnboardingPaymentOrderController,
    verifyOnboardingPaymentController,
    cancelOnboardingPaymentController
} from '../controllers/onboardingPayment.controller.js';
import { onboardingAuthMiddleware, registrationAuthMiddleware } from '../../../../core/auth/onboardingToken.js';
import {
    getOnboardingDraftUploadsController,
    addOnboardingDraftUploadController,
    removeOnboardingDraftUploadController
} from '../controllers/onboardingDraft.controller.js';

import { cacheResponse, invalidateCache, invalidateFoodBrowseCaches } from '../../../../middleware/cache.js';
import { listEatiefy99FoodsController, listPublicFoodsController } from '../controllers/publicFoods.controller.js';
import { requireDiningEnabled } from '../../dining/middleware/requireDiningEnabled.js';

const router = express.Router();

const requireRestaurant = (req, res, next) => {
    if (req.user?.role !== 'RESTAURANT') {
        return sendError(res, 403, 'Restaurant access required');
    }
    next();
};

const requireApprovedRestaurant = async (req, res, next) => {
    if (req.user?.role !== 'RESTAURANT') {
        return sendError(res, 403, 'Restaurant access required');
    }

    try {
        const doc = await FoodRestaurant.findById(req.user.userId).select('status').lean();
        if (!doc) {
            return sendError(res, 404, 'Restaurant not found');
        }

        const status = String(doc.status || '').toLowerCase();
        if (status !== 'approved') {
            return sendError(res, 403, 'Restaurant account is not approved yet');
        }

        next();
    } catch (error) {
        next(error);
    }
};

const uploadFields = upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'panImage', maxCount: 1 },
    { name: 'gstImage', maxCount: 1 },
    { name: 'fssaiImage', maxCount: 1 },
    { name: 'menuImages', maxCount: 10 }
]);

router.post('/register', uploadFields, registerRestaurantController);
router.get('/verification-status', getRestaurantVerificationStatusController);

// Onboarding draft uploads. The restaurant does not exist until /register, so these
// use the registration token issued when the phone was OTP-verified. Files are
// stored immediately, which is what lets the form survive a page refresh.
router.get('/onboarding/uploads', registrationAuthMiddleware, getOnboardingDraftUploadsController);
router.post('/onboarding/uploads', registrationAuthMiddleware, upload.single('file'), addOnboardingDraftUploadController);
router.delete('/onboarding/uploads', registrationAuthMiddleware, removeOnboardingDraftUploadController);

// One-time onboarding payment. A restaurant has no access token until it is approved,
// so these use the short-lived onboarding-scoped token issued by /register.
router.get('/onboarding/payment/quote', onboardingAuthMiddleware, getOnboardingPaymentQuoteController);
router.post('/onboarding/payment/order', onboardingAuthMiddleware, createOnboardingPaymentOrderController);
router.post('/onboarding/payment/verify', onboardingAuthMiddleware, verifyOnboardingPaymentController);
router.post('/onboarding/payment/cancel', onboardingAuthMiddleware, cancelOnboardingPaymentController);

// Public: approved restaurants list (for user app)
router.get('/restaurants', cacheResponse(300, 'restaurants'), listApprovedRestaurantsController);
router.get('/restaurants/:id', cacheResponse(600, 'restaurant_detail'), getApprovedRestaurantController);
router.get('/restaurants/:id/menu', cacheResponse(600, 'restaurant_menu'), getPublicRestaurantMenuController);
router.get('/restaurants/:id/outlet-timings', cacheResponse(600, 'restaurant_timings'), getOutletTimingsByRestaurantIdController);
router.get('/public/foods', cacheResponse(300, 'public_foods'), listPublicFoodsController);
// Eatiefy ₹99 section. Both are cached under 'under_250' — the prefix every food,
// menu, approval and pricing change already invalidates — so price edits show up.
router.get('/under-250', cacheResponse(180, 'under_250'), listRestaurantsUnder250Controller);
router.get('/public/foods/eatiefy-99', cacheResponse(180, 'under_250'), listEatiefy99FoodsController);
router.get('/offers', cacheResponse(300, 'offers'), listPublicOffersController);
// Public: categories list (zone-aware; returns zone categories + global)
router.get('/categories/public', cacheResponse(600, 'categories'), listCategoriesController);

// Restaurant dashboard/profile (Bearer token + RESTAURANT role)
router.get('/current', authMiddleware, requireRestaurant, getCurrentRestaurantController);
// Accept-order windows for this restaurant's zone (falls back to the platform default).
router.get('/accept-order-settings', authMiddleware, requireRestaurant, getCurrentRestaurantSettings);
router.patch('/profile', authMiddleware, requireRestaurant, async (req, res, next) => {
    // Invalidate caches when profile is updated
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    // Public outlet timings fall back to profile opening/closing hours.
    await invalidateCache('restaurant_timings:*');
    await invalidateCache('search:*');
    next();
}, updateRestaurantProfileController);
router.patch('/availability', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('search:*');
    // Dish rails (e.g. "Meals under 99") read from public_foods; without this a
    // restaurant that just went offline keeps showing dishes for the cache TTL.
    await invalidateCache('public_foods:*');
    await invalidateCache('under_250:*');
    next();
}, updateRestaurantAcceptingOrdersController);
// Restaurant-side dining settings. Gated on the same admin toggle as every
// other dining endpoint, so the restaurant panel cannot manage a disabled module.
router.patch('/dining-settings', authMiddleware, requireApprovedRestaurant, requireDiningEnabled, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    await invalidateCache('search:*');
    next();
}, updateCurrentRestaurantDiningSettingsController);
router.patch('/takeaway-settings', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    await invalidateCache('search:*');
    next();
}, updateCurrentRestaurantTakeawaySettingsController);
router.post('/dining-settings/request', authMiddleware, requireApprovedRestaurant, requireDiningEnabled, createDiningRequestController);
router.get('/dining-settings/pending', authMiddleware, requireApprovedRestaurant, requireDiningEnabled, getPendingDiningRequestController);
router.post('/dining-categories', authMiddleware, requireApprovedRestaurant, requireDiningEnabled, createRestaurantDiningCategoryController);
router.get('/outlet-timings', authMiddleware, requireApprovedRestaurant, getCurrentRestaurantOutletTimingsController);
router.put('/outlet-timings', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    await invalidateCache('restaurant_timings:*');
    await invalidateCache('under_250:*');
    await invalidateCache('search:*');
    next();
}, upsertCurrentRestaurantOutletTimingsController);
router.get('/finance', authMiddleware, requireApprovedRestaurant, getRestaurantFinanceController);
router.post('/withdraw', authMiddleware, requireApprovedRestaurant, createWithdrawalRequestController);
router.get('/withdrawals', authMiddleware, requireApprovedRestaurant, listMyWithdrawalsController);
router.post(
    '/profile/profile-image',
    authMiddleware,
    requireApprovedRestaurant,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        next();
    },
    uploadRestaurantProfileImageController
);
router.post(
    '/profile/menu-image',
    authMiddleware,
    requireApprovedRestaurant,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('restaurant_menu:*');
        next();
    },
    uploadRestaurantMenuImageController
);
router.post(
    '/profile/cover-images',
    authMiddleware,
    requireApprovedRestaurant,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('restaurant_detail:*');
        next();
    },
    uploadRestaurantCoverImagesController
);
router.post(
    '/profile/menu-images',
    authMiddleware,
    requireApprovedRestaurant,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('restaurant_menu:*');
        next();
    },
    uploadRestaurantMenuImagesController
);

// Categories (restaurant dashboard). Read-only for item creation, CRUD for Menu Categories page.
router.get('/categories', authMiddleware, requireApprovedRestaurant, listCategoriesController);
router.post('/categories', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateFoodBrowseCaches(['categories', 'search']);
    next();
}, createCategoryController);
// On/off must reach every customer surface that lists dishes, not just category lists.
router.patch('/categories/:id/status', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateFoodBrowseCaches(['categories', 'search', 'restaurant_menu', 'restaurant_detail', 'restaurants', 'public_foods', 'under_250']);
    next();
}, setCategoryActiveController);
router.patch('/categories/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateFoodBrowseCaches(['categories', 'search', 'restaurant_menu', 'restaurant_detail', 'restaurants', 'public_foods', 'under_250']);
    next();
}, updateCategoryController);
router.delete('/categories/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateFoodBrowseCaches(['categories', 'search']);
    next();
}, deleteCategoryController);

// Menu (restaurant dashboard) - only fields needed by UI
router.get('/menu', authMiddleware, requireApprovedRestaurant, getMenuController);
router.patch('/menu', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('under_250:*');
    next();
}, updateMenuController);
router.patch('/menu/category-order', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    next();
}, updateCategoryOrderController);

// Feedback (restaurant dashboard)
router.post('/feedback-experience', authMiddleware, requireApprovedRestaurant, feedbackExperienceController.createFeedbackExperience);

// Public: restaurant add-ons (user app)
router.get('/restaurants/:id/addons', cacheResponse(600, 'restaurant_addons'), getPublicRestaurantAddonsController);

// Foods (restaurant creates/updates items -> stored in food_items collection)
router.get('/foods/:id', authMiddleware, requireApprovedRestaurant, getRestaurantFoodByIdController);
router.post('/foods', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('categories:*');
    await invalidateCache('under_250:*');
    next();
}, createRestaurantFoodController);
router.patch('/foods/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('categories:*');
    await invalidateCache('under_250:*');
    next();
}, updateRestaurantFoodController);
router.delete('/foods/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('categories:*');
    await invalidateCache('under_250:*');
    next();
}, deleteRestaurantFoodController);

// Add-ons (restaurant dashboard) - approval handled by admin
router.get('/addons', authMiddleware, requireApprovedRestaurant, listAddonsController);
router.post('/addons', authMiddleware, requireApprovedRestaurant, createAddonController);
router.patch('/addons/:id', authMiddleware, requireApprovedRestaurant, updateAddonController);
router.delete('/addons/:id', authMiddleware, requireApprovedRestaurant, deleteAddonController);

// Orders (restaurant dashboard)
router.get('/orders', authMiddleware, requireApprovedRestaurant, orderController.listOrdersRestaurantController);
router.get('/orders/:orderId', authMiddleware, requireApprovedRestaurant, orderController.getOrderByIdRestaurantController);
router.patch('/orders/:orderId/status', authMiddleware, requireApprovedRestaurant, orderController.updateOrderStatusRestaurantController);
router.post('/orders/:orderId/resend-notification', authMiddleware, requireApprovedRestaurant, orderController.resendDeliveryNotificationRestaurantController);
router.post('/orders/:orderId/complete-takeaway', authMiddleware, requireApprovedRestaurant, orderController.completeTakeawayOrderRestaurantController);

// Complaints (restaurant dashboard)
router.get('/complaints', authMiddleware, requireApprovedRestaurant, getRestaurantComplaintsController);
router.post('/support/tickets', authMiddleware, requireApprovedRestaurant, createRestaurantSupportTicketController);
router.get('/support/tickets', authMiddleware, requireApprovedRestaurant, listRestaurantSupportTicketsController);



export default router;


