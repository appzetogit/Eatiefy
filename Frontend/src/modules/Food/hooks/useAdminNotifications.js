import { useCallback, useEffect, useMemo, useState } from "react";
import { adminAPI, supportAPI } from "@food/api";

const DISMISSED_STORAGE_KEY = "admin_notifications_dismissed_v1";
const READ_STORAGE_KEY = "admin_notifications_read_v1";
const UPDATE_EVENT = "adminNotificationsUpdated";

const safeParse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const getStoredIds = (key) => {
  if (typeof localStorage === "undefined") return [];
  const parsed = safeParse(localStorage.getItem(key) || "[]", []);
  return Array.isArray(parsed) ? parsed : [];
};

const saveStoredIds = (key, ids) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(Array.isArray(ids) ? ids : []));
};

const getDismissedIds = () => getStoredIds(DISMISSED_STORAGE_KEY);
const saveDismissedIds = (ids) => saveStoredIds(DISMISSED_STORAGE_KEY, ids);
const getReadIds = () => getStoredIds(READ_STORAGE_KEY);
const saveReadIds = (ids) => saveStoredIds(READ_STORAGE_KEY, ids);

export const dispatchAdminNotificationsUpdated = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(UPDATE_EVENT));
};

const toDateValue = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
};

const toDateLabel = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const uniqueById = (items = []) => {
  const map = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    map.set(item.id, item);
  }
  return [...map.values()];
};

const joinMeta = (...parts) => parts.filter(Boolean).join(" • ");

const mapPendingRestaurants = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .filter((item) => String(item?.status || "pending").toLowerCase() === "pending")
    .map((item) => ({
      id: `approval-restaurant-${String(item?._id || item?.id || "")}`,
      title: "Restaurant Approval Pending",
      message: `${item?.restaurantName || "Restaurant"} submitted a restaurant approval request. Owner: ${item?.ownerName || "N/A"}. Contact: ${item?.ownerPhone || "N/A"}.`,
      type: "approval",
      category: "restaurant_approval",
      path: "/admin/food/restaurants/joining-request",
      createdAt: item?.createdAt || item?.updatedAt,
      timeLabel: toDateLabel(item?.createdAt || item?.updatedAt),
      metaLabel: joinMeta(item?.restaurantName, item?.ownerName, item?.ownerPhone),
    }));

const mapDeliveryJoinRequests = (response) => {
  const payload = response?.data?.data;
  const rows =
    payload?.requests ||
    payload?.partners ||
    payload?.data ||
    payload?.items ||
    response?.data?.partners ||
    [];

  return (Array.isArray(rows) ? rows : []).map((item) => ({
    id: `approval-delivery-${String(item?._id || item?.id || "")}`,
    title: "Delivery Partner Approval Pending",
    message: `${item?.name || "Delivery partner"} submitted a joining request. Phone: ${item?.phone || "N/A"}. Email: ${item?.email || "N/A"}.`,
    type: "approval",
    category: "delivery_approval",
    path: "/admin/food/delivery-partners/join-request",
    createdAt: item?.createdAt || item?.updatedAt,
    timeLabel: toDateLabel(item?.createdAt || item?.updatedAt),
    metaLabel: joinMeta(item?.name, item?.phone, item?.email),
  }));
};

const mapPendingCategories = (response) => {
  const payload = response?.data?.data;
  const rows = payload?.categories || payload?.items || response?.data?.categories || [];

  return (Array.isArray(rows) ? rows : [])
    .filter((item) => String(item?.approvalStatus || "").toLowerCase() === "pending")
    .map((item) => ({
      id: `approval-category-${String(item?._id || item?.id || "")}`,
      title: "Category Approval Pending",
      message: `Category "${item?.name || "Category"}" is waiting for approval.`,
      type: "approval",
      category: "category_approval",
      path: "/admin/food/categories",
      createdAt: item?.requestedAt || item?.createdAt || item?.updatedAt,
      timeLabel: toDateLabel(item?.requestedAt || item?.createdAt || item?.updatedAt),
      metaLabel: joinMeta(item?.name, item?.foodTypeScope),
    }));
};

