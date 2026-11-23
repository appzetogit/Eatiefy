import { toast } from "sonner";
import { getCachedSettings, getModuleFaviconUrl } from "@food/utils/businessSettings";
import { getRestaurantPushRingRefusal, logRefusedRing } from "@food/utils/restaurantAlertSession";
import { getDeliveryPushRingRefusal } from "@food/utils/deliveryAlertSession";
import { showNotificationToast } from "@/shared/utils/customToasts";
import { userAPI, restaurantAPI, deliveryAPI, adminAPI } from "@food/api";
import { initializeApp, getApp, getApps } from "firebase/app";
const fallbackNotificationSound = "/assets/media/alert.mp3";

const pushNotificationSoundPath = "/assets/media/zomato_sms.mp3";
const restaurantAlertSoundPath = "/assets/media/restaurant_alert.mp3";

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
  messagingSenderId: "",
};

const tokenCachePrefix = "fcm_web_registered_token_";
const fcmBackendSyncedPrefix = "fcm_backend_synced_";
const fcmBackendSyncedCapabilitiesPrefix = "fcm_backend_synced_caps_";
const nativeCapabilitiesPrefix = "fcm_native_capabilities_";
const pushSoundEnabledStorageKey = "push_sound_enabled";
let publicEnvPromise = null;
let foregroundListenerAttached = false;
let registrationInFlight = null;
let serviceWorkerMessageListenerAttached = false;
const MESSAGING_APP_NAME = "web-push-app";
const recentForegroundNotifications = new Map();
let pushSoundAudio = null;
let pushSoundUnlocked = false;
let pushSoundContext = null;
/** Active HTMLAudioElements from playPushSound — stopped when a non-order push arrives. */
let activePushPlaybackAudios = [];
const PUSH_DEBUG_PREFIX = "[push-debug]";
const notificationDedupWindowMs = 30000;
const OS_NOTIFICATION_DEDUP_STORAGE_KEY = "os_notification_dedup_v1";
const pushDebugLog = (prefix, message, data = {}) => {
  if (typeof window !== "undefined" && localStorage.getItem("push_debug") === "true") {
    console.log(`${prefix} ${message}`, data);
  }
};
const pushDebugWarn = (prefix, message, data = {}) => {
  if (typeof window !== "undefined" && localStorage.getItem("push_debug") === "true") {
    console.warn(`${prefix} ${message}`, data);
  }
};

function normalizeModuleFromPath(pathname = window.location.pathname) {
  if (pathname.includes("/restaurant") && !pathname.includes("/restaurants")) return "restaurant";
  if (pathname.includes("/delivery")) return "delivery";
  if (pathname.includes("/admin")) return "admin";
  return "user";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPushSoundSources(moduleName = normalizeModuleFromPath()) {
  if (moduleName === "restaurant") {
    return [restaurantAlertSoundPath];
  }
  if (moduleName === "delivery") {
    return [restaurantAlertSoundPath, fallbackNotificationSound];
  }
  // User module: no audio alerts on push notifications/status updates
  return [];
}

/** Incoming order alerts only — never play for approval/status/broadcast pushes. */
const ORDER_ALERT_PUSH_TYPES = new Set([
  "new_order",
  "new_order_available",
]);

/** Where each app keeps the orders its rider/restaurant muted from the order popup. */
const MUTED_ORDER_IDS_STORAGE_KEYS = {
  restaurant: "restaurant_muted_order_ids",
  delivery: "delivery_muted_order_ids",
};

/**
 * True when the order this push is about was muted in the app. A push often
 * lands after the socket event; for a muted order it used to play its own copy
 * of the ringtone anyway, so muting seemed to start a second ring.
 */
function isPushOrderMuted(moduleName, data = {}) {
  const storageKey = MUTED_ORDER_IDS_STORAGE_KEYS[moduleName];
  if (!storageKey || typeof localStorage === "undefined") return false;
  try {
    const muted = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(muted) || muted.length === 0) return false;
    const mutedIds = new Set(muted.map((id) => String(id || "").trim()).filter(Boolean));
    return [data.orderMongoId, data.orderId, data.order_id, data._id]
      .map((id) => String(id || "").trim())
      .some((id) => id && mutedIds.has(id));
  } catch {
    return false;
  }
}

function shouldPlayAlertSoundForPush(payload = {}) {
  const moduleName = normalizeModuleFromPath();
  if (moduleName !== "restaurant" && moduleName !== "delivery") {
    return false;
  }

  const data = payload?.data || {};
  const type = String(data.type || data.notificationType || "").toLowerCase();
  if (!ORDER_ALERT_PUSH_TYPES.has(type)) return false;
  if (isPushOrderMuted(moduleName, data)) return false;

  if (moduleName === "restaurant") {
    const refusal = getRestaurantPushRingRefusal(data);
    if (refusal) {
      logRefusedRing("push", refusal, {
        orderId: data.orderMongoId || data.orderId || null,
        restaurantId: data.restaurantId || null,
      });
      return false;
    }
  }

  if (moduleName === "delivery") {
    const refusal = getDeliveryPushRingRefusal(data);
    if (refusal) {
      pushDebugLog(PUSH_DEBUG_PREFIX, `Skipping delivery push sound (${refusal})`, {
        orderId: data.orderMongoId || data.orderId || null,
      });
      return false;
    }
  }
  return true;
}

/** Bundled Eatiefy icon — regenerate with `npm run build:favicon`. */
export const NOTIFICATION_ICON_PATH = "/assets/images/favicon.png";

/**
 * Notification icon for the module currently in use.
 *
 * Prefers the favicon an admin uploaded in Business Settings so push icons
 * follow the configured brand, and falls back to the bundled icon when nothing
 * is configured or the settings cache is cold.
 */
export function getNotificationIcon(moduleName) {
  try {
    const settings = getCachedSettings?.();
    if (settings) {
      const url = getModuleFaviconUrl(moduleName || normalizeModuleFromPath());
      // Only trust an absolute/admin-served URL; the local fallbacks are webp
      // logos that are not shaped for a notification badge.
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  } catch {
    /* fall through to the bundled icon */
  }
  return NOTIFICATION_ICON_PATH;
}

function isSupportedBrowser() {
  if (typeof window === "undefined") return false;

  // iOS check (Web Push is only supported on iOS Safari/Chrome if added to the Home Screen)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone) {
      return false;
    }
  }

  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Why the last native token lookup came back empty, per bridge handler name. */
let lastNativeTokenFailure = null;
/** What the app's notification-permission handler answered (or that none exists). */
let lastNativePermission = null;

function describePermissionValue(raw) {
  if (raw === undefined) return "undefined";
  if (raw === null) return "null";
  if (typeof raw === "string") return raw.slice(0, 40);
  try {
    return JSON.stringify(raw).slice(0, 60);
  } catch {
    return typeof raw;
  }
}

function describeBridgeValue(raw) {
  if (raw === undefined) return "undefined";
  if (raw === null) return "null";
  if (typeof raw === "string") return raw ? `string(len=${raw.length})` : "empty-string";
  try {
    return `${typeof raw}:${JSON.stringify(raw).slice(0, 60)}`;
  } catch {
    return typeof raw;
  }
}

/**
 * The iPhone app never handed the web layer a token, so nothing can be saved
 * and pushes have nowhere to go. The client's own console never reaches us, so
 * tell the server once per session what the bridge actually said.
 */
async function reportNativeTokenFailure(moduleName, tokenFound = false) {
  try {
    const key = `fcm_native_failure_reported_${moduleName}_${tokenFound ? "ok" : "missing"}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    const apiClient = (await import("@food/api")).default;
    await apiClient.post(
      "/fcm-tokens/client-diagnostic",
      {
        module: moduleName,
        tokenFound,
        permission: lastNativePermission,
        env: {
          flutter: isFlutterWebView(),
          standalone: Boolean(
            window.navigator.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches,
          ),
          notificationApi: typeof Notification !== "undefined",
          webPermission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
          serviceWorker: "serviceWorker" in navigator,
        },
        handlers: lastNativeTokenFailure || {},
        hasCallHandler: Boolean(window.flutter_inappwebview?.callHandler),
        userAgent: String(navigator.userAgent || "").slice(0, 200),
      },
      { contextModule: moduleName },
    );
  } catch {
    // diagnostics only
  }
}

function isFlutterWebView() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.flutter_inappwebview) &&
    typeof window.flutter_inappwebview.callHandler === "function"
  );
}

const FCM_BRIDGE_HANDLER_NAMES = [
  "getFcmToken",
  "getFCMToken",
  "getPushToken",
  "getFirebaseToken",
];

const FCM_PERMISSION_HANDLER_NAMES = [
  "requestNotificationPermission",
  "requestPushPermission",
  "enableNotifications",
];

export function normalizeFcmBridgeToken(raw) {
  if (raw == null) return "";

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length >= 20 ? trimmed : "";
  }

  if (typeof raw === "object") {
    const candidates = [
      raw.token,
      raw.fcmToken,
      raw.fcm_token,
      raw.deviceToken,
      raw.pushToken,
      raw.value,
      raw.data,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeFcmBridgeToken(candidate);
      if (normalized) return normalized;
    }
  }

  return "";
}

/**
 * What the native app build says it can do, sent with its token. A build that
 * renders order alarms itself returns `{ token, capabilities: ["order_alarm"] }`
 * from getFcmToken; older builds return a bare token and send nothing here.
 */
function rememberNativeCapabilities(moduleName, raw) {
  try {
    const capabilities =
      raw && typeof raw === "object" && Array.isArray(raw.capabilities)
        ? raw.capabilities.map((entry) => String(entry || "").trim()).filter(Boolean)
        : null;
    if (capabilities) {
      localStorage.setItem(`${nativeCapabilitiesPrefix}${moduleName}`, JSON.stringify(capabilities));
    } else {
      localStorage.removeItem(`${nativeCapabilitiesPrefix}${moduleName}`);
    }
  } catch {
    // storage unavailable — the token still syncs without capabilities
  }
}

function readNativeCapabilities(moduleName) {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${nativeCapabilitiesPrefix}${moduleName}`) || "null");
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Login, OTP and the route-change registration all ask for a token within the
// same few seconds. Each one re-asking for notification permission (and, on a
// first install, each starting its own token polling loop) piles bridge calls
// onto the iOS main thread while the user is typing. Share one in-flight ask
// per module, and don't ask again once the app has answered.
const nativePermissionRequests = new Map();
const nativePermissionAnswered = new Set();

