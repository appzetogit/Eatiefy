import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { deliveryRegistrationAuthMiddleware } from '../../../../core/auth/onboardingToken.js';
import { getDeliveryDraftUploadsController, addDeliveryDraftUploadController, removeDeliveryDraftUploadController, registerDeliveryPartnerController, getDeliveryVerificationStatusController, updateDeliveryPartnerProfileController, updateDeliveryPartnerBankDetailsController, listSupportTicketsController, createSupportTicketController, getSupportTicketByIdController, updateDeliveryPartnerDetailsController, updateDeliveryPartnerProfilePhotoBase64Controller, updateAvailabilityController, getWalletController, createWithdrawalRequestController, createCashDepositOrderController, verifyCashDepositPaymentController, submitCashDepositByHandController, getEarningsController, getTripHistoryController, getPocketDetailsController, getEmergencyHelpController, getCashLimitController, getDeliveryReferralStatsController, getActiveEarningAddonsController, getMyReviewsController } from '../controllers/delivery.controller.js';
import * as feedbackExperienceController from '../../admin/controllers/feedbackExperience.controller.js';

const router = express.Router();

const uploadFields = upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'aadharPhoto', maxCount: 1 },
    { name: 'panPhoto', maxCount: 1 },
    { name: 'drivingLicensePhoto', maxCount: 1 },
    { name: 'upiQrCode', maxCount: 1 }
]);

router.post('/register', uploadFields, registerDeliveryPartnerController);

// Approval status for the pending-verification screen (no session; status only).
router.get('/verification-status', getDeliveryVerificationStatusController);

// Signup document uploads before the partner exists. Authorised by the registration
// token issued at OTP verification; files go to server storage immediately.
router.get('/onboarding/uploads', deliveryRegistrationAuthMiddleware, getDeliveryDraftUploadsController);
router.post('/onboarding/uploads', deliveryRegistrationAuthMiddleware, upload.single('file'), addDeliveryDraftUploadController);
router.delete('/onboarding/uploads', deliveryRegistrationAuthMiddleware, removeDeliveryDraftUploadController);

router.patch('/profile', authMiddleware, requireRoles('DELIVERY_PARTNER'), uploadFields, updateDeliveryPartnerProfileController);

// JSON-only profile updates (no files) – safe for web updates like vehicle number.
router.patch('/profile/details', authMiddleware, requireRoles('DELIVERY_PARTNER'), updateDeliveryPartnerDetailsController);

// Base64 profile photo update – designed for Flutter in-app WebView camera handler.
router.post('/profile/photo-base64', authMiddleware, requireRoles('DELIVERY_PARTNER'), updateDeliveryPartnerProfilePhotoBase64Controller);

router.patch('/profile/bank-details', authMiddleware, requireRoles('DELIVERY_PARTNER'), uploadFields, updateDeliveryPartnerBankDetailsController);

router.patch('/availability', authMiddleware, requireRoles('DELIVERY_PARTNER'), updateAvailabilityController);

router.get('/support-tickets', authMiddleware, requireRoles('DELIVERY_PARTNER'), listSupportTicketsController);
router.post('/support-tickets', authMiddleware, requireRoles('DELIVERY_PARTNER'), createSupportTicketController);
router.get('/support-tickets/:id', authMiddleware, requireRoles('DELIVERY_PARTNER'), getSupportTicketByIdController);

// Feedback Experience (Bearer DELIVERY_PARTNER)
router.post('/feedback-experience', authMiddleware, requireRoles('DELIVERY_PARTNER'), feedbackExperienceController.createFeedbackExperience);

// ----- Orders -----
router.get('/orders/current', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.getCurrentTripDeliveryController);
router.get('/orders/available', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.listOrdersAvailableDeliveryController);
// Legacy Flutter InAppWebView polls these — MUST be registered before /orders/:orderId
router.get('/orders/assigned', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.listLegacyAssignedActiveDeliveryController);
router.get('/orders/active', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.listLegacyAssignedActiveDeliveryController);
router.get('/orders/pending', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.listLegacyPendingDeliveryController);
router.get('/orders/:orderId', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.getOrderByIdDeliveryController);
router.patch('/orders/:orderId/accept', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.acceptOrderDeliveryController);
router.patch('/orders/:orderId/reject', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.rejectOrderDeliveryController);
router.patch('/orders/:orderId/reached-pickup', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.confirmReachedPickupDeliveryController);
router.patch('/orders/:orderId/confirm-pickup', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.confirmPickupDeliveryController);
router.patch('/orders/:orderId/reached-drop', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.confirmReachedDropDeliveryController);
router.post('/orders/:orderId/verify-drop-otp', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.verifyDropOtpDeliveryController);
router.patch('/orders/:orderId/complete', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.completeDeliveryController);
router.patch('/orders/:orderId/status', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.updateOrderStatusDeliveryController);
router.post('/orders/:orderId/collect/qr', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.createCollectQrController);
router.get('/orders/:orderId/payment-status', authMiddleware, requireRoles('DELIVERY_PARTNER'), orderController.getPaymentStatusController);

// ----- Earnings / Settings -----
router.get('/earning-addons/active', authMiddleware, requireRoles('DELIVERY_PARTNER'), getActiveEarningAddonsController);
router.post('/reverify', authMiddleware, requireRoles('DELIVERY_PARTNER'), (req, res) => res.json({ success: true, message: 'Submitted' })); // Stub

// Pocket / requests page – wallet, earnings, and admin-set delivery settings
router.get('/wallet', authMiddleware, requireRoles('DELIVERY_PARTNER'), getWalletController);
router.post('/wallet/withdraw', authMiddleware, requireRoles('DELIVERY_PARTNER'), createWithdrawalRequestController);
router.post('/wallet/deposit/order', authMiddleware, requireRoles('DELIVERY_PARTNER'), createCashDepositOrderController);
router.post('/wallet/deposit/verify', authMiddleware, requireRoles('DELIVERY_PARTNER'), verifyCashDepositPaymentController);
router.post('/wallet/deposit/cash-submit', authMiddleware, requireRoles('DELIVERY_PARTNER'), submitCashDepositByHandController);
router.get('/earnings', authMiddleware, requireRoles('DELIVERY_PARTNER'), getEarningsController);
router.get('/trip-history', authMiddleware, requireRoles('DELIVERY_PARTNER'), getTripHistoryController);
router.get('/pocket-details', authMiddleware, requireRoles('DELIVERY_PARTNER'), getPocketDetailsController);
router.get('/emergency-help', authMiddleware, requireRoles('DELIVERY_PARTNER'), getEmergencyHelpController);
router.get('/cash-limit', authMiddleware, requireRoles('DELIVERY_PARTNER'), getCashLimitController);
router.get('/referrals/stats', authMiddleware, requireRoles('DELIVERY_PARTNER'), getDeliveryReferralStatsController);
router.get('/my-reviews', authMiddleware, requireRoles('DELIVERY_PARTNER'), getMyReviewsController);


export default router;