const mapFoodApprovals = (response) => {
  const payload = response?.data?.data;
  const rows =
    payload?.requests ||
    payload?.items ||
    payload?.data ||
    response?.data?.requests ||
    [];

  return (Array.isArray(rows) ? rows : []).map((item) => ({
    id: `approval-food-${String(item?._id || item?.id || "")}`,
    title: "Food Approval Pending",
    message: `${item?.itemName || "Food item"} from ${item?.restaurantName || "Restaurant"} is waiting for review. Category: ${item?.category || item?.type || "N/A"}.`,
    type: "approval",
    category: "food_approval",
    path: "/admin/food/food-approval",
    createdAt: item?.requestedAt || item?.createdAt || item?.updatedAt,
    timeLabel: toDateLabel(item?.requestedAt || item?.createdAt || item?.updatedAt),
    metaLabel: joinMeta(item?.restaurantName, item?.itemName, item?.category || item?.type),
  }));
};

const mapUserRestaurantSupport = (response) => {
  const payload = response?.data?.data;
  const rows =
    payload?.tickets ||
    payload?.items ||
    payload?.data ||
    response?.data?.tickets ||
    [];

  return (Array.isArray(rows) ? rows : [])
    .filter((item) => !["resolved", "closed"].includes(String(item?.status || "").toLowerCase()))
    .map((item) => {
      const isRestaurantTicket = item?.source === "restaurant";
      const title = isRestaurantTicket ? "Restaurant Support Ticket" : "User Support Ticket";
      const message = isRestaurantTicket
        ? `${item?.restaurantName || "Restaurant"} raised a support ticket. Subject: ${item?.subject || item?.issueType || "N/A"}. Status: ${item?.status || "open"}.`
        : `${item?.user?.name || "User"} raised a support ticket${item?.restaurantName ? ` for ${item.restaurantName}` : ""}. Issue: ${item?.issueType || item?.type || "N/A"}. Status: ${item?.status || "open"}.`;

      const metaLabel = isRestaurantTicket
        ? joinMeta(item?.restaurantName, item?.subject || item?.issueType, item?.status)
        : joinMeta(item?.user?.name, item?.user?.phone, item?.issueType || item?.type, item?.status);

      return {
        id: `support-main-${String(item?._id || item?.id || "")}`,
        title,
        message,
        type: "support",
        category: "support",
        path: "/admin/food/support-tickets",
        createdAt: item?.createdAt || item?.updatedAt,
        timeLabel: toDateLabel(item?.createdAt || item?.updatedAt),
        metaLabel,
      };
    });
};

const mapDeliverySupport = (response) => {
  const payload = response?.data?.data;
  const rows =
    payload?.tickets ||
    payload?.items ||
    payload?.data ||
    response?.data?.tickets ||
    [];

  return (Array.isArray(rows) ? rows : [])
    .filter((item) => !["resolved", "closed"].includes(String(item?.status || "").toLowerCase()))
    .map((item) => ({
      id: `support-delivery-${String(item?._id || item?.id || "")}`,
      title: "Delivery Support Ticket",
      message: `${item?.deliveryPartner?.name || "Delivery partner"} raised a support ticket. Subject: ${item?.subject || "N/A"}. Priority: ${item?.priority || "medium"}. Status: ${item?.status || "open"}.`,
      type: "support",
      category: "delivery_support",
      path: "/admin/food/delivery-support-tickets",
      createdAt: item?.createdAt || item?.updatedAt,
      timeLabel: toDateLabel(item?.createdAt || item?.updatedAt),
      metaLabel: joinMeta(item?.deliveryPartner?.name, item?.deliveryPartner?.phone, item?.priority, item?.status),
    }));
};

const mapExpiredFssai = (response) => {
  const payload = response?.data?.data;
  const rows = payload?.items || payload?.data || response?.data?.items || [];

  return (Array.isArray(rows) ? rows : []).map((item) => ({
    id: String(item?.id || `fssai-expired-${item?.restaurantId || ""}`),
    title: item?.title || "FSSAI License Expired",
    message:
      item?.message ||
      `${item?.restaurantName || "Restaurant"} FSSAI license has expired.`,
    type: "compliance",
    category: "fssai_expired",
    path: "/admin/food/restaurants",
    createdAt: item?.createdAt || item?.fssaiExpiry,
    timeLabel: toDateLabel(item?.createdAt || item?.fssaiExpiry),
    metaLabel: joinMeta(item?.restaurantName, item?.ownerName, item?.ownerPhone, item?.fssaiNumber),
  }));
};

const applyReadState = (items, readIds) =>
  items.map((item) => ({
    ...item,
    read: readIds.has(item.id),
  }));

const sortNotifications = (items) =>
  [...items].sort((a, b) => {
    const unreadDiff = Number(a.read) - Number(b.read);
    if (unreadDiff !== 0) return unreadDiff;
    return toDateValue(b.createdAt) - toDateValue(a.createdAt);
  });