function requestNativeNotificationPermission(moduleName) {
  if (!isFlutterWebView()) return Promise.resolve(false);
  if (nativePermissionAnswered.has(moduleName)) return Promise.resolve(true);

  const inFlight = nativePermissionRequests.get(moduleName);
  if (inFlight) return inFlight;

  const request = (async () => {
    const attempts = {};
    for (const handlerName of FCM_PERMISSION_HANDLER_NAMES) {
      try {
        const raw = await window.flutter_inappwebview.callHandler(handlerName, { module: moduleName });
        lastNativePermission = { handler: handlerName, result: describePermissionValue(raw) };
        nativePermissionAnswered.add(moduleName);
        return true;
      } catch (error) {
        attempts[handlerName] = `threw ${String(error?.message || error).slice(0, 80)}`;
      }
    }
    lastNativePermission = { handler: null, attempts };
    return false;
  })().finally(() => {
    nativePermissionRequests.delete(moduleName);
  });

  nativePermissionRequests.set(moduleName, request);
  return request;
}

/** True when running inside the Flutter InAppWebView shell (no browser Allow popup). */
export function isNativeAppWebView() {
  return isFlutterWebView();
}

export const FCM_FAST_OPTIONS = { maxAttempts: 5, delayMs: 200 };
export const FCM_COLLECT_TIMEOUT_MS = 2000;
export const FCM_SUBMIT_COLLECT_TIMEOUT_MS = 6000;

let fcmVisibilityListenerAttached = false;

/**
 * Collect FCM token quickly (max ~2 seconds) for signup/login flows.
 * Pass skipCache: true when syncing to server so rotated tokens are picked up.
 */
export async function collectFcmTokenFast(moduleName, options = {}) {
  const fastOptions = { ...FCM_FAST_OPTIONS, ...options };
  const skipCache = options.skipCache === true;

  if (!skipCache) {
    const cached = getSavedToken(moduleName);
    if (cached.length >= 20) {
      return {
        fcmToken: cached,
        platform: isFlutterWebView() ? "mobile" : "web",
      };
    }
  }

  const collectTimeoutMs = options.collectTimeoutMs ?? FCM_COLLECT_TIMEOUT_MS;

  const result = await Promise.race([
    collectNativeFcmToken(moduleName, { ...fastOptions, ...options }),
    sleep(collectTimeoutMs).then(() => ({
      fcmToken: normalizeFcmBridgeToken(getSavedToken(moduleName)) || null,
      platform: isFlutterWebView() ? "mobile" : "web",
    })),
  ]);

  if (result.fcmToken) {
    setSavedToken(moduleName, result.fcmToken);
  }

  return result;
}

/**
 * Same as collectFcmTokenFast, but also reads the iPhone's VoIP token (if any)
 * so a login call can register for order calls in the same round trip,
 * instead of waiting for the next regular token sync to pick it up. Only
 * meaningful for "restaurant" and "delivery" on a mobile (Flutter) platform —
 * everywhere else `voipToken` comes back empty, same as before this existed.
 */
export async function collectFcmTokenWithVoip(moduleName, options = {}) {
  const fcmResult = await collectFcmTokenFast(moduleName, options);
  if (fcmResult.platform !== "mobile" || !VOIP_MODULES.has(moduleName)) {
    return { ...fcmResult, voipToken: "", voipSkipReason: null };
  }
  const { token: voipToken, reason: voipSkipReason } = await readNativeVoipToken(moduleName);
  return { ...fcmResult, voipToken, voipSkipReason };
}

/**
 * Signup finish / complete — same flow that worked for delivery (commit 5f54105).
 * 1) collectFcmTokenFast on button click (+ retry)
 * 2) token sent in register API
 * 3) finalize* → syncPendingPartnerFcmQuick saves again in background
 */
export async function collectFcmTokenForSignup(moduleName) {
  if (isFlutterWebView()) {
    await requestNativeNotificationPermission(moduleName);
    const result = await collectNativeFcmToken(moduleName, { maxAttempts: 10, delayMs: 400 });
    if (result.fcmToken) {
      setSavedToken(moduleName, result.fcmToken);
    }
    return { fcmToken: result.fcmToken || null, platform: "mobile" };
  }

  let fcmToken = null;
  let platform = "web";
  try {
    const collected = await collectFcmTokenFast(moduleName);
    fcmToken = collected.fcmToken;
    platform = collected.platform;
    if (!fcmToken) {
      const retry = await collectFcmTokenFast(moduleName, { maxAttempts: 8, delayMs: 250 });
      fcmToken = retry.fcmToken;
      platform = retry.platform;
    }
  } catch {
    // Non-blocking — pending-save will retry on verification screen.
  }
  if (fcmToken) {
    setSavedToken(moduleName, fcmToken);
  }
  return { fcmToken, platform };
}

/** @deprecated Use collectFcmTokenForSignup */
export async function collectFcmTokenOnSignupSubmit(moduleName) {
  return collectFcmTokenForSignup(moduleName);
}

/**
 * Flutter shell: sync native FCM token after registration (no browser UI).
 */
export async function syncNativeAppPushToken(moduleName, phone) {
  if (!isFlutterWebView() || !phone) return false;
  await requestNativeNotificationPermission(moduleName);
  const { fcmToken, platform } = await collectNativeFcmToken(moduleName, {
    maxAttempts: 10,
    delayMs: 400,
  });
  if (!fcmToken) return false;
  setSavedToken(moduleName, fcmToken);
  return persistPendingModuleFcmToken(moduleName, phone, {
    fcmToken,
    platform: platform || "mobile",
    requestPermission: false,
    maxAttempts: 3,
  });
}

/**
 * Onboarding submit fallback — cached token only (prefer collectFcmTokenOnSignupSubmit).
 */
export function getCachedFcmTokenForSubmit(moduleName) {
  const cached = normalizeFcmBridgeToken(getSavedToken(moduleName));
  return {
    fcmToken: cached || null,
    platform: isFlutterWebView() ? "mobile" : "web",
  };
}

/**
 * Collect FCM token from Flutter WebView (iPhone app) or web cache.
 * Retries because the native bridge is often not ready on first call.
 */
const nativeTokenLookups = new Map();

async function pollNativeFcmToken(moduleName, maxAttempts, delayMs) {
  await requestNativeNotificationPermission(moduleName);

  const failures = {};
  // Handler names are only aliases for older builds. A name that threw on the
  // first pass isn't registered in this build, so don't keep calling it across
  // the bridge on every retry — a first install retries for several seconds.
  let handlerNames = FCM_BRIDGE_HANDLER_NAMES;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const usable = [];
    for (const handlerName of handlerNames) {
      try {
        const raw = await window.flutter_inappwebview.callHandler(handlerName, {
          module: moduleName,
        });
        usable.push(handlerName);
        const token = normalizeFcmBridgeToken(raw);
        if (token) {
          rememberNativeCapabilities(moduleName, raw);
          setSavedToken(moduleName, token);
          lastNativeTokenFailure = null;
          return { fcmToken: token, platform: "mobile" };
        }
        failures[handlerName] = `returned ${describeBridgeValue(raw)}`;
      } catch (error) {
        failures[handlerName] = `threw ${String(error?.message || error).slice(0, 80)}`;
      }
    }
    if (usable.length > 0) handlerNames = usable;

    if (attempt < maxAttempts - 1) {
      await sleep(delayMs);
    }
  }
  lastNativeTokenFailure = failures;

  const cached = getSavedToken(moduleName);
  if (cached && cached.length >= 20) {
    return { fcmToken: cached, platform: "mobile" };
  }

  return { fcmToken: null, platform: "mobile" };
}

