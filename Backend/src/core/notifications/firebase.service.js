import crypto from 'crypto';
import { getCachedNotificationIcon } from './notificationBranding.service.js';
import { FoodNotificationDispatch } from './models/notificationDispatch.model.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import mongoose from 'mongoose';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodAdmin } from '../admin/admin.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { buildVoipCallId, getVoipTopic, isVoipConfigured, sendVoipCall } from './voip.service.js';

const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_URL = (projectId) =>
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
const OWNER_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner,
    ADMIN: FoodAdmin
};
const OWNER_TOKEN_FIELDS = {
    web: 'fcmTokens',
    mobile: 'fcmTokenMobile'
};
/**
 * Mobile tokens whose app build handles order alarms itself: a data-only push
 * wakes its background handler even when the app is killed, and it shows a
 * looping full-screen alarm. Older builds are not in this list and keep getting
 * the regular notification push, which the OS renders without the app running.
 * Only owner models that declare this path take part.
 */
const ORDER_ALARM_TOKEN_FIELD = 'fcmTokenMobileAlarm';
export const ORDER_ALARM_CAPABILITY = 'order_alarm';
/** iPhones that ring order alerts as a VoIP call (see voipDevice.schema.js). */
const VOIP_DEVICES_FIELD = 'voipDevices';
const MAX_VOIP_DEVICES = 10;

let cachedAccessToken = null;
let cachedAccessTokenExpiryMs = 0;
let cachedServiceAccount = null;

const sanitizeString = (value) => String(value ?? '').trim();

// In-memory sliding TTL idempotency cache for push notifications (per deviceToken + eventKey)
const PUSH_IDEMPOTENCY_TTL_MS = 120_000;
const pushIdempotencyCache = new Map();

export const clearPushIdempotencyCache = () => {
    pushIdempotencyCache.clear();
};

export const isPushRecentlyDispatched = (token, eventKey) => {
    if (!token || !eventKey) return false;
    const key = `${token}::${eventKey}`;
    const timestamp = pushIdempotencyCache.get(key);
    if (!timestamp) return false;
    if (Date.now() - timestamp > PUSH_IDEMPOTENCY_TTL_MS) {
        pushIdempotencyCache.delete(key);
        return false;
    }
    return true;
};

/**
 * Atomically claims (token, eventKey) so exactly one push per device per event
 * goes out. The in-memory map is the fast path; the unique index on
 * food_notification_dispatches is the authority, so a retry, a duplicated
 * caller, or a second API instance cannot re-send the same event.
 * Returns true when the caller owns the dispatch.
 */
const claimPushDispatch = async (token, eventKey) => {
    if (!token || !eventKey) return true;
    if (isPushRecentlyDispatched(token, eventKey)) return false;
    markPushDispatched(token, eventKey);

    try {
        await FoodNotificationDispatch.create({ eventKey, token });
        return true;
    } catch (error) {
        if (error?.code === 11000) return false;
        // Storage unavailable — the in-memory guard above still holds for this instance.
        logger.warn(`[FCM] Dispatch claim persistence failed (${error?.message || error})`);
        return true;
    }
};

/**
 * Releases a claim when the send never reached the device, so a later retry of
 * the same event is still allowed to deliver it once.
 */
const releasePushDispatch = async (token, eventKey) => {
    if (!token || !eventKey) return;
    pushIdempotencyCache.delete(`${token}::${eventKey}`);
    try {
        await FoodNotificationDispatch.deleteOne({ eventKey, token });
    } catch {
        // Best effort only.
    }
};

const markPushDispatched = (token, eventKey) => {
    if (!token || !eventKey) return;
    const key = `${token}::${eventKey}`;
    pushIdempotencyCache.set(key, Date.now());

    // Prune stale cache entries if cache size grows large
    if (pushIdempotencyCache.size > 2000) {
        const now = Date.now();
        for (const [k, ts] of pushIdempotencyCache.entries()) {
            if (now - ts > PUSH_IDEMPOTENCY_TTL_MS) {
                pushIdempotencyCache.delete(k);
            }
        }
    }
};

export const deriveEventKey = (payload = {}) => {
    if (payload?.idempotencyKey) return String(payload.idempotencyKey).trim();
    if (payload?.eventId) return String(payload.eventId).trim();

    const data = payload?.data || {};
    if (data.idempotencyKey) return String(data.idempotencyKey).trim();
    if (data.eventId) return String(data.eventId).trim();
    if (data.notificationId) return String(data.notificationId).trim();
    if (data.broadcastId) return `broadcast:${data.broadcastId}`;

    const orderMongoId = String(data.orderMongoId || data.order_mongo_id || '').trim();
    const orderId = String(data.orderId || data.order_id || '').trim();
    const type = String(data.type || data.notificationType || '').trim();
    const orderStatus = String(data.orderStatus || data.status || '').trim();

    if (orderMongoId || orderId) {
        const primaryId = orderMongoId || orderId;
        if (type) {
            return `order:${type}:${primaryId}${orderStatus ? `:${orderStatus}` : ''}`;
        }
        return `order:${primaryId}${orderStatus ? `:${orderStatus}` : ''}`;
    }

    const title = stripOwnerTitlePrefix(payload?.title || payload?.notification?.title || '');
    const body = sanitizeString(payload?.body || payload?.notification?.body || '');
    const link = resolveClickLink(payload, data);

    if (type || title || body) {
        return `msg:${type}:${title}:${body}:${link}`;
    }

    return null;
};

const toBase64Url = (input) =>
    Buffer.from(JSON.stringify(input))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

const normalizePrivateKey = (key) => String(key || '').replace(/\\n/g, '\n').trim();

