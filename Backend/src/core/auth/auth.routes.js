import express from 'express';
import {
    requestUserOtpController,
    verifyUserOtpController,
    validateUserReferralCodeController,
    adminLoginController,
    refreshTokenController,
    requestRestaurantOtpController,
    verifyRestaurantOtpController,
    reapplyRestaurantController,
    requestDeliveryOtpController,
    verifyDeliveryOtpController,
    logoutController,
    logoutAllDevicesController,
    getMeController,
    updateAdminProfileController,
    changeAdminPasswordController,
    requestAdminForgotPasswordOtpController,
    resetAdminPasswordWithOtpController,
    deleteAccountController,
    checkAccountBalanceController
} from './auth.controller.js';
import { authMiddleware, requireAdmin } from './auth.middleware.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';

const router = express.Router();

// Auth credential routes — AUTH_RATE_LIMIT_* only (api middleware skips these)
router.post('/user/request-otp', authRateLimiter, requestUserOtpController);
router.post('/user/verify-otp', authRateLimiter, verifyUserOtpController);
router.get('/user/validate-referral', authRateLimiter, validateUserReferralCodeController);

router.post('/restaurant/request-otp', authRateLimiter, requestRestaurantOtpController);
router.post('/restaurant/verify-otp', authRateLimiter, verifyRestaurantOtpController);
router.post('/restaurant/reapply', authRateLimiter, reapplyRestaurantController);

router.post('/delivery/request-otp', authRateLimiter, requestDeliveryOtpController);
router.post('/delivery/verify-otp', authRateLimiter, verifyDeliveryOtpController);

router.post('/admin/login', authRateLimiter, adminLoginController);

router.post('/admin/forgot-password/request-otp', authRateLimiter, requestAdminForgotPasswordOtpController);
router.post('/admin/forgot-password/reset', authRateLimiter, resetAdminPasswordWithOtpController);

router.post('/refresh-token', refreshTokenController);
router.post('/logout', logoutController);

// Authenticated auth routes — private user+IP limit via /api apiRateLimitMiddleware
router.post('/logout-all', authMiddleware, logoutAllDevicesController);
router.get('/me', authMiddleware, getMeController);
router.patch('/admin/profile', authMiddleware, requireAdmin, updateAdminProfileController);
router.post('/admin/change-password', authMiddleware, requireAdmin, changeAdminPasswordController);
router.get('/delete-account/check-balance', authMiddleware, checkAccountBalanceController);
router.delete('/delete-account', authMiddleware, deleteAccountController);

export default router;

