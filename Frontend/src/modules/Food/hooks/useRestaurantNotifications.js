import { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { API_BASE_URL } from '@food/api/config';
import { restaurantAPI } from '@food/api';
import { dispatchNotificationInboxRefresh } from '@food/hooks/useNotificationInbox';
import {
  isNativeAppWebView,
  shouldSkipDuplicateOsNotification,
  stopActivePushPlayback,
} from '@food/utils/firebaseMessaging';
import { normalizeRestaurantOrderView } from '@food/utils/restaurantOrderPricing';
import {
  RESTAURANT_DECIDABLE_STATUSES,
  setActiveRestaurant,
  clearActiveRestaurant,
  hasActiveRestaurant,
  isForActiveRestaurant,
  isRealOrderId,
  logRefusedRing,
  markRestaurantOrdersHandled,
} from '@food/utils/restaurantAlertSession';

const alertSound = '/assets/media/restaurant_alert.mp3';
const debugLog = (...args) => {};
const debugWarn = (...args) => {};
const debugError = (...args) => {};

let cachedAudioBlobUrl = null;
const preloadAudio = async () => {
  if (cachedAudioBlobUrl) return cachedAudioBlobUrl;
  try {
    const response = await fetch(alertSound);
    if (response.ok) {
      const blob = await response.blob();
      cachedAudioBlobUrl = URL.createObjectURL(blob);
      return cachedAudioBlobUrl;
    }
  } catch (e) {
    debugWarn('Failed to preload audio blob:', e);
  }
  return alertSound;
};

// Do NOT preload on import — this hook is imported from shared Food routes,
// and eager fetch() would load restaurant_alert.mp3 on user/delivery pages too.

const resolveAudioSource = (source) => {
  return cachedAudioBlobUrl || source;
};

const supportsBrowserNotifications = () =>
  typeof window !== 'undefined' && typeof Notification !== 'undefined';

const buildRestaurantOrderNotification = (orderData = {}) => {
  const orderId = orderData.orderId || orderData.orderMongoId || 'New';
  const itemCount = Array.isArray(orderData.items) ? orderData.items.length : 0;
  const total = Number(orderData.total || orderData.pricing?.total || 0);

  return {
    title: `New order #${orderId}`,
    body: itemCount > 0
      ? `${itemCount} item${itemCount === 1 ? '' : 's'} - ₹${total.toFixed(2)}`
      : 'A new order is waiting for review',
    // Prefer the backend tag: the service worker renders the push with the same
    // value, so if both paths fire the second showNotification() replaces the
    // first instead of stacking a second banner on the device.
    tag: orderData.notificationTag || `restaurant-order-${orderId}`,
    data: {
      orderId,
      targetUrl: `/restaurant/orders/${orderData.orderMongoId || orderData.orderId || ''}`,
    },
  };
};

const triggerWebViewNativeNotification = async (orderData = {}) => {
  if (typeof window === 'undefined') return false;

  const bridgePayload = {
    title: 'New restaurant order',
    body: `Order #${orderData?.orderId || orderData?.orderMongoId || orderData?.id || ''}`.trim(),
    orderId: orderData?.orderId || orderData?.order_id || '',
    orderMongoId: orderData?.orderMongoId || orderData?.order_mongo_id || '',
    targetUrl: `/restaurant/orders/${orderData?.orderMongoId || orderData?.orderId || ''}`,
  };

  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === 'function'
    ) {
      const handlerNames = [
        'playNotificationSound',
        'triggerNotificationFeedback',
        'onPushNotification',
        'onNewOrder'
      ];

      for (const handlerName of handlerNames) {
        try {
          await window.flutter_inappwebview.callHandler(handlerName, bridgePayload);
          return true;
        } catch {
          // Try next handler name
        }
      }
    }
  } catch {
    // Ignore bridge failures and fall back to browser/web audio
  }

  return false;
};

const stopWebViewNativeNotification = async () => {
  if (typeof window === 'undefined') return;
  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === 'function'
    ) {
      // stopOrderAlarm: cancels the looping alarm notification the app shows for
      // a new-order push received while it was closed.
      const handlerNames = ['stopNotificationSound', 'stopOrderRingtone', 'dismissNotification', 'stopOrderAlarm'];
      for (const handlerName of handlerNames) {
        try {
          await window.flutter_inappwebview.callHandler(handlerName, {});
        } catch {
          // Try next handler
        }
      }
    }
  } catch {
    // Ignore bridge failures
  }
};

// --------------------------------------------------------------------------
// GLOBAL SINGLETON STATE (Shared across all component hook instances)
// --------------------------------------------------------------------------
let globalIsMuted = false;
if (typeof window !== 'undefined') {
  globalIsMuted = localStorage.getItem('restaurant_notifications_muted') === 'true';
}

let globalMutedOrderIds = new Set();
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('restaurant_muted_order_ids');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        globalMutedOrderIds = new Set(parsed);
      }
    }
  } catch (e) {
    debugWarn('Failed to parse restaurant_muted_order_ids:', e);
  }
}

const saveMutedOrderIds = () => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('restaurant_muted_order_ids', JSON.stringify(Array.from(globalMutedOrderIds)));
    } catch (e) {
      debugWarn('Failed to save restaurant_muted_order_ids:', e);
    }
  }
};

let globalNewOrder = null;
let globalNewReservation = null;
let globalActiveOrder = null;

// Audio player references
let globalAudio = null;
let globalFallbackAudio = null;
/*
 * Bumped by every stop. play() resolves or rejects asynchronously, so a track
 * that was still starting when the restaurant accepted the order would come
 * back to life (or spawn a fallback) after the stop had already run - a
 * ringtone nothing was left holding a reference to, and a second copy stacked
 * on top of it when the next order arrived. Playback callbacks compare the
 * generation they were started in and give up if it has moved on.
 */
let alertPlaybackGeneration = 0;
let globalAlertLoopTimer = null;
let globalAlertLoopStartedAt = 0;
let globalAlertLoopKey = '';
let globalAlertDeadline = 0;
/* When this device last started ringing for an order (not restored from storage). */
let globalAlertArmedAt = 0;
/*
 * The native app can ring on its own - the alarm for a push that arrived while
 * it was closed or in the background - without this page knowing. Until a poll
 * confirms there is nothing to ring for, assume it might be ringing.
 */
let nativeAlarmMayBeRinging = true;
/*
 * Orders snapshots can be up to a few seconds old (client cache and in-flight
 * request sharing). A snapshot is never used to silence a ring that started
 * within this margin of it: the order may simply not be in it yet.
 */
const ORDERS_SNAPSHOT_MAX_AGE_MS = 5000;

/*
 * Every id of each order already announced (handed to the popup and rung for)
 * in this app session, whether it came from the `new_order` socket event or
 * the poll. Only stops the poll announcing the same order twice; whether an
 * order may ring is decided by getOrderRingRefusal alone.
 */
const announcedOrderIds = new Set();

/*
 * Browsers only allow sound after a user gesture. The unlock runs once per page,
 * not once per component using this hook: each mount used to add another
 * one-shot tap handler, and after the first unlock that handler called play()
 * on the element already loaded with the real ringtone - so navigating to
 * another screen and tapping anything rang the full ringtone with no order.
 */
let alertAudioUnlocked = false;
let alertAudioUnlockAttached = false;

// Socket and Polling references
let globalSocket = null;
let globalSocketConnected = false;
let globalActiveRestaurantId = null;
let globalPollingIntervalId = null;
let globalSocketWatchdogAttached = false;

/** The access token as it is *right now* - never a copy taken at login. */
const readRestaurantSocketToken = () => {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem('restaurant_accessToken') || localStorage.getItem('accessToken') || '';
};

