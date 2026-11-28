import {
    registerRestaurant,
    listApprovedRestaurants,
    getApprovedRestaurantByIdOrSlug,
    getCurrentRestaurantProfile,
    updateRestaurantProfile,
    updateRestaurantAcceptingOrders,
    updateCurrentRestaurantDiningSettings,
    updateCurrentRestaurantTakeawaySettings,
    uploadRestaurantProfileImage,
    uploadRestaurantMenuImage,
    uploadRestaurantCoverImages,
    uploadRestaurantMenuImages,
    listPublicOffers,
    getRestaurantComplaints,
    listRestaurantsUnderPriceLimit,
    getRestaurantVerificationStatus
} from '../services/restaurant.service.js';
import {
    createDiningRequest,
    getPendingDiningRequest,
    createDiningCategory
} from '../../dining/services/dining.service.js';
import { validateRestaurantRegisterDto } from '../validators/restaurant.validator.js';
import { sendResponse } from '../../../../utils/response.js';
import { verifyRegistrationToken } from '../../../../core/auth/onboardingToken.js';

/**
 * Phone proven by OTP login (the X-Registration-Token it issued), or null.
 * Needed only to re-apply over an existing registration; a missing or expired
 * token never blocks a new one.
 */
const readVerifiedRegistrationPhone = (req) => {
    const token = String(req.headers['x-registration-token'] || '').trim();
    if (!token) return null;
    try {
        return verifyRegistrationToken(token).phoneLast10 || null;
    } catch {
        return null;
    }
};

export const registerRestaurantController = async (req, res, next) => {
    try {
        const validated = validateRestaurantRegisterDto(req.body);
        // Images uploaded earlier through the onboarding draft arrive as URLs
        // (the DTO strips unknown keys, so they are passed separately).
        const draftImageRefs = {
            profileImageUrl: req.body?.profileImageUrl,
            panImageUrl: req.body?.panImageUrl,
            gstImageUrl: req.body?.gstImageUrl,
            fssaiImageUrl: req.body?.fssaiImageUrl,
            menuImageUrls: req.body?.menuImageUrls
        };
        const restaurant = await registerRestaurant(validated, req.files, draftImageRefs, {
            verifiedPhoneLast10: readVerifiedRegistrationPhone(req),
        });
        const message = restaurant?.onboarding?.paymentRequired
            ? 'Restaurant details saved. Complete the onboarding payment to submit for approval.'
            : 'Restaurant registered successfully';
        return sendResponse(res, 201, message, restaurant);
    } catch (error) {
        next(error);
    }
};

export const listApprovedRestaurantsController = async (req, res, next) => {
    try {
        const data = await listApprovedRestaurants(req.query);
        return sendResponse(res, 200, 'Restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getApprovedRestaurantController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const lat = req.query?.lat;
        const lng = req.query?.lng;
        const restaurant = await getApprovedRestaurantByIdOrSlug(req.params.id, userId, { lat, lng });
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const getCurrentRestaurantController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await getCurrentRestaurantProfile(restaurantId);
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantProfileController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantProfile(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Restaurant updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantAcceptingOrdersController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantAcceptingOrders(restaurantId, req.body?.isAcceptingOrders);
        return sendResponse(res, 200, 'Restaurant availability updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateCurrentRestaurantDiningSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateCurrentRestaurantDiningSettings(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Dining settings updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateCurrentRestaurantTakeawaySettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateCurrentRestaurantTakeawaySettings(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Takeaway settings updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantProfileImageController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantProfileImage(restaurantId, req.file);
        return sendResponse(res, 200, 'Profile image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImageController = async (req, res, next) => {
    try {
        const result = await uploadRestaurantMenuImage(req.file);
        return sendResponse(res, 200, 'Menu image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantCoverImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantCoverImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Restaurant photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantMenuImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Menu photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const listPublicOffersController = async (req, res, next) => {
    try {
        const data = await listPublicOffers(req.query || {});
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantComplaintsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantComplaints(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Complaints fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listRestaurantsUnder250Controller = async (req, res, next) => {
    try {
        const data = await listRestaurantsUnderPriceLimit(req.query || {});
        return sendResponse(res, 200, 'Under 250 restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createDiningRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const request = await createDiningRequest(restaurantId, req.body || {});
        return sendResponse(res, 201, 'Dining update request submitted successfully', request);
    } catch (error) {
        next(error);
    }
};

export const getPendingDiningRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const request = await getPendingDiningRequest(restaurantId);
        return sendResponse(res, 200, 'Pending request fetched successfully', request);
    } catch (error) {
        next(error);
    }
};

export const createRestaurantDiningCategoryController = async (req, res, next) => {
    try {
        const category = await createDiningCategory(req.body || {});
        return sendResponse(res, 201, 'Dining category created successfully', category);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantVerificationStatusController = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7).trim()
            : null;
        const registrationToken = req.headers['x-registration-token'] || req.query.registrationToken || null;
        const phone = req.query.phone || req.query.ownerPhone || null;

        const result = await getRestaurantVerificationStatus({ token, registrationToken, phone });
        return sendResponse(res, 200, result.message || 'Status fetched successfully', result);
    } catch (error) {
        next(error);
    }
};
