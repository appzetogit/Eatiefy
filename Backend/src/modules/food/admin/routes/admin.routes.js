import express from 'express';
import { AuthError } from '../../../../core/auth/errors.js';
import * as adminController from '../controllers/admin.controller.js';
import * as onboardingPricingController from '../controllers/onboardingPricing.controller.js';
import * as foodApprovalController from '../controllers/foodApproval.controller.js';
import * as addonsApprovalController from '../controllers/addonsApproval.controller.js';
import * as businessSettingsController from '../controllers/businessSettings.controller.js';
import * as feedbackExperienceController from '../controllers/feedbackExperience.controller.js';
import * as notificationBroadcastController from '../controllers/notificationBroadcast.controller.js';
import * as diningAdminController from '../../dining/controllers/diningAdmin.controller.js';
import { requireDiningEnabled } from '../../dining/middleware/requireDiningEnabled.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import * as subAdminController from '../controllers/subAdmin.controller.js';
import { getAdminPageController, upsertAdminPageController } from '../controllers/pageContent.controller.js';
import * as systemConfigController from '../controllers/systemConfig.controller.js';
import { upload } from '../../../../middleware/upload.js';
import { enforceSubAdminPermissions } from '../middleware/subAdminPermission.middleware.js';
import * as otherPriceController from '../controllers/otherPrice.controller.js';

const router = express.Router();

// ----- Public Business Settings (No Admin Required) -----
router.get('/business-settings/public', businessSettingsController.getBusinessSettings);

const ADMIN_PORTAL_ROLES = new Set(['ADMIN', 'SUB_ADMIN']);

const requireAdmin = (req, _res, next) => {
    const user = req.user;
    const role = String(user?.role || '').toUpperCase();
    if (!user || !ADMIN_PORTAL_ROLES.has(role)) {
        return next(new AuthError('Admin access required'));
    }
    return next();
};

router.use(requireAdmin);
router.use(enforceSubAdminPermissions);

// ----- Sub Admins (full ADMIN only — enforced in controller) -----
router.get('/sub-admins/permission-modules', subAdminController.getPermissionModules);
router.get('/sub-admins', subAdminController.listSubAdmins);
router.post('/sub-admins', subAdminController.createSubAdmin);
router.get('/sub-admins/:id', subAdminController.getSubAdminById);
router.patch('/sub-admins/:id', subAdminController.updateSubAdmin);
router.patch('/sub-admins/:id/status', subAdminController.updateSubAdminStatus);
router.patch('/sub-admins/:id/password', subAdminController.resetSubAdminPassword);
router.patch('/sub-admins/:id/permissions', subAdminController.updateSubAdminPermissions);
router.delete('/sub-admins/:id', subAdminController.deleteSubAdmin);

// ----- Broadcast Notifications -----
router.post('/notifications/broadcast', notificationBroadcastController.createBroadcastNotificationController);
router.get('/notifications/broadcast', notificationBroadcastController.getBroadcastNotificationsController);
router.get('/notifications/recipients-search', notificationBroadcastController.searchBroadcastRecipientsController);
router.delete('/notifications/broadcast/:id', notificationBroadcastController.deleteBroadcastNotificationController);
router.post('/notifications/push-debug', notificationBroadcastController.runPushDebugController);

// ----- Customers -----
router.get('/customers', adminController.getCustomers);
router.get('/customers/:id', adminController.getCustomerById);
router.patch('/customers/:id/status', adminController.updateCustomerStatus);
router.patch('/customers/:id/cod-status', adminController.updateCustomerCodStatus);
router.post('/customers/:id/wallet/adjust', adminController.adjustCustomerWallet);
router.delete('/customers/:id', adminController.deleteCustomer);
router.delete('/users/:id', adminController.deleteCustomer);

// ----- Safety / Emergency Reports -----
router.get('/safety-emergency-reports', adminController.getSafetyEmergencyReports);
router.put('/safety-emergency-reports/:id/status', adminController.updateSafetyEmergencyStatus);
router.put('/safety-emergency-reports/:id/priority', adminController.updateSafetyEmergencyPriority);
router.delete('/safety-emergency-reports/:id', adminController.deleteSafetyEmergencyReport);

// ----- Support Tickets (users) -----
router.get('/support-tickets', adminController.getSupportTicketsController);
router.patch('/support-tickets/:id', adminController.updateSupportTicketController);
router.get('/global-search', adminController.globalSearch);
router.get('/restaurants/complaints', adminController.getRestaurantComplaints);
router.patch('/restaurants/complaints/:id', adminController.updateRestaurantComplaint);