const reconnectRestaurantSocket = () => {
  if (!globalSocket || globalSocket.connected) return;
  try {
    globalSocket.connect();
  } catch (_) {}
};

/**
 * Keeps the realtime channel alive for the life of the app.
 *
 * Attached once, because the socket outlives every component that uses it.
 * Without this the socket could sit in a permanent failed-reconnect loop - the
 * state where order accepted/rejected/cancelled events simply never arrive and
 * the only cure is closing and reopening the app.
 */
const attachRestaurantSocketWatchdog = () => {
  if (globalSocketWatchdogAttached || typeof window === 'undefined') return;
  globalSocketWatchdogAttached = true;

  // The access token was rotated by the API client. The socket's auth callback
  // reads the new one by itself, so all that is left is waking a dead socket.
  window.addEventListener('authRefreshed', (event) => {
    const module = event?.detail?.module;
    if (module && module !== 'restaurant') return;
    reconnectRestaurantSocket();
  });

  // Mobile WebViews freeze sockets in the background and the OS drops them on a
  // network change; reconnect on the way back instead of waiting for a failed
  // heartbeat to notice.
  window.addEventListener('online', reconnectRestaurantSocket);
  window.addEventListener('focus', reconnectRestaurantSocket);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reconnectRestaurantSocket();
    });
  }

};

// Signing out must stop everything this module owns - including a ring the
// native app started before this page ever opened a socket.
if (typeof window !== 'undefined') {
  window.addEventListener('moduleAuthCleared', (event) => {
    if (event?.detail?.module !== 'restaurant') return;
    teardownRestaurantNotifications();
  });
}

/**
 * Stops every source of a ring and releases the connection. Called on logout;
 * a later login rebuilds all of it from scratch.
 */
export const teardownRestaurantNotifications = () => {
  stopGlobalAlertLoop();

  if (globalPollingIntervalId) {
    clearInterval(globalPollingIntervalId);
    globalPollingIntervalId = null;
  }

  if (globalSocket) {
    try {
      globalSocket.removeAllListeners();
      globalSocket.disconnect();
    } catch (_) {}
    globalSocket = null;
  }
  globalSocketConnected = false;
  globalActiveRestaurantId = null;
  globalActiveOrder = null;
  globalNewOrder = null;
  globalNewReservation = null;
  clearActiveRestaurant();
  announcedOrderIds.clear();

  lastAlertAtByOrder.clear();
  lastBrowserNotificationAtByOrder.clear();

  if (typeof window !== 'undefined') {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith(ALERT_START_PREFIX)) localStorage.removeItem(k);
      });
    } catch (_) {}
  }

  markRestaurantSessionStarted();

  updateGlobalState({ newOrder: null, newReservation: null, activeOrder: null, socketConnected: false });
};

let processedOrderIds = new Set();
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('restaurant_processed_order_ids');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        processedOrderIds = new Set(parsed);
      }
    }
  } catch (e) {}
}

const saveProcessedOrderIds = () => {
  if (typeof window !== 'undefined') {
    try {
      const arr = Array.from(processedOrderIds).slice(-200);
      localStorage.setItem('restaurant_processed_order_ids', JSON.stringify(arr));
    } catch (e) {}
  }
};

const lastAlertAtByOrder = new Map();
const lastBrowserNotificationAtByOrder = new Map();

// Hook subscribers
const subscribers = new Set();

const updateGlobalState = (updates) => {
  if ('isMuted' in updates) {
    globalIsMuted = updates.isMuted;
    localStorage.setItem('restaurant_notifications_muted', globalIsMuted ? 'true' : 'false');
  }
  if ('newOrder' in updates) {
    globalNewOrder = updates.newOrder;
  }
  if ('newReservation' in updates) {
    globalNewReservation = updates.newReservation;
  }
  if ('activeOrder' in updates) {
    globalActiveOrder = updates.activeOrder;
  }
  if ('socketConnected' in updates) {
    globalSocketConnected = updates.socketConnected;
  }
  
  subscribers.forEach((callback) => {
    try {
      callback({
        isMuted: globalIsMuted,
        mutedOrderIds: globalMutedOrderIds,
        newOrder: globalNewOrder,
        newReservation: globalNewReservation,
        isConnected: globalSocketConnected,
      });
    } catch (e) {
      // Ignore defunct subscribers
    }
  });
};

/*
 * Accept window, shared with the Orders page popup.
 *
 * The ringtone keeps going for as long as the order can still be accepted — the
 * admin-configured window counted from when the restaurant was first sent the
 * order — instead of a fixed 2 minutes that went quiet with most of the window
 * left. Defaults match the backend when settings cannot be loaded.
 */
const DEFAULT_ACCEPT_WINDOW_MS = 10 * 60 * 1000;
const ALERT_LOOP_TICK_MS = 4000;
let acceptWindowSettings = { deliveryMs: DEFAULT_ACCEPT_WINDOW_MS, takeawayMs: DEFAULT_ACCEPT_WINDOW_MS, loadedAt: 0 };
let acceptWindowSettingsPromise = null;

const refreshAcceptWindowSettings = () => {
  if (Date.now() - acceptWindowSettings.loadedAt < 60000) return Promise.resolve(acceptWindowSettings);
  if (acceptWindowSettingsPromise) return acceptWindowSettingsPromise;
  acceptWindowSettingsPromise = restaurantAPI
    .getRestaurantSettings()
    .then((res) => {
      const data = res?.data?.data || {};
      const toMs = (minutes) => {
        const n = Number(minutes);
        return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) * 60000 : DEFAULT_ACCEPT_WINDOW_MS;
      };
      acceptWindowSettings = {
        deliveryMs: toMs(data.deliveryAcceptOrderTimeMinutes),
        takeawayMs: toMs(data.takeawayAcceptOrderTimeMinutes),
        loadedAt: Date.now(),
      };
      return acceptWindowSettings;
    })
    .catch(() => acceptWindowSettings)
    .finally(() => {
      acceptWindowSettingsPromise = null;
    });
  return acceptWindowSettingsPromise;
};

/** Epoch ms after which the order can no longer be accepted, or null if unknown. */
export const getOrderAcceptDeadline = (orderData = {}) => {
  const startRaw = orderData?.restaurantNotifiedAt || orderData?.createdAt;
  const start = startRaw ? new Date(startRaw).getTime() : NaN;
  if (!Number.isFinite(start)) return null;
  const isTakeaway = String(orderData?.orderType || orderData?.type || '').toLowerCase() === 'takeaway';
  return start + (isTakeaway ? acceptWindowSettings.takeawayMs : acceptWindowSettings.deliveryMs);
};

/*
 * A pending order rings for as long as the restaurant can still accept it, no
 * matter when it arrived.
 *
 * Orders that reached the restaurant while the app was in the background or
 * the phone was locked - the normal case, since the push is what wakes the
 * restaurant up - used to count as "replays" from before the session resumed
 * and stayed silent: the popup came up with no sound. What keeps a stale order
 * quiet is the order itself: it must still be awaiting this restaurant's
 * decision on the server, not handled on this device, not muted, and inside
 * its accept window (isRingableOrder / getOrderRingRefusal).
 */

/** A different restaurant signed in (or signed out): nothing from before may ring. */
export const markRestaurantSessionStarted = () => {
  stopGlobalAlertLoop();
  globalActiveOrder = null;
  globalNewOrder = null;
  globalNewReservation = null;
  lastAlertAtByOrder.clear();
  lastBrowserNotificationAtByOrder.clear();
  if (typeof window !== 'undefined') {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith(ALERT_START_PREFIX)) localStorage.removeItem(k);
      });
    } catch (_) {}
  }
  updateGlobalState({ newOrder: null, newReservation: null, activeOrder: null });
};

