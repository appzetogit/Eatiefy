import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notificationAPI } from "@food/api";
import { isModuleAuthenticated } from "@food/utils/auth";

const normalizeInboxItems = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((item, index) => ({
    id: String(item?._id || item?.id || `broadcast-${index}`),
    source: "broadcast",
    title: String(item?.title || "Notification").trim(),
    message: String(item?.message || "").trim(),
    link: String(item?.link || "").trim(),
    read: Boolean(item?.isRead),
    createdAt: item?.createdAt || item?.updatedAt || new Date().toISOString(),
    category: String(item?.category || "broadcast"),
  }));

const REFRESH_EVENT = "foodNotificationInboxRefresh";
const INBOX_MIN_FETCH_MS = 60_000;

/** Shared across hook instances to avoid duplicate inbox API calls. */
const inboxSharedCache = new Map();
const inboxInflight = new Map();

const buildInboxCacheKey = (module, limit) => `${module}:${limit || 50}`;

export const dispatchNotificationInboxRefresh = () => {
  if (typeof window === "undefined") return;
  inboxSharedCache.clear();
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
};

export default function useNotificationInbox(module, options = {}) {
  const enabled = options?.enabled !== false;
  const limit = options?.limit || 50;
  const cacheKey = buildInboxCacheKey(module, limit);

  const [items, setItems] = useState(() => inboxSharedCache.get(cacheKey)?.items || []);
  const [unreadCount, setUnreadCount] = useState(
    () => inboxSharedCache.get(cacheKey)?.unreadCount || 0,
  );
  const [loading, setLoading] = useState(
    () => enabled && options?.autoload !== false && !inboxSharedCache.has(cacheKey),
  );

  const fetchInbox = useCallback(
    async ({ force = false } = {}) => {
      if (!module || !enabled) {
        setItems([]);
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      if (!isModuleAuthenticated(module)) {
        setItems([]);
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      const cached = inboxSharedCache.get(cacheKey);
      const isFresh =
        cached && Date.now() - (cached.fetchedAt || 0) < INBOX_MIN_FETCH_MS;

      if (!force && isFresh) {
        setItems(cached.items || []);
        setUnreadCount(Number(cached.unreadCount || 0));
        setLoading(false);
        return;
      }

      if (!force && inboxInflight.has(cacheKey)) {
        try {
          const payload = await inboxInflight.get(cacheKey);
          setItems(payload.items || []);
          setUnreadCount(Number(payload.unreadCount || 0));
        } catch {
          /* ignore */
        } finally {
          setLoading(false);
        }
        return;
      }

      try {
        if (!isFresh) setLoading(true);

        const request = notificationAPI
          .getInbox({ page: 1, limit }, { contextModule: module })
          .then((response) => {
            const payload = response?.data?.data || {};
            const normalized = {
              items: normalizeInboxItems(payload?.items),
              unreadCount: Number(payload?.unreadCount || 0),
              fetchedAt: Date.now(),
            };
            inboxSharedCache.set(cacheKey, normalized);
            return normalized;
          })
          .finally(() => {
            inboxInflight.delete(cacheKey);
          });

        inboxInflight.set(cacheKey, request);
        const payload = await request;
        setItems(payload.items);
        setUnreadCount(payload.unreadCount);
      } catch {
        setItems([]);
        setUnreadCount(0);
      } finally {
        setLoading(false);
      }
    },
    [cacheKey, enabled, limit, module],
  );

  useEffect(() => {
    if (!enabled || options?.autoload === false || !module) return;
    fetchInbox();
  }, [enabled, fetchInbox, module, options?.autoload]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = () => {
      fetchInbox({ force: true });
    };
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, [fetchInbox]);

  useEffect(() => {
    const pollMs = Number(options?.pollMs || 0);
    if (!enabled || !pollMs || pollMs < 1000 || !module) return undefined;
    const timer = window.setInterval(() => {
      fetchInbox();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, fetchInbox, module, options?.pollMs]);

  const markAsRead = useCallback(
    async (id) => {
      if (!id || !module) return;
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      try {
        await notificationAPI.markAsRead(id, { contextModule: module });
        const cached = inboxSharedCache.get(cacheKey);
        if (cached) {
          inboxSharedCache.set(cacheKey, {
            ...cached,
            items: cached.items.map((item) =>
              item.id === id ? { ...item, read: true } : item,
            ),
            unreadCount: Math.max(0, Number(cached.unreadCount || 0) - 1),
          });
        }
        dispatchNotificationInboxRefresh();
      } catch {
        fetchInbox({ force: true });
      }
    },
    [cacheKey, fetchInbox, module],
  );

  const markAllAsRead = useCallback(async () => {
    if (!module) return;
    setItems((prev) => prev.map((item) => (item.read ? item : { ...item, read: true })));
    setUnreadCount(0);
    try {
      await notificationAPI.markAllAsRead({ contextModule: module });
      // Every other instance (header bell, bottom-nav dot) re-reads the count.
      dispatchNotificationInboxRefresh();
    } catch {
      fetchInbox({ force: true });
    }
  }, [fetchInbox, module]);

  /*
   * `markSeen`: set by a screen that shows the list. Opening it is "seeing" the
   * notifications, so the unread badge clears. Previously only tapping each row
   * (or "Clear all") did that, and a badge stayed on after everything was read.
   * Tried once per set of unread rows, so a failing request cannot loop.
   */
  const markSeen = Boolean(options?.markSeen);
  const seenAttemptRef = useRef("");
  useEffect(() => {
    if (!markSeen || !enabled || loading || unreadCount <= 0) return;
    const signature = `${unreadCount}:${items.filter((item) => !item.read).map((item) => item.id).join(",")}`;
    if (seenAttemptRef.current === signature) return;
    seenAttemptRef.current = signature;
    markAllAsRead();
  }, [enabled, items, loading, markAllAsRead, markSeen, unreadCount]);

  const dismiss = useCallback(
    async (id) => {
      if (!id || !module) return;
      const removed = items.find((item) => item.id === id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      if (removed && !removed.read) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
      try {
        await notificationAPI.dismiss(id, { contextModule: module });
        inboxSharedCache.delete(cacheKey);
        dispatchNotificationInboxRefresh();
      } catch {
        fetchInbox({ force: true });
      }
    },
    [cacheKey, fetchInbox, items, module],
  );

  const dismissAll = useCallback(async () => {
    if (!module) return;
    setItems([]);
    setUnreadCount(0);
    inboxSharedCache.delete(cacheKey);
    try {
      await notificationAPI.dismissAll({ contextModule: module });
      dispatchNotificationInboxRefresh();
    } catch {
      fetchInbox({ force: true });
    }
  }, [cacheKey, fetchInbox, module]);

  return useMemo(
    () => ({
      items,
      unreadCount,
      loading,
      refresh: () => fetchInbox({ force: true }),
      markAsRead,
      markAllAsRead,
      dismiss,
      dismissAll,
    }),
    [dismiss, dismissAll, fetchInbox, items, loading, markAllAsRead, markAsRead, unreadCount],
  );
}