// ----- Restaurants -----
router.get('/restaurants', adminController.getRestaurants);
router.get('/restaurants/counts', adminController.getRestaurantCounts);
router.get('/restaurants/earnings', adminController.getRestaurantEarnings);
router.get('/dashboard-stats', adminController.getDashboardStats);
router.get('/reports/restaurants', adminController.getRestaurantReport);
router.get('/reports/transactions', adminController.getTransactionReport);
router.get('/reports/tax', adminController.getTaxReport);
router.get('/reports/tax/:id', adminController.getTaxReportDetail);
router.get('/restaurants/pending', adminController.getPendingRestaurants);
router.get('/restaurants/reviews', adminController.getRestaurantReviews);
router.get('/restaurants/check-duplicate', adminController.checkRestaurantDuplicate);
router.get('/restaurants/:id', adminController.getRestaurantById);
router.get('/restaurants/:id/analytics', adminController.getRestaurantAnalytics);
router.get('/restaurants/:id/menu', adminController.getRestaurantMenuById);
router.post('/restaurants', adminController.createRestaurant);
router.patch('/restaurants/:id', adminController.updateRestaurantById);
router.patch('/restaurants/:id/status', adminController.updateRestaurantStatus);
router.patch('/restaurants/:id/location', adminController.updateRestaurantLocation);
router.patch('/restaurants/:id/menu', adminController.updateRestaurantMenuById);
router.patch('/restaurants/:id/approve', adminController.approveRestaurant);
router.patch('/restaurants/:id/reject', adminController.rejectRestaurant);
router.delete('/restaurants/:id', adminController.deleteRestaurant);

// ----- Restaurant Commission -----
router.get('/restaurant-commissions/bootstrap', adminController.getRestaurantCommissionBootstrap);
router.get('/restaurant-commissions', adminController.getRestaurantCommissions);
router.post('/restaurant-commissions', adminController.createRestaurantCommission);
router.get('/restaurant-commissions/:id', adminController.getRestaurantCommissionById);
router.patch('/restaurant-commissions/:id', adminController.updateRestaurantCommission);
router.delete('/restaurant-commissions/:id', adminController.deleteRestaurantCommission);
router.patch('/restaurant-commissions/:id/toggle', adminController.toggleRestaurantCommissionStatus);

// ----- Categories -----
router.get('/categories', adminController.getCategories);
router.post('/categories', adminController.createCategory);
router.patch('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);
router.patch('/categories/:id/toggle', adminController.toggleCategoryStatus);
router.patch('/categories/:id/approve', adminController.approveCategory);
router.patch('/categories/:id/reject', adminController.rejectCategory);
router.patch('/categories/:id/make-global', adminController.makeCategoryGlobal);

// ----- Restaurant Add-ons Approval -----
router.get('/addons', addonsApprovalController.getRestaurantAddons);
router.patch('/addons/:id', addonsApprovalController.updateRestaurantAddon);
router.patch('/addons/:id/approve', addonsApprovalController.approveRestaurantAddon);
router.patch('/addons/:id/reject', addonsApprovalController.rejectRestaurantAddon);

// ----- Foods -----
router.get('/foods', adminController.getFoods);
router.post('/foods', adminController.createFood);
// Must precede '/foods/:id' so "bulk-approve" isn't treated as a food id.
router.patch('/foods/bulk-approve', foodApprovalController.bulkApprovePendingController);
router.patch('/foods/:id', adminController.updateFood);
router.delete('/foods/:id', adminController.deleteFood);

// ----- Pricing Management (Other Price markup rules) -----
router.get('/pricing/summary', otherPriceController.getPricingSummary);
router.get('/pricing/rules', otherPriceController.listPricingRules);
router.post('/pricing/rules/bulk-restaurant', otherPriceController.bulkUpsertRestaurantPricingRules);
router.post('/pricing/rules/bulk-menu-item', otherPriceController.bulkUpsertMenuItemPricingRules);
router.post('/pricing/rules', otherPriceController.upsertPricingRule);
router.delete('/pricing/rules/:id', otherPriceController.deletePricingRule);
router.post('/pricing/preview', otherPriceController.previewPricing);
router.get('/pricing/audits', otherPriceController.listPricingAudits);

// Food approval queue (pending items created by restaurants)
router.get('/foods/pending-approvals', foodApprovalController.getPendingFoodApprovals);
router.get('/foods/pending-approvals/restaurants', foodApprovalController.getPendingApprovalRestaurantsController);
router.patch('/foods/:id/approve', foodApprovalController.approveFoodItemController);
router.patch('/foods/:id/reject', foodApprovalController.rejectFoodItemController);

// ----- Offers & Coupons -----
router.get('/offers', adminController.getAllOffers);
router.post('/offers', adminController.createAdminOffer);
router.put('/offers/:id', adminController.updateAdminOffer);
router.patch('/offers/:id/cart-visibility', adminController.updateAdminOfferCartVisibility);
router.delete('/offers/:id', adminController.deleteAdminOffer);

// ----- Restaurant Item Offers (Approvals & Management) -----
router.get('/restaurant-offers', adminController.getRestaurantOffersForAdmin);
router.patch('/restaurant-offers/:id/approve', adminController.approveRestaurantOffer);
router.patch('/restaurant-offers/:id/reject', adminController.rejectRestaurantOffer);
router.delete('/restaurant-offers/:id', adminController.deleteRestaurantOfferByAdminController);

// ----- Feedback Experience (Admin) -----
router.get('/feedback-experiences', feedbackExperienceController.getFeedbackExperiences);
router.delete('/feedback-experiences/:id', feedbackExperienceController.deleteFeedbackExperience);

// ----- Fee Settings -----
router.get('/fee-settings', adminController.getFeeSettings);
router.put('/fee-settings', adminController.createOrUpdateFeeSettings);

// ----- Referral Settings -----
router.get('/referral-settings', adminController.getReferralSettings);
router.put('/referral-settings', adminController.createOrUpdateReferralSettings);

// ----- Business Settings -----
router.get('/business-settings/public', businessSettingsController.getBusinessSettings); // Public endpoint
router.get('/business-settings', businessSettingsController.getBusinessSettings);
router.patch('/business-settings', upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 }
]), businessSettingsController.updateBusinessSettings);