const ALERT_START_PREFIX = 'alert_start_';

const getOrderIdVariants = (orderData = {}) =>
  [
    orderData?.orderMongoId,
    orderData?.order_mongo_id,
    orderData?.orderId,
    orderData?.order_id,
    orderData?._id,
    orderData?.id,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);

/** Forget when an order started ringing, once it is accepted, rejected or gone. */
const forgetAlertStart = (orderOrId) => {
  if (typeof window === 'undefined' || !orderOrId) return;
  const ids = typeof orderOrId === 'object' ? getOrderIdVariants(orderOrId) : [String(orderOrId).trim()];
  try {
    ids.forEach((id) => localStorage.removeItem(`${ALERT_START_PREFIX}${id}`));
  } catch (_) {}
  // A late push for this order must not start the ringtone again.
  markRestaurantOrdersHandled(ids);
};

// Drop start markers left behind by orders from earlier sessions.
if (typeof window !== 'undefined') {
  try {
    Object.keys(localStorage).forEach((k) => {
      if (!k.startsWith(ALERT_START_PREFIX)) return;
      const at = Number(localStorage.getItem(k));
      if (!Number.isFinite(at) || Date.now() - at > 2 * 60 * 60 * 1000) localStorage.removeItem(k);
    });
  } catch (_) {}
}

/*
 * iOS 17+ (Safari and WKWebView) mutes page audio with the ringer switch. While
 * an order is ringing the page claims a "playback" session, like a media app,
 * so a phone left on silent still rings; it goes back to "auto" on stop.
 * Browsers without the Audio Session API are unaffected.
 */
const setAlertAudioSession = (type) => {
  try {
    if (typeof navigator !== 'undefined' && navigator.audioSession) {
      navigator.audioSession.type = type;
    }
  } catch (_) {}
};

const stopGlobalAlertLoop = () => {
  // Invalidate any playback still in flight before touching the elements.
  alertPlaybackGeneration += 1;
  if (typeof window !== 'undefined') window.__restaurantOrderAlertActive = false;
  setAlertAudioSession('auto');

  if (globalAlertLoopTimer) {
    clearInterval(globalAlertLoopTimer);
    globalAlertLoopTimer = null;
  }
  globalAlertLoopStartedAt = 0;
  globalAlertLoopKey = '';
  globalAlertDeadline = 0;

  if (globalAudio) {
    try {
      globalAudio.loop = false;
      globalAudio.pause();
      globalAudio.currentTime = 0;
    } catch (_) {}
  }
  if (globalFallbackAudio) {
    try {
      globalFallbackAudio.pause();
      globalFallbackAudio.currentTime = 0;
    } catch (_) {}
    globalFallbackAudio = null;
  }
  // The same order can also arrive as a push, which plays its own copy of this
  // ringtone; accepting or rejecting has to silence that one too.
  try {
    stopActivePushPlayback();
  } catch (_) {}
  stopWebViewNativeNotification();
  nativeAlarmMayBeRinging = false;
};

const ensureGlobalAlertAudio = () => {
  if (typeof window === 'undefined') return null;
  if (!globalAudio) {
    globalAudio = new Audio(resolveAudioSource(alertSound));
    globalAudio.preload = 'auto';
    preloadAudio().then((src) => {
      if (globalAudio && globalAudio.paused) globalAudio.src = src;
    });
  }
  return globalAudio;
};

/**
 * Plays the order ringtone. Internal: only startGlobalAlertLoop (after the ring
 * gate) and its keep-alive tick call it - it is not exposed to components.
 *
 * With `loop` the full track repeats seamlessly until stopGlobalAlertLoop(). The
 * loop used to rewind a 28-second ringtone to 0 every 4.5 seconds, so restaurants
 * only ever heard a choppy fragment. Calling this while it is already playing
 * leaves the audio alone.
 */
const playGlobalNotificationSound = async (orderData = {}, { loop = false } = {}) => {
  try {
    if (globalIsMuted || isOrderMuted(orderData)) return;
    const generation = alertPlaybackGeneration;
    void triggerWebViewNativeNotification(orderData).catch(() => {});
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([200, 100, 200, 100, 300]);
      } catch (_) {}
    }

    if (!ensureGlobalAlertAudio()) return;

    // Also claims the element from an in-flight silent unlock (see unlockAlertAudio).
    globalAudio.muted = false;
    globalAudio.volume = 1;

    // Already ringing - on either element: do not start a second track, and
    // never let a one-shot chime (e.g. a dining booking) turn off the looping
    // order alert. Checking only globalAudio let the fallback play underneath.
    if (isAlertSoundPlaying()) {
      if (loop) {
        if (globalAudio && !globalAudio.paused) globalAudio.loop = true;
        if (globalFallbackAudio && !globalFallbackAudio.paused) globalFallbackAudio.loop = true;
      }
      return;
    }
    globalAudio.loop = Boolean(loop);
    setAlertAudioSession('playback');

    const started = globalAudio.play();
    if (started && typeof started.then === 'function') {
      started
        .then(() => {
          // Stopped while play() was still pending: do not ring on.
          if (generation === alertPlaybackGeneration) return;
          try {
            globalAudio.pause();
            globalAudio.currentTime = 0;
          } catch (_) {}
        })
        .catch((error) => {
          // The alert was stopped (accepted/rejected) before this settled - a
          // fallback started now would ring with nothing left to stop it.
          if (generation !== alertPlaybackGeneration) return;
          // Autoplay blocked until the user interacts; the interaction handler resumes it.
          if (error?.name === 'NotAllowedError' || error?.message?.includes("user didn't interact")) return;
          try {
            if (globalFallbackAudio) {
              globalFallbackAudio.pause();
              globalFallbackAudio = null;
            }
            const fallback = new Audio(alertSound);
            fallback.loop = Boolean(loop);
            fallback.volume = 1;
            globalFallbackAudio = fallback;
            fallback
              .play()
              .then(() => {
                if (generation === alertPlaybackGeneration) return;
                try {
                  fallback.pause();
                  fallback.currentTime = 0;
                } catch (_) {}
              })
              .catch(() => {});
          } catch (_) {}
        });
    }
  } catch (error) {
    // ignore
  }
};

const isAlertSoundPlaying = () =>
  Boolean((globalAudio && !globalAudio.paused) || (globalFallbackAudio && !globalFallbackAudio.paused));

