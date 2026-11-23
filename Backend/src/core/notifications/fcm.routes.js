import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { verifyAccessToken } from '../auth/token.util.js';
import { sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import {
    getVoipDiagnostics,
    removeFirebaseDeviceToken,
    removeVoipDevice,
    sendTestNotification,
    sendTestVoipCall,
    upsertFirebaseDeviceToken,
    upsertVoipDevice
} from './firebase.service.js';
import { isVoipConfigured } from './voip.service.js';
import { PushClientDiagnostic } from './models/pushClientDiagnostic.model.js';
import { findDeliveryPartnerByPhone } from '../../modules/food/delivery/services/delivery.service.js';
import { findRestaurantByPhone } from '../../modules/food/restaurant/services/restaurant.service.js';

import mongoose from 'mongoose';

const router = express.Router();

const getOwnerContext = (req) => ({
    ownerType: req.user?.role,
    ownerId: req.user?.userId
});

/** Same as getOwnerContext, but tolerates a missing/invalid token instead of requiring authMiddleware. */
const getOwnerContextOptional = (req) => {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
        if (token) {
            const decoded = verifyAccessToken(token);
            return { ownerType: decoded.role, ownerId: decoded.userId };
        }
    } catch {
        // Falls through to the unauthenticated response below.
    }
    return { ownerType: null, ownerId: null };
};

/**
 * What the registering app build can do, e.g. ["order_alarm"] from a mobile app
 * that renders order alarms itself. Undefined when not stated, which leaves the
 * stored capability of the token unchanged.
 */
const readCapabilities = (req) => {
    const raw = req.body?.capabilities;
    if (!Array.isArray(raw)) return undefined;
    return raw.map((entry) => String(entry ?? '').trim().toLowerCase()).filter(Boolean).slice(0, 10);
};

// Public health check for fcm-tokens service
router.get('/check', (req, res) => {
    res.status(200).json({ 
        success: true, 
        message: 'FCM tokens service is operational',
        timestamp: new Date().toISOString(),
        endpoints: ['/save', '/mobile/save', '/remove', '/test', '/pending-save', '/voip/status', '/voip/test']
    });
});

/*
 * Only partners still waiting for approval can be reached through this route.
 * It is unauthenticated (pending partners hold no session), so for an approved
 * restaurant or rider it would let anyone attach their own device by phone
 * number and receive that account's order notifications - customer names,
 * addresses and phone numbers. Approved accounts register through /save.
 */
const PENDING_PARTNER_STATUSES = new Set(['pending', 'payment_pending', 'rejected']);
const isPendingPartner = (doc) =>
    PENDING_PARTNER_STATUSES.has(String(doc?.status || 'pending').toLowerCase());

// Save FCM token for pending restaurant/delivery partners (no login session required).
router.post('/pending-save', async (req, res, next) => {
    try {
        const token = String(req.body?.token || '').trim();
        const platform = req.body?.platform === 'mobile' ? 'mobile' : 'web';
        const role = String(req.body?.role || '').trim().toLowerCase();
        const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);

        if (!phone || phone.length < 10) {
            return sendError(res, 400, 'Valid phone is required');
        }
        if (!token || token.length < 20) {
            return sendError(res, 400, 'FCM token is required');
        }

        if (role === 'restaurant') {
            const restaurant = await findRestaurantByPhone(phone);
            if (!restaurant) {
                return sendError(res, 404, 'Restaurant not found for this phone');
            }
            if (!isPendingPartner(restaurant)) {
                return sendError(res, 403, 'Please sign in to register notifications');
            }

            await upsertFirebaseDeviceToken({
                ownerType: 'RESTAURANT',
                ownerId: String(restaurant._id),
                token,
                platform,
                capabilities: readCapabilities(req)
            });

            return res.status(200).json({
                success: true,
                message: 'Pending restaurant FCM token saved',
                data: { ownerType: 'RESTAURANT', ownerId: String(restaurant._id), platform }
            });
        }

        if (role === 'delivery') {
            const partner = await findDeliveryPartnerByPhone(phone);
            if (!partner) {
                return sendError(res, 404, 'Delivery partner not found for this phone');
            }
            if (!isPendingPartner(partner)) {
                return sendError(res, 403, 'Please sign in to register notifications');
            }

            await upsertFirebaseDeviceToken({
                ownerType: 'DELIVERY_PARTNER',
                ownerId: String(partner._id),
                token,
                platform
            });

            return res.status(200).json({
                success: true,
                message: 'Pending delivery FCM token saved',
                data: { ownerType: 'DELIVERY_PARTNER', ownerId: String(partner._id), platform }
            });
        }

        return sendError(res, 400, 'role must be restaurant or delivery');
    } catch (error) {
        next(error);
    }
});