// ----- Delivery Cash Limit -----
router.get('/delivery-cash-limit', adminController.getDeliveryCashLimit);
router.patch('/delivery-cash-limit', adminController.updateDeliveryCashLimit);

// ----- Top Restaurants (per zone + type) -----
router.get('/top-restaurants', adminController.getTopRestaurants);
router.put('/top-restaurants', adminController.saveTopRestaurants);

// ----- Archived / Deleted Accounts -----
router.get('/archived-accounts', adminController.getArchivedAccounts);

// ----- Delivery Emergency Help -----
router.get('/delivery-emergency-help', adminController.getEmergencyHelp);
router.put('/delivery-emergency-help', adminController.createOrUpdateEmergencyHelp);

// ----- Withdrawals (admin) -----
router.get('/withdrawals', adminController.getWithdrawals);
router.patch('/withdrawals/:id', adminController.updateWithdrawalStatus);
router.get('/delivery/withdrawals', adminController.getDeliveryWithdrawals);
router.patch('/delivery/withdrawals/:id', adminController.updateDeliveryWithdrawalStatus);
router.get('/delivery/cash-limit-settlements', adminController.getCashLimitSettlements);
router.get('/delivery/cash-confirmations', adminController.getCashConfirmations);
router.patch('/delivery/cash-limit-settlements/:id', adminController.updateCashLimitSettlement);

