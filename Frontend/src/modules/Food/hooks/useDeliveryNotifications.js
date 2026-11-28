import { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { API_BASE_URL } from '@food/api/config';
import { resolveSocketOrigin } from '@food/api/socketClient';
import { deliveryAPI } from '@food/api';
const alertSound = '/assets/media/restaurant_alert.mp3';
const originalSound = '/assets/media/restaurant_alert.mp3';
import { dispatchNotificationInboxRefresh } from '@food/hooks/useNotificationInbox';
import {
  useDeliveryStore,
  resolveOrderKey,
  ordersShareIdentity,
  collectOrderKeys,
  isOfferStillValid,
} from '@/modules/DeliveryV2/store/useDeliveryStore';
import { DELIVERY_SESSION_RESET_EVENT } from '@food/utils/auth';
import { mapOrderLocations } from '@/modules/DeliveryV2/utils/orderMapping';
import {
  isOrderWithinOfferRange,
  sanitizeOrderDispatchMetrics,
} from '@/modules/DeliveryV2/utils/pickupMetrics';
import {
  isNativeAppWebView,
  shouldSkipDuplicateOsNotification,
  getNotificationIcon,
  stopActivePushPlayback,
} from '@food/utils/firebaseMessaging';
import {
  DELIVERY_HANDLED_OFFER_TTL_MS,
  markDeliveryOffersHandled,
  clearDeliveryHandledOffers,
} from '@food/utils/deliveryAlertSession';
import { toast } from 'sonner';

const shouldLogDeliverySocket = () => {
  if (typeof window === 'undefined') return import.meta.env.DEV;
  try {
    return (
      import.meta.env.DEV ||
      window.localStorage.getItem('delivery_socket_debug') === '1' ||
      window.location.search.includes('delivery_socket_debug=1')
    );
  } catch {
    return import.meta.env.DEV;
  }
};

const debugLog = (...args) => {
  if (shouldLogDeliverySocket()) {
    console.log('[DeliverySocket]', ...args);
  }
};
const debugWarn = (...args) => {
  if (shouldLogDeliverySocket()) {
    console.warn('[DeliverySocket]', ...args);
  }
};
const debugError = (...args) => {
  console.error('[DeliverySocket]', ...args);
};

if (typeof window !== 'undefined') {
  debugLog('alertSound URL:', alertSound);
  debugLog('originalSound URL:', originalSound);
}

const resolveAudioSource = (source) => {
  if (!source) return '';
  // Handle ES6 module imports where the URL might be in a 'default' property
  const url = typeof source === 'object' ? (source.default || source) : source;
  return url;
};

const safeReadJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((ch) => `%${(`00${ch.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const resolveDeliveryPartnerIdFromClient = () => {
  try {
    const storedUser =
      safeReadJson('delivery_user') ||
      safeReadJson('deliveryUser') ||
      safeReadJson('user');

    const nestedCandidate =
      storedUser?.id ||
      storedUser?._id ||
      storedUser?.userId ||
      storedUser?.deliveryId ||
      storedUser?.deliveryPartnerId ||
      storedUser?.user?.id ||
      storedUser?.user?._id ||
      storedUser?.deliveryPartner?.id ||
      storedUser?.deliveryPartner?._id;

    if (nestedCandidate) return String(nestedCandidate);

    const token =
      localStorage.getItem('delivery_accessToken') ||
      localStorage.getItem('accessToken');
    const payload = decodeJwtPayload(token);
    const tokenCandidate =
      payload?.userId ||
      payload?.id ||
      payload?._id ||
      payload?.sub;

    return tokenCandidate ? String(tokenCandidate) : null;
  } catch {
    return null;
  }
};

const supportsBrowserNotifications = () =>
  typeof window !== 'undefined' && typeof Notification !== 'undefined';

const buildDeliveryOrderNotification = (orderData = {}) => {
  const orderId = orderData.orderId || orderData.orderMongoId || orderData.id || 'New';
  const itemCount = Array.isArray(orderData.items) ? orderData.items.length : 0;
  const total = Number(orderData.total || orderData.pricing?.total || orderData.orderTotal || 0);

  return {
    title: `New order #${orderId}`,
    body: itemCount > 0
      ? `${itemCount} item${itemCount === 1 ? '' : 's'} - ₹${total.toFixed(2)}`
      : 'A new order is available to accept',
    tag: `delivery-order-${orderId}`,
    data: {
      orderId,
      targetUrl: '/delivery',
    },
  };
}

/**
 * `isCurrent` is checked before each handler is tried: when the first name is
 * missing in the app shell, a stop (accept, pass, mute) can land while the next
 * one is still pending, and that fallback must not start the ringtone again.
 */
const triggerWebViewNativeNotification = async (orderData = {}, isCurrent = () => true) => {
  if (typeof window === 'undefined') return false;

  const bridgePayload = {
    title: 'New delivery order',
    body: `Order #${orderData?.orderId || orderData?.orderMongoId || orderData?.id || ''}`.trim(),
    orderId: orderData?.orderId || orderData?.order_id || '',
    orderMongoId: orderData?.orderMongoId || orderData?.order_mongo_id || '',
    targetUrl: '/delivery',
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
      ];

      for (const handlerName of handlerNames) {
        if (!isCurrent()) return false;
        try {
          await window.flutter_inappwebview.callHandler(handlerName, bridgePayload);
          return true;
        } catch {
          // Try next handler name.
        }
      }
    }
  } catch {
    // Ignore bridge failures and fall back to browser/web audio.
  }

  return false;
}

/**
 * Stops the ringtone the app shell started through the bridge above. Without
 * it, muting, accepting or passing silenced only the web copy while the native
 * one kept ringing - and un-muting then started another on top of it.
 *
 * By default this is sound only (the restaurant app's stop handlers): the
 * offer's notification stays in the tray, since a mute or minimise silences an
 * offer that is still open. `dismiss` is for an offer that
 * is over (accepted, passed, taken, expired) and also clears its notification:
 * a notification's own sound plays until that notification is cancelled, so
 * stopping the ringtone alone could leave the tray alert ringing after an
 * accept. Same handler the restaurant app already calls on every stop.
 */
const stopWebViewNativeRingtone = async ({ dismiss = false } = {}) => {
  if (typeof window === 'undefined') return;
  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === 'function'
    ) {
      const handlerNames = dismiss
        ? ['stopNotificationSound', 'stopOrderRingtone', 'dismissNotification']
        : ['stopNotificationSound', 'stopOrderRingtone'];
      for (const handlerName of handlerNames) {
        try {
          await window.flutter_inappwebview.callHandler(handlerName, {});
        } catch {
          // Try next handler.
        }
      }
    }
  } catch {
    // Ignore bridge failures.
  }
};