router.post('/save', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const token = String(req.body?.token || '').trim();
        const platform = req.body?.platform === 'mobile' ? 'mobile' : 'web';

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            return sendError(res, 400, 'Invalid user ID format');
        }

        if (!token) {
            return sendError(res, 400, 'FCM token is required');
        }

        await upsertFirebaseDeviceToken({ ownerType, ownerId, token, platform, capabilities: readCapabilities(req) });
        return res.status(200).json({
            success: true,
            message: 'FCM token saved',
            data: { ownerType, ownerId, platform }
        });
    } catch (error) {
        next(error);
    }
});

// iOS VoIP (CallKit) order calls: owner types that can register, and the shape
// of a PushKit token. Used both by /mobile/save below and by the standalone
// /voip/save route further down.
const VOIP_OWNER_TYPES = new Set(['RESTAURANT', 'DELIVERY_PARTNER']);
const isVoipToken = (value) => /^[0-9a-f]{64,200}$/i.test(value);

/*
 * Mobile FCM token, and — on iOS — the PushKit VoIP token of the same install
 * in the same call, so the app does not need a second round trip for order
 * calls. `voipToken` is optional; omitting it (Android, or an iOS build that
 * has not added VoIP) behaves exactly as before.
 */
router.post('/mobile/save', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const token = String(req.body?.token || '').trim();
        const voipTokenRaw = String(req.body?.voipToken || '').trim();

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        if (!token) {
            return sendError(res, 400, 'FCM token is required');
        }

        await upsertFirebaseDeviceToken({
            ownerType,
            ownerId,
            token,
            platform: 'mobile',
            capabilities: readCapabilities(req)
        });

        // VoIP calls only exist for the restaurant and delivery apps; a malformed
        // or out-of-scope voipToken never fails the whole save (the FCM token
        // above is the half that matters most) — but every reason it was NOT
        // saved is logged, since a silent skip here is exactly what makes
        // "iPhone never rings" look like a mystery later.
        let voipSaved = false;
        if (voipTokenRaw) {
            const normalizedOwnerType = String(ownerType).toUpperCase();
            if (!VOIP_OWNER_TYPES.has(normalizedOwnerType)) {
                logger.info(`[VoIP] voipToken ignored for ${ownerType}:${ownerId}: VoIP is only available for restaurant and delivery accounts`);
            } else if (!isVoipToken(voipTokenRaw)) {
                logger.warn(
                    `[VoIP] voipToken REJECTED for ${ownerType}:${ownerId}: not a valid PushKit token ` +
                    `(got ${voipTokenRaw.length} char(s), expected 64-200 hex characters; preview="${voipTokenRaw.slice(0, 12)}...")`
                );
            } else {
                try {
                    await upsertVoipDevice({
                        ownerType,
                        ownerId,
                        voipToken: voipTokenRaw,
                        fcmToken: token,
                        deviceId: String(req.body?.deviceId || '').trim()
                    });
                    voipSaved = true;
                } catch (voipError) {
                    logger.warn(`[VoIP] voipToken save FAILED for ${ownerType}:${ownerId}: ${voipError.message}`);
                }
            }
        } else {
            // The client sends WHY it has no voipToken to send (not_flutter_webview = a
            // web login, not the native app; no_bridge_handler = app build predates
            // VoIP; bridge_returned_invalid_value = handler exists but misbehaves).
            // Older app builds that don't know this field yet just omit it.
            const voipSkipReason = String(req.body?.voipSkipReason || '').trim();
            logger.info(
                `[VoIP] /mobile/save for ${ownerType}:${ownerId}: no voipToken in request body` +
                (voipSkipReason ? ` (client reason: ${voipSkipReason})` : ' (client sent no reason — app build predates this diagnostic)')
            );
        }

        return res.status(200).json({
            success: true,
            message: 'Mobile push tokens saved successfully',
            data: { ownerType, ownerId, platform: 'mobile', fcmSaved: true, voipSaved }
        });
    } catch (error) {
        next(error);
    }
});