export async function collectNativeFcmToken(moduleName, options = {}) {
  const maxAttempts = options.maxAttempts ?? 8;
  const delayMs = options.delayMs ?? 400;
  let platform = "web";

  if (isFlutterWebView()) {
    // collectFcmTokenFast stops *waiting* after its timeout but cannot stop this
    // loop, so the route-change registration, the login submit and the OTP verify
    // each left their own loop running on a fresh install (token not ready yet).
    // Join the lookup already in flight instead of starting another.
    const inFlight = nativeTokenLookups.get(moduleName);
    if (inFlight) return inFlight;

    const lookup = pollNativeFcmToken(moduleName, maxAttempts, delayMs).finally(() => {
      nativeTokenLookups.delete(moduleName);
    });
    nativeTokenLookups.set(moduleName, lookup);
    return lookup;
  }

  const skipCache = options.skipCache === true;
  if (!skipCache) {
    const webCached = localStorage.getItem(`${tokenCachePrefix}${moduleName}`) || "";
    if (webCached.length >= 20) {
      return { fcmToken: webCached, platform };
    }
  }

  const resolved = await resolveWebFcmToken(moduleName, options);
  return {
    fcmToken: resolved,
    platform,
  };
}

/** @deprecated Use collectFcmTokenFast("restaurant") — kept for older bundles */
export function collectRestaurantFcmToken(options = {}) {
  return collectFcmTokenFast("restaurant", options);
}

/** @deprecated Use collectFcmTokenFast("delivery") — kept for older bundles */
export function collectDeliveryFcmToken(options = {}) {
  return collectFcmTokenFast("delivery", options);
}

/**
 * Save FCM token to backend when the user is logged in.
 */
export async function persistModuleFcmToken(moduleName, options = {}) {
  let fcmToken = options.fcmToken || null;
  let platform = options.platform || (isFlutterWebView() ? "mobile" : "web");

  if (!fcmToken) {
    const collected = await collectFcmTokenFast(moduleName, options);
    fcmToken = collected.fcmToken;
    platform = collected.platform;
  }

  if (!fcmToken) {
    // Phones report even when the Flutter bridge is not detected: a phone that
    // says "bridge missing" is a different problem from one that never ran this build.
    const isPhone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
    if ((isFlutterWebView() || isPhone) && localStorage.getItem(`${moduleName}_accessToken`)) {
      void reportNativeTokenFailure(moduleName);
    }
    return false;
  }

  setSavedToken(moduleName, fcmToken);

  const accessToken = localStorage.getItem(`${moduleName}_accessToken`);
  if (!accessToken) {
    pushDebugLog(PUSH_DEBUG_PREFIX, "FCM token cached locally; no auth session to sync yet", {
      moduleName,
    });
    return false;
  }

  try {
    await saveTokenByModule(moduleName, fcmToken, platform);
    pushDebugLog(PUSH_DEBUG_PREFIX, "FCM token synced to backend", { moduleName, platform });
    // A saved token does not mean iOS will show anything: report what the app
    // said about notification permission so the admin Push Debug tool can show it.
    if (isFlutterWebView()) void reportNativeTokenFailure(moduleName, true);
    return true;
  } catch (error) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "Failed to sync FCM token to backend", {
      moduleName,
      error: error?.message || error,
    });
    return false;
  }
}

/**
 * Save FCM for pending partners using phone (no login required).
 * Requires an existing restaurant/delivery record in DB (post-registration or pending OTP login).
 */
export async function persistPendingModuleFcmToken(moduleName, phone, options = {}) {
  const hasKnownToken = Boolean(options.fcmToken);
  const maxAttempts = options.maxAttempts ?? (hasKnownToken ? 1 : 2);
  const retryDelayMs = options.retryDelayMs ?? 400;
  const syncOptions = {
    ...options,
    skipCache: options.skipCache ?? true,
    collectTimeoutMs: options.collectTimeoutMs ?? FCM_COLLECT_TIMEOUT_MS,
    requestPermission: options.requestPermission ?? false,
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let fcmToken = options.fcmToken || null;
    let platform = options.platform || (isFlutterWebView() ? "mobile" : "web");

    if (!fcmToken) {
      const collected = await collectFcmTokenFast(moduleName, syncOptions);
      fcmToken = collected.fcmToken;
      platform = collected.platform;
    }

    if (!fcmToken || !phone) {
      if (attempt < maxAttempts - 1) {
        await sleep(retryDelayMs);
        continue;
      }
      return false;
    }

    setSavedToken(moduleName, fcmToken);

    const normalizedPhone = String(phone || "").replace(/\D/g, "").slice(-10);
    if (!normalizedPhone) return false;

    try {
      const apiClient = (await import("@food/api")).default;
      await apiClient.post("/fcm-tokens/pending-save", {
        phone: normalizedPhone,
        token: fcmToken,
        platform,
        role: moduleName,
      });
      pushDebugLog(PUSH_DEBUG_PREFIX, "Pending FCM token saved by phone", {
        moduleName,
        phone: normalizedPhone,
        attempt: attempt + 1,
      });
      return true;
    } catch (error) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Failed to save pending FCM token", {
        moduleName,
        attempt: attempt + 1,
        error: error?.message || error,
      });
      if (attempt < maxAttempts - 1) {
        options.fcmToken = null;
        await sleep(retryDelayMs);
      }
    }
  }

  return false;
}

/** Warm FCM cache during onboarding (no permission popup). */
export function prefetchModuleFcmToken(moduleName) {
  void collectFcmTokenFast(moduleName, { requestPermission: false }).catch(() => {});
}

/**
 * Drop local FCM prefetch when user leaves onboarding before profile submit.
 * Server tokens are only stored after registration; nothing to remove remotely yet.
 */
export function clearOnboardingFcmLocal(moduleName) {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(`${tokenCachePrefix}${moduleName}`);
}

/**
 * Background FCM sync after registration (delivery 5f54105 pattern).
 */
export function syncPendingPartnerFcmQuick(moduleName, phone, options = {}) {
  if (!phone || typeof window === "undefined") return;

  const runSync = () => {
    void persistPendingModuleFcmToken(moduleName, phone, {
      ...options,
      maxAttempts: 3,
      retryDelayMs: 500,
    });
  };

  runSync();
  [1500, 3500, 7000].forEach((delayMs) => {
    window.setTimeout(runSync, delayMs);
  });
}

/**
 * Navigate to delivery pending screen immediately; persist FCM in background (restaurant parity).
 */
export function finalizeDeliveryPendingSubmission(
  navigate,
  phone,
  { fcmToken, platform, status = "pending", message, rejectionReason } = {},
  navigateState = {},
) {
  const normalizedPhone = String(phone || "").replace(/\D/g, "").slice(-10);

  if (normalizedPhone) {
    sessionStorage.setItem("delivery_pendingPhone", normalizedPhone);
  }
  sessionStorage.setItem("delivery_pendingStatus", status);
  if (message) {
    sessionStorage.setItem("delivery_pendingMessage", message);
  } else {
    sessionStorage.removeItem("delivery_pendingMessage");
  }
  if (rejectionReason) {
    sessionStorage.setItem("delivery_pendingRejectionReason", rejectionReason);
  } else {
    sessionStorage.removeItem("delivery_pendingRejectionReason");
  }

  try {
    syncPendingPartnerFcmQuick("delivery", normalizedPhone, { fcmToken, platform });
  } catch {}

  if (typeof localStorage !== "undefined" && localStorage.getItem("delivery_accessToken")) {
    try {
      void persistModuleFcmToken("delivery", { fcmToken, platform });
    } catch {}
  }

  navigate("/food/delivery/pending-verification", {
    replace: true,
    state: {
      phone: normalizedPhone,
      isRejected: status === "rejected",
      message,
      rejectionReason,
      ...navigateState,
    },
  });
}

function setupFcmTokenRefreshOnVisibility(moduleName) {
  if (typeof window === "undefined" || fcmVisibilityListenerAttached) return;
  fcmVisibilityListenerAttached = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const activeModule = normalizeModuleFromPath(window.location.pathname);
    if (activeModule === "admin") return;

    const accessToken = localStorage.getItem(`${activeModule}_accessToken`);
    if (accessToken) {
      void persistModuleFcmToken(activeModule, {
        skipCache: true,
        requestPermission: false,
      }).catch(() => {});
      return;
    }

    const pendingPhone =
      activeModule === "delivery"
        ? sessionStorage.getItem("delivery_pendingPhone")
        : localStorage.getItem("restaurant_pendingPhone");
    if (
      pendingPhone &&
      (activeModule === "delivery" || activeModule === "restaurant") &&
      window.location.pathname.includes("/pending-verification")
    ) {
      void persistPendingModuleFcmToken(activeModule, pendingPhone, {
        requestPermission: true,
        collectTimeoutMs: FCM_SUBMIT_COLLECT_TIMEOUT_MS,
      }).catch(() => {});
    }
  });
}