export const useDeliveryNotifications = () => {
  // CRITICAL: All hooks must be called unconditionally and in the same order every render
  // Order: useRef -> useState -> useEffect -> useCallback
  
  // Step 1: All refs first (unconditional)
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const activeOrderRef = useRef(null);
  const alertLoopTimerRef = useRef(null);
  const alertLoopStartedAtRef = useRef(0);
  // True from the moment this app starts ringing for an offer until it stops.
  const alertActiveRef = useRef(false);
  // Bumped by every stop, so sound scheduled before a stop cannot start after it.
  const alertGenerationRef = useRef(0);
  const userInteractedRef = useRef(false);
  const lastAlertAtByOrderRef = useRef(new Map());
  const lastBrowserNotificationAtByOrderRef = useRef(new Map());
  /**
   * Orders already handled on this device, kept as id -> timestamp.
   *
   * This used to be an unbounded Set, which meant an order dismissed once could
   * never be shown again for the whole session. The server already refuses to
   * re-offer an order to a partner who declined it (dispatch.offeredTo), so a
   * short local window is enough to stop duplicate cards — and it lets a
   * legitimately re-dispatched order through instead of silently dropping it.
   */
  const processedOrderIdsRef = useRef(new Map());
  // Same window the push path uses to refuse ringing for a handled offer.
  const PROCESSED_ORDER_TTL_MS = DELIVERY_HANDLED_OFFER_TTL_MS;
  const mutedOrderIdsRef = useRef((() => {
    const ids = new Set();
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('delivery_muted_order_ids');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            parsed.forEach((id) => {
              const key = String(id || '').trim();
              if (key) ids.add(key);
            });
          }
        }
        localStorage.removeItem('delivery_notifications_muted');
      } catch (_) {}
    }
    return ids;
  })());
  const [muteUiTick, setMuteUiTick] = useState(0);
  
  // Step 2: All state hooks (unconditional)
  const [newOrder, setNewOrder] = useState(null);
  const [orderReady, setOrderReady] = useState(null);
  const [orderStatusUpdate, setOrderStatusUpdate] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [deliveryPartnerId, setDeliveryPartnerId] = useState(null);
  const [claimedOrderId, setClaimedOrderId] = useState(null); // set when another partner claims an order
  const [adminNotification, setAdminNotification] = useState(null);
  const joinedDeliveryRoomRef = useRef(null);
  const ALERT_LOOP_INTERVAL_MS = 1000;
  // Longest a heads-up that is not an offer (order ready) may ring. An offer
  // rings until it is handled or its window closes - see startAlertLoop.
  const ALERT_LOOP_MAX_MS = 10000;
  const ALERT_DEDUPE_MS = 15000;
  const BROWSER_NOTIFICATION_DEDUPE_MS = 20000;
  const NOTIFICATION_PERMISSION_ASKED_KEY = 'delivery_notification_permission_asked';
  const DELIVERY_MUTED_ORDER_IDS_KEY = 'delivery_muted_order_ids';

  // Step 3: All callbacks before effects (unconditional)
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

  const collectOrderAlertKeys = (orderData) => {
    if (!orderData) return [];
    if (typeof orderData === 'string') {
      const key = String(orderData).trim();
      return key ? [key] : [];
    }
    return [
      ...new Set(
        [
          orderData.orderMongoId,
          orderData.order_mongo_id,
          orderData.orderId,
          orderData.order_id,
          orderData._id,
          orderData.id,
          orderData.mongoId,
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    ];
  };

  const saveMutedOrderIds = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        DELIVERY_MUTED_ORDER_IDS_KEY,
        JSON.stringify([...mutedOrderIdsRef.current]),
      );
    } catch (_) {}
  }, []);

  const isOrderAlertMuted = useCallback((orderData) => {
    const keys = collectOrderAlertKeys(orderData);
    if (!keys.length) return false;
    return keys.some((key) => mutedOrderIdsRef.current.has(key));
  }, []);

  const clearOrderMuteState = useCallback(
    (orderData) => {
      const keys = collectOrderAlertKeys(orderData);
      if (!keys.length) return;
      let changed = false;
      keys.forEach((key) => {
        if (mutedOrderIdsRef.current.delete(key)) {
          changed = true;
        }
      });
      if (changed) {
        saveMutedOrderIds();
        setMuteUiTick((tick) => tick + 1);
      }
    },
    [saveMutedOrderIds],
  );

  /**
   * Is this event addressed to the rider currently signed in on this device?
   *
   * The server addresses every delivery event to a single partner room, but a
   * socket opened by the previous account can still be alive for a moment after
   * a switch, and a push can be opened long after it was sent. The backend now
   * stamps `targetPartnerId` on every offer, expiry and claim event, so the
   * client can refuse anything that is not its own instead of trusting delivery.
   *
   * Events with no addressee (older server, or genuinely broadcast events) are
   * allowed through - this is a safety net on top of server-side scoping, not a
   * replacement for it.
   */
  const isEventForCurrentAccount = useCallback((data) => {
    const target = String(
      data?.targetPartnerId ||
      data?.deliveryPartnerId ||
      data?.delivery_partner_id ||
      '',
    ).trim();
    if (!target) return true;
    if (!deliveryPartnerId) return false;
    return target === String(deliveryPartnerId);
  }, [deliveryPartnerId]);

  const isProcessedOrder = useCallback((orderData) => {
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
    const now = Date.now();
    // Drop stale entries so the map cannot grow without bound.
    for (const [key, at] of processedOrderIdsRef.current) {
      if (now - at > PROCESSED_ORDER_TTL_MS) processedOrderIdsRef.current.delete(key);
    }
    return ids.some((id) => {
      const at = processedOrderIdsRef.current.get(String(id).trim());
      return at != null && now - at <= PROCESSED_ORDER_TTL_MS;
    });
  }, []);

  const isOrderInAcceptedQueue = useCallback((orderData) => {
    if (!orderData) return false;
    const accepted = useDeliveryStore.getState().acceptedOrders || [];
    return accepted.some((item) => ordersShareIdentity(item, orderData));
  }, []);

  const markOrderIdsProcessed = useCallback((orderData) => {
    if (!orderData) return;
    const ids = [
      orderData.orderMongoId,
      orderData.order_mongo_id,
      orderData.orderId,
      orderData.order_id,
      orderData._id,
      orderData.id,
      orderData.mongoId,
    ].filter(Boolean);
    const now = Date.now();
    ids.forEach((id) => processedOrderIdsRef.current.set(String(id).trim(), now));
    // A push for this offer that lands after this point must not ring.
    markDeliveryOffersHandled(ids);
  }, []);

  const shouldProcessOrderAlert = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastAlertAtByOrderRef.current.get(key) || 0;
    if (now - last < ALERT_DEDUPE_MS) return false;
    lastAlertAtByOrderRef.current.set(key, now);
    return true;
  };

  const shouldShowBrowserNotification = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastBrowserNotificationAtByOrderRef.current.get(key) || 0;
    if (now - last < BROWSER_NOTIFICATION_DEDUPE_MS) return false;
    lastBrowserNotificationAtByOrderRef.current.set(key, now);
    return true;
  };

  const clearAlertLoopTimer = useCallback(() => {
    if (alertLoopTimerRef.current) {
      clearInterval(alertLoopTimerRef.current);
      alertLoopTimerRef.current = null;
    }
  }, []);

  /**
   * Stops the offer ringtone.
   *
   * With no options, the push's own copy and the app shell's native ringtone
   * are stopped only when this app was the one ringing - this also runs when
   * an offer's window closes and on idle expiry sweeps.
   *
   * `everywhere` is for a rider's own action on an offer (accept, pass, mute,
   * minimise): it stops those other copies whether or not the in-app alert is
   * still flagged. The flag clears whenever the in-app ring ends, and a push or
   * native ring still playing after that - or one for an offer shown without
   * ringing - used to carry on through the accept. `dismiss` marks the offer as
   * over and also clears its native notification.
   */
  const stopAlertLoop = useCallback(({ everywhere = false, dismiss = false } = {}) => {
    clearAlertLoopTimer();
    alertLoopStartedAtRef.current = 0;
    alertGenerationRef.current += 1;

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.loop = false;
      } catch (_) {}
    }

    const wasRinging = alertActiveRef.current;
    alertActiveRef.current = false;
    if (typeof window !== 'undefined') window.__deliveryOrderAlertActive = false;
    if (!wasRinging && !everywhere && !dismiss) return;

    try {
      stopActivePushPlayback();
    } catch (_) {}
    void stopWebViewNativeRingtone({ dismiss });
  }, [clearAlertLoopTimer]);

  /** A rider's own action on an offer: silence every copy of the ringtone. */
  const silenceOrderAlert = useCallback(() => {
    stopAlertLoop({ everywhere: true });
  }, [stopAlertLoop]);

  /** The offer is over (accepted, passed, taken, expired): silence it and clear its notification. */
  const endOrderAlert = useCallback(() => {
    stopAlertLoop({ everywhere: true, dismiss: true });
  }, [stopAlertLoop]);

  /**
   * Keeps a ring going and decides when it ends.
   *
   * An offer rings for as long as the rider can still take it, like the
   * restaurant's order alert: until they accept, pass, mute or minimise it
   * (those stop it directly), another rider takes it, or the window the backend
   * gave it closes. It used to stop after a fixed 10 seconds, so a rider who did
   * not look at the phone at once missed a request that was still open.
   * `whileOfferPending: false` is for a ring that is not about an offer (order
   * ready); that one ends after ALERT_LOOP_MAX_MS.
   *
   * Each tick also restarts the track if something paused it while the ring is
   * still wanted: a call or focus loss, or the first-tap audio unlock.
   */
  const startAlertLoop = useCallback((playSoundFn, orderData, { whileOfferPending = true } = {}) => {
    clearAlertLoopTimer();
    const targetOrder = orderData || activeOrderRef.current;
    if (!targetOrder || isOrderAlertMuted(targetOrder)) return;

    alertLoopStartedAtRef.current = Date.now();

    alertLoopTimerRef.current = setInterval(() => {
      const offer = activeOrderRef.current;
      const finished = whileOfferPending
        ? !offer || !isOfferStillValid(offer) || isOrderAlertMuted(offer)
        : Date.now() - alertLoopStartedAtRef.current >= ALERT_LOOP_MAX_MS;
      if (finished) {
        stopAlertLoop();
        return;
      }

      const audio = audioRef.current;
      if (alertActiveRef.current && audio && audio.paused) {
        audio.loop = true;
        const resumed = audio.play();
        // Still blocked (no tap yet): try again next tick, without a fallback beep.
        if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
      }
    }, ALERT_LOOP_INTERVAL_MS);
  }, [clearAlertLoopTimer, isOrderAlertMuted, stopAlertLoop]);


  
  const playSynthDeliveryBeep = useCallback(async (generation = alertGenerationRef.current) => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      let ctx = window.__deliverySynthCtx;
      if (!ctx) {
        ctx = new AudioCtx();
        window.__deliverySynthCtx = ctx;
      }
      if (ctx.state === 'suspended') {
        /*
         * Before the rider's first tap, resume() stays pending. Every beep
         * waiting on it then fired at once on that tap - usually the mute
         * button - which is the "double ring when muting". Give up instead of
         * queueing: the beep is only a fallback.
         */
        await Promise.race([
          ctx.resume().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 300)),
        ]);
      }
      if (ctx.state !== 'running') return;
      // Stopped (muted, accepted, passed) while this was starting.
      if (generation !== alertGenerationRef.current) return;
      const now = ctx.currentTime;
      const pulses = [
        { start: 0, duration: 0.25, freq: 880 },
        { start: 0.28, duration: 0.25, freq: 1100 },
        { start: 0.56, duration: 0.35, freq: 880 },
      ];
      pulses.forEach(({ start, duration, freq }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0.9, now + start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration);
      });
    } catch (err) {
      debugWarn('Synth delivery beep failed:', err);
    }
  }, []);

  const playNotificationSound = useCallback((orderData = {}) => {
    if (isOrderAlertMuted(orderData)) {
      return;
    }

    const generation = alertGenerationRef.current;
    alertActiveRef.current = true;
    // Claims the ringtone: a push for this offer must not play its own copy.
    if (typeof window !== 'undefined') window.__deliveryOrderAlertActive = true;
    // ...and one that arrived first and is already playing is stopped.
    try {
      stopActivePushPlayback();
    } catch (_) {}

    // Native bridge must not block the first web ring
    void triggerWebViewNativeNotification(
      orderData,
      () => generation === alertGenerationRef.current,
    ).catch(() => {});

    try {
      if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([200, 100, 200, 100, 300]);
        } catch (_) {}
      }

      const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
      const soundFile = selectedSound === 'original'
        ? resolveAudioSource(originalSound, 'delivery-original')
        : resolveAudioSource(alertSound, 'delivery-alert');
      
      if (audioRef.current) {
        const currentSrc = audioRef.current.src;
        const newSrc = soundFile;
        if (!currentSrc.includes(newSrc.split('/').pop())) {
          audioRef.current.pause();
          audioRef.current.src = newSrc;
          audioRef.current.load();
          debugLog('Audio source updated to:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
        }
      } else {
        audioRef.current = new Audio();
        audioRef.current.src = soundFile;
        audioRef.current.preload = 'auto';
        audioRef.current.volume = 1.0;
        audioRef.current.load();
        debugLog('Audio initialized with:', selectedSound === 'original' ? 'Original' : 'Zomato Tone', 'Source:', soundFile);
      }
      
      if (audioRef.current) {
        audioRef.current.muted = false;
        audioRef.current.volume = 1.0;
        audioRef.current.currentTime = 0;
        audioRef.current.loop = true;
        const p = audioRef.current.play();
        if (p && typeof p.catch === 'function') {
          p.catch(async (error) => {
            // Muted, accepted or passed while starting: pause() rejects play()
            // with AbortError, which used to fire the beep fallback right after
            // the rider silenced the alert.
            if (generation !== alertGenerationRef.current || error?.name === 'AbortError') return;
            debugWarn('HTML5 Audio play failed, running WebAudio synth fallback:', error);
            await playSynthDeliveryBeep(generation);
          });
        }
      } else {
        void playSynthDeliveryBeep(generation);
      }
    } catch (error) {
      void playSynthDeliveryBeep(generation);
    }
  }, [isOrderAlertMuted, playSynthDeliveryBeep]);

  const triggerOrderAlert = useCallback((orderData) => {
    const target = orderData || activeOrderRef.current || newOrder;
    if (!target) return;
    if (isOrderAlertMuted(target)) return;
    /*
     * The ringtone rings for currently valid requests only. Callers such as the
     * Orders tab re-trigger it on mount and whenever the queue grows, and
     * without this an expired card left on screen would ring again every time
     * the rider opened that tab.
     */
    if (!isOfferStillValid(target)) return;

    activeOrderRef.current = target;
    playNotificationSound(target);
    startAlertLoop(playNotificationSound, target);
  }, [isOrderAlertMuted, playNotificationSound, startAlertLoop, newOrder]);

  const setOrderAlertMuted = useCallback(
    (orderData, nextMuted) => {
      const keys = collectOrderAlertKeys(orderData);
      if (!keys.length) return;

      const muted = Boolean(nextMuted);
      keys.forEach((key) => {
        if (muted) {
          mutedOrderIdsRef.current.add(key);
        } else {
          mutedOrderIdsRef.current.delete(key);
        }
      });
      saveMutedOrderIds();
      setMuteUiTick((tick) => tick + 1);

      if (muted) {
        silenceOrderAlert();
        return;
      }

      const targetOrder = orderData || activeOrderRef.current || newOrder;
      if (targetOrder) {
        activeOrderRef.current = targetOrder;
        triggerOrderAlert(targetOrder);
      }
    },
    [saveMutedOrderIds, silenceOrderAlert, triggerOrderAlert, newOrder],
  );

  const toggleOrderAlertMuted = useCallback(
    (orderData) => {
      setOrderAlertMuted(orderData, !isOrderAlertMuted(orderData));
    },
    [isOrderAlertMuted, setOrderAlertMuted],
  );

  const stopAlertsWhenQueueEmpty = useCallback(() => {
    const pending = useDeliveryStore.getState().newOrders || [];
    if (pending.length === 0) {
      stopAlertLoop();
      activeOrderRef.current = null;
      setNewOrder(null);
    }
  }, [stopAlertLoop]);

  const showBackgroundOrderNotification = useCallback(async (orderData = {}) => {
    if (isNativeAppWebView()) {
      return;
    }

    if (
      shouldSkipDuplicateOsNotification({
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

    const notificationOptions = buildDeliveryOrderNotification(orderData);

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
            icon: getNotificationIcon("delivery"),
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
        icon: getNotificationIcon("delivery"),
        data: notificationOptions.data,
      });
    } catch (error) {
      debugWarn('Error showing background delivery notification:', error);
    }
  }, []);

  /*
   * When this session started listening. Anything dispatched before this
   * instant reached the device while the app was closed or backgrounded, so on
   * resume it is a replay, not news. Set once per mount and refreshed whenever
   * the app comes back to the foreground.
   */
  const sessionResumedAtRef = useRef(Date.now());

  /** The moment the offer was dispatched, or null when the payload has no usable stamp. */
  const getOfferCreatedAt = useCallback((orderData = {}) => {
    const raw = orderData?.offerCreatedAt || orderData?.dispatchedAt || orderData?.createdAt;
    if (!raw) return null;
    const at = new Date(raw).getTime();
    return Number.isFinite(at) ? at : null;
  }, []);

  /**
   * True only for an offer dispatched after this session resumed.
   *
   * Without a stamp we cannot prove the offer is new, so it is treated as a
   * replay and shown silently - the safe direction for a ringtone.
   */
  const isFreshOffer = useCallback((orderData = {}) => {
    const created = getOfferCreatedAt(orderData);
    if (created === null) return true;
    return created >= (sessionResumedAtRef.current - 5 * 60 * 1000);
  }, [getOfferCreatedAt]);

  const handleIncomingOrderAlert = useCallback((orderData = {}, { silent = false } = {}) => {
    // Ownership first: never ring for a request addressed to another account.
    if (!isEventForCurrentAccount(orderData)) {
      debugWarn('Ignored delivery offer addressed to another account', {
        target: orderData?.targetPartnerId,
        current: deliveryPartnerId,
      });
      return;
    }
    /*
     * Validity second: the ringtone is only ever for a request the backend
     * still considers acceptable. A push opened minutes later, or a socket
     * frame that arrives after the window closed, must stay silent rather than
     * put a card on screen that the server will refuse.
     */
    if (!isOfferStillValid(orderData)) {
      debugLog('Ignored expired delivery offer', {
        orderId: orderData?.orderId || orderData?.orderMongoId,
        offerExpiresAt: orderData?.offerExpiresAt,
      });
      return;
    }
    if (isOrderInAcceptedQueue(orderData)) {
      return;
    }
    if (isProcessedOrder(orderData)) {
      return;
    }
    if (!shouldProcessOrderAlert(orderData)) {
      return;
    }

    const mappedOrder = sanitizeOrderDispatchMetrics(mapOrderLocations(orderData) || orderData);
    const riderLocation = useDeliveryStore.getState().riderLocation;
    if (!isOrderWithinOfferRange(mappedOrder, riderLocation)) {
      debugLog('Ignored out-of-range order offer', {
        orderId: mappedOrder?.orderId || mappedOrder?._id,
      });
      return;
    }
    useDeliveryStore.getState().addNewOrder(mappedOrder);

    /*
     * A replayed offer is shown, not announced.
     *
     * Recovery runs on every resume, reconnect and focus, and it replays every
     * offer the server still considers live. Those offers are unexpired, so the
     * validity gate above lets them through - which is exactly how reopening the
     * app started the ringtone for a request that arrived while it was closed.
     * The card still appears (the rider can act on it); only the sound is
     * withheld, because nothing new just happened.
     */
    if (silent) {
      debugLog('Delivery offer restored without ringing (arrived before this session)', {
        orderId: mappedOrder?.orderId || mappedOrder?._id,
      });
      return;
    }

    activeOrderRef.current = mappedOrder || { id: Date.now() };
    // Play first, then schedule loop (loop must not pause the first play)
    playNotificationSound(mappedOrder);
    startAlertLoop(playNotificationSound);

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      showBackgroundOrderNotification(orderData);
    }
  }, [deliveryPartnerId, isEventForCurrentAccount, isOrderInAcceptedQueue, isProcessedOrder, playNotificationSound, showBackgroundOrderNotification, startAlertLoop]);

  const recoverDeliveryState = useCallback(async () => {
    if (!deliveryPartnerId) return;

    try {
      const [availableResult, currentTripResult] = await Promise.allSettled([
        deliveryAPI.getOrders({ limit: 20, page: 1 }),
        deliveryAPI.getCurrentDelivery(),
      ]);

      const currentPayload =
        currentTripResult.status === 'fulfilled'
          ? currentTripResult.value?.data?.data ??
            currentTripResult.value?.data ??
            null
          : null;

      const activeOrders = Array.isArray(currentPayload?.activeOrders)
        ? currentPayload.activeOrders
        : currentPayload?.activeOrder
          ? [currentPayload.activeOrder]
          : [];

      if (currentPayload?.capacity) {
        useDeliveryStore.getState().setCapacity(currentPayload.capacity);
      }

      if (activeOrders.length) {
        useDeliveryStore.getState().setAcceptedOrders(
          activeOrders.map(mapOrderLocations).filter(Boolean),
          { capacity: currentPayload?.capacity },
        );
        return;
      }

      if (currentPayload && (currentPayload._id || currentPayload.orderId)) {
        debugLog('Recovered current delivery trip after reconnect/focus:', currentPayload);
        setOrderStatusUpdate({
          ...currentPayload,
          recoverySource: 'delivery_reconnect',
        });
        return;
      }

      const availablePayload =
        availableResult.status === 'fulfilled'
          ? availableResult.value?.data?.data ??
            availableResult.value?.data ??
            {}
          : {};
      if (availablePayload?.capacity) {
        useDeliveryStore.getState().setCapacity(availablePayload.capacity);
      }

      /*
       * `newOffers` is the ONLY list that may produce a request card.
       *
       * Recovery used to scan the raw `docs` page for anything unassigned and
       * ring for it, gated by nothing but a two-hour age cut-off. That is how a
       * rider opening the app was greeted by a pile of long-dead requests: the
       * docs page is a paginated order listing, not an authorisation, and a
       * two-hour window is not an expiry. `newOffers` is built per-rider from
       * live `offeredTo` rows and carries each offer's own `offerExpiresAt`.
       */
      const newOffers = (
        Array.isArray(availablePayload?.newOffers) ? availablePayload.newOffers : []
      ).filter((order) => isEventForCurrentAccount(order) && isOfferStillValid(order));

      newOffers.forEach((order) => useDeliveryStore.getState().addNewOrder(order));

      const recoverableOrder = newOffers.find((order) => !isProcessedOrder(order)) || null;

      /*
       * Reconcile, don't just append.
       *
       * This recovery used to only add offers, so a request that expired or was
       * taken by someone else while this app was backgrounded stayed on screen
       * after reconnect. The available-orders endpoint is authorized per rider
       * and already excludes expired, rejected and claimed offers, so it is the
       * authority on what should still be showing.
       *
       * Only prune when the call actually succeeded - a failed request yields an
       * empty list, and pruning against that would wipe every live offer.
       *
       * Reconciled against `newOffers` alone. Including the raw `docs` page here
       * kept a card alive whenever the order appeared in that listing but was
       * dropped from `newOffers` by the server's own zone, distance or expiry
       * checks - which is the stale-card case this prune exists to catch.
       */
      if (availableResult.status === 'fulfilled') {
        const liveKeys = new Set(
          newOffers.flatMap((order) => collectOrderKeys(order)).map((key) => String(key)),
        );
        const store = useDeliveryStore.getState();
        (store.newOrders || []).forEach((offer) => {
          const keys = collectOrderKeys(offer).map((key) => String(key));
          const stillLive = keys.some((key) => liveKeys.has(key));
          if (!stillLive) {
            debugLog('Pruning stale delivery offer after resync:', keys[0]);
            store.removeNewOrder(offer);
          }
        });
      }

      if (recoverableOrder && !isProcessedOrder(recoverableOrder)) {
        debugLog('Recovered available delivery order after reconnect/focus:', recoverableOrder);
        setNewOrder(recoverableOrder);
        useDeliveryStore.getState().addNewOrder(recoverableOrder);
        /*
         * Recovery may only ring for an offer dispatched after this session
         * resumed. Everything else is replayed state and must stay silent,
         * which is what stopped the ringtone firing for old requests whenever
         * the app was reopened.
         */
        handleIncomingOrderAlert(recoverableOrder, { silent: !isFreshOffer(recoverableOrder) });
      }
    } catch (error) {
      debugWarn('Delivery recovery sync failed:', error?.message || error);
    }
  }, [deliveryPartnerId, handleIncomingOrderAlert, isEventForCurrentAccount, isFreshOffer, isProcessedOrder]);

  const joinDeliveryRoomIfPossible = useCallback(() => {
    if (!socketRef.current?.connected || !deliveryPartnerId) {
      return false;
    }

    if (joinedDeliveryRoomRef.current === deliveryPartnerId) {
      return true;
    }

    debugLog('Joining delivery room', {
      deliveryPartnerId,
      socketId: socketRef.current?.id,
    });
    socketRef.current.emit('join-delivery', deliveryPartnerId);
    joinedDeliveryRoomRef.current = deliveryPartnerId;
    return true;
  }, [deliveryPartnerId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.__deliverySocketDebug = {
      enabled: shouldLogDeliverySocket(),
      apiBaseUrl: API_BASE_URL,
      get deliveryPartnerId() {
        return deliveryPartnerId;
      },
      get isConnected() {
        return isConnected;
      },
      get socketId() {
        return socketRef.current?.id || null;
      },
      get socketConnected() {
        return Boolean(socketRef.current?.connected);
      },
      forceReconnect() {
        if (socketRef.current) {
          socketRef.current.connect();
        }
      },
      dump() {
        return {
          enabled: shouldLogDeliverySocket(),
          apiBaseUrl: API_BASE_URL,
          deliveryPartnerId,
          isConnected,
          socketId: socketRef.current?.id || null,
          socketConnected: Boolean(socketRef.current?.connected),
          socketAuthTokenPresent: Boolean(
            localStorage.getItem('delivery_accessToken') || localStorage.getItem('accessToken')
          ),
        };
      },
    };

    return () => {
      if (window.__deliverySocketDebug) {
        delete window.__deliverySocketDebug;
      }
    };
  }, [deliveryPartnerId, isConnected]);

  // Step 4: All effects (unconditional hook calls, conditional logic inside)
  useEffect(() => {
    if (!supportsBrowserNotifications()) return;

    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY) === 'true') return;

    const requestPermissionOnce = async () => {
      localStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
      try {
        await Notification.requestPermission();
      } catch (error) {
        debugWarn('Failed to request delivery notification permission:', error);
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

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'hidden') return;
      if (!activeOrderRef.current) return;
      // Don't re-announce a request whose window closed while the app sat open.
      if (!isOfferStillValid(activeOrderRef.current)) {
        stopAlertLoop();
        activeOrderRef.current = null;
        return;
      }

      playNotificationSound(activeOrderRef.current);
      // Through the same loop as the first ring, so it ends with the offer: this
      // used to loop with nothing watching it until the rider came back.
      startAlertLoop(playNotificationSound, activeOrderRef.current);
      showBackgroundOrderNotification(activeOrderRef.current);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playNotificationSound, showBackgroundOrderNotification, startAlertLoop, stopAlertLoop]);

  /*
   * Audio unlock on the rider's first real tap - the same approach as the
   * restaurant app.
   *
   * Browsers only let a page play sound after a user gesture. iPhone counts
   * click / touchend / pointerup / keydown - never touchstart or pointerdown -
   * and only for a play() made synchronously inside that handler. This used to
   * listen once on pointerdown/touchstart and call play() after awaiting
   * AudioContext.resume(), so on iPhone audio was never unlocked and an offer
   * never rang in the app. Now the ringtone element is played muted inside the
   * tap and put back, which is all the browser needs; a ring still owed starts
   * on the alert loop's next tick. Listeners stay until an unlock succeeds.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const UNLOCK_EVENTS = ['click', 'touchend', 'pointerup', 'keydown'];
    let unlocked = false;

    function detach() {
      UNLOCK_EVENTS.forEach((type) => window.removeEventListener(type, unlock, { capture: true }));
    }

    function unlock() {
      if (unlocked) return;
      userInteractedRef.current = true;
      window.__userHasInteracted = true;

      // The fallback beep's context: resume() only has to be called inside the gesture.
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          if (!window.__deliverySynthCtx) window.__deliverySynthCtx = new AudioCtx();
          if (window.__deliverySynthCtx.state === 'suspended') {
            window.__deliverySynthCtx.resume().catch(() => {});
          }
          const buffer = window.__deliverySynthCtx.createBuffer(1, 1, 22050);
          const source = window.__deliverySynthCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(window.__deliverySynthCtx.destination);
          source.start(0);
        } catch (_) {}
      }

      // Pre-initialize audio element reference without playing the file
      if (!audioRef.current) {
        const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
        audioRef.current = new Audio(
          selectedSound === 'original'
            ? resolveAudioSource(originalSound, 'delivery-original')
            : resolveAudioSource(alertSound, 'delivery-alert'),
        );
        audioRef.current.preload = 'auto';
        audioRef.current.volume = 1.0;
      }

      // Play 1-sample silent dummy audio to unlock HTMLAudioElement media pipeline
      try {
        const silentAudio = new Audio(
          'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
        );
        const started = silentAudio.play();
        if (started && typeof started.then === 'function') {
          started
            .then(() => {
              try {
                silentAudio.pause();
              } catch (_) {}
              unlocked = true;
              detach();
            })
            .catch(() => {
              unlocked = true;
              detach();
            });
          return;
        }
      } catch (_) {}

      unlocked = true;
      detach();
    }

    // Capture phase on window: a handler that stops propagation cannot hide the gesture.
    UNLOCK_EVENTS.forEach((type) =>
      window.addEventListener(type, unlock, { capture: true, passive: true }),
    );
    return detach;
  }, []);
  
  // Initialize audio on mount - use selected preference from localStorage
  useEffect(() => {
    // Get selected alert sound preference from localStorage
    const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
    const soundFile = selectedSound === 'original'
      ? resolveAudioSource(originalSound, 'delivery-original')
      : resolveAudioSource(alertSound, 'delivery-alert');
    
    if (!audioRef.current) {
      audioRef.current = new Audio(soundFile);
      audioRef.current.preload = 'auto';
      audioRef.current.volume = 0.7;
      debugLog('?? Audio initialized with:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
    } else {
      // Update audio source if preference changed
      const currentSrc = audioRef.current.src;
      const newSrc = soundFile;
      if (!currentSrc.includes(newSrc.split('/').pop())) {
        audioRef.current.pause();
        audioRef.current.src = newSrc;
        audioRef.current.load();
        debugLog('?? Audio updated to:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
      }
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      // Leaving the claim set would silence every later push for good.
      alertActiveRef.current = false;
      if (typeof window !== 'undefined') window.__deliveryOrderAlertActive = false;
    };
  }, []); // Note: This runs once on mount. To update dynamically, we'd need to listen to storage events

  // Fetch delivery partner ID
  useEffect(() => {
    const fallbackId = resolveDeliveryPartnerIdFromClient();
    if (fallbackId) {
      setDeliveryPartnerId(fallbackId);
      debugLog('? Delivery Partner ID restored from local client auth:', fallbackId);
    }

    const fetchDeliveryPartnerId = async () => {
      try {
        const response = await deliveryAPI.getMe();
        if (response.data?.success && response.data.data) {
          const deliveryPartner = response.data.data.user || response.data.data.deliveryPartner;
          if (deliveryPartner) {
            const id = deliveryPartner.id?.toString() || 
                      deliveryPartner._id?.toString() || 
                      deliveryPartner.deliveryId;
            if (id) {
              setDeliveryPartnerId(id);
              debugLog('? Delivery Partner ID fetched:', id);
            } else {
              debugWarn('?? Could not extract delivery partner ID from response');
            }
          } else {
            debugWarn('?? No delivery partner data in API response');
          }
        } else {
          debugWarn('?? Could not fetch delivery partner ID from API');
        }
      } catch (error) {
        debugError('Error fetching delivery partner:', error);
      }
    };
    fetchDeliveryPartnerId();
  }, []);

  // Socket connection effect (no backend when API_BASE_URL is empty)
  useEffect(() => {
    if (!API_BASE_URL || !String(API_BASE_URL).trim()) {
      setIsConnected(false);
      return;
    }

    // IMPORTANT: Socket.IO server is on the origin (not /api/v1).
    // Our API baseURL is typically like: http://localhost:5000/api/v1
    // So for sockets we always connect to: http://localhost:5000
    let backendUrl = API_BASE_URL;
    try {
      const base =
        String(backendUrl).startsWith('http')
          ? undefined
          : (typeof window !== 'undefined' ? window.location.origin : undefined);
      backendUrl = new URL(backendUrl, base).origin;
    } catch {
      // best-effort fallback: strip common API prefixes
      backendUrl = String(backendUrl || "")
        .replace(/\/api\/v\d+\/?$/i, "")
        .replace(/\/api\/?$/i, "")
        .replace(/\/+$/, "");

      if ((!backendUrl || !backendUrl.startsWith('http')) && typeof window !== 'undefined') {
        backendUrl = window.location.origin;
      }
    }
    
    // Same origin resolution as every other app socket, so VITE_SOCKET_URL is honoured
    // when sockets are served from a different host than the REST API.
    try {
      const resolved = resolveSocketOrigin();
      if (resolved?.url) backendUrl = resolved.url;
    } catch {
      // keep the API-derived origin
    }

    // Backend uses default namespace; rooms handle role separation.
    const socketUrl = `${backendUrl}`;
    
    debugLog('?? Attempting to connect to Delivery Socket.IO:', socketUrl);
    debugLog('?? Backend URL:', backendUrl);
    debugLog('?? API_BASE_URL:', API_BASE_URL);
    debugLog('?? Delivery Partner ID:', deliveryPartnerId);
    debugLog('?? Environment: (ui-only mode)');
    
    // Block localhost only in production builds. In dev, localhost is expected.
    if (import.meta.env.PROD && backendUrl.includes('localhost')) {
      debugError('? CRITICAL: Trying to connect Socket.IO to localhost in production!');
      debugError('?? Current socketUrl:', socketUrl);
      debugError('?? Current API_BASE_URL:', API_BASE_URL);
      setIsConnected(false);
      return;
    }
    
    // Validate backend URL format
    if (!backendUrl || !backendUrl.startsWith('http')) {
      debugError('? CRITICAL: Invalid backend URL format:', backendUrl);
      debugError('?? API_BASE_URL:', API_BASE_URL);
      debugError('?? Expected format: https://your-domain.com or ');
      return; // Don't try to connect with invalid URL
    }
    
    // Validate socket URL format
    try {
      new URL(socketUrl); // This will throw if URL is invalid
    } catch (urlError) {
      debugError('? CRITICAL: Invalid Socket.IO URL:', socketUrl);
      debugError('?? URL validation error:', urlError.message);
      debugError('?? Backend URL:', backendUrl);
      debugError('?? API_BASE_URL:', API_BASE_URL);
      return; // Don't try to connect with invalid URL
    }

    const token = localStorage.getItem('delivery_accessToken') || localStorage.getItem('accessToken');
    const tokenPreview = token ? `${String(token).slice(0, 12)}...` : null;
    debugLog('Preparing socket auth payload', {
      tokenPresent: Boolean(token),
      tokenPreview,
      deliveryPartnerId,
      socketUrl,
    });

    socketRef.current = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'], // WebSocket first for instant connection
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      auth: {
        token: token || ""
      },
      query: token ? { token } : undefined,
    });

    debugLog('Socket.IO client created', {
      socketUrl,
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      tokenPresent: Boolean(token),
      tokenPreview,
      deliveryPartnerId,
    });

    socketRef.current.on('connect', () => {
      debugLog('Socket connected', {
        socketId: socketRef.current?.id,
        deliveryPartnerId,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(true);

      joinedDeliveryRoomRef.current = null;
      if (!joinDeliveryRoomIfPossible()) {
        debugLog('Socket connected before deliveryPartnerId was ready; waiting to join room.');
      }

      // Auto-join tracking room for all active orders
      const active = useDeliveryStore.getState().acceptedOrders || [];
      active.forEach((o) => {
        const id = o.orderId || o._id;
        if (id) socketRef.current?.emit('join-tracking', id);
      });

      debugLog('Requesting resync after connect', {
        deliveryPartnerId,
        socketId: socketRef.current?.id,
      });
      socketRef.current.emit('resync');
      void recoverDeliveryState();
    });

    socketRef.current.on('delivery-room-joined', (data) => {
      debugLog('Delivery room joined successfully', data);
    });

    socketRef.current.on('resync_complete', (data) => {
      debugLog('Resync completed', data);
    });

    socketRef.current.on('connect_error', (error) => {
      debugError('Socket connection error', {
        message: error?.message,
        type: error?.type,
        description: error?.description,
        context: error?.context,
        data: error?.data,
        socketUrl,
        apiBaseUrl: API_BASE_URL,
        deliveryPartnerId,
        tokenPresent: Boolean(token),
        tokenPreview,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(false);
    });

    socketRef.current.on('disconnect', (reason) => {
      debugWarn('Socket disconnected', {
        reason,
        socketId: socketRef.current?.id,
        deliveryPartnerId,
      });
      setIsConnected(false);
      joinedDeliveryRoomRef.current = null;
      
      if (reason === 'io server disconnect') {
        socketRef.current.connect();
      }
    });

    socketRef.current.on('reconnect_attempt', (attemptNumber) => {
      debugWarn('Reconnection attempt', {
        attemptNumber,
        socketUrl,
        deliveryPartnerId,
      });
    });

    socketRef.current.on('reconnect', (attemptNumber) => {
      debugLog('Socket reconnected', {
        attemptNumber,
        socketId: socketRef.current?.id,
        deliveryPartnerId,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(true);

      joinedDeliveryRoomRef.current = null;
      joinDeliveryRoomIfPossible();

      // Auto-join tracking room for all active orders
      const active = useDeliveryStore.getState().acceptedOrders || [];
      active.forEach((o) => {
        const id = o.orderId || o._id;
        if (id) socketRef.current?.emit('join-tracking', id);
      });

      socketRef.current.emit('resync');
      void recoverDeliveryState();
    });

    /*
     * Every offer event passes the same two gates before it can reach the UI:
     * it must be addressed to the account signed in right now, and its
     * server-issued window must still be open. Without the first, a socket left
     * over from the previous account can put that rider's request on this
     * screen; without the second, a frame delivered late can revive a request
     * the backend has already expired.
     */
    const handleOfferEvent = (orderData, label) => {
      debugLog(`${label} received via socket`, {
        orderId: orderData?.orderId || orderData?.orderMongoId || orderData?._id,
        targetPartnerId: orderData?.targetPartnerId,
        offerExpiresAt: orderData?.offerExpiresAt,
      });
      if (!isEventForCurrentAccount(orderData)) {
        debugWarn(`${label} ignored - addressed to another account`, {
          target: orderData?.targetPartnerId,
          current: deliveryPartnerId,
        });
        return;
      }
      if (!isOfferStillValid(orderData)) {
        debugLog(`${label} ignored - offer window already closed`);
        return;
      }
      if (isOrderInAcceptedQueue(orderData) || isProcessedOrder(orderData)) {
        return;
      }
      setNewOrder(orderData);
      handleIncomingOrderAlert(orderData);
    };

    socketRef.current.on('new_order', (orderData) => handleOfferEvent(orderData, 'new_order'));

    // Same payload as new_order — also ring so retry-only offers are not silent
    socketRef.current.on('new_order_available', (orderData) =>
      handleOfferEvent(orderData, 'new_order_available'),
    );

    socketRef.current.on('active_orders', (orders = []) => {
      if (!Array.isArray(orders) || orders.length === 0) return;
      useDeliveryStore.getState().setAcceptedOrders(
        orders.map(mapOrderLocations).filter(Boolean),
      );
    });

    socketRef.current.on('delivery_capacity', (capacity) => {
      if (capacity) {
        useDeliveryStore.getState().setCapacity(capacity);
      }
    });

    socketRef.current.on('active_order', (orderData) => {
      if (!orderData) return;
      if (!isEventForCurrentAccount(orderData)) return;
      const mapped = mapOrderLocations(orderData);
      if (mapped) {
        markOrderIdsProcessed(mapped);
        clearOrderMuteState(mapped);
        useDeliveryStore.getState().acceptOrderToQueue(mapped);
        endOrderAlert();
        activeOrderRef.current = null;
        setNewOrder(null);
      }
    });

    socketRef.current.on('play_notification_sound', (data) => {
      debugLog('play_notification_sound received', {
        orderId: data?.orderId || data?.orderMongoId || data?.order_id,
      });
      const normalizedData = {
        orderId: data?.orderId || data?.order_id,
        orderMongoId: data?.orderMongoId || data?.order_mongo_id,
        ...data
      };
      if (!isEventForCurrentAccount(normalizedData)) return;
      if (isOrderAlertMuted(normalizedData) || isOrderInAcceptedQueue(normalizedData) || isProcessedOrder(normalizedData)) {
        return;
      }
      handleIncomingOrderAlert(normalizedData);
    });

    socketRef.current.on('order_ready', (orderData) => {
      debugLog('order_ready received via socket', {
        orderId: orderData?.orderId || orderData?.orderMongoId || orderData?._id,
      });
      setOrderReady(orderData);
      /*
       * A heads-up for an order the rider already holds. It used to call
       * playNotificationSound alone, which loops the ringtone and sets no
       * limit - with no offer card on screen, nothing ever stopped it. Now it
       * ends after ALERT_LOOP_MAX_MS, and never cuts into an offer's ring that
       * is already playing.
       */
      if (alertActiveRef.current) return;
      playNotificationSound(orderData);
      startAlertLoop(playNotificationSound, orderData, { whileOfferPending: false });
    });

    socketRef.current.on('order_status_update', (statusData) => {
      debugLog('?? Delivery order status update received via socket:', statusData);
      setOrderStatusUpdate(statusData || null);
      const incomingStatus = String(statusData?.orderStatus || statusData?.status || '').toLowerCase();
      const oid = statusData?.orderId || statusData?.orderMongoId;
      if (oid && ['picked_up', 'out_for_delivery', 'on_way', 'reached_drop'].includes(incomingStatus)) {
        socketRef.current?.emit('join-tracking', oid);
      }
    });

    socketRef.current.on('user_live_location', (data) => {
      if (!data) return;
      debugLog('📍 Customer live location received via socket:', data);
      const orderId = data.orderId || data.orderMongoId;
      if (orderId && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng))) {
        useDeliveryStore.getState().updateCustomerLiveLocation(orderId, {
          lat: Number(data.lat),
          lng: Number(data.lng),
          accuracy: data.accuracy != null ? Number(data.accuracy) : null,
          timestamp: data.timestamp || Date.now(),
        });
      }
    });

    socketRef.current.on('order_cancelled', (statusData) => {
      debugLog('?? Delivery order cancelled event received via socket:', statusData);
      setOrderStatusUpdate({
        ...(statusData || {}),
        status: 'cancelled'
      });
    });

    socketRef.current.on('order_deleted', (statusData) => {
      debugLog('?? Delivery order deleted event received via socket:', statusData);
      setOrderStatusUpdate({
        ...(statusData || {}),
        status: 'deleted'
      });
    });

    const handleOfferTakenElsewhere = (data, { showToast }) => {
      // A dismissal meant for another rider must not clear this rider's card.
      if (!isEventForCurrentAccount(data)) return;
      const claimedId = data?.orderId || data?.orderMongoId || data?.order_id;
      // The server flags the winner's own copy instead of broadcasting the
      // winning rider's id to the whole fleet. `claimedBy` is the pre-split
      // form, kept so a client running against an older server still works.
      const legacyClaimedBy = String(data?.claimedBy || '');
      const isSelf =
        data?.claimedByYou === true ||
        (Boolean(legacyClaimedBy) &&
          Boolean(deliveryPartnerId) &&
          legacyClaimedBy === String(deliveryPartnerId));

      if (claimedId) {
        markOrderIdsProcessed({ _id: claimedId, orderId: claimedId, orderMongoId: claimedId });
        useDeliveryStore.getState().removeNewOrder(claimedId);
        setClaimedOrderId(claimedId);
      }

      if (showToast && !isSelf) {
        toast.info('This request accepted by another rider', {
          id: `order-claimed-${claimedId || 'unknown'}`,
          duration: 4000,
        });
      }

      const remaining = useDeliveryStore.getState().newOrders || [];
      if (remaining.length > 0) {
        const nextOffer = remaining[0];
        activeOrderRef.current = nextOffer;
        setNewOrder(nextOffer);
        if (!isOrderAlertMuted(nextOffer)) {
          playNotificationSound(nextOffer);
          startAlertLoop(playNotificationSound);
        } else {
          endOrderAlert();
        }
        return;
      }

      endOrderAlert();
      activeOrderRef.current = null;
      setNewOrder(null);
    };

    socketRef.current.on('order_reassigned_elsewhere', (data) => {
      debugLog('?? Order reassigned to another partner:', data);
      handleOfferTakenElsewhere(data, { showToast: true });
    });

    // The backend expired this rider's offer (server-side expiresAt, not a
    // frontend timer). Clear the card and stop the ringtone so a dead request
    // cannot sit on screen until the rider taps it and gets an error.
    socketRef.current.on('delivery_request_expired', (data) => {
      debugLog('?? Delivery request expired:', data);
      handleOfferTakenElsewhere(data, { showToast: false });
    });

    // Backend emits 'order_claimed' when another delivery boy accepts an offered order
    socketRef.current.on('order_claimed', (data) => {
      debugLog('?? order_claimed received - order taken by another partner:', data);
      handleOfferTakenElsewhere(data, { showToast: true });
    });

    socketRef.current.on('admin_notification', (payload) => {
      debugLog('Admin broadcast received via socket', payload);
      setAdminNotification(payload);
      dispatchNotificationInboxRefresh();
    });

    // Auth change/refresh listeners
    const handleAuthChange = () => {
      const newToken = localStorage.getItem('delivery_accessToken') || localStorage.getItem('accessToken');
      if (socketRef.current && newToken) {
        debugLog('?? Auth changed, updating socket token');
        socketRef.current.auth.token = newToken;
        // Only reconnect if not already connecting/connected or if token changed significantly
        if (!socketRef.current.connected) {
          socketRef.current.connect();
        }
      }
    };

    const handleAuthRefreshed = (e) => {
      if (e.detail?.module === 'delivery' && socketRef.current && e.detail.token) {
        debugLog('?? Auth refreshed for delivery, updating socket token');
        socketRef.current.auth.token = e.detail.token;
        if (!socketRef.current.connected) {
          socketRef.current.connect();
        }
      }
    };

    /*
     * Stamp the resume instant BEFORE recovery runs.
     *
     * Recovery decides whether to ring by comparing each offer's dispatch time
     * against this marker, so it has to be current when that comparison
     * happens. Stamping afterwards would leave the previous value in place and
     * let offers that arrived while the app was away count as new.
     */
    const markResumed = () => {
      sessionResumedAtRef.current = Date.now();
    };

    const handleWindowFocus = () => {
      markResumed();
      void recoverDeliveryState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markResumed();
        void recoverDeliveryState();
      }
    };

    const handleRiderPickedUp = (e) => {
      const orderId = e?.detail?.orderId;
      if (orderId && socketRef.current) {
        debugLog('Immediately joining tracking room on pickup:', orderId);
        socketRef.current.emit('join-tracking', orderId);
      }
    };

    window.addEventListener('deliveryAuthChanged', handleAuthChange);
    window.addEventListener('authRefreshed', handleAuthRefreshed);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('riderPickedUpOrder', handleRiderPickedUp);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      debugLog('? Cleaning up socket connection...');
      stopAlertLoop();
      joinedDeliveryRoomRef.current = null;
      window.removeEventListener('deliveryAuthChanged', handleAuthChange);
      window.removeEventListener('authRefreshed', handleAuthRefreshed);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('riderPickedUpOrder', handleRiderPickedUp);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [deliveryPartnerId, handleIncomingOrderAlert, isEventForCurrentAccount, isOrderAlertMuted, isOrderInAcceptedQueue, isProcessedOrder, joinDeliveryRoomIfPossible, markOrderIdsProcessed, clearOrderMuteState, playNotificationSound, recoverDeliveryState, showBackgroundOrderNotification, startAlertLoop, stopAlertLoop, endOrderAlert]);

  // Handle push notification order alerts for delivery partner (FCM / Service Worker push)
  useEffect(() => {
    if (!deliveryPartnerId || typeof window === 'undefined') return;

    const handlePushDeliveryOffer = (event) => {
      const raw = event?.detail?.data || event?.detail || {};
      const orderPayload = raw?.orderData || raw?.order || raw;
      const orderId = orderPayload?.orderId || orderPayload?.order_id || orderPayload?._id || raw?.orderId;
      if (!orderId) return;

      const normalizedData = {
        orderId,
        orderMongoId: orderPayload?.orderMongoId || orderPayload?._id || orderId,
        targetPartnerId: raw?.targetPartnerId || orderPayload?.targetPartnerId || deliveryPartnerId,
        ...orderPayload,
      };

      if (!isEventForCurrentAccount(normalizedData)) return;
      if (!isOfferStillValid(normalizedData)) return;
      if (isOrderInAcceptedQueue(normalizedData) || isProcessedOrder(normalizedData)) return;

      setNewOrder(normalizedData);
      handleIncomingOrderAlert(normalizedData, { silent: false });
    };

    window.addEventListener('app-order-push', handlePushDeliveryOffer);
    window.addEventListener('delivery_request', handlePushDeliveryOffer);
    window.addEventListener('new_order', handlePushDeliveryOffer);

    return () => {
      window.removeEventListener('app-order-push', handlePushDeliveryOffer);
      window.removeEventListener('delivery_request', handlePushDeliveryOffer);
      window.removeEventListener('new_order', handlePushDeliveryOffer);
    };
  }, [deliveryPartnerId, handleIncomingOrderAlert, isEventForCurrentAccount, isOfferStillValid, isOrderInAcceptedQueue, isProcessedOrder, setNewOrder]);

  /**
   * Expire offers locally, on a ticker, between server events.
   *
   * The backend is the authority and emits `delivery_request_expired`, but that
   * event only lands if a socket is connected at that instant. While the app is
   * backgrounded, offline, or reconnecting, an expired request would otherwise
   * sit on screen - still ringing - until something else cleared it. Each offer
   * carries the server's own `offerExpiresAt`, so the tick only enforces a
   * decision the backend already made; it never invents an expiry.
   */
  useEffect(() => {
    const enforceOfferExpiry = () => {
      const expired = useDeliveryStore.getState().pruneExpiredOffers();
      if (!expired.length) return;

      debugLog('Expired delivery offers removed locally', {
        count: expired.length,
      });

      // Stop the ringtone if what it was ringing for is one of the dead ones.
      const ringingFor = activeOrderRef.current;
      const ringingExpired =
        ringingFor && expired.some((order) => ordersShareIdentity(order, ringingFor));
      if (ringingExpired || !ringingFor) {
        stopAlertLoop();
        activeOrderRef.current = null;
        setNewOrder((current) =>
          current && expired.some((order) => ordersShareIdentity(order, current))
            ? null
            : current,
        );
      }
      stopAlertsWhenQueueEmpty();
    };

    const timer = setInterval(enforceOfferExpiry, 2000);
    // Also run the moment the app is brought back, so a request that died while
    // backgrounded is gone by the time the first frame is painted.
    const onVisible = () => {
      if (document.visibilityState === 'visible') enforceOfferExpiry();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', enforceOfferExpiry);
    enforceOfferExpiry();

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', enforceOfferExpiry);
    };
  }, [stopAlertLoop, stopAlertsWhenQueueEmpty]);

  /**
   * Tear down everything account-specific when the rider session ends.
   *
   * Logout and account switch both clear storage, but this hook's own state -
   * the ringtone, the processed/muted/dedupe maps, the pending offer, the
   * socket's room membership - lives in refs that survive a route change. Left
   * alone, the next rider to sign in inside the same app session inherits all
   * of it: the previous rider's offer still on screen, their ringtone still
   * playing, their mutes still suppressing alerts.
   */
  useEffect(() => {
    const handleSessionReset = () => {
      debugLog('Delivery session reset - clearing local rider state');
      endOrderAlert();
      activeOrderRef.current = null;
      setNewOrder(null);
      setOrderReady(null);
      setOrderStatusUpdate(null);
      setClaimedOrderId(null);
      setAdminNotification(null);
      processedOrderIdsRef.current.clear();
      clearDeliveryHandledOffers();
      mutedOrderIdsRef.current.clear();
      lastAlertAtByOrderRef.current.clear();
      lastBrowserNotificationAtByOrderRef.current.clear();
      joinedDeliveryRoomRef.current = null;
      // Re-read rather than hard-null: storage was just cleared, so this is
      // null on a logout, but on an account switch the incoming rider may
      // already be stored and we pick them up without waiting for a remount.
      setDeliveryPartnerId(resolveDeliveryPartnerIdFromClient());

      try {
        useDeliveryStore.getState().resetAccountState();
      } catch (_) {}

      // Drop the socket: it authenticated as the previous rider and is still
      // joined to their private room. The next sign-in opens a fresh one.
      if (socketRef.current) {
        try {
          socketRef.current.removeAllListeners();
          socketRef.current.disconnect();
        } catch (_) {}
        socketRef.current = null;
      }
      setIsConnected(false);
    };

    window.addEventListener(DELIVERY_SESSION_RESET_EVENT, handleSessionReset);
    return () => window.removeEventListener(DELIVERY_SESSION_RESET_EVENT, handleSessionReset);
  }, [endOrderAlert]);

  /**
   * A change of authenticated rider is itself a reset.
   *
   * Belt-and-braces alongside the session-reset event: if an account switch ever
   * happens without that event firing, the id changing is still enough to drop
   * the previous rider's offers and silence their ringtone.
   */
  const previousPartnerIdRef = useRef(null);
  useEffect(() => {
    const previous = previousPartnerIdRef.current;
    previousPartnerIdRef.current = deliveryPartnerId;
    if (!previous || !deliveryPartnerId || previous === deliveryPartnerId) return;

    debugLog('Delivery account changed - dropping previous rider state', {
      previous,
      next: deliveryPartnerId,
    });
    endOrderAlert();
    activeOrderRef.current = null;
    setNewOrder(null);
    processedOrderIdsRef.current.clear();
    clearDeliveryHandledOffers();
    mutedOrderIdsRef.current.clear();
    lastAlertAtByOrderRef.current.clear();
    lastBrowserNotificationAtByOrderRef.current.clear();
    joinedDeliveryRoomRef.current = null;
    try {
      useDeliveryStore.getState().resetAccountState();
    } catch (_) {}
  }, [deliveryPartnerId, endOrderAlert]);

  useEffect(() => {
    if (!deliveryPartnerId) {
      debugLog('? Waiting for deliveryPartnerId...');
      return;
    }

    joinDeliveryRoomIfPossible();

    if (socketRef.current?.connected) {
      debugLog('Requesting resync after deliveryPartnerId resolved', {
        deliveryPartnerId,
        socketId: socketRef.current?.id,
      });
      socketRef.current.emit('resync');
      void recoverDeliveryState();
    }
  }, [deliveryPartnerId, joinDeliveryRoomIfPossible, recoverDeliveryState]);

  // Helper functions
  const clearNewOrder = useCallback((orderOrId) => {
    const target = orderOrId || newOrder || activeOrderRef.current;
    if (target) {
      if (typeof target === 'object') {
        markOrderIdsProcessed(target);
        clearOrderMuteState(target);
      } else {
        markOrderIdsProcessed({ orderId: target });
        clearOrderMuteState(target);
      }
    }
    // Accepted, passed or taken: every copy of its ringtone ends here.
    endOrderAlert();
    activeOrderRef.current = null;
    setNewOrder(null);
    const removeId =
      typeof target === 'object'
        ? resolveOrderKey(target)
        : String(target || '').trim();
    if (removeId) {
      useDeliveryStore.getState().removeNewOrder(removeId);
    }
    stopAlertsWhenQueueEmpty();
  }, [clearOrderMuteState, endOrderAlert, markOrderIdsProcessed, newOrder, stopAlertsWhenQueueEmpty]);

  /**
   * Hide the offer card WITHOUT marking the order processed.
   *
   * clearNewOrder() permanently blocklists the order via markOrderIdsProcessed,
   * and the socket handler drops anything already processed — so using it for a
   * minimise, or before an accept that then fails, made that order impossible to
   * receive again for the rest of the session. Use this whenever the rider has
   * not actually declined the order.
   */
  const dismissNewOrder = useCallback(() => {
    // The offer is still open (minimised, or an accept/pass in flight), so its
    // notification stays - but the rider has acted, so nothing keeps ringing.
    silenceOrderAlert();
    activeOrderRef.current = null;
    setNewOrder(null);
    stopAlertsWhenQueueEmpty();
  }, [silenceOrderAlert, stopAlertsWhenQueueEmpty]);

  /*
   * Going offline silences a ringing offer, the way minimising does. The offer
   * stays on screen until it is taken or expires, but now that an offer rings
   * for its whole window, a rider who has just switched off must not be rung at
   * for the rest of it.
   */
  useEffect(
    () =>
      useDeliveryStore.subscribe((state, previous) => {
        if (previous?.isOnline && !state.isOnline) dismissNewOrder();
      }),
    [dismissNewOrder],
  );

  /** Drop every pending offer (used when the rider goes offline or clears the feed). */
  const clearAllOffers = useCallback(() => {
    endOrderAlert();
    activeOrderRef.current = null;
    setNewOrder(null);
    try {
      useDeliveryStore.getState().setNewOrders([]);
    } catch (_) {}
    stopAlertsWhenQueueEmpty();
  }, [endOrderAlert, stopAlertsWhenQueueEmpty]);

  const clearClaimedOrderId = () => setClaimedOrderId(null);

  const clearOrderReady = () => {
    setOrderReady(null);
  };

  const clearOrderStatusUpdate = () => {
    setOrderStatusUpdate(null);
  };

  const clearAdminNotification = () => {
    setAdminNotification(null);
  };

  const emitLocation = useCallback((data) => {
    if (socketRef.current && socketRef.current.connected) {
      // debugLog('? Emitting location via socket:', data);
      socketRef.current.emit('update-location', data);
      return true;
    }
    return false;
  }, []);

  const joinOrderTracking = useCallback((orderId) => {
    if (socketRef.current && socketRef.current.connected && orderId) {
      socketRef.current.emit('join-tracking', orderId);
      return true;
    }
    return false;
  }, []);

  return {
    newOrder,
    clearNewOrder,
    clearAllOffers,
    dismissNewOrder,
    orderReady,
    clearOrderReady,
    orderStatusUpdate,
    clearOrderStatusUpdate,
    adminNotification,
    clearAdminNotification,
    claimedOrderId,
    clearClaimedOrderId,
    isConnected,
    playNotificationSound,
    // Called by the Orders tab on accept / pass: a rider action, so it silences every copy.
    stopSound: silenceOrderAlert,
    triggerOrderAlert,
    isOrderAlertMuted,
    setOrderAlertMuted,
    toggleOrderAlertMuted,
    muteUiTick,
    emitLocation,
    joinOrderTracking,
  };
};