const handleRemoveToken = async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const token = String(req.params?.token || req.body?.token || '').trim();
        const platform = req.body?.platform === 'mobile' ? 'mobile' : req.body?.platform === 'web' ? 'web' : undefined;

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        await removeFirebaseDeviceToken({ ownerType, ownerId, token, platform });
        return res.status(200).json({
            success: true,
            message: 'FCM token removed'
        });
    } catch (error) {
        next(error);
    }
};

router.delete('/remove', authMiddleware, handleRemoveToken);
router.delete('/remove/:token', authMiddleware, handleRemoveToken);

router.post('/test', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const platform = req.body?.platform === 'mobile' ? 'mobile' : req.body?.platform === 'web' ? 'web' : undefined;

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        const result = await sendTestNotification({ ownerType, ownerId, platform });
        const delivered = Number(result?.successCount || 0);
        const attempted = delivered + Number(result?.failureCount || 0);
        // Be honest: "sent" only when Firebase accepted at least one device. The
        // old response said success even when this account had no registered
        // device, so a push that was never attempted looked like it was sent.
        if (delivered > 0) {
            return res.status(200).json({
                success: true,
                message: `Test notification sent to ${delivered} device${delivered === 1 ? '' : 's'}`,
                data: { ...result, delivered }
            });
        }
        const reason = attempted === 0
            ? `No ${platform === 'mobile' ? 'mobile' : 'web'} push device is registered for this account. Allow notifications on this device (or open the app on your phone) and try again.`
            : (result?.error || 'Firebase rejected the push for every registered device (the token may be expired). Re-enable notifications on this device and try again.');
        return res.status(200).json({
            success: false,
            message: reason,
            data: { ...result, delivered: 0 }
        });
    } catch (error) {
        next(error);
    }
});

/** @deprecated Register voipToken via POST /mobile/save instead (one call, one round trip). */
router.post('/voip/save', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }
        if (!VOIP_OWNER_TYPES.has(String(ownerType).toUpperCase())) {
            return sendError(res, 403, 'VoIP calls are only available for restaurant and delivery accounts');
        }
        const voipToken = String(req.body?.voipToken || '').trim();
        if (!isVoipToken(voipToken)) {
            return sendError(res, 400, 'A valid voipToken is required');
        }

        const result = await upsertVoipDevice({
            ownerType,
            ownerId,
            voipToken,
            fcmToken: String(req.body?.fcmToken || '').trim(),
            deviceId: String(req.body?.deviceId || '').trim()
        });
        return res.status(200).json({
            success: true,
            message: 'VoIP device saved',
            data: { ownerType, ownerId, voipConfigured: result.voipConfigured }
        });
    } catch (error) {
        next(error);
    }
});

router.delete('/voip/remove', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }
        const voipToken = String(req.body?.voipToken || req.query?.voipToken || '').trim();
        const fcmToken = String(req.body?.fcmToken || req.query?.fcmToken || '').trim();
        const deviceId = String(req.body?.deviceId || req.query?.deviceId || '').trim();
        if (!voipToken && !fcmToken && !deviceId) {
            return sendError(res, 400, 'voipToken, fcmToken or deviceId is required');
        }

        await removeVoipDevice({ ownerType, ownerId, voipToken, fcmToken, deviceId });
        return res.status(200).json({ success: true, message: 'VoIP device removed' });
    } catch (error) {
        next(error);
    }
});

/*
 * Server-side check: "is VoIP actually working for my account right now".
 * Shows whether this owner type is supported, whether the server has valid
 * APNs settings (team id, key id, .p8 file, topic), how many iPhones are
 * registered, and the environment (sandbox/production) a call would use.
 * Unauthenticated callers get the server-wide picture only, no account data.
 */