// ----- Delivery partners & general -----
router.get('/delivery/join-requests', adminController.getDeliveryJoinRequests);
router.get('/delivery/wallets', adminController.getDeliveryWallets);
router.get('/delivery/bonus-transactions', adminController.getDeliveryPartnerBonusTransactions);
router.get('/delivery/earnings', adminController.getDeliveryEarnings);
router.post('/delivery/bonus', adminController.addDeliveryPartnerBonus);
router.get('/delivery/commission-rules', adminController.getDeliveryCommissionRules);
router.post('/delivery/commission-rules', adminController.createDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id', adminController.updateDeliveryCommissionRule);
router.delete('/delivery/commission-rules/:id', adminController.deleteDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id/status', adminController.toggleDeliveryCommissionRuleStatus);
// Eatiefy incentive (zone-wise, on top of payout rules). Path maps to the
// Delivery Boy Payout sub-admin permission.
router.get('/delivery-boy-commission/incentive', adminController.getDeliveryIncentiveSettings);
router.put('/delivery-boy-commission/incentive', adminController.updateDeliveryIncentiveSettings);
router.get('/delivery/reviews', adminController.getDeliverymanReviews);
router.get('/contact-messages', adminController.getContactMessages);
router.get('/delivery/earning-addons', adminController.getEarningAddons);
router.post('/delivery/earning-addons', adminController.createEarningAddon);
router.patch('/delivery/earning-addons/:id', adminController.updateEarningAddon);
router.delete('/delivery/earning-addons/:id', adminController.deleteEarningAddon);
router.patch('/delivery/earning-addons/:id/status', adminController.toggleEarningAddonStatus);
router.get('/delivery/earning-addon-history', adminController.getEarningAddonHistory);
router.post('/delivery/earning-addon-history/:id/credit', adminController.creditEarningToWallet);
router.post('/delivery/earning-addon-history/:id/cancel', adminController.cancelEarningAddonHistory);
router.post('/delivery/earning-addon-completions/check', adminController.checkEarningAddonCompletions);
router.get('/delivery/support-tickets/stats', adminController.getSupportTicketStats);
router.get('/delivery/support-tickets', adminController.getSupportTickets);
router.patch('/delivery/support-tickets/:id', adminController.updateSupportTicket);
router.get('/delivery/partners', adminController.getDeliveryPartners);
router.patch('/delivery/partners/:id/wallet', adminController.updateDeliveryPartnerWallet);
router.get('/delivery/:id', adminController.getDeliveryPartnerById);
router.patch('/delivery/:id', adminController.updateDeliveryPartner);
router.patch('/delivery-partners/:id', adminController.updateDeliveryPartner);
router.patch('/delivery/:id/approve', adminController.approveDeliveryPartner);
router.patch('/delivery/:id/reject', adminController.rejectDeliveryPartner);
// Named after the Deliveryman List page so sub-admin "delete" permission for that page applies.
router.delete('/delivery-partners/:id', adminController.deleteDeliveryPartner);

// ----- Zones -----
// ----- Restaurant onboarding pricing, offers & payments -----
router.get('/onboarding/pricing/bootstrap', onboardingPricingController.getBootstrap);
router.get('/onboarding/pricing/rules', onboardingPricingController.getPricingRules);
router.post('/onboarding/pricing/rules', onboardingPricingController.savePricingRule);
router.patch('/onboarding/pricing/rules/:id', onboardingPricingController.updatePricingRule);
router.patch('/onboarding/pricing/rules/:id/status', onboardingPricingController.togglePricingRule);
router.delete('/onboarding/pricing/rules/:id', onboardingPricingController.removePricingRule);
router.get('/onboarding/offers', onboardingPricingController.getOffers);
router.post('/onboarding/offers', onboardingPricingController.saveOffer);
router.patch('/onboarding/offers/:id', onboardingPricingController.updateOffer);
router.patch('/onboarding/offers/:id/status', onboardingPricingController.toggleOffer);
router.delete('/onboarding/offers/:id', onboardingPricingController.removeOffer);
router.get('/onboarding/payments', onboardingPricingController.getPayments);

router.get('/zones', adminController.getZones);
router.get('/zones/:id', adminController.getZoneById);
router.post('/zones', adminController.createZone);
router.patch('/zones/:id', adminController.updateZone);
router.delete('/zones/:id', adminController.deleteZone);

// ----- Dining -----
// Admin dining management. The router is already behind ADMIN/SUB_ADMIN auth in
// routes/index.js; requireDiningEnabled adds the feature gate on top, so these
// endpoints exist only while the module is switched on.
router.get('/dining/categories', requireDiningEnabled, diningAdminController.getDiningCategories);
router.post('/dining/categories', requireDiningEnabled, diningAdminController.createDiningCategory);
router.patch('/dining/categories/:id', requireDiningEnabled, diningAdminController.updateDiningCategory);
router.delete('/dining/categories/:id', requireDiningEnabled, diningAdminController.deleteDiningCategory);
router.get('/dining/restaurants', requireDiningEnabled, diningAdminController.getDiningRestaurants);
router.patch('/dining/restaurants/:restaurantId', requireDiningEnabled, diningAdminController.updateDiningRestaurant);
router.get('/dining/requests', requireDiningEnabled, diningAdminController.listAllDiningRequests);
router.patch('/dining/requests/:id/approve', requireDiningEnabled, diningAdminController.approveDiningRequest);
router.patch('/dining/requests/:id/reject', requireDiningEnabled, diningAdminController.rejectDiningRequest);

// ----- Orders -----
router.get('/orders/refund-requests', orderController.getRefundRequestsAdminController);
router.get('/refund-requests', orderController.getRefundRequestsAdminController);
router.get('/orders', orderController.listOrdersAdminController);
router.get('/orders/:orderId', orderController.getOrderByIdAdminController);
router.delete('/orders/:orderId', orderController.deleteOrderAdminController);
router.patch('/orders/:orderId/accept', orderController.acceptOrderAdminController);
router.patch('/orders/:orderId/reject', orderController.rejectOrderAdminController);
router.patch('/orders/:orderId/statuses', orderController.updateOrderStatusesAdminController);
router.post('/orders/:orderId/refund', adminController.processRefund);

// ----- CMS Pages (About + legal) -----
router.get('/pages-social-media/:key', getAdminPageController);
router.put('/pages-social-media/:key', upsertAdminPageController);

router.get('/sidebar-badges', adminController.getSidebarBadges);
router.get('/notifications/fssai-expired', adminController.getExpiredFssaiNotifications);

// ----- Customization Settings -----
router.get('/customization-settings', systemConfigController.getCustomizationSettings);
router.patch('/customization-settings', systemConfigController.updateCustomizationSettings);
router.get('/customization-settings/takeaway-cod', systemConfigController.getTakeawayCodStatus);

// ----- Restaurant Settings -----
router.get('/restaurant-settings', systemConfigController.getAdminRestaurantSettings);
router.patch('/restaurant-settings', systemConfigController.updateRestaurantSettings);

export default router;