function isSecureContextForPush() {
  return window.isSecureContext || window.location.hostname === "localhost";
}

function sanitize(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function buildOsNotificationDedupeKey(source = {}) {
  const data = isRecord(source?.data) ? source.data : source;

  // Prefer backend-provided idempotency keys (most reliable for dedup)
  const backendTag = data?.tag || source?.tag || '';
  const backendEventId = data?.eventId || source?.eventId || data?.idempotencyKey || source?.idempotencyKey || '';
  if (backendEventId) return String(backendEventId);
  if (backendTag) return String(backendTag);

  if (data?.notificationId || data?.messageId || source?.messageId) {
    return data?.notificationId || data?.messageId || source?.messageId;
  }

  const orderMongoId = String(
    data?.orderMongoId || source?.orderMongoId || data?._id || source?._id || "",
  ).trim();
  const orderId = String(
    data?.orderId || source?.orderId || source?.order_id || "",
  ).trim();
  const orderStatus = String(
    data?.orderStatus || source?.orderStatus || source?.status || "",
  ).trim();

  // Same order event from socket + FCM should collapse to one OS notification.
  if (orderMongoId || orderId) {
    return [orderMongoId || orderId, orderStatus || "update"].join("::");
  }

  return [
    String(data?.type || source?.type || ""),
    String(data?.title || source?.title || source?.notification?.title || ""),
    String(data?.targetUrl || data?.link || source?.targetUrl || ""),
  ]
    .filter(Boolean)
    .join("::");
}

function getNotificationKey(payload = {}) {
  return buildOsNotificationDedupeKey(payload);
}

/**
 * Returns true when the same OS notification was already handled recently
 * (shared by FCM foreground/background handlers and socket fallbacks).
 */
export function shouldSkipDuplicateOsNotification(source = {}) {
  const notificationKey = buildOsNotificationDedupeKey(source);
  return wasRecentlyHandled(notificationKey);
}

function readSharedOsNotificationDedup() {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(OS_NOTIFICATION_DEDUP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSharedOsNotificationDedup(map) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(OS_NOTIFICATION_DEDUP_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

function wasRecentlyHandled(notificationKey) {
  if (!notificationKey) return false;
  const now = Date.now();

  for (const [key, timestamp] of recentForegroundNotifications.entries()) {
    if (now - timestamp > notificationDedupWindowMs) {
      recentForegroundNotifications.delete(key);
    }
  }

  const shared = readSharedOsNotificationDedup();
  for (const [key, timestamp] of Object.entries(shared)) {
    if (now - Number(timestamp) > notificationDedupWindowMs) {
      delete shared[key];
    }
  }

  const sharedTimestamp = Number(shared[notificationKey] || 0);
  if (sharedTimestamp && now - sharedTimestamp < notificationDedupWindowMs) {
    pushDebugLog(PUSH_DEBUG_PREFIX, "Duplicate notification skipped (shared)", { notificationKey });
    return true;
  }

  if (recentForegroundNotifications.has(notificationKey)) {
    pushDebugLog(PUSH_DEBUG_PREFIX, "Duplicate notification skipped", { notificationKey });
    return true;
  }

  recentForegroundNotifications.set(notificationKey, now);
  shared[notificationKey] = now;
  writeSharedOsNotificationDedup(shared);
  return false;
}

function ensurePushSoundAudio() {
  if (typeof window === "undefined") return null;
  if (!pushSoundAudio) {
    const [primarySource] = getPushSoundSources();
    const audioUrl = primarySource.startsWith("/")
      ? new URL(primarySource, window.location.origin).toString()
      : primarySource;
    pushDebugLog(PUSH_DEBUG_PREFIX, "Creating primary push audio", { audioUrl });
    pushSoundAudio = new Audio(audioUrl);
    pushSoundAudio.preload = "auto";
    pushSoundAudio.volume = 1;
    pushSoundAudio.load();
  }
  return pushSoundAudio;
}

function createPushPlaybackAudio() {
  const moduleName = normalizeModuleFromPath();
  const audioSources = getPushSoundSources(moduleName).map((source) =>
    typeof window === "undefined" || !source.startsWith("/")
      ? source
      : new URL(source, window.location.origin).toString(),
  );
  pushDebugLog(PUSH_DEBUG_PREFIX, "Preparing push playback sources", { audioSources });
  return audioSources.map((source) => {
    const playbackAudio = new Audio(source);
    playbackAudio.preload = "auto";
    playbackAudio.volume = 1;
    playbackAudio.load();
    return playbackAudio;
  });
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!pushSoundContext) {
    pushSoundContext = new AudioContextClass();
  }

  return pushSoundContext;
}

async function playSynthNotificationBeep() {
  const ctx = getAudioContext();
  if (!ctx) return false;
  pushDebugLog(PUSH_DEBUG_PREFIX, "Playing synth notification beep");

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const now = ctx.currentTime;
  const pulses = [
    { start: 0, duration: 0.11, frequency: 880 },
    { start: 0.16, duration: 0.11, frequency: 988 },
    { start: 0.34, duration: 0.18, frequency: 1046 },
  ];

  pulses.forEach(({ start, duration, frequency }) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + duration);
  });

  return true;
}

export function isPushSoundEnabled() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(pushSoundEnabledStorageKey) === "true";
}

async function triggerWebViewNativeNotification(payload = {}) {
  // Flutter shell already displays FCM alerts natively — avoid a second OS notification.
  if (isFlutterWebView()) return false;

  if (typeof window === "undefined") return false;

  const bridgePayload = {
    title: payload?.notification?.title || payload?.data?.title || "New notification",
    body: payload?.notification?.body || payload?.data?.body || "",
    notificationId: payload?.data?.notificationId || payload?.messageId || "",
    targetUrl: payload?.data?.targetUrl || payload?.data?.link || "",
    imageUrl: payload?.notification?.image || payload?.data?.image || payload?.data?.imageUrl || "",
  };

  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === "function"
    ) {
      const handlerNames = [
        "playNotificationSound",
        "triggerNotificationFeedback",
        "onPushNotification",
      ];

      for (const handlerName of handlerNames) {
        try {
          pushDebugLog(PUSH_DEBUG_PREFIX, "Trying native notification handler", { handlerName, bridgePayload });
          await window.flutter_inappwebview.callHandler(handlerName, bridgePayload);
          pushDebugLog(PUSH_DEBUG_PREFIX, "Native notification handler succeeded", { handlerName });
          return true;
        } catch {
          // Try the next available handler name.
        }
      }
    }
  } catch {
    // Ignore bridge failures.
  }

  return false;
}

export function stopActivePushPlayback() {
  if (pushSoundAudio) {
    try {
      pushSoundAudio.pause();
      pushSoundAudio.currentTime = 0;
    } catch (_) {}
  }
  for (const audio of activePushPlaybackAudios) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_) {}
  }
  activePushPlaybackAudios = [];
}

async function playPushSound(payload = {}) {
  try {
    if (!shouldPlayAlertSoundForPush(payload)) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Skipping push sound (not an order alert)", {
        notificationKey: getNotificationKey(payload),
        type: payload?.data?.type || payload?.data?.notificationType || "",
      });
      stopActivePushPlayback();
      return;
    }

    // The app's own alert (useRestaurantNotifications / useDeliveryNotifications)
    // owns the ringtone for an order awaiting a decision: one track per order,
    // stopped the moment it is accepted, rejected or muted. When the same order
    // also arrives as a push, playing a second copy here put two ringtones on
    // top of each other, and that copy outlived the accept because the app's
    // alert cannot stop it. The alert has already triggered the native bridge
    // and vibration.
    if (
      typeof window !== "undefined" &&
      (window.__restaurantOrderAlertActive || window.__deliveryOrderAlertActive)
    ) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Skipping push sound (in-app order alert is ringing)", {
        notificationKey: getNotificationKey(payload),
      });
      stopActivePushPlayback();
      return;
    }

    pushDebugLog(PUSH_DEBUG_PREFIX, "playPushSound called", {
      notificationKey: getNotificationKey(payload),
      pushSoundUnlocked,
      notificationPermission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
      payload,
    });
    const usedNativeBridge = await triggerWebViewNativeNotification(payload);

    if (typeof window !== "undefined" && window.__userHasInteracted && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        pushDebugLog(PUSH_DEBUG_PREFIX, "Triggering vibration");
        navigator.vibrate([200, 100, 200, 100, 300]);
      } catch (_) {}
    }

    if (usedNativeBridge) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Push sound handled by native bridge");
      return;
    }

    if (!pushSoundUnlocked) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Push sound blocked because sound is not enabled/unlocked");
      return;
    }

    stopActivePushPlayback();
    const players = createPushPlaybackAudio();
    activePushPlaybackAudios = players;
    for (const audio of players) {
      try {
        audio.currentTime = 0;
        await audio.play();
        pushDebugLog(PUSH_DEBUG_PREFIX, "Audio playback succeeded", { source: audio.src });
        return;
      } catch (error) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Audio playback failed", {
          source: audio.src,
          error: error?.message || error,
        });
        // Try next fallback sound source.
      }
    }

    await playSynthNotificationBeep();
  } catch (error) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "playPushSound failed", { error: error?.message || error });
  }
}