router.get('/voip/status', async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContextOptional(req);
        if (!ownerType || !ownerId) {
            return res.status(200).json({
                success: true,
                data: {
                    authenticated: false,
                    restaurant: { serverConfigured: isVoipConfigured('RESTAURANT') },
                    deliveryPartner: { serverConfigured: isVoipConfigured('DELIVERY_PARTNER') }
                }
            });
        }

        const diagnostics = await getVoipDiagnostics({ ownerType, ownerId });
        return res.status(200).json({ success: true, data: { authenticated: true, ...diagnostics } });
    } catch (error) {
        next(error);
    }
});

router.post('/voip/test', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }
        if (!VOIP_OWNER_TYPES.has(String(ownerType).toUpperCase())) {
            return sendError(res, 403, 'VoIP calls are only available for restaurant and delivery accounts');
        }

        const result = await sendTestVoipCall({ ownerType: String(ownerType).toUpperCase(), ownerId });
        return res.status(200).json({
            success: true,
            message: result?.skipped ? result.reason : 'Test VoIP call sent',
            data: { voip: result }
        });
    } catch (error) {
        next(error);
    }
});

/*
 * The native app build could not hand the web layer an FCM token, so no push
 * can ever reach that device. The client reports why (what each bridge handler
 * returned or threw) so it shows up in server logs instead of staying on-device.
 */
router.post('/client-diagnostic', authMiddleware, async (req, res) => {
    const { ownerType, ownerId } = getOwnerContext(req);
    const clip = (value, max) => String(value ?? '').slice(0, max);
    const rawHandlers = req.body?.handlers && typeof req.body.handlers === 'object' ? req.body.handlers : {};
    // Keys become Mongo field names, so strip the characters Mongo reserves.
    const handlers = Object.fromEntries(
        Object.entries(rawHandlers)
            .slice(0, 8)
            .map(([name, outcome]) => [clip(name, 30).replace(/[.$]/g, '_'), clip(outcome, 100)])
    );
    const handlerSummary =
        Object.entries(handlers).map(([name, outcome]) => `${name}=${outcome}`).join('; ') ||
        '(no handler answered in time)';
    // What the app's notification-permission handler answered; null when never asked.
    const rawPermission = req.body?.permission && typeof req.body.permission === 'object' ? req.body.permission : null;
    const permission = rawPermission
        ? {
            handler: rawPermission.handler ? clip(rawPermission.handler, 40) : null,
            result: rawPermission.result === undefined ? undefined : clip(rawPermission.result, 60),
            attempts: Object.fromEntries(
                Object.entries(
                    rawPermission.attempts && typeof rawPermission.attempts === 'object' ? rawPermission.attempts : {}
                )
                    .slice(0, 8)
                    .map(([name, outcome]) => [clip(name, 30).replace(/[.$]/g, '_'), clip(outcome, 100)])
            )
        }
        : null;
    const rawEnv = req.body?.env && typeof req.body.env === 'object' ? req.body.env : {};
    const env = {
        flutter: rawEnv.flutter === true,
        standalone: rawEnv.standalone === true,
        notificationApi: rawEnv.notificationApi === true,
        webPermission: clip(rawEnv.webPermission, 20),
        serviceWorker: rawEnv.serviceWorker === true
    };
    const diagnostic = {
        env,
        module: clip(req.body?.module, 20),
        tokenFound: req.body?.tokenFound === true,
        hasCallHandler: Boolean(req.body?.hasCallHandler),
        userAgent: clip(req.body?.userAgent, 200)
    };
    logger.warn(
        `[FCM-Client] ${ownerType}:${ownerId} module=${diagnostic.module} tokenFound=${diagnostic.tokenFound} ` +
        `permission=${permission ? JSON.stringify(permission) : 'unknown'} ` +
        `hasCallHandler=${diagnostic.hasCallHandler} handlers: ${handlerSummary} ua="${diagnostic.userAgent}"`
    );
    try {
        if (ownerType && mongoose.Types.ObjectId.isValid(ownerId)) {
            await PushClientDiagnostic.create({
                ownerType: String(ownerType).toUpperCase(),
                ownerId,
                handlers,
                permission,
                ...diagnostic
            });
        }
    } catch (error) {
        logger.warn(`[FCM-Client] Could not store client diagnostic: ${error.message}`);
    }
    return res.status(200).json({ success: true });
});

export default router;