const syncItemsFromStorage = (currentItems = []) => {
  const readIds = new Set(getReadIds());
  const dismissed = new Set(getDismissedIds());
  return sortNotifications(
    applyReadState(
      currentItems.filter((item) => !dismissed.has(item.id)),
      readIds,
    ),
  );
};

export default function useAdminNotifications(options = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(options?.autoload !== false));

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const dismissed = new Set(getDismissedIds());
      const readIds = new Set(getReadIds());

      const settled = await Promise.allSettled([
        adminAPI.getPendingRestaurants(),
        adminAPI.getDeliveryPartnerJoinRequests({ page: 1, limit: 50, status: "pending" }),
        adminAPI.getPendingFoodApprovals({ page: 1, limit: 50 }),
        adminAPI.getCategories({ page: 1, limit: 50, approvalStatus: "pending" }),
        supportAPI.getSupportTicketsAdmin({ page: 1, limit: 50, source: "all" }),
        adminAPI.getDeliverySupportTickets({ page: 1, limit: 50 }),
        adminAPI.getExpiredFssaiNotifications(),
      ]);

      const pick = (result) => (result.status === "fulfilled" ? result.value : null);
      const [
        restaurantsRes,
        deliveryJoinRes,
        foodApprovalRes,
        categoryApprovalRes,
        supportRes,
        deliverySupportRes,
        fssaiExpiredRes,
      ] = settled.map(pick);

      const restaurantPayload = restaurantsRes?.data?.data
      const restaurantRows = Array.isArray(restaurantPayload?.restaurants)
        ? restaurantPayload.restaurants
        : Array.isArray(restaurantPayload)
          ? restaurantPayload
          : Array.isArray(restaurantsRes?.data?.restaurants)
            ? restaurantsRes.data.restaurants
            : []

      const aggregated = uniqueById([
        ...mapPendingRestaurants(restaurantRows),
        ...mapDeliveryJoinRequests(deliveryJoinRes),
        ...mapFoodApprovals(foodApprovalRes),
        ...mapPendingCategories(categoryApprovalRes),
        ...mapUserRestaurantSupport(supportRes),
        ...mapDeliverySupport(deliverySupportRes),
        ...mapExpiredFssai(fssaiExpiredRes),
      ]);

      const sorted = sortNotifications(
        applyReadState(
          aggregated.filter((item) => !dismissed.has(item.id)),
          readIds,
        ),
      );

      setItems(sorted);
    } catch {
      // Keep the last successful snapshot instead of clearing alerts on transient 429s.
      setItems((prev) => prev);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (options?.autoload === false) return;
    loadNotifications();
  }, [loadNotifications, options?.autoload]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = () => {
      setItems((prev) => syncItemsFromStorage(prev));
      loadNotifications();
    };
    window.addEventListener(UPDATE_EVENT, handler);
    return () => window.removeEventListener(UPDATE_EVENT, handler);
  }, [loadNotifications]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadNotifications();
    }, 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const markAsRead = useCallback((id) => {
    if (!id) return;
    const readIds = [...new Set([...getReadIds(), id])];
    saveReadIds(readIds);
    setItems((prev) =>
      sortNotifications(
        prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
      ),
    );
    dispatchAdminNotificationsUpdated();
  }, []);

  const markAllAsRead = useCallback(() => {
    const ids = items.map((item) => item.id).filter(Boolean);
    if (ids.length) {
      saveReadIds([...new Set([...getReadIds(), ...ids])]);
    }
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
    dispatchAdminNotificationsUpdated();
  }, [items]);

  const dismissOne = useCallback((id) => {
    if (!id) return;
    const dismissed = [...new Set([...getDismissedIds(), id])];
    saveDismissedIds(dismissed);
    setItems((prev) => prev.filter((item) => item.id !== id));
    dispatchAdminNotificationsUpdated();
  }, []);

  const clearAll = useCallback(() => {
    const ids = items.map((item) => item.id).filter(Boolean);
    if (ids.length) {
      saveDismissedIds([...new Set([...getDismissedIds(), ...ids])]);
    }
    setItems([]);
    dispatchAdminNotificationsUpdated();
  }, [items]);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items],
  );

  return useMemo(
    () => ({
      items,
      loading,
      unreadCount,
      refresh: loadNotifications,
      markAsRead,
      markAllAsRead,
      dismissOne,
      clearAll,
    }),
    [clearAll, dismissOne, items, loadNotifications, loading, markAllAsRead, markAsRead, unreadCount],
  );
}