const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let pushSoundUnlockListenersAttached = false;

function setupPushSoundUnlock() {
  if (typeof window === "undefined" || pushSoundUnlocked) return;
  // initPushNotificationClient runs on every route change; adding a fresh set of
  // listeners each time made the first tap fire the unlock once per route visited.
  if (pushSoundUnlockListenersAttached) return;
  pushSoundUnlockListenersAttached = true;

  // pointerdown, touchstart and keydown all land on the first tap/keystroke, and
  // the unlock awaits audio calls that iOS can leave pending. Without this guard
  // every event (and every later keystroke) built another AudioContext, which
  // is what made the very first typing on a fresh install stutter.
  let unlockInFlight = false;
  const withTimeout = (promise, ms) => Promise.race([promise, sleep(ms)]);

  const detach = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
  };

  const unlock = async () => {
    if (pushSoundUnlocked) {
      detach();
      return;
    }
    if (unlockInFlight) return;
    unlockInFlight = true;
    try {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Attempting passive push sound unlock with silent buffer");

      // 1. Prime Web Audio Context
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        let ctx = null;
        try {
          ctx = new AudioCtx();
          if (ctx.state === "suspended") {
            await withTimeout(ctx.resume(), 1500);
          }
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
          source.onended = () => {
            try {
              void ctx.close?.();
            } catch (_) {}
          };
        } catch (_) {
          try {
            void ctx?.close?.();
          } catch (__) {}
        }
      }

      // 2. Pre-initialize audio elements without playing real sound file
      ensurePushSoundAudio();

      // 3. Play a 100% silent 1-sample dummy audio to unlock HTMLAudioElement media pipeline
      try {
        const silentAudio = new Audio(SILENT_AUDIO_DATA_URI);
        const started = silentAudio.play();
        if (started && typeof started.then === "function") {
          await withTimeout(started, 1500);
          try {
            silentAudio.pause();
          } catch (_) {}
        }
      } catch (_) {}

      pushSoundUnlocked = true;
      localStorage.setItem(pushSoundEnabledStorageKey, "true");
      pushDebugLog(PUSH_DEBUG_PREFIX, "Passive push sound unlock succeeded");
      window.dispatchEvent(new CustomEvent("push-sound-enabled"));
    } catch (error) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Passive push sound unlock failed", {
        error: error?.message || error,
      });
      pushSoundUnlocked = true;
    } finally {
      unlockInFlight = false;
    }

    if (pushSoundUnlocked) detach();
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

export async function enablePushNotificationSound() {
  if (typeof window === "undefined") return false;

  let audio = null;
  try {
    audio = ensurePushSoundAudio();
    if (!audio) return false;
    pushDebugLog(PUSH_DEBUG_PREFIX, "Manual push sound enable started");
    audio.muted = true;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    pushSoundUnlocked = true;
    localStorage.setItem(pushSoundEnabledStorageKey, "true");
    window.dispatchEvent(new CustomEvent("push-sound-enabled"));

    const players = createPushPlaybackAudio();
    for (const previewAudio of players) {
      try {
        previewAudio.currentTime = 0;
        await previewAudio.play();
        pushDebugLog(PUSH_DEBUG_PREFIX, "Manual sound preview succeeded", { source: previewAudio.src });
        return true;
      } catch (error) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Manual sound preview failed", {
          source: previewAudio.src,
          error: error?.message || error,
        });
        // Try next preview source.
      }
    }

    await playSynthNotificationBeep();
    return true;
  } catch (error) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "Manual push sound enable failed, trying synth beep", {
      error: error?.message || error,
    });
    try {
      await playSynthNotificationBeep();
      pushSoundUnlocked = true;
      localStorage.setItem(pushSoundEnabledStorageKey, "true");
      window.dispatchEvent(new CustomEvent("push-sound-enabled"));
      }
    catch (beepError) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Synth beep fallback failed", {
        error: beepError?.message || beepError,
      });
      return false;
    }
    return true;
  } finally {
    if (audio) {
      audio.muted = false;
    }
  }
}

function isFirebaseWebConfigComplete(env) {
  return Boolean(
    env?.apiKey && env?.projectId && env?.appId && env?.messagingSenderId && env?.vapidKey,
  );
}

async function fetchFirebasePublicEnvFromApi() {
  const candidates = ["/api/v1/food/public/env", "/api/v1/env/public"];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const json = await response.json();
      const data = json?.data || {};
      const env = {
        apiKey: sanitize(data.VITE_FIREBASE_API_KEY || data.FIREBASE_API_KEY),
        authDomain: sanitize(data.VITE_FIREBASE_AUTH_DOMAIN || data.FIREBASE_AUTH_DOMAIN),
        projectId: sanitize(data.VITE_FIREBASE_PROJECT_ID || data.FIREBASE_PROJECT_ID),
        appId: sanitize(data.VITE_FIREBASE_APP_ID || data.FIREBASE_APP_ID),
        messagingSenderId: sanitize(
          data.VITE_FIREBASE_MESSAGING_SENDER_ID || data.FIREBASE_MESSAGING_SENDER_ID,
        ),
        storageBucket: sanitize(data.VITE_FIREBASE_STORAGE_BUCKET || data.FIREBASE_STORAGE_BUCKET),
        measurementId: sanitize(data.VITE_FIREBASE_MEASUREMENT_ID || data.FIREBASE_MEASUREMENT_ID),
        vapidKey: sanitize(data.VITE_FIREBASE_VAPID_KEY || data.FIREBASE_VAPID_KEY),
      };
      if (isFirebaseWebConfigComplete(env)) return env;
    } catch {
      // try next
    }
  }
  return null;
}

