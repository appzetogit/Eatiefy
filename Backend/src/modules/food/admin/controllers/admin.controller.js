import mongoose from 'mongoose';
import * as adminService from '../services/admin.service.js';
import * as deliveryIncentiveService from '../services/deliveryIncentive.service.js';
import { logger } from '../../../../utils/logger.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { invalidateCache, invalidateFoodBrowseCaches } from '../../../../middleware/cache.js';
import { FoodRefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';
import { validateCategoryListQuery, validateCategoryRejectDto, validateCategoryUpsertDto } from '../validators/category.validator.js';
import { validateCreateOfferDto, validateUpdateOfferCartVisibilityDto } from '../validators/offer.validator.js';
import { validateAddDeliveryBonusDto } from '../validators/deliveryBonus.validator.js';
import { validateCheckCompletionsDto, validateEarningAddonHistoryActionDto, validateEarningAddonUpsertDto, validateToggleEarningAddonStatusDto } from '../validators/earningAddon.validator.js';
import { validateDeliveryCommissionRuleDto, validateOptionalStatusDto, validateRestaurantCommissionUpsertDto } from '../validators/commission.validator.js';
import { validateFeeSettingsUpsertDto } from '../validators/feeSettings.validator.js';
import {
    getAdminDeliveryCashLimitSettings,
    getAdminDeliveryEmergencyHelp,
} from '../services/zoneDeliverySettings.service.js';
import { validateReferralSettingsUpsertDto } from '../validators/referralSettings.validator.js';

// ----- Customers / Users -----
export async function getCustomers(req, res, next) {
    try {
        const data = await adminService.getCustomers(req.query || {});
        res.status(200).json({ success: true, message: 'Customers fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getCustomerById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const customer = await adminService.getCustomerById(id);
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer fetched successfully', data: { user: customer, customer } });
    } catch (error) {
        next(error);
    }
}

export async function updateCustomerStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const isActive = req.body?.isActive;
        const updated = await adminService.updateCustomerStatus(id, isActive);
        if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer status updated successfully', data: { user: updated, customer: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateCustomerCodStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const isCodBlocked = req.body?.isCodBlocked;
        const updated = await adminService.updateCustomerCodStatus(id, isCodBlocked);
        if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer COD status updated successfully', data: { user: updated, customer: updated } });
    } catch (error) {
        next(error);
    }
}

export async function adjustCustomerWallet(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const { type, amount, reason } = req.body || {};
        const result = await adminService.adjustCustomerWallet(id, { type, amount, reason }, req.user);
        res.status(200).json({
            success: true,
            message: `Wallet ${type === 'credit' ? 'credited' : 'debited'} successfully`,
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteCustomer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const result = await adminService.deleteCustomer(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Customer deleted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}


// ----- Safety / Emergency Reports -----
export async function getSafetyEmergencyReports(req, res, next) {
    try {
        const data = await adminService.getSafetyEmergencyReports(req.query || {});
        res.status(200).json({ success: true, message: 'Safety emergency reports fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateSafetyEmergencyStatus(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await adminService.updateSafetyEmergencyStatus(id, req.body?.status);
        if (!updated) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { report: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateSafetyEmergencyPriority(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await adminService.updateSafetyEmergencyPriority(id, req.body?.priority);
        if (!updated) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Priority updated successfully', data: { report: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteSafetyEmergencyReport(req, res, next) {
    try {
        const { id } = req.params;
        const deleted = await adminService.deleteSafetyEmergencyReport(id);
        if (!deleted) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Safety emergency report deleted successfully', data: { report: deleted } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantComplaint(req, res, next) {
    try {
        const { id } = req.params;
        const { status, adminResponse } = req.body;
        const updated = await adminService.updateRestaurantComplaint(id, { status, adminResponse });
        res.status(200).json({ success: true, message: 'Complaint updated successfully', data: { complaint: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Restaurants -----
export async function getRestaurantComplaints(req, res, next) {
    try {
        const data = await adminService.getRestaurantComplaints(req.query || {});
        res.status(200).json({ success: true, message: 'Restaurant complaints fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function globalSearch(req, res, next) {
    try {
        const { query } = req.query;
        const data = await adminService.globalSearch(query);
        res.status(200).json({
            success: true,
            message: 'Global search results fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurants(req, res, next) {
    try {
        const data = await adminService.getRestaurants(req.query);
        res.status(200).json({
            success: true,
            message: 'Restaurants fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantCounts(req, res, next) {
    try {
        const data = await adminService.getRestaurantCounts(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Restaurant counts fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}


export async function getRestaurantReport(req, res, next) {
    try {
        const data = await adminService.getRestaurantReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Restaurant report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDashboardStats(req, res, next) {
    try {
        const data = await adminService.getDashboardStats(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Dashboard stats fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getArchivedAccounts(req, res, next) {
    try {
        const data = await adminService.getArchivedAccounts();
        res.status(200).json({
            success: true,
            message: 'Archived accounts fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTransactionReport(req, res, next) {
    try {
        const data = await adminService.getTransactionReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Transaction report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTaxReport(req, res, next) {
    try {
        const data = await adminService.getTaxReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Tax report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTaxReportDetail(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.getTaxReportDetail(id, req.query || {});
        res.status(200).json({
            success: true,
            message: 'Tax report detail fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantReviews(req, res, next) {
    try {
        const data = await adminService.getRestaurantReviews(req.query);
        res.status(200).json({
            success: true,
            message: 'Restaurant reviews fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const restaurant = await adminService.getRestaurantById(id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Restaurant fetched successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantAnalytics(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const data = await adminService.getRestaurantAnalytics(id);
        if (!data) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Restaurant analytics fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantMenuById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const menu = await adminService.getRestaurantMenuById(id);
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({ success: true, message: 'Menu fetched successfully', data: { menu } });
    } catch (error) {
        next(error);
    }
}



export async function updateRestaurantMenuById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const menu = await adminService.updateRestaurantMenuById(id, req.body || {});
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        await invalidateCache('restaurant_menu:*');
        await invalidateCache('search:*');
        await invalidateCache('categories:*');
        await invalidateCache('under_250:*');
        res.status(200).json({ success: true, message: 'Menu updated successfully', data: { menu } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const updated = await adminService.updateRestaurantById(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        await invalidateCache('under_250:*');
        await invalidateCache('offers:*');
        await invalidateCache('search:*');
        res.status(200).json({ success: true, message: 'Restaurant updated successfully', data: { restaurant: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantStatus(req, res, next) {
    try {
        const { id } = req.params;
        logger.info(`[ADMIN-STATUS] HTTP PATCH /restaurants/${id}/status body=${JSON.stringify(req.body || {})} admin=${req.user?.userId || 'unknown'}`);
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const updated = await adminService.updateRestaurantStatus(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        
        // If restaurant is being disabled/banned/rejected, delete their active refresh tokens to force logout.
        const statusVal = req.body.status;
        const isActiveVal = req.body.isActive;
        if (statusVal === false || isActiveVal === false || statusVal === 'rejected' || statusVal === 'deleted') {
            await FoodRefreshToken.deleteMany({ userId: id });
        }

        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        await invalidateCache('under_250:*');
        await invalidateCache('offers:*');
        await invalidateCache('search:*');
        res.status(200).json({ success: true, message: 'Restaurant status updated successfully', data: { restaurant: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantLocation(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const updated = await adminService.updateRestaurantLocation(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        await invalidateCache('under_250:*');
        await invalidateCache('search:*');
        res.status(200).json({ success: true, message: 'Restaurant location updated successfully', data: { restaurant: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Foods -----
export async function getFoods(req, res, next) {
    try {
        const data = await adminService.getFoods(req.query || {});
        res.status(200).json({ success: true, message: 'Foods fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

// Menus, search and dish rails are response-cached; an admin edit (incl. a
// price override) must show up right away, as it does after an approval.
const FOOD_BROWSE_CACHES = [
    'restaurant_menu',
    'restaurant_detail',
    'search',
    'categories',
    'under_250',
    'restaurants',
    'public_foods',
];

export async function createFood(req, res, next) {
    try {
        const created = await adminService.createFood(req.body || {});
        await invalidateFoodBrowseCaches(FOOD_BROWSE_CACHES);
        res.status(201).json({ success: true, message: 'Food created successfully', data: { food: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateFood(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid food id' });
        }
        const updated = await adminService.updateFood(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Food not found' });
        }
        await invalidateFoodBrowseCaches(FOOD_BROWSE_CACHES);
        res.status(200).json({ success: true, message: 'Food updated successfully', data: { food: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteFood(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid food id' });
        }
        const result = await adminService.deleteFood(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Food not found' });
        }
        res.status(200).json({ success: true, message: 'Food deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

// ----- Categories -----
export async function getCategories(req, res, next) {
    try {
        const query = validateCategoryListQuery(req.query || {});
        const data = await adminService.getCategories(query);
        res.status(200).json({ success: true, message: 'Categories fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createCategory(req, res, next) {
    try {
        const body = validateCategoryUpsertDto(req.body || {});
        const created = await adminService.createCategory(body);
        await invalidateFoodBrowseCaches(['categories', 'search']);
        res.status(201).json({ success: true, message: 'Category created successfully', data: { category: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const body = validateCategoryUpsertDto(req.body || {});
        const updated = await adminService.updateCategory(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        await invalidateFoodBrowseCaches(['categories', 'search']);
        res.status(200).json({ success: true, message: 'Category updated successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const result = await adminService.deleteCategory(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        await invalidateFoodBrowseCaches(['categories', 'search']);
        res.status(200).json({ success: true, message: 'Category deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleCategoryStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.toggleCategoryStatus(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        await invalidateFoodBrowseCaches(['categories', 'search']);
        res.status(200).json({ success: true, message: 'Category status updated successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function approveCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.approveCategory(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found or already approved' });
        }
        await invalidateFoodBrowseCaches(['categories', 'search']);
        res.status(200).json({ success: true, message: 'Category approved successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function rejectCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const body = validateCategoryRejectDto(req.body || {});
        const updated = await adminService.rejectCategory(id, body.reason);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        await invalidateFoodBrowseCaches(['categories', 'search']);
        res.status(200).json({ success: true, message: 'Category rejected successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function makeCategoryGlobal(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.makeCategoryGlobal(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        await invalidateFoodBrowseCaches(['categories', 'search']);
        res.status(200).json({ success: true, message: 'Category is now global', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Offers & Coupons -----
export async function getAllOffers(req, res, next) {
    try {
        const data = await adminService.getAllOffers(req.query || {});
        res.status(200).json({ success: true, message: 'Offers fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createAdminOffer(req, res, next) {
    try {
        const body = validateCreateOfferDto(req.body || {});
        const created = await adminService.createAdminOffer(body);
        res.status(201).json({ success: true, message: 'Offer created successfully', data: { offer: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateAdminOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid offer id' });
        }
        const body = validateCreateOfferDto(req.body || {});
        const updated = await adminService.updateAdminOffer(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }
        res.status(200).json({ success: true, message: 'Offer updated successfully', data: { offer: updated } });
    } catch (error) {
        next(error);
    }
}


export async function updateAdminOfferCartVisibility(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid offer id' });
        }
        const body = validateUpdateOfferCartVisibilityDto(req.body || {});
        const updated = await adminService.updateAdminOfferCartVisibility(id, body.itemId, body.showInCart);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }
        res.status(200).json({ success: true, message: 'Offer updated successfully', data: { offer: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteAdminOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid offer id' });
        }
        const result = await adminService.deleteAdminOffer(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }
        res.status(200).json({ success: true, message: 'Offer deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

// ----- Restaurant Item Offers Approvals (Admin) -----
export async function getRestaurantOffersForAdmin(req, res, next) {
    try {
        const { listRestaurantOffersForAdmin } = await import('../../restaurant/services/restaurantOffer.service.js');
        const data = await listRestaurantOffersForAdmin(req.query || {});
        res.status(200).json({ success: true, message: 'Restaurant offers fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function approveRestaurantOffer(req, res, next) {
    try {
        const { id } = req.params;
        const { approveRestaurantOfferByAdmin } = await import('../../restaurant/services/restaurantOffer.service.js');
        const offer = await approveRestaurantOfferByAdmin(id, req.user?.userId);
        res.status(200).json({ success: true, message: 'Restaurant offer approved successfully', data: { offer } });
    } catch (error) {
        next(error);
    }
}

export async function rejectRestaurantOffer(req, res, next) {
    try {
        const { id } = req.params;
        const { rejectRestaurantOfferByAdmin } = await import('../../restaurant/services/restaurantOffer.service.js');
        const offer = await rejectRestaurantOfferByAdmin(id, req.body?.reason, req.user?.userId);
        res.status(200).json({ success: true, message: 'Restaurant offer rejected successfully', data: { offer } });
    } catch (error) {
        next(error);
    }
}

export async function deleteRestaurantOfferByAdminController(req, res, next) {
    try {
        const { id } = req.params;
        const { deleteRestaurantOfferByAdmin } = await import('../../restaurant/services/restaurantOffer.service.js');
        const result = await deleteRestaurantOfferByAdmin(id);
        res.status(200).json({ success: true, message: 'Restaurant offer deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function getSupportTicketsController(req, res, next) {
    try {
        const data = await adminService.getSupportTickets(req.query || {});
        res.status(200).json({ success: true, message: 'Support tickets fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateSupportTicketController(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket id' });
        }
        const updated = await adminService.updateSupportTicket(id, req.body || {});
        if (!updated) return res.status(404).json({ success: false, message: 'Ticket not found' });
        res.status(200).json({ success: true, message: 'Support ticket updated successfully', data: { ticket: updated } });
    } catch (error) {
        next(error);
    }
}

export async function getPendingRestaurants(req, res, next) {
    try {
        const data = await adminService.getPendingRestaurants(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Pending restaurants fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery partner bonus (admin) -----
export async function getDeliveryPartnerBonusTransactions(req, res, next) {
    try {
        const data = await adminService.getDeliveryPartnerBonusTransactions(req.query || {});
        res.status(200).json({ success: true, message: 'Bonus transactions fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function addDeliveryPartnerBonus(req, res, next) {
    try {
        const body = validateAddDeliveryBonusDto(req.body || {});
        const created = await adminService.addDeliveryPartnerBonus(body, req.user);
        res.status(201).json({ success: true, message: 'Bonus added successfully', data: { transaction: created } });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryEarnings(req, res, next) {
    try {
        const data = await adminService.getDeliveryEarnings(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery earnings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantEarnings(req, res, next) {
    try {
        const data = await adminService.getRestaurantEarnings(req.query || {});
        res.status(200).json({ success: true, message: 'Restaurant earnings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getAdminEarnings(req, res, next) {
    try {
        const data = await adminService.getAdminEarnings(req.query || {});
        res.status(200).json({ success: true, message: 'Admin earnings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Earning Addon (admin) -----
export async function getEarningAddons(req, res, next) {
    try {
        const data = await adminService.getEarningAddons(req.query || {});
        res.status(200).json({ success: true, message: 'Earning addons fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createEarningAddon(req, res, next) {
    try {
        const body = validateEarningAddonUpsertDto(req.body || {});
        const created = await adminService.createEarningAddon(body);
        res.status(201).json({ success: true, message: 'Earning addon created successfully', data: { earningAddon: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateEarningAddon(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const body = validateEarningAddonUpsertDto(req.body || {});
        const updated = await adminService.updateEarningAddon(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Earning addon updated successfully', data: { earningAddon: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteEarningAddon(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const result = await adminService.deleteEarningAddon(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Earning addon deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleEarningAddonStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const { status } = validateToggleEarningAddonStatusDto(req.body || {});
        const updated = await adminService.toggleEarningAddonStatus(id, status);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { earningAddon: updated } });
    } catch (error) {
        next(error);
    }
}

export async function getEarningAddonHistory(req, res, next) {
    try {
        const data = await adminService.getEarningAddonHistory(req.query || {});
        res.status(200).json({ success: true, message: 'Earning addon history fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function creditEarningToWallet(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid history id' });
        }
        const { notes } = validateEarningAddonHistoryActionDto(req.body || {});
        const updated = await adminService.creditEarningAddonHistory(id, notes);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'History record not found' });
        }
        res.status(200).json({ success: true, message: 'Earning credited successfully', data: { history: updated } });
    } catch (error) {
        next(error);
    }
}

export async function cancelEarningAddonHistory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid history id' });
        }
        const { reason } = validateEarningAddonHistoryActionDto(req.body || {});
        const updated = await adminService.cancelEarningAddonHistory(id, reason);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'History record not found' });
        }
        res.status(200).json({ success: true, message: 'Earning cancelled successfully', data: { history: updated } });
    } catch (error) {
        next(error);
    }
}

export async function checkEarningAddonCompletions(req, res, next) {
    try {
        const { deliveryPartnerId, force } = validateCheckCompletionsDto(req.body || {});
        const data = await adminService.checkEarningAddonCompletions(deliveryPartnerId, force);
        res.status(200).json({ success: true, message: 'Completion check done', data });
    } catch (error) {
        next(error);
    }
}

// ----- Restaurant Commission (admin) -----
export async function getRestaurantCommissions(req, res, next) {
    try {
        const data = await adminService.getRestaurantCommissions(req.query || {});
        res.status(200).json({ success: true, message: 'Restaurant commissions fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantCommissionBootstrap(req, res, next) {
    try {
        const data = await adminService.getRestaurantCommissionBootstrap(req.query || {});
        res.status(200).json({ success: true, message: 'Restaurant commission bootstrap fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantCommissionById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const commission = await adminService.getRestaurantCommissionById(id);
        if (!commission) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission fetched successfully', data: { commission } });
    } catch (error) {
        next(error);
    }
}

export async function createRestaurantCommission(req, res, next) {
    try {
        const body = validateRestaurantCommissionUpsertDto(req.body || {});
        const created = await adminService.createRestaurantCommission(body);
        res.status(201).json({ success: true, message: 'Commission created successfully', data: { commission: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantCommission(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const body = validateRestaurantCommissionUpsertDto(req.body || {});
        const updated = await adminService.updateRestaurantCommission(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteRestaurantCommission(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const result = await adminService.deleteRestaurantCommission(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleRestaurantCommissionStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const updated = await adminService.toggleRestaurantCommissionStatus(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery commission rules (admin) -----
export async function getDeliveryCommissionRules(req, res, next) {
    try {
        const zoneId = req.query?.zoneId || req.body?.zoneId;
        const data = await adminService.getDeliveryCommissionRules(zoneId);
        res.status(200).json({ success: true, message: 'Commission rules fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createDeliveryCommissionRule(req, res, next) {
    try {
        const body = validateDeliveryCommissionRuleDto(req.body || {}, { requireZoneId: true });
        const created = await adminService.createDeliveryCommissionRule(body);
        res.status(201).json({ success: true, message: 'Commission rule created successfully', data: { commission: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryCommissionRule(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const body = validateDeliveryCommissionRuleDto(req.body || {});
        const updated = await adminService.updateDeliveryCommissionRule(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Commission rule updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteDeliveryCommissionRule(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const result = await adminService.deleteDeliveryCommissionRule(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Commission rule deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleDeliveryCommissionRuleStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const { status } = validateOptionalStatusDto(req.body || {});
        if (typeof status !== 'boolean') {
            return res.status(400).json({ success: false, message: 'status is required' });
        }
        const updated = await adminService.toggleDeliveryCommissionRuleStatus(id, status);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Fee Settings (admin) -----
export async function getFeeSettings(req, res, next) {
    try {
        const zoneId = req.query?.zoneId || req.body?.zoneId;
        const data = await adminService.getFeeSettings(zoneId);
        res.status(200).json({ success: true, message: 'Fee settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateFeeSettings(req, res, next) {
    try {
        const body = validateFeeSettingsUpsertDto(req.body || {});
        const feeSettings = await adminService.upsertFeeSettings(body);
        res.status(200).json({ success: true, message: 'Fee settings saved successfully', data: { feeSettings } });
    } catch (error) {
        next(error);
    }
}

// ----- Referral Settings (admin) -----
export async function getReferralSettings(req, res, next) {
    try {
        const data = await adminService.getReferralSettings();
        res.status(200).json({ success: true, message: 'Referral settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateReferralSettings(req, res, next) {
    try {
        const body = validateReferralSettingsUpsertDto(req.body || {});
        const referralSettings = await adminService.upsertReferralSettings(body);
        res.status(200).json({ success: true, message: 'Referral settings saved successfully', data: { referralSettings } });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery Cash Limit (admin) -----
export async function getDeliveryCashLimit(req, res, next) {
    try {
        // One zone's values (with what it overrides) or, without ?zoneId=, the default.
        const data = await getAdminDeliveryCashLimitSettings(req.query?.zoneId);
        res.status(200).json({ success: true, message: 'Delivery cash limit fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryCashLimit(req, res, next) {
    try {
        const data = await adminService.upsertDeliveryCashLimitSettings(req.body || {}, req.user);
        res.status(200).json({ success: true, message: 'Delivery cash limit updated successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Eatiefy Delivery Partner Incentive (admin, zone-wise) -----
export async function getDeliveryIncentiveSettings(req, res, next) {
    try {
        const data = await deliveryIncentiveService.getDeliveryIncentiveSettings(req.query?.zoneId);
        res.status(200).json({ success: true, message: 'Delivery incentive settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryIncentiveSettings(req, res, next) {
    try {
        const data = await deliveryIncentiveService.upsertDeliveryIncentiveSettings(req.body || {});
        res.status(200).json({ success: true, message: 'Delivery incentive settings updated successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Top Restaurants (admin) -----
export async function getTopRestaurants(req, res, next) {
    try {
        const data = await adminService.getTopRestaurantsForAdmin(req.query || {});
        res.status(200).json({ success: true, message: 'Top restaurants fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function saveTopRestaurants(req, res, next) {
    try {
        const adminId = req.user?.userId || null;
        const data = await adminService.saveTopRestaurantsForAdmin(req.body || {}, adminId);
        res.status(200).json({ success: true, message: 'Top restaurants updated successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery Emergency Help (admin) -----
export async function getEmergencyHelp(req, res, next) {
    try {
        const data = await getAdminDeliveryEmergencyHelp(req.query?.zoneId);
        res.status(200).json({ success: true, message: 'Emergency help fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateEmergencyHelp(req, res, next) {
    try {
        // Validated in the service: the default as before, a zone's numbers with blank = use default.
        const data = await adminService.upsertDeliveryEmergencyHelp(req.body || {}, req.user);
        res.status(200).json({ success: true, message: 'Emergency help saved successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function approveRestaurant(req, res, next) {
    try {
        const { id } = req.params;
        logger.info(`[ADMIN-APPROVE] HTTP PATCH /restaurants/${id}/approve admin=${req.user?.userId || 'unknown'}`);
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid restaurant id'
            });
        }
        const restaurant = await adminService.approveRestaurant(id);
        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: 'Restaurant not found'
            });
        }
        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        await invalidateCache('under_250:*');
        await invalidateCache('offers:*');
        await invalidateCache('search:*');
        res.status(200).json({
            success: true,
            message: 'Restaurant approved successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

export async function checkRestaurantDuplicate(req, res, next) {
    try {
        const { email, phone, primaryContact, excludeRestaurantId } = req.query;
        const result = await adminService.checkRestaurantDuplicate({
            email,
            phone,
            primaryContact,
            excludeRestaurantId
        });
        res.json({
            success: true,
            available: result.available,
            errors: result.errors
        });
    } catch (error) {
        next(error);
    }
}

export async function createRestaurant(req, res, next) {
    try {
        const restaurant = await adminService.createRestaurantByAdmin(req.body || {});
        await invalidateCache('restaurants:*');
        await invalidateCache('search:*');
        res.status(201).json({
            success: true,
            message: 'Restaurant created successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

export async function rejectRestaurant(req, res, next) {
    try {
        const { id } = req.params;
        logger.info(`[ADMIN-REJECT] HTTP PATCH /restaurants/${id}/reject admin=${req.user?.userId || 'unknown'}`);
        const { reason } = req.body || {};
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid restaurant id'
            });
        }
        const restaurant = await adminService.rejectRestaurant(id, reason);
        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: 'Restaurant not found'
            });
        }
        
        // Banned/rejected restaurant - force logout
        await FoodRefreshToken.deleteMany({ userId: id });

        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        await invalidateCache('under_250:*');
        await invalidateCache('offers:*');
        await invalidateCache('search:*');
        res.status(200).json({
            success: true,
            message: 'Restaurant rejected successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteRestaurant(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid restaurant id'
            });
        }
        const result = await adminService.deleteRestaurant(id);
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Restaurant not found'
            });
        }

        // Deleted restaurant - force logout
        await FoodRefreshToken.deleteMany({ userId: id });

        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        await invalidateCache('under_250:*');
        await invalidateCache('offers:*');
        await invalidateCache('restaurant_menu:*');
        await invalidateCache('search:*');
        await invalidateCache('categories:*');
        res.status(200).json({
            success: true,
            message: 'Restaurant and all associated data deleted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery join requests -----
export async function getDeliveryJoinRequests(req, res, next) {
    try {
        const data = await adminService.getDeliveryJoinRequests(req.query);
        res.status(200).json({
            success: true,
            message: 'Delivery join requests fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}


// ----- Support tickets -----
export async function getSupportTicketStats(req, res, next) {
    try {
        const data = await adminService.getSupportTicketStats(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Support ticket stats fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getSupportTickets(req, res, next) {
    try {
        const data = await adminService.getDeliverySupportTickets(req.query);
        res.status(200).json({
            success: true,
            message: 'Support tickets fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function updateSupportTicket(req, res, next) {
    try {
        const ticket = await adminService.updateDeliverySupportTicket(req.params.id, req.body);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Support ticket not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Support ticket updated successfully',
            data: ticket
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery partners -----
export async function getDeliveryPartners(req, res, next) {
    try {
        const data = await adminService.getDeliveryPartners(req.query);
        res.status(200).json({
            success: true,
            message: 'Delivery partners fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDeliverymanReviews(req, res, next) {
    try {
        const data = await adminService.getDeliverymanReviews(req.query);
        res.status(200).json({
            success: true,
            message: 'Deliveryman reviews fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getContactMessages(req, res, next) {
    try {
        const data = await adminService.getContactMessages(req.query);
        res.status(200).json({
            success: true,
            message: 'Contact messages fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryPartnerById(req, res, next) {
    try {
        const delivery = await adminService.getDeliveryPartnerById(req.params.id);
        if (!delivery) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner fetched successfully',
            data: { delivery }
        });
    } catch (error) {
        next(error);
    }
}

/** DELETE /food/admin/delivery-partners/:id[?writeOffCashInHand=<amount>] — permanent delete. */
export async function deleteDeliveryPartner(req, res, next) {
    try {
        logger.info(`[ADMIN-DELETE-DELIVERY] HTTP DELETE /delivery-partners/${req.params.id} admin=${req.user?.userId || 'unknown'}`);
        const result = await adminService.deleteDeliveryPartner(req.params.id, {
            writeOffCashInHand: req.query?.writeOffCashInHand,
            adminId: req.user?.userId
        });
        res.status(200).json({
            success: true,
            message: `${result.name || 'Delivery partner'} deleted permanently`,
            data: result
        });
    } catch (error) {
        // The admin has to confirm the exact amount, so it travels with the refusal.
        if (error?.code === 'CASH_IN_HAND_WRITE_OFF_REQUIRED') {
            return res.status(409).json({
                success: false,
                message: error.message,
                error: error.message,
                code: error.code,
                data: { cashInHand: error.cashInHand }
            });
        }
        next(error);
    }
}

export async function approveDeliveryPartner(req, res, next) {
    try {
        logger.info(`[ADMIN-APPROVE] HTTP PATCH /delivery/${req.params.id}/approve admin=${req.user?.userId || 'unknown'}`);
        const partner = await adminService.approveDeliveryPartner(req.params.id, req.body || {});
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner approved successfully',
            data: partner
        });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryPartner(req, res, next) {
    try {
        const partner = await adminService.updateDeliveryPartner(req.params.id, req.body || {});
        res.status(200).json({
            success: true,
            message: 'Delivery partner updated successfully',
            data: { delivery: partner, partner }
        });
    } catch (error) {
        next(error);
    }
}

export async function rejectDeliveryPartner(req, res, next) {
    try {
        logger.info(`[ADMIN-REJECT] HTTP PATCH /delivery/${req.params.id}/reject admin=${req.user?.userId || 'unknown'}`);
        const reason = req.body?.reason != null ? String(req.body.reason).trim() : '';
        const partner = await adminService.rejectDeliveryPartner(req.params.id, reason);
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner rejected successfully',
            data: partner
        });
    } catch (error) {
        next(error);
    }
}

// ----- Zones -----
export async function getZones(req, res, next) {
    try {
        const data = await adminService.getZones(req.query);
        res.status(200).json({
            success: true,
            message: 'Zones fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getZoneById(req, res, next) {
    try {
        const zone = await adminService.getZoneById(req.params.id);
        if (!zone) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone fetched successfully',
            data: { zone }
        });
    } catch (error) {
        next(error);
    }
}

export async function createZone(req, res, next) {
    try {
        const result = await adminService.createZone(req.body || {});
        if (result.error) {
            return res.status(400).json({
                success: false,
                message: result.error
            });
        }
        res.status(201).json({
            success: true,
            message: 'Zone created successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function updateZone(req, res, next) {
    try {
        const result = await adminService.updateZone(req.params.id, req.body || {});
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone updated successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteZone(req, res, next) {
    try {
        const result = await adminService.deleteZone(req.params.id);
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone deleted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function processRefund(req, res, next) {
    try {
        const { orderId } = req.params;
        const { refundAmount, destination } = req.body || {};
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Order id is required' });
        }
        
        const updated = await adminService.processRefund(orderId, refundAmount, { destination });
        
        const FoodOrder = mongoose.model('FoodOrder');
        let order = null;
        if (mongoose.Types.ObjectId.isValid(orderId)) {
            order = await FoodOrder.findById(orderId).lean();
        }
        if (!order) {
            order = await FoodOrder.findOne({ $or: [{ orderId }, { order_id: orderId }] }).lean();
        }
        
        if (order && order.userId) {
            const { notifyOwnersSafely } = await import('../../notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'USER', ownerId: order.userId }],
                {
                    title: 'Refund Processed! 💸',
                    body: `Your refund of ₹${refundAmount || order.pricing?.total || order.totalAmount || order.total || 0} for Order #${order.order_id || order.orderId || order._id} has been processed successfully.`,
                    image: 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    data: {
                        type: 'refund_processed',
                        orderId: String(order.order_id || order.orderId || order._id),
                        orderMongoId: String(order._id)
                    }
                }
            );
        }
        
        res.status(200).json({ success: true, message: 'Refund processed successfully', data: updated });
    } catch (error) {
        next(error);
    }
}
export async function getWithdrawals(req, res, next) {
    try {
        const data = await adminService.getWithdrawals(req.query || {});
        res.status(200).json({ success: true, message: 'Withdrawals fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateWithdrawalStatus(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.updateWithdrawalStatus(id, req.body || {});
        res.status(200).json({ success: true, message: 'Withdrawal status updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryWithdrawals(req, res, next) {
    try {
        const data = await adminService.getDeliveryWithdrawals(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery withdrawals fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryWithdrawalStatus(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.updateDeliveryWithdrawalStatus(id, req.body || {});
        res.status(200).json({ success: true, message: 'Delivery withdrawal status updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryWallets(req, res, next) {
    try {
        const data = await adminService.getDeliveryWallets(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery wallets fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryPartnerWallet(req, res, next) {
    try {
        const { id } = req.params;
        const { pocketBalance, cashInHand } = req.body || {};
        const data = await adminService.updateDeliveryPartnerWallet(id, { pocketBalance, cashInHand }, req.user);
        res.status(200).json({ success: true, message: 'Delivery wallet updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getCashLimitSettlements(req, res, next) {
    try {
        const data = await adminService.getCashLimitSettlements(req.query || {});
        res.status(200).json({ success: true, message: 'Cash limit settlements fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getCashConfirmations(req, res, next) {
    try {
        const data = await adminService.getCashConfirmations(req.query || {});
        res.status(200).json({ success: true, message: 'Cash confirmations fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateCashLimitSettlement(req, res, next) {
    try {
        const data = await adminService.updateCashLimitSettlementStatus(
            req.params.id,
            req.body || {},
            req.user,
        );
        res.status(200).json({ success: true, message: 'Settlement updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSidebarBadges(req, res, next) {
    try {
        const counts = await adminService.getSidebarBadges();
        res.status(200).json({ success: true, counts });
    } catch (error) {
        next(error);
    }
}

export async function getExpiredFssaiNotifications(req, res, next) {
    try {
        const { listExpiredFssaiRestaurants } = await import('../../restaurant/services/fssaiExpiry.service.js');
        const items = await listExpiredFssaiRestaurants();
        res.status(200).json({
            success: true,
            message: 'Expired FSSAI notifications fetched successfully',
            data: { items }
        });
    } catch (error) {
        next(error);
    }
}