const startGlobalAlertLoop = (orderData) => {
  // Last line of defence: every caller (socket arrival, the poll, the Orders
  // page re-arming the order in its popup, unmute, resume after the first tap)
  // goes through here. It may only ring a real order of this restaurant that is
  // still awaiting its decision. It used to also require a `new_order` socket
  // event in this session, so an order the popup loaded from the API - every
  // order that arrived while the app was in the background - showed with no sound.
  const refusal = getOrderRingRefusal(orderData);
  if (refusal) {
    if (orderData) logRefusedRing('alert', refusal, describeOrderForLog(orderData));
    return;
  }
  const orderId = getOrderAlertKey(orderData);

  // The Orders page re-renders often; restarting the same order's alert would
  // rewind the ringtone and reset its timer. Just refresh the order it refers to.
  if (globalAlertLoopTimer && orderId && orderId === globalAlertLoopKey) {
    globalActiveOrder = orderData;
    const deadline = getOrderAcceptDeadline(orderData);
    if (deadline) globalAlertDeadline = deadline;
    if (!globalIsMuted && !isOrderMuted(orderData) && !isAlertSoundPlaying()) {
      playGlobalNotificationSound(orderData, { loop: true });
    }
    return;
  }

  stopGlobalAlertLoop();

  const storageKey = `${ALERT_START_PREFIX}${orderId}`;
  let alertStartTime = typeof window !== 'undefined' ? Number(localStorage.getItem(storageKey)) : 0;
  if (!alertStartTime) {
    alertStartTime = Date.now();
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(storageKey, String(alertStartTime));
      } catch (_) {}
    }
  }

  // Claim the ringtone for this order: a push carrying the same order must not
  // play its own copy on top (see playPushSound).
  if (typeof window !== 'undefined') window.__restaurantOrderAlertActive = true;

  globalAlertLoopStartedAt = alertStartTime;
  globalAlertArmedAt = Date.now();
  // The ring also goes through the native app (playGlobalNotificationSound).
  nativeAlarmMayBeRinging = true;
  globalAlertLoopKey = orderId;
  globalAlertDeadline = getOrderAcceptDeadline(orderData) || alertStartTime + DEFAULT_ACCEPT_WINDOW_MS;
  globalActiveOrder = orderData;
  updateGlobalState({ activeOrder: orderData });

  if (Date.now() >= globalAlertDeadline) {
    stopGlobalAlertLoop();
    return;
  }

  if (!globalIsMuted && !isOrderMuted(orderData)) {
    playGlobalNotificationSound(orderData, { loop: true });
  }

  globalAlertLoopTimer = setInterval(() => {
    if (!globalActiveOrder) {
      stopGlobalAlertLoop();
      return;
    }

    // Stop exactly when the order can no longer be accepted.
    if (Date.now() >= globalAlertDeadline) {
      stopGlobalAlertLoop();
      return;
    }

    // Respect BOTH the global mute and the per-order mute.
    if (globalIsMuted || isOrderMuted(globalActiveOrder)) {
      if (isAlertSoundPlaying()) {
        try {
          globalAudio?.pause();
          globalFallbackAudio?.pause();
        } catch (_) {}
      }
      return;
    }

    // Keep ringing if the OS/browser paused the audio (call, focus loss), and
    // re-buzz for devices where vibration is the main signal.
    if (!isAlertSoundPlaying()) {
      playGlobalNotificationSound(globalActiveOrder, { loop: true });
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([200, 100, 200, 100, 300]);
      } catch (_) {}
    }
  }, ALERT_LOOP_TICK_MS);
};

const isProcessedOrder = (orderData) => {
  if (!orderData) return false;
  const ids = [
    orderData.orderMongoId,
    orderData.orderId,
    orderData._id,
    orderData.id,
    orderData.mongoId,
    orderData.order_id,
    orderData.order_mongo_id
  ].filter(Boolean);
  return ids.some(id => processedOrderIds.has(String(id).trim()));
};

const getOrderAlertKey = (orderData = {}) => (
  String(
    orderData?.orderMongoId ||
    orderData?.order_mongo_id ||
    orderData?.orderId ||
    orderData?.order_id ||
    orderData?._id ||
    orderData?.id ||
    ''
  ).trim()
);

// True if ANY of the order's id variants is muted. Different call sites resolve
// the "order id" with slightly different priorities, so checking all variants
// avoids a mute being missed just because a different id field was stored.
const isOrderMuted = (orderData = {}) => {
  const ids = [
    orderData?.orderMongoId,
    orderData?.order_mongo_id,
    orderData?.orderId,
    orderData?.order_id,
    orderData?._id,
    orderData?.id,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  return ids.some((id) => globalMutedOrderIds.has(id));
};

/*
 * The single gate every ring has to pass.
 *
 * The ringtone used to start for anything that reached a handler, including a
 * payload with no order in it at all: an empty object survived every check
 * (no id to look up, no createdAt so no accept deadline, empty dedupe key) and
 * then rang for the whole 10-minute accept window. It also rang again for an
 * order the restaurant had already answered, because the resume paths replayed
 * `globalActiveOrder` without re-checking it.
 *
 * A ring now requires: a real order identity, a status the restaurant can still
 * act on, not already handled, and still inside its accept window.
 */
export const isRingableOrder = (orderData) => {
  if (!orderData || typeof orderData !== 'object') return false;

  // 1. It must identify a real order.
  const orderKey = getOrderAlertKey(orderData);
  if (!orderKey) return false;

  /*
   * 2. It must still be awaiting this restaurant's decision. Read the backend
   * enum (`orderStatus`), falling back to `status` if present.
   */
  const rawStatus = String(orderData.orderStatus ?? orderData.status ?? '').toLowerCase().trim();
  if (!rawStatus || !RESTAURANT_DECIDABLE_STATUSES.has(rawStatus)) return false;

  // 3. Not already accepted, rejected or otherwise handled on this device.
  if (isProcessedOrder(orderData)) return false;

  // 4. Still inside the window in which it can be accepted.
  const deadline = getOrderAcceptDeadline(orderData);
  if (deadline && Date.now() >= deadline) return false;

  return true;
};

const getRestaurantRef = (orderData = {}) =>
  orderData?.restaurantId ?? orderData?.restaurant_id ?? orderData?.restaurant ?? null;

/**
 * Why this order must not ring, or '' when it may. Checked for every ring:
 * a real order id, the signed-in restaurant's own order, and still awaiting its
 * decision (status, not already handled, inside the accept window).
 */
const getOrderRingRefusal = (orderData) => {
  if (!orderData || typeof orderData !== 'object') return 'no order data';
  if (!isRealOrderId(getOrderAlertKey(orderData))) return 'no valid order id';
  if (!hasActiveRestaurant()) return 'signed-in restaurant not verified yet';
  if (!isForActiveRestaurant(getRestaurantRef(orderData))) return 'order is not for the signed-in restaurant';
  if (!isRingableOrder(orderData)) return 'order is not awaiting this restaurant (status, already handled, or accept window over)';
  return '';
};

const markOrderAnnounced = (orderData) => {
  getOrderIdVariants(orderData).forEach((id) => announcedOrderIds.add(id));
};

const wasOrderAnnounced = (orderData) => getOrderIdVariants(orderData).some((id) => announcedOrderIds.has(id));

const describeOrderForLog = (orderData) => ({
  orderId: getOrderAlertKey(orderData || {}) || null,
  orderStatus: orderData?.orderStatus ?? orderData?.status ?? null,
  restaurantId: getRestaurantRef(orderData || {}) || null,
});

const shouldProcessOrderAlert = (orderData = {}) => {
  const key = getOrderAlertKey(orderData);
  if (!key) return true;
  const now = Date.now();
  const last = lastAlertAtByOrder.get(key) || 0;
  const ALERT_DEDUPE_MS = 15000;
  if (now - last < ALERT_DEDUPE_MS) return false;
  lastAlertAtByOrder.set(key, now);
  return true;
};

const shouldShowBrowserNotification = (orderData = {}) => {
  const key = getOrderAlertKey(orderData);
  if (!key) return true;
  const now = Date.now();
  const last = lastBrowserNotificationAtByOrder.get(key) || 0;
  const BROWSER_NOTIFICATION_DEDUPE_MS = 20000;
  if (now - last < BROWSER_NOTIFICATION_DEDUPE_MS) return false;
  lastBrowserNotificationAtByOrder.set(key, now);
  return true;
};

const showBackgroundOrderNotification = async (orderData) => {
  if (isNativeAppWebView()) {
    return;
  }

  if (
    shouldSkipDuplicateOsNotification({
      // The backend event id is what the push carries, so passing it through
      // makes the socket fallback and the push resolve to the same dedupe key.
      eventId: orderData?.eventId || orderData?.idempotencyKey,
      tag: orderData?.notificationTag,
      orderMongoId: orderData?.orderMongoId || orderData?._id,
      orderId: orderData?.orderId || orderData?.order_id,
      orderStatus: orderData?.status || orderData?.orderStatus || 'new',
    })
  ) {
    return;
  }

  if (!shouldShowBrowserNotification(orderData)) {
    return;
  }

  if (!supportsBrowserNotifications() || Notification.permission !== 'granted') {
    return;
  }

  const notificationOptions = buildRestaurantOrderNotification(orderData);

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(notificationOptions.title, {
          body: notificationOptions.body,
          tag: notificationOptions.tag,
          renotify: false,
          requireInteraction: true,
          silent: false,
          vibrate: [200, 100, 200, 100, 300],
          data: notificationOptions.data,
        });
        return;
      }
    }

    new Notification(notificationOptions.title, {
      body: notificationOptions.body,
      tag: notificationOptions.tag,
      requireInteraction: true,
      silent: false,
      data: notificationOptions.data,
    });
  } catch (error) {
    // ignore
  }
};