async function getFirebasePublicEnv() {
  if (publicEnvPromise) return publicEnvPromise;

  publicEnvPromise = (async () => {
    try {
      const fromVite = {
        apiKey: sanitize(import.meta.env.VITE_FIREBASE_API_KEY) || DEFAULT_FIREBASE_CONFIG.apiKey,
        authDomain: sanitize(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) || DEFAULT_FIREBASE_CONFIG.authDomain,
        projectId: sanitize(import.meta.env.VITE_FIREBASE_PROJECT_ID) || DEFAULT_FIREBASE_CONFIG.projectId,
        appId: sanitize(import.meta.env.VITE_FIREBASE_APP_ID) || DEFAULT_FIREBASE_CONFIG.appId,
        messagingSenderId:
          sanitize(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
        storageBucket: sanitize(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
        measurementId: sanitize(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
        vapidKey: sanitize(import.meta.env.VITE_FIREBASE_VAPID_KEY),
      };
      if (isFirebaseWebConfigComplete(fromVite)) return fromVite;

      // Production / SW cold-start fallback when Vite env was not baked into the build
      const fromApi = await fetchFirebasePublicEnvFromApi();
      if (fromApi) return fromApi;

      pushDebugWarn(PUSH_DEBUG_PREFIX, "Firebase web config incomplete (Vite + public/env both missing keys)");
      return fromVite;
    } catch {
      return {
        ...DEFAULT_FIREBASE_CONFIG,
        storageBucket: sanitize(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
        measurementId: sanitize(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
        vapidKey: sanitize(import.meta.env.VITE_FIREBASE_VAPID_KEY),
      };
    } finally {
      publicEnvPromise = null;
    }
  })();

  return publicEnvPromise;
}

async function syncFirebaseConfigToServiceWorker(registration, firebasePublicEnv) {
  if (!registration || !firebasePublicEnv) return;
  const config = {
    apiKey: firebasePublicEnv.apiKey,
    authDomain: firebasePublicEnv.authDomain,
    projectId: firebasePublicEnv.projectId,
    appId: firebasePublicEnv.appId,
    messagingSenderId: firebasePublicEnv.messagingSenderId,
    storageBucket: firebasePublicEnv.storageBucket,
    measurementId: firebasePublicEnv.measurementId,
  };
  if (!config.apiKey || !config.projectId || !config.appId || !config.messagingSenderId) return;

  // Persist for SW cold starts (closed-tab background push) — do not rely only on postMessage race
  try {
    const cache = await caches.open("eatiefy-fcm-config-v1");
    await cache.put(
      "/__ometto_fcm_web_config__",
      new Response(JSON.stringify(config), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch {
    // ignore cache write failures
  }

  const post = (sw) => {
    try {
      sw?.postMessage({ type: "OMETTO_FCM_CONFIG", config });
    } catch {
      // ignore
    }
  };

  post(registration.active);
  post(registration.waiting);
  post(registration.installing);

  try {
    const ready = await navigator.serviceWorker.ready;
    post(ready.active);
  } catch {
    // ignore
  }
}

async function registerMessagingServiceWorker(firebasePublicEnv) {
  // Cache-bust so closed-app background handler updates after deploys
  const registration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?v=20261010`,
    {
      scope: "/",
      updateViaCache: "none",
    },
  );
  await syncFirebaseConfigToServiceWorker(registration, firebasePublicEnv);
  try {
    await registration.update();
  } catch {
    // ignore
  }
  // Ensure the worker is active before getToken (critical for background delivery)
  if (registration.installing) {
    await new Promise((resolve) => {
      const worker = registration.installing;
      if (!worker) {
        resolve();
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated" || worker.state === "redundant") resolve();
      });
    });
  }
  try {
    await navigator.serviceWorker.ready;
  } catch {
    // ignore
  }
  await syncFirebaseConfigToServiceWorker(registration, firebasePublicEnv);
  return registration;
}

function getMessagingFirebaseApp(config) {
  const appConfig = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
    ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
    ...(config.measurementId ? { measurementId: config.measurementId } : {}),
  };

  if (!appConfig.apiKey || !appConfig.projectId || !appConfig.appId || !appConfig.messagingSenderId) {
    return null;
  }

  const existing = getApps().find((a) => a.name === MESSAGING_APP_NAME);
  if (existing) return existing;

  try {
    return getApp(MESSAGING_APP_NAME);
  } catch {
    return initializeApp(appConfig, MESSAGING_APP_NAME);
  }
}

function getSavedToken(moduleName) {
  return localStorage.getItem(`${tokenCachePrefix}${moduleName}`) || "";
}

function setSavedToken(moduleName, token) {
  localStorage.setItem(`${tokenCachePrefix}${moduleName}`, token);
}

async function resolveWebFcmToken(moduleName, options = {}) {
  const shouldRequestPermission = options.requestPermission !== false;

  if (!isSupportedBrowser() || !isSecureContextForPush()) {
    return null;
  }

  try {
    const firebasePublicEnv = await getFirebasePublicEnv();
    if (!firebasePublicEnv?.vapidKey) return null;

    const app = getMessagingFirebaseApp(firebasePublicEnv);
    if (!app) return null;

    let permission = Notification.permission;
    if (permission === "default") {
      if (!shouldRequestPermission) return null;
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") return null;

    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    const supported = await isSupported().catch(() => false);
    if (!supported) return null;

    const registration = await registerMessagingServiceWorker(firebasePublicEnv);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: firebasePublicEnv.vapidKey,
      serviceWorkerRegistration: registration,
    });

    const normalized = normalizeFcmBridgeToken(token);
    if (normalized) {
      setSavedToken(moduleName, normalized);
      return normalized;
    }
  } catch (error) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "resolveWebFcmToken failed", {
      moduleName,
      error: error?.message || error,
    });
  }

  if (options.skipCache !== true) {
    const cached = getSavedToken(moduleName);
    if (cached.length >= 20) return cached;
  }

  return null;
}

function getBackendSyncedToken(moduleName) {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(`${fcmBackendSyncedPrefix}${moduleName}`) || "";
  } catch {
    return "";
  }
}

function markBackendSyncedToken(moduleName, token) {
  if (typeof sessionStorage === "undefined" || !token) return;
  try {
    sessionStorage.setItem(`${fcmBackendSyncedPrefix}${moduleName}`, token);
  } catch {
    /* ignore */
  }
}

export function clearFcmBackendSyncRecord(moduleName) {
  if (typeof sessionStorage === "undefined" || !moduleName) return;
  try {
    sessionStorage.removeItem(`${fcmBackendSyncedPrefix}${moduleName}`);
    sessionStorage.removeItem(`${voipBackendSyncedPrefix}${moduleName}`);
  } catch {
    /* ignore */
  }
}

/*
 * iOS VoIP (CallKit) calls for new orders. The iOS app registers with PushKit
 * and returns its VoIP token from one of these handlers; Android and older
 * builds have none, which simply leaves them on the regular push.
 */
const VOIP_BRIDGE_HANDLER_NAMES = ["getVoipToken", "getVOIPToken", "getPushKitToken"];
const VOIP_MODULES = new Set(["restaurant", "delivery"]);
const voipBackendSyncedPrefix = "voip_backend_synced_";

function normalizeVoipBridgeToken(raw) {
  const value =
    raw && typeof raw === "object"
      ? raw.voipToken || raw.token || raw.pushKitToken || raw.value || ""
      : raw;
  const token = String(value || "").trim();
  // PushKit tokens are hex (64 chars today); anything else is not a VoIP token.
  return /^[0-9a-f]{64,200}$/i.test(token) ? token : "";
}

/**
 * Reads the native VoIP token, and WHY there isn't one when there isn't —
 * the server can only log what actually reached it over HTTP, so without this
 * "no VoIP token on a mobile save" is a dead end: not running inside the
 * Flutter app, the app has no VoIP bridge handler at all (old build), or a
 * handler exists but returned something that isn't a real PushKit token.
 * `reason` rides along to the server as `voipSkipReason` in saveTokenByModule.
 */
async function readNativeVoipToken(moduleName) {
  if (!isFlutterWebView()) return { token: "", reason: "not_flutter_webview" };

  let handlerFound = false;
  let lastBadRaw = null;
  for (const handlerName of VOIP_BRIDGE_HANDLER_NAMES) {
    try {
      const raw = await window.flutter_inappwebview.callHandler(handlerName, { module: moduleName });
      handlerFound = true;
      const token = normalizeVoipBridgeToken(raw);
      if (token) return { token, reason: null };
      lastBadRaw = raw;
    } catch {
      // Handler not implemented in this build — try the next name.
    }
  }
  if (!handlerFound) return { token: "", reason: "no_bridge_handler" };
  const preview = String(
    (lastBadRaw && typeof lastBadRaw === "object" ? JSON.stringify(lastBadRaw) : lastBadRaw) ?? ""
  ).slice(0, 40);
  return { token: "", reason: preview ? `bridge_returned_invalid_value:${preview}` : "bridge_returned_empty" };
}

function getVoipBackendSyncedSignature(moduleName) {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(`${voipBackendSyncedPrefix}${moduleName}`) || "";
  } catch {
    return "";
  }
}

function markVoipBackendSynced(moduleName, signature) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`${voipBackendSyncedPrefix}${moduleName}`, signature);
  } catch {
    /* ignore */
  }
}

function getBackendSyncedCapabilities(moduleName) {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(`${fcmBackendSyncedCapabilitiesPrefix}${moduleName}`) || "";
  } catch {
    return "";
  }
}

function markBackendSyncedCapabilities(moduleName, signature) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`${fcmBackendSyncedCapabilitiesPrefix}${moduleName}`, signature);
  } catch {
    /* ignore */
  }
}

async function saveTokenByModule(moduleName, token, platform = "web") {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return;

  // Only the restaurant app has a native order alarm to declare.
  const capabilities =
    platform === "mobile" && moduleName === "restaurant" ? readNativeCapabilities(moduleName) : undefined;
  const capabilitiesSignature = capabilities ? capabilities.join(",") : "";

  // iPhone app: PushKit token for this install, sent in the same save so new
  // orders (restaurant) / offers (rider) can ring as a call. Empty everywhere
  // else (Android, web, older app builds with no VoIP handler) — voipSkipReason
  // tells the server WHY, since pushDebugLog below only reaches this device's
  // own browser console, never the server's logs.
  const shouldTryVoip = platform === "mobile" && VOIP_MODULES.has(moduleName);
  const { token: voipToken, reason: voipSkipReason } = shouldTryVoip
    ? await readNativeVoipToken(moduleName)
    : { token: "", reason: shouldTryVoip === false && platform === "mobile" ? "module_not_voip_eligible" : null };
  const voipSignature = voipToken ? `${voipToken}|${normalizedToken}` : "";

  const tokenUnchanged =
    getBackendSyncedToken(moduleName) === normalizedToken &&
    getBackendSyncedCapabilities(moduleName) === capabilitiesSignature;
  // A voipToken only shows up once PushKit finishes registering, which can be
  // after the FCM token was already synced — so re-send whenever that pair
  // hasn't been saved yet, even if the FCM token itself hasn't changed.
  const voipUnchanged = !voipToken || getVoipBackendSyncedSignature(moduleName) === voipSignature;

  if (tokenUnchanged && voipUnchanged) {
    pushDebugLog(PUSH_DEBUG_PREFIX, "FCM token unchanged — skip backend save", {
      moduleName,
      platform,
    });
    return;
  }

  pushDebugLog(PUSH_DEBUG_PREFIX, "saveTokenByModule starting", {
    moduleName,
    platform,
    tokenPreview: `${normalizedToken.slice(0, 10)}...`,
    hasVoipToken: Boolean(voipToken),
    voipSkipReason,
  });

  if (moduleName === "restaurant") {
    await restaurantAPI.saveFcmToken(normalizedToken, platform, { capabilities, voipToken, voipSkipReason });
  } else if (moduleName === "delivery") {
    await deliveryAPI.saveFcmToken(normalizedToken, platform, { voipToken, voipSkipReason });
  } else if (moduleName === "user") {
    await userAPI.saveFcmToken(normalizedToken, { platform });
  } else if (moduleName === "admin") {
    await adminAPI.saveFcmToken(normalizedToken, platform);
  } else {
    return;
  }

  markBackendSyncedToken(moduleName, normalizedToken);
  markBackendSyncedCapabilities(moduleName, capabilitiesSignature);
  if (voipToken) markVoipBackendSynced(moduleName, voipSignature);
}

async function registerNativeWebViewFcmToken(moduleName) {
  return persistModuleFcmToken(moduleName, { maxAttempts: 6, delayMs: 350 });
}

function showForegroundNotification(payload = {}) {
  if (!isRecord(payload)) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed foreground notification payload", { payload });
    return;
  }

  // Lets screens (e.g. Settings -> "Send test notification") know this browser
  // really received the push, regardless of whether a banner was then shown.
  try {
    window.dispatchEvent(new CustomEvent("eatiefy-push-received", { detail: payload }));
  } catch {
    /* ignore */
  }

  // In the Flutter-wrapped app, native FCM handlers own all OS notifications.
  if (isFlutterWebView()) {
    const notificationType = String(payload?.data?.type || "").toLowerCase();
    if (
      notificationType === "cash_deposit" ||
      notificationType === "cash_deposit_rejected"
    ) {
      window.dispatchEvent(new CustomEvent("delivery-wallet-refresh"));
    }
    if (
      notificationType === "restaurant_approved" ||
      notificationType === "restaurant_changes_approved" ||
      notificationType === "onboarding_approved"
    ) {
      window.dispatchEvent(new CustomEvent("restaurantApprovalStatusChanged", { detail: payload?.data }));
    }
    if (
      notificationType === "new_order" ||
      notificationType === "delivery_offer" ||
      notificationType === "delivery_request" ||
      Boolean(payload?.data?.orderId || payload?.data?.order_id)
    ) {
      window.dispatchEvent(new CustomEvent("app-order-push", { detail: payload }));
      window.dispatchEvent(new CustomEvent("new_order", { detail: payload?.data || payload }));
      window.dispatchEvent(new CustomEvent("delivery_request", { detail: payload?.data || payload }));
    }
    return;
  }

  const notificationKey = getNotificationKey(payload);
  pushDebugLog(PUSH_DEBUG_PREFIX, "showForegroundNotification received", { notificationKey, payload });
  if (wasRecentlyHandled(notificationKey)) {
    return;
  }

  const title =
    payload?.notification?.title ||
    payload?.data?.title ||
    "New notification";
  const body =
    payload?.notification?.body ||
    payload?.data?.body ||
    "";
  const image =
    payload?.notification?.image ||
    payload?.notification?.imageUrl ||
    payload?.data?.image ||
    payload?.data?.imageUrl ||
    undefined;

  const notificationType = String(payload?.data?.type || "").toLowerCase();
  if (
    notificationType === "cash_deposit" ||
    notificationType === "cash_deposit_rejected"
  ) {
    window.dispatchEvent(new CustomEvent("delivery-wallet-refresh"));
  }
  if (
    notificationType === "restaurant_approved" ||
    notificationType === "restaurant_changes_approved" ||
    notificationType === "onboarding_approved"
  ) {
    window.dispatchEvent(new CustomEvent("restaurantApprovalStatusChanged", { detail: payload?.data }));
  }
  if (
    notificationType === "new_order" ||
    notificationType === "delivery_offer" ||
    notificationType === "delivery_request" ||
    Boolean(payload?.data?.orderId || payload?.data?.order_id)
  ) {
    window.dispatchEvent(new CustomEvent("app-order-push", { detail: payload }));
    window.dispatchEvent(new CustomEvent("new_order", { detail: payload?.data || payload }));
    window.dispatchEvent(new CustomEvent("delivery_request", { detail: payload?.data || payload }));
  }

  // Must match the tag the service worker uses for the same event so the two
  // renderers replace each other instead of stacking duplicate banners.
  const osTag = String(payload?.data?.tag || "").trim() || notificationKey || undefined;

  const isTabVisible =
    typeof document !== "undefined" && document.visibilityState === "visible";

  // Foreground: in-app toast + sound only (no duplicate OS banner while tab is open).
  if (isTabVisible) {
    playPushSound(payload);
    showNotificationToast({ title, message: body });
    return;
  }

  // Background tab: OS notification via service worker; sound optional.
  playPushSound(payload);

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Showing browser notification from page", {
        title,
        body,
        image,
        notificationKey,
      });
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistration().then((registration) => {
          if (registration) {
            registration.showNotification(title, {
              body,
              icon: getNotificationIcon(),
              image,
              tag: osTag,
              renotify: false,
              data: payload?.data || {},
              requireInteraction: true,
              vibrate: [200, 100, 200, 100, 300],
            });
          } else {
            new Notification(title, {
              body,
              icon: getNotificationIcon(),
              image,
              tag: osTag,
              requireInteraction: true,
            });
          }
        }).catch(() => {
          new Notification(title, {
            body,
            icon: getNotificationIcon(),
            image,
            tag: osTag,
          });
        });
      } else {
        new Notification(title, {
          body,
          icon: getNotificationIcon(),
          image,
          tag: osTag,
        });
      }
    } catch (error) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Browser notification creation failed", {
        error: error?.message || error,
      });
    }
  }
}

function attachServiceWorkerMessageListener() {
  if (serviceWorkerMessageListenerAttached || typeof window === "undefined") {
    return;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = isRecord(event?.data) ? event.data : null;
      if (!data || data.type !== "push-notification-received") return;
      if (!isRecord(data.payload)) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed SW push relay payload", { payload: data.payload });
        return;
      }
      const rawType = String(data?.payload?.data?.type || "").toLowerCase();
      const isOrderAlert =
        rawType === "new_order" ||
        rawType === "delivery_offer" ||
        rawType === "delivery_request" ||
        Boolean(data?.payload?.data?.orderId || data?.payload?.data?.order_id);

      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        if (isOrderAlert) {
          pushDebugLog(PUSH_DEBUG_PREFIX, "Background order alert received from SW relay - triggering alert & events");
          playPushSound(data.payload);
          window.dispatchEvent(new CustomEvent("app-order-push", { detail: data.payload }));
          window.dispatchEvent(new CustomEvent("new_order", { detail: data.payload?.data || data.payload }));
          window.dispatchEvent(new CustomEvent("delivery_request", { detail: data.payload?.data || data.payload }));
        } else {
          pushDebugLog(PUSH_DEBUG_PREFIX, "Skipping page notification render for SW relay because tab is hidden");
        }
        return;
      }
      pushDebugLog(PUSH_DEBUG_PREFIX, "Received service worker message in page", { payload: data.payload });
      scheduleForegroundNotification(data.payload);
    });
  }

  window.addEventListener("native-push-notification", (event) => {
    const payload = isRecord(event?.detail) ? event.detail : null;
    if (!payload) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed native push event", { payload: event?.detail });
      return;
    }
    pushDebugLog(PUSH_DEBUG_PREFIX, "Received native push event", { payload });
    scheduleForegroundNotification(payload);
  });

  window.addEventListener("message", (event) => {
    const data = isRecord(event?.data) ? event.data : null;
    if (!data) return;
    if (data.type !== "native-push-notification") return;
    if (!isRecord(data.payload)) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed native postMessage payload", { payload: data.payload });
      return;
    }
    pushDebugLog(PUSH_DEBUG_PREFIX, "Received native postMessage push event", { payload: data.payload });
    scheduleForegroundNotification(data.payload);
  });

  serviceWorkerMessageListenerAttached = true;
}

function scheduleForegroundNotification(payload) {
  // Keep message handlers fast to avoid Chrome [Violation] warnings.
  // Defer heavier work (toast, audio) to idle time / next tick.
  const run = () => showForegroundNotification(payload);
  try {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1000 });
      return;
    }
  } catch {
    // ignore
  }
  setTimeout(run, 0);
}

export function initPushNotificationClient() {
  if (typeof window === "undefined") return;
  const moduleName = normalizeModuleFromPath(window.location.pathname);
  pushDebugLog(PUSH_DEBUG_PREFIX, "Initializing push notification client", {
    path: window.location.pathname,
    moduleName,
    soundEnabled: isPushSoundEnabled(),
  });

  attachServiceWorkerMessageListener();

  if (moduleName === "admin") {
    setupFcmTokenRefreshOnVisibility(moduleName);
    return;
  }

  if (isPushSoundEnabled()) {
    pushSoundUnlocked = true;
  }

  setupPushSoundUnlock();
  setupFcmTokenRefreshOnVisibility(moduleName);
}

async function getMessagingAppForPush() {
  const firebasePublicEnv = await getFirebasePublicEnv();
  if (!firebasePublicEnv?.vapidKey) return null;
  const app = getMessagingFirebaseApp(firebasePublicEnv);
  if (!app) return null;
  const { isSupported } = await import("firebase/messaging");
  if (!(await isSupported().catch(() => false))) return null;
  return { app, firebasePublicEnv };
}

export function getWebNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * What the notification prompt UI should do on this device:
 * "native" (Flutter shell owns push), "ios-needs-install" (iOS Safari tab —
 * web push only works from the Home Screen app), "unsupported", or the
 * browser permission ("default" | "granted" | "denied").
 */
export function getWebPushPromptState() {
  if (typeof window === "undefined") return "unsupported";
  if (isFlutterWebView()) return "native";
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS && !isSupportedBrowser()) {
    const standalone =
      window.navigator.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches;
    return standalone ? "unsupported" : "ios-needs-install";
  }
  if (!isSupportedBrowser() || !isSecureContextForPush()) return "unsupported";
  return Notification.permission;
}

/**
 * Must be called straight from a tap/click handler: iOS ignores
 * Notification.requestPermission() when it is not triggered by a user gesture,
 * which is why the automatic prompt never produced a token on iPhones.
 * The permission request is therefore the first await in this function.
 */
export async function enableWebPushFromUserGesture(moduleName = "user") {
  if (!isSupportedBrowser() || !isSecureContextForPush()) return "unsupported";
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") return permission;
  await registerWebPushForCurrentModule(`/food/${moduleName}`);
  return permission;
}

/**
 * Pending verification screen: register service worker + foreground listener (no login).
 * Without this, FCM delivers but the browser tab never shows the notification.
 */
export async function setupPendingVerificationPushListeners(moduleName) {
  if (isFlutterWebView()) {
    initPushNotificationClient();
    return true;
  }
  if (!isSupportedBrowser() || !isSecureContextForPush()) return false;
  initPushNotificationClient();
  const ready = await getMessagingAppForPush();
  if (!ready) return false;
  try {
    await registerMessagingServiceWorker(ready.firebasePublicEnv);
    await attachForegroundListener(ready.app);
    return true;
  } catch {
    return false;
  }
}

/**
 * User taps "Enable notifications" on pending screen (browser requires a click for Allow).
 */
export async function enablePendingVerificationPush(moduleName, phone) {
  if (!phone || !moduleName) return false;
  if (isFlutterWebView()) {
    return syncNativeAppPushToken(moduleName, phone);
  }
  if (!isSupportedBrowser() || !isSecureContextForPush()) return false;

  const ready = await getMessagingAppForPush();
  if (!ready) return false;

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return false;

  const registration = await registerMessagingServiceWorker(ready.firebasePublicEnv);
  await attachForegroundListener(ready.app);

  const { getMessaging, getToken } = await import("firebase/messaging");
  const messaging = getMessaging(ready.app);
  const token = await getToken(messaging, {
    vapidKey: ready.firebasePublicEnv.vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) return false;
  setSavedToken(moduleName, token);

  return persistPendingModuleFcmToken(moduleName, phone, {
    fcmToken: token,
    platform: "web",
    requestPermission: false,
    maxAttempts: 2,
  });
}

async function attachForegroundListener(firebaseAppInstance) {
  if (foregroundListenerAttached) return;

  const { getMessaging, onMessage, isSupported } = await import("firebase/messaging");
  const supported = await isSupported().catch(() => false);
  if (!supported) return;

  const messaging = getMessaging(firebaseAppInstance);
  setupPushSoundUnlock();
  attachServiceWorkerMessageListener();

  onMessage(messaging, (payload) => {
    pushDebugLog(PUSH_DEBUG_PREFIX, "Received Firebase foreground message", { payload });
    scheduleForegroundNotification(payload);
  });

  foregroundListenerAttached = true;
}

const nativeRegistrationInFlight = new Set();

export async function registerWebPushForCurrentModule(pathname = window.location.pathname) {
  const moduleName = normalizeModuleFromPath(pathname);

  initPushNotificationClient();

  const cachedToken = getSavedToken(moduleName);
  if (cachedToken && getBackendSyncedToken(moduleName) === cachedToken) {
    // The FCM half is already synced — but on an iPhone the VoIP token can
    // arrive later than the FCM one (PushKit registers asynchronously, and an
    // app update can add VoIP support to an install whose FCM token never
    // changed). Returning here unconditionally meant such a device could never
    // register for order calls. Let it through when VoIP is still pending.
    const voipStillPending =
      isFlutterWebView() &&
      VOIP_MODULES.has(moduleName) &&
      !getVoipBackendSyncedSignature(moduleName);
    if (!voipStillPending) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "FCM already synced this session — skip registration", {
        moduleName,
      });
      return;
    }
    pushDebugLog(PUSH_DEBUG_PREFIX, "FCM synced but VoIP token not registered yet — continuing", {
      moduleName,
    });
  }

  if (isFlutterWebView()) {
    // Ask the app itself (not the cache) so an updated build's token and
    // capabilities reach the server at launch; the cache is still the fallback.
    // iOS can take several seconds to hand out the first FCM token (it waits on
    // the APNs registration), longer than the default 2s collect window.
    // One lookup per module at a time: every route change (login -> otp) calls
    // this, and stacked bridge-polling loops hog the iOS main thread, which
    // makes typing and the keyboard lag on the login screen.
    if (nativeRegistrationInFlight.has(moduleName)) return;
    nativeRegistrationInFlight.add(moduleName);
    try {
      await persistModuleFcmToken(moduleName, {
        maxAttempts: 10,
        delayMs: 500,
        skipCache: true,
        collectTimeoutMs: FCM_SUBMIT_COLLECT_TIMEOUT_MS,
      });
    } finally {
      nativeRegistrationInFlight.delete(moduleName);
    }
    return;
  }

  const isPendingPath = pathname.includes("/pending-verification");
  const accessToken = localStorage.getItem(`${moduleName}_accessToken`);

  if (
    !accessToken &&
    isPendingPath &&
    (moduleName === "restaurant" || moduleName === "delivery")
  ) {
    const pendingPhone =
      moduleName === "delivery"
        ? sessionStorage.getItem("delivery_pendingPhone")
        : localStorage.getItem("restaurant_pendingPhone");
    void setupPendingVerificationPushListeners(moduleName);
    if (pendingPhone && typeof Notification !== "undefined" && Notification.permission === "granted") {
      void persistPendingModuleFcmToken(moduleName, pendingPhone, {
        requestPermission: false,
        collectTimeoutMs: FCM_SUBMIT_COLLECT_TIMEOUT_MS,
      });
    }
    return;
  }

  if (!accessToken) return;

  const supportsBrowserPush = isSupportedBrowser() && isSecureContextForPush();

  if (supportsBrowserPush) {
    if (registrationInFlight) return registrationInFlight;

    registrationInFlight = (async () => {
      const firebasePublicEnv = await getFirebasePublicEnv();
      if (!firebasePublicEnv?.vapidKey) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "FCM web registration skipped: FIREBASE_VAPID_KEY is missing in env setup.");
        return;
      }

      const app = getMessagingFirebaseApp(firebasePublicEnv);
      if (!app) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "FCM web registration skipped: Firebase public web config is incomplete.");
        return;
      }

      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;

      if (permission !== "granted") {
        pushDebugLog(PUSH_DEBUG_PREFIX, "FCM web registration skipped: Notification permission not granted.", { permission });
        return;
      }

      const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
      const supported = await isSupported().catch(() => false);
      if (!supported) return;

      const registration = await registerMessagingServiceWorker(firebasePublicEnv);
      pushDebugLog(PUSH_DEBUG_PREFIX, "Service worker registered for push", {
        scope: registration.scope,
        moduleName,
      });
      const messaging = getMessaging(app);

      const token = await getToken(messaging, {
        vapidKey: firebasePublicEnv.vapidKey,
        serviceWorkerRegistration: registration,
      });

      if (!token) return;
      setSavedToken(moduleName, token);
      pushDebugLog(PUSH_DEBUG_PREFIX, "FCM token resolved", {
        moduleName,
        tokenPreview: `${token.slice(0, 12)}...`,
      });

      // Removed localStorage caching (getSavedToken/setSavedToken) as per user requirements.
      // The backend 'upsert' already handles duplicates efficiently.
      try {
        pushDebugLog(PUSH_DEBUG_PREFIX, "Synchronizing FCM token with backend database", { moduleName, tokenPreview: `${token?.slice(0, 10)}...` });
        await saveTokenByModule(moduleName, token);
        pushDebugLog(PUSH_DEBUG_PREFIX, "FCM token synchronized with backend successfully");
      } catch (e) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Failed to synchronize FCM token to backend", { error: e?.message || e, stack: e?.stack });
      }
      
      await attachForegroundListener(app);
    })()
    .catch((e) => {
      console.error("FCM web registration failed:", e);
    })
    .finally(() => {
      registrationInFlight = null;
    });

    return registrationInFlight;
  }

  // Flutter WebView fallback: register native token when browser web push isn't available.
  // This keeps restaurant/delivery FCM alerts working even when Web Push APIs are limited.
  await registerNativeWebViewFcmToken(moduleName);
  return null;
}