const getServiceAccountFromEnv = () => {
    if (cachedServiceAccount) return cachedServiceAccount;

    const rawJson = sanitizeString(config.firebaseServiceAccount || process.env.FIREBASE_SERVICE_ACCOUNT);
    if (rawJson) {
        cachedServiceAccount = JSON.parse(rawJson);
        return cachedServiceAccount;
    }

    const pathValue = sanitizeString(config.firebaseServiceAccountPath || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (pathValue) {
        const filePath = resolve(process.cwd(), pathValue);
        if (existsSync(filePath)) {
            cachedServiceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
            return cachedServiceAccount;
        }
    }

    throw new Error('Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH.');
};

const getFirebaseProjectId = () => {
    const account = getServiceAccountFromEnv();
    const projectId =
        sanitizeString(config.firebaseProjectId) ||
        sanitizeString(account.project_id) ||
        sanitizeString(process.env.FIREBASE_PROJECT_ID);
    if (!projectId) {
        throw new Error('Firebase project ID is not configured.');
    }
    return projectId;
};

const getFirebaseAccessToken = async () => {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessTokenExpiryMs - now > 60_000) {
        return cachedAccessToken;
    }

    const account = getServiceAccountFromEnv();
    const privateKey = normalizePrivateKey(account.private_key);
    if (!account.client_email || !privateKey) {
        throw new Error('Firebase service account is missing client_email or private_key.');
    }

    const iat = Math.floor(now / 1000);
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: account.client_email,
        scope: FIREBASE_MESSAGING_SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat,
        exp
    };

    const jwtUnsigned = `${toBase64Url(header)}.${toBase64Url(payload)}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(jwtUnsigned);
    signer.end();
    const signature = signer.sign(privateKey, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const assertion = `${jwtUnsigned}.${signature}`;

    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
    });

    const response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Firebase OAuth token exchange failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    cachedAccessToken = json.access_token;
    cachedAccessTokenExpiryMs = now + ((Number(json.expires_in) || 3600) * 1000);
    return cachedAccessToken;
};

const normalizeDataMap = (data = {}) => {
    const result = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (value === undefined || value === null) continue;
        result[String(key)] = String(value);
    }
    return result;
};

const stripOwnerTitlePrefix = (title = '') =>
    sanitizeString(title)
        // `u`: these emoji are surrogate pairs; without it the class matches half of
        // any emoji sharing a lead surrogate (e.g. 🔔) and leaves a broken character.
        .replace(/^(?:👤|🏪|🛵|🛡️?)\s*/u, '')
        .replace(/^\[(User|Shop|Rider|Admin)\]\s*/i, '')
        .trim();

const resolveClickLink = (payload = {}, data = {}) => {
    const raw =
        sanitizeString(payload.link) ||
        sanitizeString(data.link) ||
        sanitizeString(data.targetUrl) ||
        sanitizeString(data.click_action) ||
        '/';
    return raw || '/';
};

const buildMessagePayload = (payload = {}, token, { platform } = {}) => {
    const notification = {
        title:
            stripOwnerTitlePrefix(payload.title || payload.notification?.title) ||
            'New notification',
        body: sanitizeString(payload.body || payload.notification?.body || '')
    };
    const clickLink = resolveClickLink(payload, payload.data || {});
    const data = normalizeDataMap({
        ...(payload.data || {}),
        // Always mirror title/body in data so native/web handlers can show tray UI if needed
        title: notification.title,
        body: notification.body,
        link: clickLink,
        click_action: clickLink,
        targetUrl: sanitizeString(payload.data?.targetUrl) || clickLink,
    });
    const image =
        sanitizeString(payload.icon || payload.notification?.image || payload.notification?.icon || data.image || data.imageUrl);

    // The web service worker cannot read admin settings, so the branded icon
    // travels in the data map. Left empty when nothing is configured, and the
    // client then falls back to its bundled icon.
    if (!data.icon) {
        const brandIcon = getCachedNotificationIcon();
        if (brandIcon) data.icon = brandIcon;
    }

    const eventKey = deriveEventKey(payload);
    const collapseRaw = sanitizeString(
        payload.collapseKey ||
        payload.tag ||
        payload.data?.tag ||
        payload.idempotencyKey ||
        payload.eventId ||
        payload.data?.eventId ||
        eventKey ||
        ''
    );
    const collapseKey = collapseRaw ? collapseRaw.replace(/[^a-zA-Z0-9-_.~%]/g, '_').slice(0, 64) : undefined;
    const tag = sanitizeString(payload.tag || payload.data?.tag || collapseKey || '');

    // Mirror a single stable dedup key into the data map so every client-side
    // renderer collapses to one notification. The web FCM SDK's foreground
    // `onMessage` and the service worker's own `push` relay both fire for the
    // same message when a tab is open; without a shared key in `data` their
    // dedup falls back to title/body and a race lets both render — one broadcast
    // shows up twice. `data.eventId`/`data.tag` are the first keys both the page
    // (buildOsNotificationDedupeKey) and the SW (getNotificationKey) check.
    if (eventKey && !data.eventId) data.eventId = eventKey;
    if (tag && !data.tag) data.tag = tag;

    // dataOnly: omit system notification blocks ONLY if caller explicitly requested silent background sync.
    // For killed/closed app delivery (Android/iOS), top-level `notification` block MUST be included.
    const message = { token };
    const isWeb = platform === 'web';
    const isDataOnly = payload.dataOnly === true;
    // Order alarm for an app that renders it itself: Android gets a data-only
    // message (its background handler runs even when the app is killed and
    // shows the looping alarm), while iOS still gets the alert below — iOS
    // never wakes a force-quit app for a data-only push, so only an alert with
    // a bundled sound can ring there.
    const isAndroidDataOnly = !isDataOnly && payload.androidDataOnly === true;
    const androidChannel = sanitizeString(payload.channelId) || 'high_importance_channel';

    // Web is deliberately data-only. When a web push carries a `notification`
    // block the FCM JS SDK renders an OS banner itself *and* still invokes the
    // app's onBackgroundMessage handler, which renders a second banner — one
    // event, two notifications on the device. Keeping web data-only leaves
    // rendering solely to firebase-messaging-sw.js, which reads the title/body
    // mirrored into `data` below.
    const includeNotificationBlock = !isDataOnly && !isWeb && !isAndroidDataOnly;

    if (includeNotificationBlock) {
        message.notification = { ...notification };
        if (image) {
            message.notification.image = image;
        }
    }

    if (Object.keys(data).length > 0) {
        message.data = data;
    }

    // `sound` may be a single name or per-platform ({ android, ios }): Android refers to
    // a raw resource without extension, iOS to a bundled file with one.
    const soundConfig = payload.sound && typeof payload.sound === 'object' ? payload.sound : null;
    const androidSound = sanitizeString(soundConfig ? soundConfig.android : payload.sound) || 'default';
    const iosSound = sanitizeString(soundConfig ? soundConfig.ios : payload.sound) || 'default';
    // Order alerts must be readable on the lock screen and break through iOS Focus.
    const isUrgent = payload.urgent === true;
    if (isUrgent) data.urgent = 'true';
    // Time-bound alerts (e.g. a rider offer) are pointless once expired, so callers may cap delivery.
    const ttlSeconds = Number(payload.ttlSeconds) > 0 ? Math.round(Number(payload.ttlSeconds)) : 86400;

    message.android = {
        priority: 'high',
        ttl: `${ttlSeconds}s`,
        ...(collapseKey ? { collapse_key: collapseKey } : {}),
        ...(isDataOnly || isAndroidDataOnly
            ? {}
            : {
                notification: {
                    channel_id: androidChannel,
                    sound: androidSound,
                    default_vibrate_timings: true,
                    default_light_settings: true,
                    notification_priority: isUrgent ? 'PRIORITY_MAX' : 'PRIORITY_HIGH',
                    ...(isUrgent ? { visibility: 'PUBLIC' } : {}),
                    ...(tag ? { tag } : {}),
                    ...(image ? { image } : {}),
                },
            }),
    };

    message.apns = {
        headers: {
            'apns-priority': '10',
            'apns-push-type': isDataOnly ? 'background' : 'alert',
            'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSeconds),
            ...(collapseKey ? { 'apns-collapse-id': collapseKey } : {}),
        },
        payload: {
            aps: isDataOnly
                ? {
                    'content-available': 1,
                }
                : {
                    alert: {
                        title: notification.title,
                        body: notification.body,
                    },
                    sound: iosSound,
                    badge: 1,
                    'content-available': 1,
                    'mutable-content': 1,
                    ...(isUrgent ? { 'interruption-level': 'time-sensitive' } : {}),
                },
        },
    };

    let webLink = clickLink;
    try {
        if (webLink.startsWith('/')) {
            const origin = sanitizeString(
                payload.webOrigin ||
                    process.env.FRONTEND_URL ||
                    process.env.CLIENT_URL ||
                    process.env.APP_URL ||
                    ''
            ).replace(/\/$/, '');
            if (origin) webLink = `${origin}${webLink}`;
        }
    } catch {
        // keep relative
    }

    message.webpush = {
        headers: {
            Urgency: 'high',
            TTL: String(ttlSeconds),
            ...(collapseKey ? { Topic: collapseKey.replace(/[^a-zA-Z0-9-_.~%]/g, '_').slice(0, 32) } : {}),
        },
        // No `notification` here on purpose — see includeNotificationBlock above.
        fcm_options: {
            link: webLink || '/',
        },
    };

    return message;
};

const parseFirebaseError = async (response) => {
    try {
        return await response.json();
    } catch {
        try {
            const text = await response.text();
            return { error: { message: text } };
        } catch {
            return { error: { message: 'Unknown Firebase error' } };
        }
    }
};

const shouldRemoveTokenFromError = (errorJson, response) => {
    const status = response?.status;
    const message = String(errorJson?.error?.message || '').toUpperCase();
    return status === 404 || message.includes('UNREGISTERED') || message.includes('INVALID_ARGUMENT');
};

const getOwnerModel = (ownerType) => OWNER_MODELS[String(ownerType || '').toUpperCase()] || null;

const getTokenFieldForPlatform = (platform) => OWNER_TOKEN_FIELDS[platform === 'mobile' ? 'mobile' : 'web'];

const normalizeTokenList = (tokens = []) => {
    const normalized = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).map(sanitizeString).filter(Boolean))];
    return normalized.slice(-10);
};

// pickLatestTokenOnly removed as we want to push to all active devices of a user

const readTokensFromDoc = (doc, platform) => {
    if (!doc) return [];
    if (platform) {
        return normalizeTokenList(doc[getTokenFieldForPlatform(platform)] || []);
    }
    return normalizeTokenList([
        ...(Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []),
        ...(Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : [])
    ]);
};

const supportsOrderAlarmTokens = (model) => Boolean(model?.schema?.path(ORDER_ALARM_TOKEN_FIELD));

const hasOrderAlarmCapability = (capabilities) =>
    Array.isArray(capabilities) &&
    capabilities.some((entry) => sanitizeString(entry).toLowerCase() === ORDER_ALARM_CAPABILITY);

/**
 * How order alarms reach Android: `auto` (default) sends data-only only to
 * tokens whose app declared the order_alarm capability, `data` forces it for
 * every mobile token, `notification` never uses it (the OS renders the push).
 */
const getOrderAlarmAndroidMode = () => {
    const mode = sanitizeString(process.env.PUSH_ORDER_ALARM_ANDROID_MODE).toLowerCase();
    return mode === 'data' || mode === 'notification' ? mode : 'auto';
};

const supportsVoipDevices = (model) => Boolean(model?.schema?.path(VOIP_DEVICES_FIELD));

const readVoipDevices = (doc) =>
    (Array.isArray(doc?.[VOIP_DEVICES_FIELD]) ? doc[VOIP_DEVICES_FIELD] : []).filter((device) => sanitizeString(device?.voipToken));

/**
 * Registers (or refreshes) one iPhone's VoIP token for an owner. The device is
 * matched by its VoIP token, its install id or its FCM token, so a rotated
 * token replaces the old entry instead of adding a second phone.
 */
export const upsertVoipDevice = async ({ ownerType, ownerId, voipToken, fcmToken, deviceId } = {}) => {
    const normalizedVoipToken = sanitizeString(voipToken);
    const normalizedFcmToken = sanitizeString(fcmToken);
    const normalizedDeviceId = sanitizeString(deviceId).slice(0, 200);
    if (!ownerType || !ownerId || !normalizedVoipToken) {
        throw new Error('ownerType, ownerId and voipToken are required.');
    }
    const model = getOwnerModel(ownerType);
    if (!supportsVoipDevices(model)) {
        throw new Error(`VoIP calls are not available for ${ownerType}.`);
    }
    if (!mongoose.Types.ObjectId.isValid(ownerId)) {
        throw new Error(`Invalid owner ID: ${ownerId}`);
    }

    const doc = await model.findById(ownerId);
    if (!doc) throw new Error('Owner profile not found.');

    const isSameDevice = (device) =>
        sanitizeString(device?.voipToken) === normalizedVoipToken ||
        (normalizedDeviceId && sanitizeString(device?.deviceId) === normalizedDeviceId) ||
        (normalizedFcmToken && sanitizeString(device?.fcmToken) === normalizedFcmToken);

    /*
     * FCM tokens this same physical install used before this registration.
     *
     * A PushKit token (and an install id) survives an FCM token rotation, so
     * when the device re-registers with a new fcmToken the one previously
     * stored against the SAME voipToken/deviceId is provably dead. Nothing
     * removed it before, so `fcmTokenMobile` kept every token the phone ever
     * had and each order push went out once per stale entry — five copies on
     * one handset. Matching on fcmToken is deliberately excluded here: that
     * means the token did not change, so there is nothing to supersede.
     */
    const supersededFcmTokens = normalizedFcmToken
        ? readVoipDevices(doc)
            .filter((device) => {
                const sameInstall =
                    sanitizeString(device?.voipToken) === normalizedVoipToken ||
                    (normalizedDeviceId && sanitizeString(device?.deviceId) === normalizedDeviceId);
                if (!sameInstall) return false;
                const previous = sanitizeString(device?.fcmToken);
                return previous && previous !== normalizedFcmToken;
            })
            .map((device) => sanitizeString(device.fcmToken))
        : [];

    const others = readVoipDevices(doc).filter((device) => !isSameDevice(device));
    doc[VOIP_DEVICES_FIELD] = [
        ...others,
        {
            voipToken: normalizedVoipToken,
            fcmToken: normalizedFcmToken,
            deviceId: normalizedDeviceId,
            lastSeenAt: new Date()
        }
    ].slice(-MAX_VOIP_DEVICES);

    if (supersededFcmTokens.length) {
        const isSuperseded = (token) => supersededFcmTokens.includes(sanitizeString(token));
        doc.fcmTokens = normalizeTokenList(
            (Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []).filter((t) => !isSuperseded(t))
        );
        doc.fcmTokenMobile = normalizeTokenList(
            (Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : []).filter((t) => !isSuperseded(t))
        );
        if (supportsOrderAlarmTokens(model)) {
            doc[ORDER_ALARM_TOKEN_FIELD] = (
                Array.isArray(doc[ORDER_ALARM_TOKEN_FIELD]) ? doc[ORDER_ALARM_TOKEN_FIELD] : []
            ).filter((t) => !isSuperseded(t));
        }
        logger.info(
            `[VoIP] ${ownerType}:${ownerId} dropped ${supersededFcmTokens.length} superseded FCM token(s) ` +
            `from the same install: ${supersededFcmTokens.map((t) => `...${t.slice(-8)}`).join(', ')}`
        );
    }

    await doc.save();

    // A VoIP token identifies one install, so it can ring for one account only
    // (same reasoning as the FCM detach in upsertFirebaseDeviceToken).
    let detachedFromOthers = 0;
    try {
        const results = await Promise.all(
            Object.entries(OWNER_MODELS)
                .filter(([, otherModel]) => supportsVoipDevices(otherModel))
                .map(([type, otherModel]) => {
                    const isSameOwner = String(type).toUpperCase() === String(ownerType).toUpperCase();
                    return otherModel.updateMany(
                        { ...(isSameOwner ? { _id: { $ne: doc._id } } : {}), [`${VOIP_DEVICES_FIELD}.voipToken`]: normalizedVoipToken },
                        { $pull: { [VOIP_DEVICES_FIELD]: { voipToken: normalizedVoipToken } } }
                    );
                })
        );
        detachedFromOthers = results.reduce((sum, r) => sum + (r?.modifiedCount || 0), 0);
    } catch (err) {
        logger.warn(`[VoIP] Failed to detach token from previous owners: ${err.message}`);
    }

    const voipConfigured = isVoipConfigured(ownerType);
    logger.info(
        `[VoIP] registered ${ownerType}:${ownerId} voipToken=...${normalizedVoipToken.slice(-8)} ` +
        `fcmToken=${normalizedFcmToken ? `...${normalizedFcmToken.slice(-8)}` : 'none'} deviceId=${normalizedDeviceId || 'none'} ` +
        `devicesNow=${doc[VOIP_DEVICES_FIELD].length} detachedFromOtherAccounts=${detachedFromOthers} ` +
        `voipConfigured=${voipConfigured}${voipConfigured ? '' : ' (calls will NOT ring until APNS_* env is set — see /fcm-tokens/voip/status)'}`
    );

    return { success: true, voipConfigured };
};

/** Removes an iPhone's VoIP registration by VoIP token, FCM token or install id. */
export const removeVoipDevice = async ({ ownerType, ownerId, voipToken, fcmToken, deviceId } = {}) => {
    const model = getOwnerModel(ownerType);
    if (!supportsVoipDevices(model) || !ownerId || !mongoose.Types.ObjectId.isValid(ownerId)) return { success: false };
    const matchers = [
        sanitizeString(voipToken) && { voipToken: sanitizeString(voipToken) },
        sanitizeString(fcmToken) && { fcmToken: sanitizeString(fcmToken) },
        sanitizeString(deviceId) && { deviceId: sanitizeString(deviceId) }
    ].filter(Boolean);
    if (!matchers.length) return { success: false };
    const result = await model.updateOne({ _id: ownerId }, { $pull: { [VOIP_DEVICES_FIELD]: { $or: matchers } } });
    logger.info(`[VoIP] unregistered ${ownerType}:${ownerId} matched=${JSON.stringify(matchers)} removed=${Boolean(result?.modifiedCount)}`);
    return { success: true };
};

/**
 * Places the VoIP call a payload asks for and returns the FCM tokens of the
 * iPhones the call now covers, so the caller holds back their regular push.
 *
 * `payload.voipCall` = { orderKey, ring, ringSeconds }:
 *  - ring true  → ring every registered iPhone of this owner.
 *  - ring false → a call placed earlier is still ringing; nothing new to do.
 * The regular push always goes out alongside the VoIP call (CallKit rings
 * the phone, the push puts the alert in the notification tray/lock screen) —
 * this function never suppresses it, on any outcome.
 * An iPhone whose call could not be placed keeps its regular push, and with
 * VoIP not configured nothing changes at all.
 */
const placeVoipCall = async ({ ownerType, ownerId, model, doc, payload }) => {
    // Always empty: kept as a Set (not removed outright) so callers that
    // still read it as "tokens to exclude" keep working with zero exclusions.
    const covered = new Set();
    const voipCall = payload?.voipCall;
    if (!voipCall || !supportsVoipDevices(model)) return covered;

    const callType = voipCall.callType || 'order';
    const devices = readVoipDevices(doc);
    if (!devices.length) {
        logger.info(`[VoIP] skip ${ownerType}:${ownerId} callType=${callType}: no iPhone registered for VoIP on this account`);
        return covered;
    }
    if (!isVoipConfigured(ownerType)) {
        logger.info(`[VoIP] skip ${ownerType}:${ownerId} callType=${callType}: VoIP not configured on server (${devices.length} iPhone(s) would otherwise ring) — falling back to regular push`);
        return covered;
    }

    if (!voipCall.ring) {
        logger.info(`[VoIP] ${ownerType}:${ownerId} callType=${callType}: call already ringing, regular push still sent as usual on ${devices.length} iPhone(s)`);
        return covered;
    }

    const orderKey = sanitizeString(voipCall.orderKey || payload?.data?.orderMongoId || payload?.data?.orderId);
    const callId = buildVoipCallId(ownerType, ownerId, orderKey);
    const eventKey = `voip:${deriveEventKey(payload) || callId}`;

    const toRing = [];
    for (const device of devices) {
        // A device that loses the claim was already rung for this event (retry,
        // second instance), so its call is live and there is nothing to send it.
        // Its regular push is NOT suppressed — that now always goes out too.
        if (await claimPushDispatch(device.voipToken, eventKey)) toRing.push(device);
    }
    if (!toRing.length) {
        logger.info(`[VoIP] ${ownerType}:${ownerId} callType=${callType} callId=${callId}: already ringing on all ${devices.length} iPhone(s), nothing new to send`);
        return covered;
    }

    const title = stripOwnerTitlePrefix(payload.title) || 'New order';
    const link = resolveClickLink(payload, payload.data || {});
    logger.info(
        `[VoIP] ringing ${ownerType}:${ownerId} callType=${callType} callId=${callId} orderKey=${orderKey || 'none'} ` +
        `iPhones=${toRing.length} ringSeconds=${voipCall.ringSeconds || '(default)'} title="${title}"`
    );
    let response;
    try {
        response = await sendVoipCall(
            toRing.map((device) => device.voipToken),
            {
                callId,
                title,
                body: sanitizeString(payload.body),
                link,
                ringSeconds: voipCall.ringSeconds,
                data: { ...(payload.data || {}), orderKey, callType }
            },
            { ownerType }
        );
    } catch (error) {
        logger.warn(`[VoIP] call FAILED ${ownerType}:${ownerId} callId=${callId}: ${error?.message || error} — falling back to regular push`);
        await Promise.all(toRing.map((device) => releasePushDispatch(device.voipToken, eventKey)));
        return covered;
    }

    const byToken = new Map(toRing.map((device) => [sanitizeString(device.voipToken), device]));
    const deadTokens = [];
    const fellBack = [];
    for (const result of response.results || []) {
        const device = byToken.get(result.token);
        if (!device) continue;
        if (!result.ok) {
            fellBack.push(`...${result.token.slice(-8)}: ${result.error || 'unknown error'}`);
            if (result.remove) deadTokens.push(result.token);
            else await releasePushDispatch(result.token, eventKey);
        }
    }
    logger.info(
        `[VoIP] call result ${ownerType}:${ownerId} callId=${callId}: ${response.successCount} ringing ` +
        `(regular push sent alongside as usual), ${response.failureCount} fell back to regular push only` +
        (fellBack.length ? ` (${fellBack.join('; ')})` : '')
    );
    if (deadTokens.length) {
        await model
            .updateOne({ _id: ownerId }, { $pull: { [VOIP_DEVICES_FIELD]: { voipToken: { $in: deadTokens } } } })
            .then(() => logger.info(`[VoIP] removed ${deadTokens.length} dead VoIP token(s) for ${ownerType}:${ownerId}`))
            .catch((err) => logger.warn(`[VoIP] Could not drop dead tokens for ${ownerType}:${ownerId}: ${err.message}`));
    }
    return covered;
};

/**
 * Ends the order call on these owners' iPhones (accepted, rejected, taken by
 * another rider, expired, cancelled). A VoIP push cannot be used for this —
 * iOS terminates an app that receives one without showing a call — so it goes
 * as a data-only push to the FCM token linked to each VoIP device.
 */
export const endVoipCallsSafely = async (targets = [], { orderKey, reason = 'resolved', data = {} } = {}) => {
    try {
        const normalizedOrderKey = sanitizeString(orderKey);
        if (!normalizedOrderKey) return;
        await Promise.all(
            (Array.isArray(targets) ? targets : []).map(async ({ ownerType, ownerId } = {}) => {
                const model = getOwnerModel(ownerType);
                if (!supportsVoipDevices(model) || !ownerId) return;
                if (!isVoipConfigured(ownerType)) return;
                const doc = await model.findById(ownerId).select(VOIP_DEVICES_FIELD).lean();
                const tokens = readVoipDevices(doc).map((device) => sanitizeString(device.fcmToken)).filter(Boolean);
                if (!tokens.length) return;
                const callId = buildVoipCallId(ownerType, String(ownerId), normalizedOrderKey);
                // Callers already send this once per resolution (claimed state changes),
                // and a re-offered order rings again under the same call id, so no dedup here.
                const endKey = `voip_end:${callId}:${reason}:${Date.now()}`;
                logger.info(`[VoIP] ending call ${ownerType}:${ownerId} callId=${callId} reason=${reason} orderKey=${normalizedOrderKey} iPhones=${tokens.length}`);
                await sendPushNotification(
                    tokens,
                    {
                        title: 'Call ended',
                        body: '',
                        dataOnly: true,
                        ttlSeconds: 120,
                        idempotencyKey: endKey,
                        data: {
                            ...data,
                            type: 'voip_call_end',
                            callId,
                            orderKey: normalizedOrderKey,
                            reason,
                            eventId: endKey
                        }
                    },
                    { platform: 'mobile' }
                );
            })
        );
    } catch (error) {
        logger.warn(`[VoIP] End-call push failed: ${error?.message || error}`);
    }
};

/** Rings this owner's registered iPhones with a test call (settings screen). */
export const sendTestVoipCall = async ({ ownerType, ownerId }) => {
    const model = getOwnerModel(ownerType);
    if (!supportsVoipDevices(model)) {
        logger.info(`[VoIP] test call skipped ${ownerType}:${ownerId}: VoIP not available for this owner type`);
        return { skipped: true, reason: `VoIP calls are not available for ${ownerType}.` };
    }
    if (!isVoipConfigured(ownerType)) {
        logger.info(`[VoIP] test call skipped ${ownerType}:${ownerId}: not configured on server`);
        return { skipped: true, reason: 'VoIP is not configured on the server (APNs key, team, key id or topic missing).' };
    }
    const doc = await model.findById(ownerId).select(VOIP_DEVICES_FIELD).lean();
    const tokens = readVoipDevices(doc).map((device) => device.voipToken);
    if (!tokens.length) {
        logger.info(`[VoIP] test call skipped ${ownerType}:${ownerId}: no iPhone registered`);
        return { skipped: true, reason: 'No iPhone has registered for VoIP calls on this account.' };
    }
    const testKey = `test-${Date.now()}`;
    const callId = buildVoipCallId(ownerType, String(ownerId), testKey);
    logger.info(`[VoIP] sending test call ${ownerType}:${ownerId} callId=${callId} iPhones=${tokens.length}`);
    const result = await sendVoipCall(
        tokens,
        {
            callId,
            title: 'Test order call',
            body: 'This is a test call from Eatiefy',
            link: ownerType === 'DELIVERY_PARTNER' ? '/food/delivery' : '/food/restaurant',
            ringSeconds: 30,
            data: { type: 'voip_test', orderKey: testKey, callType: 'test' }
        },
        { ownerType }
    );
    logger.info(`[VoIP] test call result ${ownerType}:${ownerId} callId=${callId}: success=${result.successCount} failure=${result.failureCount}`);
    return result;
};

/**
 * Everything the /fcm-tokens/voip/status endpoint and server logs need to
 * answer "is VoIP actually working" without guessing from scattered lines:
 * whether this account can place calls at all, and each registered iPhone
 * with when it last registered.
 */
export const getVoipDiagnostics = async ({ ownerType, ownerId }) => {
    const model = getOwnerModel(ownerType);
    const supported = supportsVoipDevices(model);
    const configured = isVoipConfigured(ownerType);
    const doc = supported && ownerId ? await model.findById(ownerId).select(VOIP_DEVICES_FIELD).lean() : null;
    const devices = readVoipDevices(doc).map((device) => ({
        voipToken: `...${sanitizeString(device.voipToken).slice(-8)}`,
        fcmToken: device.fcmToken ? `...${sanitizeString(device.fcmToken).slice(-8)}` : null,
        deviceId: device.deviceId || null,
        lastSeenAt: device.lastSeenAt || null
    }));
    return {
        ownerType,
        ownerId: ownerId ? String(ownerId) : null,
        supported,
        serverConfigured: configured,
        registeredDeviceCount: devices.length,
        devices,
        readyToRing: supported && configured && devices.length > 0,
        topic: supported ? getVoipTopic(ownerType) || null : null,
        environment: config.apnsProduction ? 'production' : 'sandbox'
    };
};

export const listOwnerTokens = async ({ ownerType, ownerId, platform }) => {
    if (!ownerType || !ownerId) return [];
    const model = getOwnerModel(ownerType);
    if (!model) return [];
    const doc = await model.findById(ownerId).select('fcmTokens fcmTokenMobile').lean();
    return readTokensFromDoc(doc, platform);
};

export const upsertFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform = 'web', capabilities }) => {
    try {
        const normalizedToken = sanitizeString(token);
        if (!ownerType || !ownerId || !normalizedToken) {
            throw new Error('ownerType, ownerId, and token are required.');
        }

        const normalizedPlatform = platform === 'mobile' ? 'mobile' : 'web';
        const model = getOwnerModel(ownerType);
        if (!model) {
            throw new Error(`Unsupported owner type: ${ownerType}`);
        }

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            throw new Error(`Invalid owner ID: ${ownerId}`);
        }

        const doc = await model.findById(ownerId);
        if (!doc) {
            throw new Error('Owner profile not found.');
        }

        const targetField = getTokenFieldForPlatform(normalizedPlatform);
        const otherField = getTokenFieldForPlatform(normalizedPlatform === 'mobile' ? 'web' : 'mobile');

        let isModified = false;

        // 1. Remove this token from the other platform array to prevent cross-contamination / duplicate notifications
        const otherTokens = Array.isArray(doc[otherField]) ? doc[otherField] : [];
        if (otherTokens.includes(normalizedToken)) {
            doc[otherField] = normalizeTokenList(otherTokens.filter((t) => t !== normalizedToken));
            isModified = true;
        }

        // 2. Add to target field if not already present
        const existingTokens = Array.isArray(doc[targetField]) ? doc[targetField] : [];
        if (!existingTokens.includes(normalizedToken)) {
            doc[targetField] = normalizeTokenList([...existingTokens, normalizedToken]);
            isModified = true;
        }

        // 2b. Whether this install renders order alarms itself. Only a
        // registration that states its capabilities changes it, so a login path
        // that sends just the token cannot downgrade the device.
        if (supportsOrderAlarmTokens(model)) {
            const alarmTokens = Array.isArray(doc[ORDER_ALARM_TOKEN_FIELD]) ? doc[ORDER_ALARM_TOKEN_FIELD] : [];
            const isAlarmToken = alarmTokens.includes(normalizedToken);
            const shouldBeAlarmToken =
                normalizedPlatform === 'mobile' &&
                (Array.isArray(capabilities) ? hasOrderAlarmCapability(capabilities) : isAlarmToken);
            if (shouldBeAlarmToken !== isAlarmToken) {
                doc[ORDER_ALARM_TOKEN_FIELD] = shouldBeAlarmToken
                    ? normalizeTokenList([...alarmTokens, normalizedToken])
                    : alarmTokens.filter((t) => t !== normalizedToken);
                isModified = true;
            }
        }

        if (isModified) {
            await doc.save();
        }

        /*
         * 3. Detach this token from every OTHER account.
         *
         * A device token identifies a device, not a person, so it can only
         * belong to one account at a time. Registering it here used to leave it
         * attached wherever it was registered before: rider A signs in on a
         * phone, signs out or is switched away, rider B signs in on the same
         * phone - and the token now sits on both records. Every push aimed at A
         * then rings on B's phone, showing B a request that is not theirs.
         * Logout already scrubbed the token, but only when the client got to
         * send it; a switch, a reinstall or a killed app never did.
         *
         * Runs after the save so a failure here can never cost the owner their
         * own token, and covers all four owner types because the same device
         * may have been a customer or a restaurant before.
         */
        try {
            await Promise.all(
                Object.entries(OWNER_MODELS).map(([type, otherModel]) => {
                    const isSameOwner = String(type).toUpperCase() === String(ownerType).toUpperCase();
                    const excludeSelf = isSameOwner ? { _id: { $ne: doc._id } } : {};
                    return otherModel.updateMany(
                        {
                            ...excludeSelf,
                            $or: [
                                { fcmTokens: normalizedToken },
                                { fcmTokenMobile: normalizedToken }
                            ]
                        },
                        {
                            $pull: {
                                fcmTokens: normalizedToken,
                                fcmTokenMobile: normalizedToken,
                                ...(supportsOrderAlarmTokens(otherModel) ? { [ORDER_ALARM_TOKEN_FIELD]: normalizedToken } : {})
                            }
                        }
                    );
                })
            );
        } catch (err) {
            logger.warn(`Failed to detach FCM token from previous owners: ${err.message}`);
        }

        return { success: true };
    } catch (error) {
        throw error;
    }
};

export const removeFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform }) => {
    const normalizedToken = sanitizeString(token);
    if (!ownerType || !ownerId || !normalizedToken) {
        throw new Error('ownerType, ownerId, and token are required.');
    }
    const model = getOwnerModel(ownerType);
    if (!model) {
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }
    const doc = await model.findById(ownerId);
    if (!doc) {
        return { success: false };
    }

    if (platform) {
        const field = getTokenFieldForPlatform(platform);
        doc[field] = normalizeTokenList((Array.isArray(doc[field]) ? doc[field] : []).filter((t) => t !== normalizedToken));
    } else {
        doc.fcmTokens = normalizeTokenList((Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []).filter((t) => t !== normalizedToken));
        doc.fcmTokenMobile = normalizeTokenList(
            (Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : []).filter((t) => t !== normalizedToken)
        );
    }
    if (supportsOrderAlarmTokens(model) && platform !== 'web') {
        doc[ORDER_ALARM_TOKEN_FIELD] = (Array.isArray(doc[ORDER_ALARM_TOKEN_FIELD]) ? doc[ORDER_ALARM_TOKEN_FIELD] : [])
            .filter((t) => t !== normalizedToken);
    }
    // Logout removes the FCM token; the same phone must stop ringing for calls too.
    if (supportsVoipDevices(model) && platform !== 'web') {
        doc[VOIP_DEVICES_FIELD] = readVoipDevices(doc).filter(
            (device) => sanitizeString(device.fcmToken) !== normalizedToken && sanitizeString(device.voipToken) !== normalizedToken
        );
    }

    await doc.save();
    return { success: true };
};

export const sendPushNotification = async (tokens, payload = {}, { platform } = {}) => {
    const projectId = getFirebaseProjectId();
    const accessToken = await getFirebaseAccessToken();
    const uniqueTokens = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).map(sanitizeString).filter(Boolean))];

    if (uniqueTokens.length === 0) {
        return { successCount: 0, failureCount: 0, results: [] };
    }

    const eventKey = deriveEventKey(payload);

    const results = await Promise.all(
        uniqueTokens.map(async (token) => {
            // Claim before sending so concurrent callers (or a second instance)
            // cannot both dispatch the same event to the same device.
            const claimed = await claimPushDispatch(token, eventKey);
            if (!claimed) {
                logger.info(`[FCM] Duplicate push skipped for token ${token.slice(0, 10)}... and eventKey: ${eventKey}`);
                return {
                    token,
                    ok: true,
                    skippedDuplicate: true
                };
            }

            const message = buildMessagePayload(payload, token, { platform });
            try {
                const response = await fetch(FCM_SEND_URL(projectId), {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message })
                });

                if (!response.ok) {
                    const errorJson = await parseFirebaseError(response);
                    const remove = shouldRemoveTokenFromError(errorJson, response);
                    const errorMessage = errorJson?.error?.message || `FCM send failed (${response.status})`;
                    logger.warn(
                        `[FCM] Send FAILED token=...${token.slice(-8)} platform=${platform || 'unknown'} ` +
                        `status=${response.status} remove=${remove} reason="${errorMessage}"`
                    );
                    // Nothing was delivered — free the claim so a retry can still
                    // deliver this event once (unless the token itself is dead).
                    if (!remove) await releasePushDispatch(token, eventKey);
                    return {
                        token,
                        ok: false,
                        remove,
                        error: errorMessage
                    };
                }

                const fcmResponse = await response.json();
                logger.info(
                    `[FCM] Send OK token=...${token.slice(-8)} platform=${platform || 'unknown'} ` +
                    `messageId=${fcmResponse?.name || 'unknown'}`
                );
                return {
                    token,
                    ok: true,
                    response: fcmResponse
                };
            } catch (error) {
                logger.warn(`[FCM] Send threw for token=...${token.slice(-8)}: ${error?.message || error}`);
                await releasePushDispatch(token, eventKey);
                return {
                    token,
                    ok: false,
                    remove: false,
                    error: error?.message || String(error)
                };
            }
        })
    );

    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    return { successCount, failureCount, results };
};

/**
 * Debug probe for one token: asks Firebase directly and reports its exact
 * answer. `validateOnly` checks the token/payload without delivering anything
 * (it cannot prove APNs delivery); otherwise a real push is sent. Bypasses the
 * dispatch idempotency claim on purpose so it can be repeated.
 */
export const probeFcmToken = async ({ token, platform = 'mobile', validateOnly = true, payload } = {}) => {
    const normalizedToken = sanitizeString(token);
    if (!normalizedToken) return { ok: false, error: 'empty token' };

    try {
        const projectId = getFirebaseProjectId();
        const accessToken = await getFirebaseAccessToken();
        const message = buildMessagePayload(
            payload || {
                title: 'Eatiefy push test',
                body: `Debug probe at ${new Date().toLocaleTimeString('en-IN')}`,
                eventId: `probe:${Date.now()}:${crypto.randomUUID()}`,
                data: { type: 'debug_probe' }
            },
            normalizedToken,
            { platform }
        );
        const response = await fetch(FCM_SEND_URL(projectId), {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ validate_only: Boolean(validateOnly), message })
        });
        if (response.ok) {
            const json = await response.json().catch(() => ({}));
            return { ok: true, status: response.status, messageId: json?.name || null, validateOnly: Boolean(validateOnly) };
        }
        const errorJson = await parseFirebaseError(response);
        const detailCodes = (errorJson?.error?.details || []).map((d) => d?.errorCode).filter(Boolean);
        return {
            ok: false,
            status: response.status,
            errorCode: detailCodes[0] || errorJson?.error?.status || null,
            error: errorJson?.error?.message || `FCM send failed (${response.status})`,
            validateOnly: Boolean(validateOnly)
        };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
};

/**
 * Order alarms split the mobile group by what each install can render:
 *  - `payload.orderAlarm`: alarm-capable tokens get the Android data-only
 *    variant, every other device keeps the regular push.
 *  - `payload.alarmTokensOnly` (e.g. "stop ringing"): alarm-capable tokens
 *    only — web and older builds would render a data-only message as a stray
 *    "New notification" banner.
 */
const splitOrderAlarmGroups = (groups, doc, payload) => {
    const isAlarm = payload?.orderAlarm === true;
    const isAlarmOnly = payload?.alarmTokensOnly === true;
    if (!isAlarm && !isAlarmOnly) return groups;

    const mode = getOrderAlarmAndroidMode();
    const declared = new Set(normalizeTokenList(doc?.[ORDER_ALARM_TOKEN_FIELD] || []));
    const isAlarmToken = (token) => mode === 'data' || (mode === 'auto' && declared.has(token));

    return groups.flatMap((group) => {
        if (group.platform !== 'mobile') return isAlarmOnly ? [] : [group];
        const alarmTokens = group.tokens.filter(isAlarmToken);
        if (isAlarmOnly) return [{ ...group, tokens: alarmTokens }];
        return [
            { ...group, payload: { ...group.payload, androidDataOnly: true }, tokens: alarmTokens },
            { ...group, tokens: group.tokens.filter((token) => !isAlarmToken(token)) }
        ];
    });
};

export const sendNotificationToOwner = async ({ ownerType, ownerId, payload, platform } = {}) => {
    // Clone payload so broadcast loops don't mutate a shared object
    const enrichedPayload = { ...payload };

    try {
        const model = getOwnerModel(ownerType);
        const alarmField = supportsOrderAlarmTokens(model) ? ` ${ORDER_ALARM_TOKEN_FIELD}` : '';
        const voipField = enrichedPayload.voipCall && supportsVoipDevices(model) ? ` ${VOIP_DEVICES_FIELD}` : '';
        const doc = model
            ? await model.findById(ownerId).select(`fcmTokens fcmTokenMobile${alarmField}${voipField}`).lean()
            : null;

        // Places the VoIP call (if applicable); the regular push below always
        // still goes out to the same iPhone alongside it (see placeVoipCall).
        const voipCoveredTokens = await placeVoipCall({ ownerType, ownerId, model, doc, payload: enrichedPayload });

        // Group tokens by their real platform. `platform` must be concrete when the
        // message is built: web pushes are data-only (the service worker renders
        // them), mobile pushes carry a notification block — sending one blended
        // batch would give web devices both renderers and duplicate the banner.
        const requestedPlatform = platform === 'mobile' || platform === 'web' ? platform : null;
        const groups = (requestedPlatform ? [requestedPlatform] : ['web', 'mobile']).map(
            (groupPlatform) => ({ platform: groupPlatform, tokens: readTokensFromDoc(doc, groupPlatform) })
        );

        // Deduplicate strictly across groups so no single device token is sent to twice.
        const seenTokens = new Set();
        const platformGroups = splitOrderAlarmGroups(
            groups.map(({ platform: groupPlatform, tokens }) => ({
                platform: groupPlatform,
                payload: enrichedPayload,
                tokens: tokens.filter((token) => {
                    if (seenTokens.has(token) || voipCoveredTokens.has(token)) return false;
                    seenTokens.add(token);
                    return true;
                })
            })),
            doc,
            enrichedPayload
        ).filter((group) => group.tokens.length > 0);

        if (!platformGroups.length && voipCoveredTokens.size > 0) {
            logger.info(`[FCM] ${ownerType}:${ownerId} alerted by VoIP call only (${voipCoveredTokens.size} iPhone(s))`);
            return { successCount: voipCoveredTokens.size, failureCount: 0, results: [] };
        }

        if (!platformGroups.length) {
            logger.warn(`[FCM] No device tokens for ${ownerType}:${ownerId} — push skipped`);
            return { successCount: 0, failureCount: 0, results: [] };
        }

        // One dispatch call per platform, each with deduplicated tokens.
        const groupResponses = await Promise.all(
            platformGroups.map((group) =>
                sendPushNotification(group.tokens, group.payload, { platform: group.platform })
            )
        );

        const response = groupResponses.reduce(
            (acc, item) => ({
                successCount: acc.successCount + (item.successCount || 0),
                failureCount: acc.failureCount + (item.failureCount || 0),
                results: acc.results.concat(item.results || [])
            }),
            { successCount: 0, failureCount: 0, results: [] }
        );

        // Clean up any stale or unregistered tokens across both web and mobile fields
        const invalidTokens = (response.results || [])
            .filter((item) => !item.ok && item.remove)
            .map((item) => item.token)
            .filter(Boolean);

        if (invalidTokens.length > 0) {
            logger.warn(
                `[FCM] Pruning ${invalidTokens.length} dead token(s) for ${ownerType}:${ownerId}: ` +
                invalidTokens.map((t) => `...${t.slice(-8)}`).join(', ')
            );
            const ownerDoc = model ? await model.findById(ownerId) : null;
            if (ownerDoc) {
                ownerDoc.fcmTokens = normalizeTokenList(
                    (Array.isArray(ownerDoc.fcmTokens) ? ownerDoc.fcmTokens : []).filter((t) => !invalidTokens.includes(t))
                );
                ownerDoc.fcmTokenMobile = normalizeTokenList(
                    (Array.isArray(ownerDoc.fcmTokenMobile) ? ownerDoc.fcmTokenMobile : []).filter((t) => !invalidTokens.includes(t))
                );
                if (supportsOrderAlarmTokens(model)) {
                    ownerDoc[ORDER_ALARM_TOKEN_FIELD] = (
                        Array.isArray(ownerDoc[ORDER_ALARM_TOKEN_FIELD]) ? ownerDoc[ORDER_ALARM_TOKEN_FIELD] : []
                    ).filter((t) => !invalidTokens.includes(t));
                }
                await ownerDoc.save();
            }
        }

        console.log(
            `[FCM] Sending to ${ownerType}:${ownerId}. Title: "${enrichedPayload.title || 'Data Only'}" success=${response.successCount} failure=${response.failureCount}`
        );
        logger.info(
            `FCM push sent to ${ownerType}:${ownerId} (${platform || 'all'}). Success=${response.successCount}, Failure=${response.failureCount}`
        );

        return response;
    } catch (error) {
        logger.warn(`FCM push failed for ${ownerType}:${ownerId}: ${error.message}`);
        return { successCount: 0, failureCount: 1, error: error.message };
    }
};

export const sendNotificationToOwners = async (targets = [], payload = {}) => {
    // 🔍 Deduplicate targets by ownerType:ownerId before sending
    // This prevents duplicate notifications if the same person is listed twice (e.g. as USER and partner)
    const uniqueTargets = Array.isArray(targets)
        ? [...new Map(targets.filter(t => t?.ownerType && t?.ownerId).map(t => [`${t.ownerType}:${t.ownerId}`, t])).values()]
        : [];

    const results = [];
    // Chunking to avoid overwhelming the event loop during large broadcasts
    const CHUNK_SIZE = 50;
    for (let i = 0; i < uniqueTargets.length; i += CHUNK_SIZE) {
        const chunk = uniqueTargets.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(
            chunk.map((target) =>
                sendNotificationToOwner({
                    ownerType: target.ownerType,
                    ownerId: target.ownerId,
                    platform: target.platform,
                    payload
                })
            )
        );
        results.push(...chunkResults);
    }
    return results;
};

/**
 * Ringtone for new order / delivery request pushes. The OS plays it (the app may be
 * closed or the screen locked), so it must name a sound bundled in the native app:
 * a res/raw resource on Android (no extension) and a bundled file on iOS. Unset
 * values fall back to the device default sound. Android 8+ also takes the sound
 * from the notification channel the app registered for `channelId`.
 */
export const getNewOrderAlertSound = () => ({
    android: sanitizeString(process.env.PUSH_NEW_ORDER_SOUND_ANDROID) || 'restaurant_alert',
    ios: sanitizeString(process.env.PUSH_NEW_ORDER_SOUND_IOS) || 'restaurant_alert.mp3',
});

export const notifyAdminsSafely = async (payload = {}) => {
    // Live copy for admin panels that are open right now. Sent first and
    // independent of FCM, so it still arrives with no push token / no Firebase.
    try {
        const data = payload?.data || {};
        const { emitToAdmins } = await import('../../config/socket.js');
        emitToAdmins('admin_live_notification', {
            id: sanitizeString(payload.idempotencyKey || payload.eventId || data.eventId || data.id) || `${Date.now()}`,
            title: stripOwnerTitlePrefix(payload.title || payload.notification?.title || '') || 'New notification',
            body: sanitizeString(payload.body || payload.notification?.body || ''),
            link: resolveClickLink(payload, data) !== '/' ? resolveClickLink(payload, data) : '',
            type: sanitizeString(data.type || ''),
            createdAt: new Date().toISOString()
        });
    } catch (e) {
        logger.warn(`Live admin notification emit failed: ${e.message}`);
    }

    try {
        const admins = await FoodAdmin.find({ isActive: true }).select('_id').lean();
        if (!admins.length) return [];

        const targets = admins.map(a => ({
            ownerType: 'ADMIN',
            ownerId: String(a._id)
        }));

        return await sendNotificationToOwners(targets, payload);
    } catch (e) {
        logger.error(`Error notifying admins: ${e.message}`);
        return [];
    }
};

export const sendTestNotification = async ({ ownerType, ownerId, platform }) => {
    // Each test send is a deliberate, one-off manual action, not a retried
    // business event, so it must bypass the (token, eventKey) dedup guard —
    // otherwise every click after the first within 24h is silently dropped
    // because the payload is otherwise identical every time.
    return sendNotificationToOwner({
        ownerType,
        ownerId,
        platform,
        payload: {
            title: 'Test Notification',
            body: 'This is a test notification from Firebase push',
            eventId: `test:${Date.now()}:${crypto.randomUUID()}`,
            data: {
                type: 'test',
                link: '/'
            }
        }
    });
};
export const notifyOwnerSafely = async (target = {}, payload = {}) => {
    try {
        return await sendNotificationToOwner({ ...target, payload });
    } catch (error) {
        logger.warn(`FCM individual push failed: ${error.message}`);
        return null;
    }
};

export const notifyOwnersSafely = async (targets = [], payload = {}) => {
    try {
        return await sendNotificationToOwners(targets, payload);
    } catch (error) {
        logger.warn(`FCM broadcast push failed: ${error.message}`);
        return [];
    }
};

export const broadcastPushToTargetsSafely = async (targets = [], payload = {}) => {
    try {
        logger.info(`[FCM Broadcast] Starting bulk push to ${targets.length} targets`);
        const uniqueTargets = Array.isArray(targets)
            ? [...new Map(targets.filter(t => t?.ownerType && t?.ownerId).map(t => [`${t.ownerType}:${t.ownerId}`, t])).values()]
            : [];

        const byType = { USER: [], RESTAURANT: [], DELIVERY_PARTNER: [], ADMIN: [] };
        uniqueTargets.forEach(t => {
            const type = t.ownerType?.toUpperCase();
            if (byType[type]) byType[type].push(t.ownerId);
        });

        // Tokens stay grouped by platform: web must be dispatched data-only so the
        // service worker is the single renderer (see buildMessagePayload).
        const tokensByPlatform = { web: [], mobile: [] };

        // 1. Bulk fetch all tokens to avoid N+1 DB queries
        let ownersWithoutMobileTokens = 0;
        let ownersWithMobileTokens = 0;
        for (const [type, ids] of Object.entries(byType)) {
            if (!ids.length) continue;
            const model = getOwnerModel(type);
            if (!model) continue;

            // Process DB fetches in chunks to avoid massive $in array limits
            const DB_CHUNK = 1000;
            for (let i = 0; i < ids.length; i += DB_CHUNK) {
                const chunkIds = ids.slice(i, i + DB_CHUNK);
                const docs = await model.find({ _id: { $in: chunkIds } }).select('fcmTokens fcmTokenMobile').lean();
                for (const doc of docs) {
                    const webTokens = readTokensFromDoc(doc, 'web');
                    const mobileTokens = readTokensFromDoc(doc, 'mobile');
                    if (mobileTokens.length > 0) ownersWithMobileTokens++;
                    else ownersWithoutMobileTokens++;
                    tokensByPlatform.web.push(...webTokens);
                    tokensByPlatform.mobile.push(...mobileTokens);
                }
            }
        }

        logger.info(
            `[FCM Broadcast] Token fetch done: webTokens=${tokensByPlatform.web.length} mobileTokens=${tokensByPlatform.mobile.length} ` +
            `ownersWithMobile=${ownersWithMobileTokens} ownersWithoutMobile=${ownersWithoutMobileTokens}`
        );

        // Deduplicate globally so one device token is never sent to twice.
        const seenTokens = new Set();
        const dispatchGroups = ['web', 'mobile'].map((groupPlatform) => ({
            platform: groupPlatform,
            tokens: tokensByPlatform[groupPlatform].filter((token) => {
                if (!token || seenTokens.has(token)) return false;
                seenTokens.add(token);
                return true;
            })
        }));

        logger.info(
            `[FCM Broadcast] After dedup: ${seenTokens.size} unique tokens ` +
            `(web=${dispatchGroups[0].tokens.length}, mobile=${dispatchGroups[1].tokens.length}). Dispatching to Firebase...`
        );

        // 2. Dispatch to FCM in controlled chunks
        // Firebase HTTP v1 limits: we do 50 concurrent fetch requests to avoid socket hang ups.
        const CHUNK_SIZE = 50;
        let successCount = 0;
        let failureCount = 0;
        const deadTokens = [];

        for (const group of dispatchGroups) {
            for (let i = 0; i < group.tokens.length; i += CHUNK_SIZE) {
                const chunk = group.tokens.slice(i, i + CHUNK_SIZE);
                const res = await sendPushNotification(chunk, payload, { platform: group.platform });
                successCount += res.successCount || 0;
                failureCount += res.failureCount || 0;

                for (const r of (res.results || [])) {
                    if (!r.ok && r.remove && r.token) deadTokens.push(r.token);
                    if (!r.ok && !r.skippedDuplicate) {
                        logger.warn(
                            `[FCM Broadcast] FAILED token=...${r.token?.slice(-8)} platform=${group.platform} ` +
                            `remove=${r.remove} error="${r.error}"`
                        );
                    }
                }

                // Artificial delay to prevent overwhelming network interfaces on huge broadcasts
                if (i + CHUNK_SIZE < group.tokens.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        }

        // Prune dead/unregistered tokens so future broadcasts skip them.
        if (deadTokens.length > 0) {
            logger.info(`[FCM Broadcast] Pruning ${deadTokens.length} dead token(s)`);
            try {
                const pullOp = { $pull: { fcmTokens: { $in: deadTokens }, fcmTokenMobile: { $in: deadTokens } } };
                await Promise.all(
                    Object.values(OWNER_MODELS).map((m) => m.updateMany(
                        { $or: [{ fcmTokens: { $in: deadTokens } }, { fcmTokenMobile: { $in: deadTokens } }] },
                        pullOp
                    ))
                );
            } catch (pruneErr) {
                logger.warn(`[FCM Broadcast] Dead-token prune failed: ${pruneErr.message}`);
            }
        }

        logger.info(`[FCM Broadcast] Completed. Success=${successCount}, Failure=${failureCount}, DeadTokensPruned=${deadTokens.length}`);
        return { successCount, failureCount };
    } catch (error) {
        logger.error(`[FCM Broadcast] Critical failure during bulk push: ${error.message}`);
        return { successCount: 0, failureCount: 0, error: error.message };
    }
};