/*
 * Events that count as a user gesture for media on every mobile browser. iOS
 * does not accept pointerdown/touchstart, and it only honours a play() made
 * synchronously inside the handler - never one made after an `await`.
 */
const ALERT_UNLOCK_EVENTS = ['click', 'touchend', 'pointerup', 'keydown'];
/* After unlocking, wait for the rest of the tap (a mute/accept/reject click) to land. */
const RING_RESUME_AFTER_UNLOCK_MS = 300;

const markAlertAudioUnlocked = () => {
  if (alertAudioUnlocked) return;
  alertAudioUnlocked = true;
  detachAlertAudioUnlock();

  // An announced order that could not sound before the first tap rings now,
  // through the same gate as every other ring - unless that same tap muted,
  // accepted or rejected it.
  setTimeout(() => {
    if (globalActiveOrder && !globalIsMuted && !isOrderMuted(globalActiveOrder)) {
      startGlobalAlertLoop(globalActiveOrder);
    }
  }, RING_RESUME_AFTER_UNLOCK_MS);
};

const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

/**
 * Unlocks audio on the first user gesture - 100% silently.
 *
 * Uses a 1-sample silent dummy audio buffer and Web Audio API rather than
 * calling play() on the real restaurant_alert.mp3. This completely prevents
 * false audible chimes on iOS WebKit/WKWebView while fully satisfying browser
 * media autoplay permissions for future real orders.
 */
const unlockAlertAudio = () => {
  if (typeof window === 'undefined' || alertAudioUnlocked) return;
  window.__userHasInteracted = true;

  // 1. Prime Web Audio Context with silent inaudible buffer
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (AudioCtx) {
    try {
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (_) {}
  }

  // 2. Pre-initialize global audio object without playing the audio file
  ensureGlobalAlertAudio();

  // 3. Play a 100% silent 1-sample dummy audio to unlock HTMLAudioElement media pipeline
  try {
    const silentAudio = new Audio(SILENT_AUDIO_DATA_URI);
    const started = silentAudio.play();
    if (started && typeof started.then === 'function') {
      started
        .then(() => {
          try {
            silentAudio.pause();
          } catch (_) {}
          markAlertAudioUnlocked();
        })
        .catch(() => {
          markAlertAudioUnlocked();
        });
      return;
    }
  } catch (_) {}

  markAlertAudioUnlocked();
};

const attachAlertAudioUnlock = () => {
  if (typeof window === 'undefined' || alertAudioUnlocked || alertAudioUnlockAttached) return;
  alertAudioUnlockAttached = true;
  // Capture phase on window: a handler that stops propagation cannot hide the gesture.
  ALERT_UNLOCK_EVENTS.forEach((type) =>
    window.addEventListener(type, unlockAlertAudio, { capture: true, passive: true }),
  );
};

function detachAlertAudioUnlock() {
  if (typeof window === 'undefined') return;
  ALERT_UNLOCK_EVENTS.forEach((type) =>
    window.removeEventListener(type, unlockAlertAudio, { capture: true }),
  );
  alertAudioUnlockAttached = false;
}

/**
 * Hook for restaurant to receive real-time order notifications with sound
 * @returns {object} - { newOrder, isConnected, isMuted, setMuted, clearNewOrder, stopSound, startAlertLoop, ... }
 */
export const useRestaurantNotifications = () => {
  const [localState, setLocalState] = useState({
    isMuted: globalIsMuted,
    mutedOrderIds: globalMutedOrderIds,
    newOrder: globalNewOrder,
    newReservation: globalNewReservation,
    isConnected: globalSocketConnected,
  });

  const [restaurantId, setRestaurantId] = useState(null);

  // Subscribe to global updates
  useEffect(() => {
    const callback = (newState) => {
      setLocalState(newState);
    };
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }, []);

  // Fetch restaurant ID from API on mount
  useEffect(() => {
    const fetchRestaurantId = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant();
        if (response.data?.success && response.data.data?.restaurant) {
          const restaurant = response.data.data.restaurant;
          if (restaurant.status !== "approved") {
            // Not a live restaurant: nothing may ring for it.
            clearActiveRestaurant();
            return;
          }
          const id = restaurant._id?.toString() || restaurant.restaurantId;
          /*
           * Every screen that uses this hook runs this fetch when it mounts.
           * Resetting on each of them stopped a ring that was still owed:
           * opening another screen - or the app's own screens mounting after a
           * notification tap - silenced an order nobody had answered. Only a
           * different signed-in restaurant starts clean.
           */
          const isSameRestaurant = isForActiveRestaurant(restaurant);
          // The server-verified signed-in restaurant: only its orders can ring.
          setActiveRestaurant(restaurant);
          refreshAcceptWindowSettings();
          if (!isSameRestaurant) markRestaurantSessionStarted();
          setRestaurantId(id);
        }
      } catch (error) {
        // ignore
      }
    };
    fetchRestaurantId();
  }, []);

  /*
   * Announces an order to the restaurant: the popup and the ringtone. It comes
   * from the `new_order` socket event, or from the poll for any order still
   * waiting that the socket did not deliver (app in the background, phone
   * locked, socket reconnecting, mobile network drop). Both pass the same gate:
   * a real order of the signed-in restaurant that is still awaiting its
   * decision. Anything else is refused - and logged - before it can touch the
   * popup or the ringtone.
   */
  const handleIncomingOrderAlert = useCallback((orderData, source = 'unknown') => {
    if (source !== 'socket' && source !== 'poll' && source !== 'push') {
      logRefusedRing(source, 'rings start only from a new-order arrival (socket event, poll, or push)', describeOrderForLog(orderData));
      return;
    }

    const normalizedOrder = normalizeRestaurantOrderView(orderData);

    const refusal = getOrderRingRefusal(normalizedOrder);
    if (refusal) {
      logRefusedRing(source, refusal, describeOrderForLog(normalizedOrder));
      return;
    }

    if (normalizedOrder?.scheduledAt) {
      const scheduledTime = new Date(normalizedOrder.scheduledAt).getTime();
      const now = Date.now();
      if (scheduledTime > now + 15 * 60000) {
        return;
      }
    }

    // Past its accept window: nothing to ring for.
    const deadline = getOrderAcceptDeadline(normalizedOrder);
    if (deadline && Date.now() >= deadline) {
      return;
    }

    const deduped = !shouldProcessOrderAlert(normalizedOrder);
    if (deduped) {
      return;
    }

    markOrderAnnounced(normalizedOrder);
    updateGlobalState({ newOrder: normalizedOrder });

    if (!isOrderMuted(normalizedOrder)) {
      // startGlobalAlertLoop already plays the sound immediately (and then loops)
      startGlobalAlertLoop(normalizedOrder);
    }

    const isTabHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (isTabHidden) {
      showBackgroundOrderNotification(normalizedOrder);
    }
  }, []);

  // Handle socket connection and listeners globally
  useEffect(() => {
    if (!API_BASE_URL || !String(API_BASE_URL).trim()) {
      updateGlobalState({ socketConnected: false });
      return;
    }
    if (!restaurantId) {
      return;
    }

    // Check if we need to initialize or update socket
    if (globalSocket && globalActiveRestaurantId === restaurantId) {
      return;
    }

    if (globalSocket) {
      globalSocket.disconnect();
      globalSocket = null;
      globalSocketConnected = false;
      updateGlobalState({ socketConnected: false });
    }

    globalActiveRestaurantId = restaurantId;

    let backendUrl = API_BASE_URL;
    try {
      const urlObj = new URL(backendUrl);
      let pathname = urlObj.pathname.replace(/^\/api\/?$/, '');
      backendUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.port ? `:${urlObj.port}` : ''}${pathname}`;
    } catch (e) {
      backendUrl = backendUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');
      if (backendUrl.startsWith('https:') || backendUrl.startsWith('http:')) {
        const protocolMatch = backendUrl.match(/^(https?):/i);
        if (protocolMatch) {
          const protocol = protocolMatch[1].toLowerCase();
          const cleanPath = backendUrl.substring(protocol.length + 1).replace(/^\/+/, '');
          backendUrl = `${protocol}://${cleanPath}`;
        }
      }
    }
    backendUrl = backendUrl.replace(/^(https?):\/+/gi, '$1://').replace(/\/+$/, '');

    const frontendHostname = window.location.hostname;
    const isLocalhost = frontendHostname === 'localhost' || frontendHostname === '127.0.0.1' || frontendHostname === '';
    const isProductionBuild = import.meta.env.MODE === 'production' || import.meta.env.PROD;
    const isProductionDeployment = !isLocalhost && (window.location.protocol === 'https:' || frontendHostname.includes('.'));
    const backendIsLocalhost = backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1');

    if (backendIsLocalhost && (isProductionBuild || isProductionDeployment) && !isLocalhost) {
      updateGlobalState({ socketConnected: false });
      return;
    }

    let socketOrigin = backendUrl;
    try {
      socketOrigin = new URL(backendUrl).origin;
    } catch {
      socketOrigin = String(backendUrl || "").replace(/\/api\/v\d+\/?$/i, "").replace(/\/api\/?$/i, "").replace(/\/+$/, "");
    }

    const socketUrl = `${socketOrigin}`;

    try {
      new URL(socketUrl);
    } catch {
      updateGlobalState({ socketConnected: false });
      return;
    }

    globalSocket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      forceNew: false,
      autoConnect: true,
      /*
       * A function, not an object: socket.io calls it on EVERY connection
       * attempt. With a fixed object the socket kept re-handshaking with the
       * token captured when the hook first ran, so once that token expired the
       * server answered AUTH_INVALID for ever and the restaurant stopped
       * receiving order updates until the app was restarted.
       */
      auth: (cb) => cb({ token: readRestaurantSocketToken() }),
    });

    attachRestaurantSocketWatchdog();

    globalSocket.on('connect', () => {
      globalSocketConnected = true;
      updateGlobalState({ socketConnected: true });
      globalSocket?.emit('join-restaurant', restaurantId);
    });

    globalSocket.on('connect_error', () => {
      globalSocketConnected = false;
      updateGlobalState({ socketConnected: false });
    });

    globalSocket.on('disconnect', (reason) => {
      globalSocketConnected = false;
      updateGlobalState({ socketConnected: false });
      if (reason === 'io server disconnect') {
        globalSocket?.connect();
      }
    });

    globalSocket.on('reconnect', () => {
      globalSocketConnected = true;
      updateGlobalState({ socketConnected: true });
      globalSocket?.emit('join-restaurant', restaurantId);
    });

    globalSocket.on('new_order', (orderData) => {
      const normalizedOrder = normalizeRestaurantOrderView({
        ...orderData,
        orderMongoId: orderData?.orderMongoId || orderData?._id || orderData?.order_id,
        orderId: orderData?.orderId || orderData?.order_id || orderData?._id,
      });
      handleIncomingOrderAlert(normalizedOrder, 'socket');
    });

    /*
     * Reservation badge only - no sound. The order ringtone is reserved for real
     * new orders; this listener rang it for whatever payload arrived, and no
     * backend code emits 'new_dining_booking' at all.
     */
    globalSocket.on('new_dining_booking', (bookingData) => {
      updateGlobalState({ newReservation: bookingData });
    });

    /*
     * 'play_notification_sound' is deliberately NOT handled.
     *
     * No backend code emits it (checked across the whole server), yet the
     * listener rang for whatever payload it was handed - including one with no
     * order in it. A real new order always arrives as 'new_order'.
     */

    globalSocket.on('order_status_update', (data) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('restaurantOrderStatusUpdate', {
            detail: data || {},
          }),
        );
      }
      const status = String(data?.orderStatus || data?.status || '').toLowerCase();

      // A Mongo ObjectId is a 24-char hex string — not a human order id, so don't show it.
      const isMongoId = (val) => /^[0-9a-fA-F]{24}$/.test(String(val || '').trim());
      const friendlyOrderId = (() => {
        const candidate = data?.orderId || data?.order_id || '';
        return candidate && !isMongoId(candidate) ? `#${candidate}` : '';
      })();

      // Order accepted — stop popup & sound immediately. Admin accept moves the
      // order straight to "preparing", so treat that (and the acceptedBy flag) as
      // accepted too, otherwise the restaurant popup would not dismiss.
      if (status === 'confirmed' || status === 'accepted' || status === 'preparing' || data?.acceptedBy === 'admin') {
        // Every id variant: the polling fallback matches on whichever field its
        // rows carry, and one missed variant let the poll ring for it again.
        const acceptedIds = getOrderIdVariants(data || {});
        if (acceptedIds.length) {
          acceptedIds.forEach((id) => {
            processedOrderIds.add(id);
            globalMutedOrderIds.delete(id);
          });
          saveProcessedOrderIds();
        }
        forgetAlertStart(data);
        stopGlobalAlertLoop();
        updateGlobalState({ newOrder: null, activeOrder: null, mutedOrderIds: new Set(globalMutedOrderIds) });
        // Toast only if admin accepted (not restaurant itself)
        if (data?.acceptedBy === 'admin') {
          toast.success(`Order ${friendlyOrderId} Accepted By Admin`, {
            duration: 6000,
            id: `admin-accepted-${data?.orderId || Date.now()}`
          });
        }
        dispatchNotificationInboxRefresh();
      }

      // Cancelled (by customer, restaurant, admin or the accept timeout): it must
      // stop ringing now and never ring again, on every screen.
      if (status.includes('cancel')) {
        const cancelledIds = getOrderIdVariants(data || {});
        cancelledIds.forEach((id) => processedOrderIds.add(id));
        saveProcessedOrderIds();
        forgetAlertStart(data);
        const activeIds = globalActiveOrder ? getOrderIdVariants(globalActiveOrder) : [];
        if (activeIds.some((id) => cancelledIds.includes(id))) {
          stopGlobalAlertLoop();
          globalActiveOrder = null;
          updateGlobalState({ activeOrder: null });
        }
        // Drop the pending-order state as well when it is THIS order, so a later
        // re-render cannot raise the accept popup again for an order the
        // customer has already cancelled. Another order still waiting keeps its.
        const pendingIds = globalNewOrder ? getOrderIdVariants(globalNewOrder) : [];
        if (pendingIds.some((id) => cancelledIds.includes(id))) {
          updateGlobalState({ newOrder: null });
        }
      }

      if (status === 'cancelled_by_admin') {
        toast.error(`Order ${friendlyOrderId} Rejected By Admin`, {
          duration: 6000,
          id: `admin-rejected-${data?.orderId || Date.now()}`
        });
        dispatchNotificationInboxRefresh();
      } else if (status === 'cancelled_by_user' || data?.cancelledBy === 'customer') {
        toast.error(`Order ${friendlyOrderId || ''} was cancelled by the customer.`, {
          duration: 6000,
          id: `user-cancelled-${data?.orderId || data?._id || Date.now()}`
        });
        dispatchNotificationInboxRefresh();
      }

      if (status === 'delivered') {
        // Only announce a delivery for an order this restaurant actually tracked as
        // a real order (a valid display id). Guards against stray/stale events that
        // carry only a Mongo id firing a bogus "delivered" toast on new orders.
        if (friendlyOrderId) {
          toast.success(`Order ${friendlyOrderId} delivered successfully!`, {
            description: 'The order has been delivered to the customer.',
            duration: 6000,
            id: `delivered-${data?.orderId || Date.now()}`
          });
        }
        dispatchNotificationInboxRefresh();
      }
    });

    globalSocket.on('order_cancelled_by_user', (data) => {
      const payload = {
        ...(data || {}),
        orderStatus: 'cancelled_by_user',
        status: 'cancelled_by_user',
        cancelledBy: 'customer',
      };

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('restaurantOrderStatusUpdate', {
            detail: payload,
          }),
        );
        window.dispatchEvent(
          new CustomEvent('orderCancelledByUser', {
            detail: payload,
          }),
        );
      }

      const cancelledIds = getOrderIdVariants(payload);
      cancelledIds.forEach((id) => processedOrderIds.add(id));
      saveProcessedOrderIds();
      forgetAlertStart(payload);

      const activeIds = globalActiveOrder ? getOrderIdVariants(globalActiveOrder) : [];
      if (activeIds.some((id) => cancelledIds.includes(id))) {
        stopGlobalAlertLoop();
        globalActiveOrder = null;
        updateGlobalState({ activeOrder: null });
      }

      const pendingIds = globalNewOrder ? getOrderIdVariants(globalNewOrder) : [];
      if (pendingIds.some((id) => cancelledIds.includes(id))) {
        updateGlobalState({ newOrder: null });
      }

      const isMongoId = (val) => /^[0-9a-fA-F]{24}$/.test(String(val || '').trim());
      const friendlyOrderId = (() => {
        const candidate = payload?.orderId || payload?.order_id || '';
        return candidate && !isMongoId(candidate) ? `#${candidate}` : '';
      })();

      toast.error(`Order ${friendlyOrderId || ''} was cancelled by the customer.`, {
        duration: 6000,
        id: `user-cancelled-${payload?.orderId || payload?._id || Date.now()}`,
      });

      dispatchNotificationInboxRefresh();
    });

    globalSocket.on('admin_notification', () => {
      dispatchNotificationInboxRefresh();
    });

    return () => {
      // Don't disconnect here to keep active room listeners alive across components
    };
  }, [restaurantId, handleIncomingOrderAlert]);

  // Handle REST polling fallback globally
  useEffect(() => {
    if (!restaurantId) return;
    if (globalPollingIntervalId) return;

    const ALERT_POLL_MS = 8000;

    const pollOrders = async () => {
      try {
        const token = localStorage.getItem('restaurant_accessToken') || localStorage.getItem('accessToken');
        // Inside the app the router lives in the hash (HashRouter), so check both.
        const routePath = `${window.location.pathname}${window.location.hash || ''}`;
        const isAuthPage = routePath.includes('/login') || routePath.includes('/otp') || routePath.includes('/signup');

        if (!token || isAuthPage) {
          if (globalActiveOrder) {
            globalActiveOrder = null;
            updateGlobalState({ activeOrder: null });
          }
          // Signed out: nothing may ring, whoever started it.
          if (nativeAlarmMayBeRinging || globalAlertLoopTimer || isAlertSoundPlaying()) {
            stopGlobalAlertLoop();
          }
          return;
        }

        await refreshAcceptWindowSettings();
        // Orders responses can be a few seconds old (short client cache). Remember
        // when this snapshot was requested so it is never used to silence an
        // alert for an order that arrived after it was taken.
        const requestedAt = Date.now();
        const response = await restaurantAPI.getOrders({ page: 1, limit: 30 });
        const rows = response?.data?.data?.orders || response?.data?.data?.data?.orders || [];
        const now = Date.now();

        // Orders still waiting for this restaurant's decision, oldest first.
        const pending = (rows || [])
          .filter((o) => {
            const rawStatus = String(o?.orderStatus || o?.status || "").toLowerCase().trim();
            if (!RESTAURANT_DECIDABLE_STATUSES.has(rawStatus)) return false;
            if (isProcessedOrder(o)) return false;

            if (o.scheduledAt) {
              const scheduledTime = new Date(o.scheduledAt).getTime();
              if (scheduledTime > now + 30 * 60000) return false;
            }

            const deadline = getOrderAcceptDeadline(o);
            return !deadline || now < deadline;
          })
          .sort((a, b) => {
            const at = new Date(a?.restaurantNotifiedAt || a?.createdAt || 0).getTime();
            const bt = new Date(b?.restaurantNotifiedAt || b?.createdAt || 0).getTime();
            return at - bt;
          });

        /*
          * Socket-independent status catch-up.
          *
          * The Orders page closes the accept popup and refreshes its tabs when
          * it sees a 'restaurantOrderStatusUpdate'. That event only ever came
          * from the socket, so a customer cancelling while this device's socket
          * was down left the popup counting down on a dead order until the app
          * was restarted. If the order being tracked has moved on, say so here.
          */
        if (globalActiveOrder && typeof window !== 'undefined') {
          const trackedIds = new Set(getOrderIdVariants(globalActiveOrder));
          const row = (rows || []).find((o) => getOrderIdVariants(o).some((id) => trackedIds.has(id)));
          const rawStatus = String(row?.orderStatus || row?.status || '').toLowerCase().trim();
          if (rawStatus && !RESTAURANT_DECIDABLE_STATUSES.has(rawStatus)) {
            window.dispatchEvent(
              new CustomEvent('restaurantOrderStatusUpdate', {
                detail: {
                  orderMongoId: row._id,
                  orderId: row.orderId || row.order_id || row._id,
                  orderStatus: row.orderStatus,
                  status: row.status,
                  cancelledBy: row.cancelledBy,
                  source: 'poll',
                },
              }),
            );
            // This order is answered: stop ringing for it and never ring again,
            // exactly as the socket handler would have done.
            getOrderIdVariants(row).forEach((id) => processedOrderIds.add(id));
            saveProcessedOrderIds();
            forgetAlertStart(row);
            stopGlobalAlertLoop();
            globalActiveOrder = null;
            updateGlobalState({ activeOrder: null, newOrder: null });
          }
        }

        // A snapshot that may predate the current ring cannot prove its order is
        // gone - unless that order is in it, which shows the snapshot is newer.
        const activeOrderIds = globalActiveOrder ? new Set(getOrderIdVariants(globalActiveOrder)) : null;
        const snapshotHasActiveOrder = Boolean(
          activeOrderIds && (rows || []).some((o) => getOrderIdVariants(o).some((id) => activeOrderIds.has(id))),
        );
        const snapshotPredatesRing =
          !snapshotHasActiveOrder && globalAlertArmedAt > requestedAt - ORDERS_SNAPSHOT_MAX_AGE_MS;

        // If an order was actively ringing, ensure it is still pending in DB; if not, stop ringing
        if (globalActiveOrder && !snapshotPredatesRing) {
          const activeKeys = new Set(getOrderIdVariants(globalActiveOrder));
          const activeStillPending = pending.find((o) => getOrderIdVariants(o).some((id) => activeKeys.has(id)));
          if (!activeStillPending) {
            stopGlobalAlertLoop();
            globalActiveOrder = null;
            updateGlobalState({ activeOrder: null });
          }
        }

        /*
         * Nothing awaits this restaurant (or everything waiting is muted): no
         * sound may play, whoever started it - a leftover web track, a push's own
         * copy of the ringtone, or the native app's alarm for a push that arrived
         * while it was closed. Checked on every poll and on return to the app.
         */
        const ringablePending = globalIsMuted ? [] : pending.filter((o) => !isOrderMuted(o));
        if (
          ringablePending.length === 0 &&
          !snapshotPredatesRing &&
          (nativeAlarmMayBeRinging || globalAlertLoopTimer || isAlertSoundPlaying())
        ) {
          stopGlobalAlertLoop();
        }

        // Orders still waiting whose socket event never reached this device
        // (it arrived while the app was in the background, or the socket was
        // down): announce them the way the socket would have, through the same gate.
        pending
          .filter((o) => !wasOrderAnnounced(o))
          .forEach((missed) => {
            handleIncomingOrderAlert(
              normalizeRestaurantOrderView({
                ...missed,
                orderMongoId: missed.orderMongoId || missed._id,
                orderId: missed.orderId || missed.order_id || missed._id,
              }),
              'poll',
            );
          });
      } catch (error) {
        // ignore
      }
    };

    pollOrders();
    globalPollingIntervalId = setInterval(pollOrders, ALERT_POLL_MS);

    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        // While in the background a push may have started the native alarm.
        nativeAlarmMayBeRinging = true;
        pollOrders();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      // Polling remains alive globally
    };
  }, [restaurantId, handleIncomingOrderAlert]);

  // Request browser notification permission once on user interaction
  useEffect(() => {
    if (!supportsBrowserNotifications()) return;
    const askPermissionKey = 'restaurant_notification_permission_asked';
    if (Notification.permission !== 'default' || localStorage.getItem(askPermissionKey) === 'true') return;

    const requestPermissionOnce = async () => {
      localStorage.setItem(askPermissionKey, 'true');
      try {
        await Notification.requestPermission();
      } catch (error) {
        debugWarn('Failed to request restaurant notification permission:', error);
      }
    };

    const askOnInteraction = () => {
      requestPermissionOnce();
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };

    window.addEventListener('pointerdown', askOnInteraction, { once: true, passive: true });
    window.addEventListener('keydown', askOnInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };
  }, []);

  // Visibility change background browser notifications handler
  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden' && globalActiveOrder && !globalIsMuted) {
        showBackgroundOrderNotification(globalActiveOrder);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Audio unlock on the first gesture: attached once per page, silent (see unlockAlertAudio).
  useEffect(() => {
    attachAlertAudioUnlock();
  }, []);

  // Handle push notification order alerts (FCM / Service Worker push)
  useEffect(() => {
    if (!restaurantId || typeof window === 'undefined') return;

    const handlePushOrder = (event) => {
      const raw = event?.detail?.data || event?.detail || {};
      const orderPayload = raw?.orderData || raw?.order || raw;
      const orderMongoId = orderPayload?.orderMongoId || orderPayload?._id || orderPayload?.orderId || raw?.orderId;
      if (!orderMongoId) return;

      const normalizedOrder = normalizeRestaurantOrderView({
        ...orderPayload,
        orderMongoId,
        orderId: orderPayload?.orderId || orderPayload?.order_id || orderMongoId,
        restaurantId: orderPayload?.restaurantId || raw?.restaurantId || restaurantId,
      });

      handleIncomingOrderAlert(normalizedOrder, 'push');
    };

    window.addEventListener('app-order-push', handlePushOrder);
    window.addEventListener('new_order', handlePushOrder);
    return () => {
      window.removeEventListener('app-order-push', handlePushOrder);
      window.removeEventListener('new_order', handlePushOrder);
    };
  }, [restaurantId, handleIncomingOrderAlert]);

  const setMuted = useCallback((nextMuted) => {
    const muted = Boolean(nextMuted);
    updateGlobalState({ isMuted: muted });
    if (muted) {
      stopGlobalAlertLoop();
    } else if (globalActiveOrder) {
      startGlobalAlertLoop(globalActiveOrder);
    }
  }, []);

  const clearNewOrder = useCallback((orderOrId) => {
    let targetId = null;
    if (orderOrId) {
      if (typeof orderOrId === 'object') {
        const ids = [
          orderOrId.orderMongoId,
          orderOrId.orderId,
          orderOrId._id,
          orderOrId.id,
          orderOrId.mongoId,
          orderOrId.order_id,
          orderOrId.order_mongo_id
        ].filter(Boolean);
        ids.forEach(id => {
          const cleanId = String(id).trim();
          processedOrderIds.add(cleanId);
          globalMutedOrderIds.delete(cleanId);
        });
        targetId = getOrderAlertKey(orderOrId);
        forgetAlertStart(orderOrId);
      } else {
        targetId = String(orderOrId).trim();
        forgetAlertStart(targetId);
        processedOrderIds.add(targetId);
        globalMutedOrderIds.delete(targetId);
      }
      saveProcessedOrderIds();
      saveMutedOrderIds();
    }
    stopGlobalAlertLoop();
    updateGlobalState({ newOrder: null, activeOrder: null, mutedOrderIds: new Set(globalMutedOrderIds) });
  }, []);

  const muteOrders = useCallback((orderIds) => {
    if (!Array.isArray(orderIds)) return;
    orderIds.forEach(id => {
      if (id) globalMutedOrderIds.add(String(id).trim());
    });
    saveMutedOrderIds();
    
    // Silence the alert right away if the ringing order is among the muted ones.
    if (globalActiveOrder && isOrderMuted(globalActiveOrder)) {
      stopGlobalAlertLoop();
    }
    
    updateGlobalState({ mutedOrderIds: new Set(globalMutedOrderIds) });
  }, []);

  const unmuteOrder = useCallback((orderId) => {
    if (!orderId) return;
    const cleanId = String(orderId).trim();
    globalMutedOrderIds.delete(cleanId);
    saveMutedOrderIds();

    // Restart the alert for the active order once it is no longer muted.
    if (globalActiveOrder && !isOrderMuted(globalActiveOrder)) {
      startGlobalAlertLoop(globalActiveOrder);
    }

    updateGlobalState({ mutedOrderIds: new Set(globalMutedOrderIds) });
  }, []);

  const clearNewReservation = useCallback(() => {
    updateGlobalState({ newReservation: null });
  }, []);

  return {
    newOrder: localState.newOrder,
    newReservation: localState.newReservation,
    clearNewOrder,
    clearNewReservation,
    isConnected: localState.isConnected,
    isMuted: localState.isMuted,
    setMuted,
    // No raw "play sound" is exposed: every ring must go through the gate.
    stopSound: stopGlobalAlertLoop,
    startAlertLoop: startGlobalAlertLoop,
    mutedOrderIds: localState.mutedOrderIds || new Set(),
    muteOrders,
    unmuteOrder,
  };
};
