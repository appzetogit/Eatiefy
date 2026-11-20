/**
 * API layer - auth connected to new backend; rest stubbed for UI compatibility.
 */

import apiClient from "./axios.js";
import { API_ENDPOINTS } from "./config.js";
import * as authService from "./auth.js";
import { filterPublicOffers } from "@food/utils/offerUtils";
import {
  prepareUploadFile,
  prepareUploadFiles,
} from "../../shared/utils/imageCompressor.js";

const stub = () =>
  Promise.resolve({
    data: { success: false, message: "Backend not connected", data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

/** Zone-wise offers: the zone detected for the customer's current location. */
const userZoneParams = () => {
  try {
    const zoneId = typeof localStorage !== "undefined" ? localStorage.getItem("userZoneId") : ""
    return zoneId ? { zoneId } : {}
  } catch {
    return {}
  }
}

/** Search API - unified search for user app */
export const searchAPI = {
  unifiedSearch: (params = {}) =>
    apiClient.get("/food/search/unified", { params }),
  getAdminCategories: (params = {}) =>
    apiClient.get("/food/search/categories/admin", { params }),
};

const createStubAPI = () =>
  new Proxy(
    {},
    {
      get(_, prop) {
        return () => stub();
      },
    },
  );

export default apiClient;
export { API_ENDPOINTS };

// Stub for non-auth endpoints so we don't hit backend for unimplemented routes (avoids 404s and extra calls).
// Auth is done via authAPI/authService which use apiClient directly.
const emptyDataStub = () =>
  Promise.resolve({
    data: { success: false, data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

export const api = {
  get: (_url, _config) => emptyDataStub(),
  post: (_url, _data, _config) => emptyDataStub(),
  put: (_url, _data, _config) => emptyDataStub(),
  patch: (_url, _data, _config) => emptyDataStub(),
  delete: (_url, _config) => emptyDataStub(),
};

/** Single in-flight + short cache for user /auth/me - avoids duplicate calls. */
let userMeInFlight = null;
let userMeCached = null;
let userMeCacheTime = 0;
const USER_ME_CACHE_MS = 3000;

const getUserMeOnce = () => {
  const now = Date.now();
  if (userMeCached && now - userMeCacheTime < USER_ME_CACHE_MS) {
    return Promise.resolve(userMeCached);
  }
  if (!userMeInFlight) {
    userMeInFlight = authService
      .getMe("user")
      .then((res) => {
        userMeCached = res;
        userMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        userMeInFlight = null;
      });
  }
  return userMeInFlight;
};

/** Auth API - user OTP + admin login via new backend */
export const authAPI = {
  sendOTP: (phone, _purpose = "login", _email = null) => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestUserOtp(phone);
  },
  verifyOTP: (
    phone,
    otp,
    _purpose,
    _name,
    _email,
    _role,
    _password,
    _referralCode,
    fcmToken = null,
    platform = "web",
    _token = null,
    confirmAction = null,
  ) => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyUserOtp(
      phone,
      otp,
      _referralCode,
      _name,
      fcmToken,
      platform,
      confirmAction,
    );
  },
  /** Resolves true/false; rejects on network errors. */
  validateReferralCode: (code) => authService.validateUserReferralCode(code),
  getCurrentUser: () => getUserMeOnce(),
  refreshToken: (token) => authService.refreshToken(token),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("user_refreshToken")
        : null);
    return authService.logout(token, fcmToken, platform);
  },
  logoutFromAllDevices: (module = "user") => authService.logoutFromAllDevices(module),
  deleteAccount: (module = "user") => authService.deleteAccount(module),
  checkBalance: (module = "user") => authService.checkAccountBalance(module),
};

export const supportAPI = {
  createTicket: (body) =>
    apiClient.post("/food/user/support/ticket", body ?? {}, {
      contextModule: "user",
    }),
  getMyTickets: (params = {}) =>
    apiClient.get("/food/user/support/my-tickets", {
      params,
      contextModule: "user",
    }),
  getSupportTicketsAdmin: (params = {}) =>
    adminCachedGet("/food/admin/support-tickets", {
      params,
      contextModule: "admin",
    }, { ttlMs: 5000, staleOn429Ms: 60000 }),
  updateSupportTicketAdmin: (id, body = {}) =>
    apiClient.patch(`/food/admin/support-tickets/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
};

export const notificationAPI = {
  getInbox: (params = {}, config = {}) =>
    apiClient.get("/food/notifications/inbox", {
      params,
      ...config,
    }),
  markAsRead: (id, config = {}) =>
    apiClient.patch(`/food/notifications/${String(id)}/read`, {}, config),
  dismiss: (id, config = {}) =>
    apiClient.delete(`/food/notifications/${String(id)}`, config),
  dismissAll: (config = {}) =>
    apiClient.delete("/food/notifications/inbox/all", config),
};

/** Admin API - new backend only (GET /auth/me, PATCH /auth/admin/profile, POST /auth/admin/change-password) */
export const adminAPI = {
  getSidebarBadges: () =>
    adminCachedGet("/food/admin/sidebar-badges", { contextModule: "admin" }, { ttlMs: 12000, staleOn429Ms: 90000 }),
  login: (email, password) => authService.adminLogin(email, password),
  /** POST /auth/admin/forgot-password/request-otp – only accepts registered admin email */
  requestForgotPasswordOtp: (email) =>
    apiClient.post("/auth/admin/forgot-password/request-otp", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
    }),
  /** POST /auth/admin/forgot-password/reset – verify OTP and set new password in one call */
  resetPasswordWithOtp: (email, otp, newPassword) =>
    apiClient.post("/auth/admin/forgot-password/reset", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
      otp: String(otp || "").replace(/\D/g, ""),
      newPassword: String(newPassword || ""),
    }),
  /** Raw /auth/me for admin (e.g. navbar). For Profile & Settings use getAdminProfile. */
  getCurrentAdmin: () => authService.getMe("admin"),
  /** Single API for admin profile: GET /auth/me, returns { data: { admin } }. Use on Profile & Settings only. */
  getAdminProfile: () =>
    authService.getMe("admin").then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { data: { data: { admin: user }, admin: user } };
    }),
  /** PATCH /auth/admin/profile. Body: name?, phone?, profileImage? */
  updateAdminProfile: (body) =>
    apiClient.patch("/auth/admin/profile", body ?? {}, {
      contextModule: "admin",
    }),
  /** POST /auth/admin/change-password */
  changePassword: (currentPassword, newPassword) =>
    apiClient.post(
      "/auth/admin/change-password",
      { currentPassword, newPassword },
      { contextModule: "admin" },
    ),
  logout: (refreshToken) => {
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("admin_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_admin") : null;
    return authService.logout(token, fcmToken, "web");
  },
  // Restaurant approvals and join requests
  getPendingRestaurants: (params = {}) =>
    adminCachedGet("/food/admin/restaurants/pending", {
      params,
      contextModule: "admin",
    }, { ttlMs: 10000, staleOn429Ms: 90000 }),
  /** List restaurant complaints (admin). */
  getRestaurantComplaints: (params = {}) =>
    apiClient.get("/food/admin/restaurants/complaints", {
      params,
      contextModule: "admin",
    }),
  updateRestaurantComplaint: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/complaints/${id}`, body, {
      contextModule: "admin",
    }),
  /** Global universal search (admin). */
  globalSearch: (query) =>
    apiClient.get("/food/admin/global-search", {
      params: { query },
      contextModule: "admin",
    }),
  approveRestaurant: (id) =>
    apiClient.patch(
      `/food/admin/restaurants/${id}/approve`,
      {},
      {
        contextModule: "admin",
      },
    ),
  rejectRestaurant: (id, reason) =>
    apiClient.patch(
      `/food/admin/restaurants/${id}/reject`,
      { reason },
      { contextModule: "admin" },
    ),
  /** Delivery partner join requests - uses /food/admin/delivery/* (new backend API) */
  getDeliveryPartnerJoinRequests: (params) =>
    adminCachedGet("/food/admin/delivery/join-requests", {
      params,
      contextModule: "admin",
    }, { ttlMs: 10000, staleOn429Ms: 90000 }),
  /** Admin: set a delivery partner's pocket balance / cash in hand. */
  updateDeliveryBoyWallet: ({ deliveryId, pocketBalance, cashInHand } = {}) =>
    apiClient.patch(
      `/food/admin/delivery/partners/${String(deliveryId)}/wallet`,
      { pocketBalance, cashInHand },
      { contextModule: "admin" },
    ),
  /** List approved delivery partners (Deliveryman List page) */
  getDeliveryPartners: (params) =>
    apiClient.get("/food/admin/delivery/partners", {
      params,
      contextModule: "admin",
    }),
  getDeliverymanReviews: (params = {}) =>
    apiClient.get("/food/admin/delivery/reviews", {
      params,
      contextModule: "admin",
    }),
  getContactMessages: (params = {}) =>
    apiClient.get("/food/admin/contact-messages", {
      params,
      contextModule: "admin",
    }),
  getArchivedAccounts: () =>
    apiClient.get("/food/admin/archived-accounts", {
      contextModule: "admin",
    }),
  /** Dashboard summary stats (admin home) */
  getDashboardStats: (params = {}) =>
    adminCachedGet("/food/admin/dashboard-stats", {
      params,
      contextModule: "admin",
    }, { ttlMs: 8000, staleOn429Ms: 90000 }),
  /** List restaurant withdrawal requests (admin). */
  getWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a withdrawal request. */
  updateWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** List delivery withdrawal requests (admin). */
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a delivery withdrawal request. */
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/delivery/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** Delivery withdrawal aliases */
  getDeliveryWithdrawalRequests: (params) => adminAPI.getDeliveryWithdrawals(params),
  approveDeliveryWithdrawal: (id) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "approved" }),
  rejectDeliveryWithdrawal: (id, reason) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  // Aliases for RestaurantWithdraws page
  getWithdrawalRequests: (params) => adminAPI.getWithdrawals(params),
  approveWithdrawalRequest: (id) => adminAPI.updateWithdrawalStatus(id, { status: "approved" }),
  rejectWithdrawalRequest: (id, reason) => adminAPI.updateWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  /** Delivery boy wallets (stub until backend implements - returns empty so list still loads) */
  getDeliveryBoyWallets: (params) =>
    apiClient.get("/food/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  getDeliveryPartnerById: (id) =>
    apiClient.get(`/food/admin/delivery/${id}`, { contextModule: "admin" }),
  updateDeliveryPartner: (id, payload) =>
    apiClient.patch(`/food/admin/delivery/${String(id)}`, payload, {
      contextModule: "admin",
    }),
  /**
   * Permanently delete a delivery partner. A 409 with code CASH_IN_HAND_WRITE_OFF_REQUIRED
   * means the rider holds COD cash; repeat with `writeOffCashInHand` set to that amount.
   */
  deleteDeliveryPartner: (id, { writeOffCashInHand } = {}) =>
    apiClient.delete(`/food/admin/delivery-partners/${String(id)}`, {
      params: writeOffCashInHand != null ? { writeOffCashInHand } : undefined,
      contextModule: "admin",
    }),
  approveDeliveryPartner: (id) =>
    apiClient.patch(
      `/food/admin/delivery/${String(id)}/approve`,
      {},
      {
        contextModule: "admin",
      },
    ),
  rejectDeliveryPartner: (id, reason) =>
    apiClient.patch(
      `/food/admin/delivery/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      {
        contextModule: "admin",
      },
    ),
  /** GET /food/admin/delivery/support-tickets - list all delivery support tickets (query: status, priority, search, page, limit). */
  getDeliverySupportTickets: (params) =>
    adminCachedGet("/food/admin/delivery/support-tickets", {
      params,
      contextModule: "admin",
    }, { ttlMs: 5000, staleOn429Ms: 60000 }),
  getExpiredFssaiNotifications: (params = {}) =>
    adminCachedGet("/food/admin/notifications/fssai-expired", {
      params,
      contextModule: "admin",
    }, { ttlMs: 10000, staleOn429Ms: 90000 }),
  // Customization Settings
  getCustomizationSettings: () =>
    apiClient.get("/food/admin/customization-settings", { contextModule: "admin" }),
  updateCustomizationSettings: (data) =>
    apiClient.patch("/food/admin/customization-settings", data, { contextModule: "admin" }),
  getTakeawayCodStatus: () =>
    apiClient.get("/food/admin/customization-settings/takeaway-cod", { contextModule: "admin" }),
  /** Query: zoneId (omit for the platform default). */
  getRestaurantSettings: (params = {}) =>
    apiClient.get("/food/admin/restaurant-settings", { params, contextModule: "admin" }),
  updateRestaurantSettings: (data) =>
    apiClient.patch("/food/admin/restaurant-settings", data, { contextModule: "admin" }),
  /** GET /food/admin/delivery/support-tickets/stats - counts by status. */
  /** Query: zoneId (omit for all zones). */
  getDeliverySupportTicketStats: (params = {}) =>
    apiClient.get("/food/admin/delivery/support-tickets/stats", {
      params,
      contextModule: "admin",
    }),
  /** PATCH /food/admin/delivery/support-tickets/:id - update adminResponse, status. */
  updateDeliverySupportTicket: (id, body) =>
    apiClient.patch(`/food/admin/delivery/support-tickets/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  createBroadcastNotification: (body = {}) =>
    apiClient.post("/food/admin/notifications/broadcast", body ?? {}, {
      contextModule: "admin",
    }),
  getBroadcastNotifications: (params = {}) =>
    apiClient.get("/food/admin/notifications/broadcast", {
      params,
      contextModule: "admin",
    }),
  deleteBroadcastNotification: (id) =>
    apiClient.delete(`/food/admin/notifications/broadcast/${String(id)}`, {
      contextModule: "admin",
    }),
  /** Full admins only: end-to-end push diagnostics for one account. */
  runPushDebug: (body = {}) =>
    apiClient.post("/food/admin/notifications/push-debug", body ?? {}, {
      contextModule: "admin",
    }),
  searchBroadcastRecipients: (params = {}) =>
    apiClient.get("/food/admin/notifications/recipients-search", {
      params,
      contextModule: "admin",
    }),
  /** List restaurants for admin. Requires admin auth. */
  getRestaurants: (params = {}, config = {}) =>
    apiClient.get("/food/admin/restaurants", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
      ...config,
    }),
  getRestaurantReviews: (params = {}) =>
    apiClient.get("/food/admin/restaurants/reviews", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Categories (admin) */
  getCategories: (params = {}) =>
    apiClient.get("/food/admin/categories", { params, contextModule: "admin" }),
  /** Dining categories (admin) */
  getDiningCategories: (params = {}) =>
    apiClient.get("/food/admin/dining/categories", {
      params,
      contextModule: "admin",
    }),
  createDiningCategory: (body) =>
    apiClient.post("/food/admin/dining/categories", body ?? {}, {
      contextModule: "admin",
    }),
  updateDiningCategory: (id, body) =>
    apiClient.patch(`/food/admin/dining/categories/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteDiningCategory: (id) =>
    apiClient.delete(`/food/admin/dining/categories/${String(id)}`, {
      contextModule: "admin",
    }),
  getDiningRestaurants: (params = {}) =>
    apiClient.get("/food/admin/dining/restaurants", {
      params,
      contextModule: "admin",
    }),
  updateRestaurantDiningSettings: (restaurantId, body) =>
    apiClient.patch(
      `/food/admin/dining/restaurants/${String(restaurantId)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  getDiningRequests: (params = {}) =>
    apiClient.get("/food/admin/dining/requests", {
      params,
      contextModule: "admin",
    }),
  approveDiningRequest: (id) =>
    apiClient.patch(`/food/admin/dining/requests/${String(id)}/approve`, {}, {
      contextModule: "admin",
    }),
  rejectDiningRequest: (id, reason) =>
    apiClient.patch(`/food/admin/dining/requests/${String(id)}/reject`, { reason }, {
      contextModule: "admin",
    }),
  createCategory: (body) =>
    apiClient.post("/food/admin/categories", body ?? {}, {
      contextModule: "admin",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/food/admin/categories/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/food/admin/categories/${id}`, {
      contextModule: "admin",
    }),
  approveCategory: (id) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectCategory: (id, reason) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  makeCategoryGlobal: (id) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/make-global`,
      {},
      { contextModule: "admin" },
    ),
  toggleCategoryStatus: (id) =>
    apiClient.patch(
      `/food/admin/categories/${id}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Get single restaurant by id (full details for View Details modal). */
  getRestaurantById: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}`, { contextModule: "admin" }),
  /** Get restaurant analytics for POS. */
  getRestaurantAnalytics: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/analytics`, {
      contextModule: "admin",
    }),
  /** Update restaurant basic details (admin). */
  updateRestaurant: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteRestaurant: (id) =>
    apiClient.delete(`/food/admin/restaurants/${id}`, { contextModule: "admin" }),
  /** Update restaurant status (admin). Body: { status: boolean } */
  updateRestaurantStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/restaurants/${String(id)}/status`,
      { status: status !== false },
      { contextModule: "admin" },
    ),
  /** Update restaurant location (admin). Body includes lat/lng + address fields. */
  updateRestaurantLocation: (id, body) =>
    apiClient.patch(
      `/food/admin/restaurants/${String(id)}/location`,
      body ?? {},
      { contextModule: "admin" },
    ),
  /** Restaurant menu (admin) */
  getRestaurantMenuById: (id, config = {}) =>
    apiClient.get(`/food/admin/restaurants/${id}/menu`, {
      contextModule: "admin",
      ...config,
    }),
  updateRestaurantMenuById: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/${id}/menu`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Foods (admin) - separate collection */
  getFoods: (params = {}) =>
    apiClient.get("/food/admin/foods", { params, contextModule: "admin" }),
  getPricingSummary: (params = {}) =>
    apiClient.get("/food/admin/pricing/summary", { params, contextModule: "admin" }),
  getPricingRules: (params = {}) =>
    apiClient.get("/food/admin/pricing/rules", { params, contextModule: "admin" }),
  upsertPricingRule: (body) =>
    apiClient.post("/food/admin/pricing/rules", body ?? {}, { contextModule: "admin" }),
  bulkUpsertRestaurantPricingRules: (body) =>
    apiClient.post("/food/admin/pricing/rules/bulk-restaurant", body ?? {}, { contextModule: "admin" }),
  bulkUpsertMenuItemPricingRules: (body) =>
    apiClient.post("/food/admin/pricing/rules/bulk-menu-item", body ?? {}, { contextModule: "admin" }),
  deletePricingRule: (id) =>
    apiClient.delete(`/food/admin/pricing/rules/${id}`, { contextModule: "admin" }),
  previewPricingRule: (body) =>
    apiClient.post("/food/admin/pricing/preview", body ?? {}, { contextModule: "admin" }),
  getPricingAudits: (params = {}) =>
    apiClient.get("/food/admin/pricing/audits", { params, contextModule: "admin" }),
  createFood: (body) =>
    apiClient.post("/food/admin/foods", body ?? {}, { contextModule: "admin" }),
  updateFood: (id, body) =>
    apiClient.patch(`/food/admin/foods/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteFood: (id) =>
    apiClient.delete(`/food/admin/foods/${id}`, { contextModule: "admin" }),
  /** Food approvals (admin) - pending items created by restaurants */
  getPendingFoodApprovals: (params = {}) =>
    adminCachedGet("/food/admin/foods/pending-approvals", {
      params,
      contextModule: "admin",
    }, { ttlMs: 10000, staleOn429Ms: 90000 }),
  approveFoodItem: (id) =>
    withPendingFoodApprovalsInvalidation(apiClient.patch(
      `/food/admin/foods/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    )),
  rejectFoodItem: (id, reason) =>
    withPendingFoodApprovalsInvalidation(apiClient.patch(
      `/food/admin/foods/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    )),
  /** Restaurants with pending food/add-on approvals (+ counts); uncached so the bulk dialog is always current. */
  getPendingApprovalRestaurants: (params = {}) =>
    apiClient.get("/food/admin/foods/pending-approvals/restaurants", {
      params,
      contextModule: "admin",
    }),
  /** Bulk approve: { items: [{ id, entityType }] } or { restaurantIds | allRestaurants, zoneId }. */
  bulkApprovePending: (payload) =>
    withPendingFoodApprovalsInvalidation(apiClient.patch(
      "/food/admin/foods/bulk-approve",
      payload,
      { contextModule: "admin" },
    )),
  /** Customers (admin) */
  getCustomers: (params = {}) =>
    apiClient.get("/food/admin/customers", { params, contextModule: "admin" }),
  getCustomerById: (id) =>
    apiClient.get(`/food/admin/customers/${String(id)}`, {
      contextModule: "admin",
    }),
  updateCustomerStatus: (id, isActive) =>
    apiClient.patch(
      `/food/admin/customers/${String(id)}/status`,
      { isActive: isActive !== false },
      { contextModule: "admin" },
    ),
  updateCustomerCodStatus: (id, isCodBlocked) =>
    apiClient.patch(
      `/food/admin/customers/${String(id)}/cod-status`,
      { isCodBlocked: isCodBlocked === true },
      { contextModule: "admin" },
    ),
  deleteCustomer: (id) =>
    apiClient.delete(`/food/admin/customers/${String(id)}`, { contextModule: "admin" }),
  /** type: "credit" | "debit", amount: number, reason?: string */
  adjustCustomerWallet: (id, { type, amount, reason } = {}) =>
    apiClient.post(
      `/food/admin/customers/${String(id)}/wallet/adjust`,
      { type, amount, reason },
      { contextModule: "admin" },
    ),

  /** Sub Admins */
  getSubAdmins: (params = {}) =>
    apiClient.get("/food/admin/sub-admins", { params, contextModule: "admin" }),
  getSubAdminById: (id) =>
    apiClient.get(`/food/admin/sub-admins/${String(id)}`, { contextModule: "admin" }),
  createSubAdmin: (body) =>
    apiClient.post("/food/admin/sub-admins", body, { contextModule: "admin" }),
  updateSubAdmin: (id, body) =>
    apiClient.patch(`/food/admin/sub-admins/${String(id)}`, body, { contextModule: "admin" }),
  updateSubAdminStatus: (id, isActive) =>
    apiClient.patch(
      `/food/admin/sub-admins/${String(id)}/status`,
      { isActive: isActive !== false },
      { contextModule: "admin" },
    ),
  resetSubAdminPassword: (id, newPassword) =>
    apiClient.patch(
      `/food/admin/sub-admins/${String(id)}/password`,
      { newPassword },
      { contextModule: "admin" },
    ),
  updateSubAdminPermissions: (id, permissions) =>
    apiClient.patch(
      `/food/admin/sub-admins/${String(id)}/permissions`,
      { permissions },
      { contextModule: "admin" },
    ),
  deleteSubAdmin: (id) =>
    apiClient.delete(`/food/admin/sub-admins/${String(id)}`, { contextModule: "admin" }),
  getSubAdminPermissionModules: () =>
    apiClient.get("/food/admin/sub-admins/permission-modules", { contextModule: "admin" }),

  /** Orders (admin) – list, get by id, assign delivery partner */
  getOrders: (params = {}) =>
    adminCachedGet("/food/admin/orders", {
      params: { limit: 50, page: 1, ...params },
      contextModule: "admin",
    }, { ttlMs: 2500, staleOn429Ms: 120000 }),
  getOrderById: (orderId, config = {}) =>
    adminCachedGet(`/food/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
      ...config,
    }, { ttlMs: 3000, staleOn429Ms: 60000 }),
  deleteOrder: (orderId) =>
    apiClient.delete(`/food/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
    }),
  acceptOrder: (orderId) =>
    apiClient.patch(`/food/admin/orders/${String(orderId)}/accept`, {}, {
      contextModule: "admin",
    }),
  rejectOrder: (orderId, reason = "") =>
    apiClient.patch(`/food/admin/orders/${String(orderId)}/reject`, { reason }, {
      contextModule: "admin",
    }),
  updateOrderStatuses: (orderId, body = {}) =>
    apiClient.patch(`/food/admin/orders/${String(orderId)}/statuses`, body, {
      contextModule: "admin",
    }),
  /** Dispatch settings – auto vs manual assign (global) */
  /** Check for duplicate email, owner phone, or primary contact */
  checkRestaurantDuplicate: (params = {}) =>
    apiClient.get("/food/admin/restaurants/check-duplicate", {
      params,
      contextModule: "admin",
    }),
  /** Create restaurant (admin). Single API: POST /food/admin/restaurants. Body: JSON with image URLs. */
  createRestaurant: (body) =>
    apiClient.post("/food/admin/restaurants", body ?? {}, {
      contextModule: "admin",
    }),
  /** List delivery zones. Query: limit, page, isActive, search */
  getZones: (params = {}) =>
    adminCachedGet("/food/admin/zones", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
    }, { ttlMs: 30000, staleOn429Ms: 120000 }),
  /** Top Restaurants (per zone + type). Query: zoneId, type (delivery|takeaway) */
  getTopRestaurants: (params = {}) =>
    apiClient.get("/food/admin/top-restaurants", {
      params,
      contextModule: "admin",
    }),
  /** Save ordered top restaurants. Body: { zoneId, type, restaurantIds: [] } */
  saveTopRestaurants: (body = {}) =>
    apiClient.put("/food/admin/top-restaurants", body ?? {}, {
      contextModule: "admin",
    }),
  /** Restaurant report (admin). */
  getRestaurantReport: (params = {}) =>
    apiClient.get("/food/admin/reports/restaurants", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTransactionReport: (params = {}) =>
    apiClient.get("/food/admin/reports/transactions", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTaxReport: (params = {}) =>
    apiClient.get("/food/admin/reports/tax", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTaxReportDetail: (id, params = {}) =>
    apiClient.get(`/food/admin/reports/tax/${id}`, {
      params,
      contextModule: "admin",
    }),
  /** Get single zone by id */
  getZoneById: (id) =>
    apiClient.get(`/food/admin/zones/${id}`, { contextModule: "admin" }),
  /** Create zone. Body: name, zoneName?, country?, unit?, coordinates, isActive? */
  createZone: (body) =>
    apiClient.post("/food/admin/zones", body ?? {}, { contextModule: "admin" }),
  /** Update zone. Body: name?, zoneName?, country?, unit?, coordinates?, isActive? */
  updateZone: (id, body) =>
    apiClient.patch(`/food/admin/zones/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Delete zone */
  deleteZone: (id) =>
    apiClient.delete(`/food/admin/zones/${id}`, { contextModule: "admin" }),

  /** Feedback Experience (admin) */
  getFeedbackExperiences: (params = {}) =>
    apiClient.get(API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE, {
      params,
      contextModule: "admin",
    }),
  deleteFeedbackExperience: (id) =>
    apiClient.delete(`${API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE}/${id}`, {
      contextModule: "admin",
    }),

  /** Public env variables (safe subset). Used for runtime keys like Google Maps. */
  // getPublicEnvVariables removed: rely on import.meta.env instead.

  /** Public categories (user app) - zone-aware */
  getPublicCategories: (params = {}, config = {}) =>
    apiClient.get("/food/restaurant/categories/public", {
      params: params ?? {},
      ...config,
    }),

  /** Offers & Coupons (admin) */
  getAllOffers: (params = {}) =>
    apiClient.get("/food/admin/offers", { params, contextModule: "admin" }),
  createAdminOffer: (body) =>
    apiClient.post("/food/admin/offers", body ?? {}, {
      contextModule: "admin",
    }),
  updateAdminOffer: (offerId, body) =>
    apiClient.put(`/food/admin/offers/${String(offerId)}`, body ?? {}, {
      contextModule: "admin",
    }),
  updateAdminOfferCartVisibility: (offerId, itemId, showInCart) =>
    apiClient.patch(
      `/food/admin/offers/${String(offerId)}/cart-visibility`,
      { itemId: String(itemId), showInCart: Boolean(showInCart) },
      { contextModule: "admin" },
    ),
  deleteAdminOffer: (offerId) =>
    apiClient.delete(`/food/admin/offers/${String(offerId)}`, {
      contextModule: "admin",
    }),

  /** Restaurant Item Offers Approvals (admin) */
  getRestaurantOffers: (params = {}) =>
    apiClient.get("/food/admin/restaurant-offers", {
      params,
      contextModule: "admin",
    }),
  approveRestaurantOffer: (offerId) =>
    apiClient.patch(
      `/food/admin/restaurant-offers/${String(offerId)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectRestaurantOffer: (offerId, reason) =>
    apiClient.patch(
      `/food/admin/restaurant-offers/${String(offerId)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  deleteRestaurantOffer: (offerId) =>
    apiClient.delete(`/food/admin/restaurant-offers/${String(offerId)}`, {
      contextModule: "admin",
    }),

  /** Delivery Partner Bonus (admin) */
  getDeliveryPartnerBonusTransactions: (params = {}) =>
    apiClient.get("/food/admin/delivery/bonus-transactions", {
      params,
      contextModule: "admin",
    }),
  /** Delivery Earnings (admin) */
  getDeliveryEarnings: (params = {}) =>
    apiClient.get("/food/admin/delivery/earnings", {
      params,
      contextModule: "admin",
    }),
  /** Restaurant Earnings (admin) */
  getRestaurantEarnings: (params = {}) =>
    apiClient.get("/food/admin/restaurants/earnings", {
      params,
      contextModule: "admin",
    }),
  addDeliveryPartnerBonus: (deliveryPartnerId, amount, reference = "") =>
    apiClient.post(
      "/food/admin/delivery/bonus",
      {
        deliveryPartnerId: String(deliveryPartnerId),
        amount: Number(amount),
        reference: String(reference || ""),
      },
      { contextModule: "admin" },
    ),

  /** Earning Addon Offers (admin) */
  getEarningAddons: (params = {}) =>
    apiClient.get("/food/admin/delivery/earning-addons", {
      params,
      contextModule: "admin",
    }),
  createEarningAddon: (body) =>
    apiClient.post("/food/admin/delivery/earning-addons", body ?? {}, {
      contextModule: "admin",
    }),
  updateEarningAddon: (id, body) =>
    apiClient.patch(
      `/food/admin/delivery/earning-addons/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteEarningAddon: (id) =>
    apiClient.delete(`/food/admin/delivery/earning-addons/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleEarningAddonStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/delivery/earning-addons/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),

  /** Earning Addon History (admin) */
  getEarningAddonHistory: (params = {}) =>
    apiClient.get("/food/admin/delivery/earning-addon-history", {
      params,
      contextModule: "admin",
    }),
  creditEarningToWallet: (historyId, notes = "") =>
    apiClient.post(
      `/food/admin/delivery/earning-addon-history/${String(historyId)}/credit`,
      { notes: String(notes || "") },
      { contextModule: "admin" },
    ),
  cancelEarningAddonHistory: (historyId, reason = "") =>
    apiClient.post(
      `/food/admin/delivery/earning-addon-history/${String(historyId)}/cancel`,
      { reason: String(reason || "") },
      { contextModule: "admin" },
    ),
  checkEarningAddonCompletions: (deliveryPartnerId, force = false) =>
    apiClient.post(
      "/food/admin/delivery/earning-addon-completions/check",
      { deliveryPartnerId: String(deliveryPartnerId), force: Boolean(force) },
      { contextModule: "admin" },
    ),
  getDeliveryWallets: (params = {}) =>
    apiClient.get("/food/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/delivery/withdrawals/${String(id)}`, body, {
      contextModule: "admin",
    }),
  getCashLimitSettlements: (params = {}) =>
    apiClient.get("/food/admin/delivery/cash-limit-settlements", {
      params,
      contextModule: "admin",
    }),
  getCashConfirmations: (params = {}) =>
    apiClient.get("/food/admin/delivery/cash-confirmations", {
      params,
      contextModule: "admin",
    }),
  updateCashLimitSettlement: (id, body) =>
    apiClient.patch(`/food/admin/delivery/cash-limit-settlements/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),

  /** Restaurant Commission (admin) */
  /** Query: zoneId (omit for all zones). */
  getRestaurantCommissionBootstrap: (params = {}) =>
    apiClient.get("/food/admin/restaurant-commissions/bootstrap", {
      params,
      contextModule: "admin",
    }),
  getRestaurantCommissions: (params = {}) =>
    apiClient.get("/food/admin/restaurant-commissions", {
      params,
      contextModule: "admin",
    }),
  getRestaurantCommissionById: (id) =>
    apiClient.get(`/food/admin/restaurant-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  createRestaurantCommission: (body) =>
    apiClient.post("/food/admin/restaurant-commissions", body ?? {}, {
      contextModule: "admin",
    }),
  updateRestaurantCommission: (id, body) =>
    apiClient.patch(
      `/food/admin/restaurant-commissions/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteRestaurantCommission: (id) =>
    apiClient.delete(`/food/admin/restaurant-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleRestaurantCommissionStatus: (id) =>
    apiClient.patch(
      `/food/admin/restaurant-commissions/${String(id)}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Backward-compatible alias used in UI */
  getApprovedRestaurants: (params = {}) =>
    apiClient.get("/food/admin/restaurants", {
      params: { status: "approved", limit: 1000, ...params },
      contextModule: "admin",
    }),
  getRestaurantCounts: (params = {}) =>
    apiClient.get("/food/admin/restaurants/counts", {
      params,
      contextModule: "admin",
    }),

  /** Delivery Boy Payout Rules (admin) */
  getCommissionRules: (params) =>
    apiClient.get("/food/admin/delivery/commission-rules", {
      params: params ?? {},
      contextModule: "admin",
    }),
  createCommissionRule: (body) =>
    apiClient.post("/food/admin/delivery/commission-rules", body ?? {}, {
      contextModule: "admin",
    }),
  updateCommissionRule: (id, body) =>
    apiClient.patch(
      `/food/admin/delivery/commission-rules/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteCommissionRule: (id) =>
    apiClient.delete(`/food/admin/delivery/commission-rules/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleCommissionRuleStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/delivery/commission-rules/${String(id)}/status`,
      { status: Boolean(status) },
      { contextModule: "admin" },
    ),
  /** Eatiefy incentive for delivery partners (zone-wise, on top of payout rules) */
  getDeliveryIncentiveSettings: (zoneId) =>
    apiClient.get("/food/admin/delivery-boy-commission/incentive", {
      params: { zoneId },
      contextModule: "admin",
    }),
  updateDeliveryIncentiveSettings: (body) =>
    apiClient.put("/food/admin/delivery-boy-commission/incentive", body ?? {}, {
      contextModule: "admin",
    }),

  /** Restaurant onboarding pricing rules (admin) */
  getOnboardingPricingBootstrap: (config = {}) =>
    apiClient.get("/food/admin/onboarding/pricing/bootstrap", { ...config, contextModule: "admin" }),
  getOnboardingPricingRules: (params = {}, config = {}) =>
    apiClient.get("/food/admin/onboarding/pricing/rules", { ...config, params, contextModule: "admin" }),
  createOnboardingPricingRule: (body) =>
    apiClient.post("/food/admin/onboarding/pricing/rules", body ?? {}, { contextModule: "admin" }),
  updateOnboardingPricingRule: (id, body) =>
    apiClient.patch(`/food/admin/onboarding/pricing/rules/${id}`, body ?? {}, { contextModule: "admin" }),
  toggleOnboardingPricingRule: (id, isActive) =>
    apiClient.patch(`/food/admin/onboarding/pricing/rules/${id}/status`, { isActive }, { contextModule: "admin" }),
  deleteOnboardingPricingRule: (id) =>
    apiClient.delete(`/food/admin/onboarding/pricing/rules/${id}`, { contextModule: "admin" }),

  /** Restaurant onboarding promotional offers (admin) */
  getOnboardingOffers: (params = {}, config = {}) =>
    apiClient.get("/food/admin/onboarding/offers", { ...config, params, contextModule: "admin" }),
  createOnboardingOffer: (body) =>
    apiClient.post("/food/admin/onboarding/offers", body ?? {}, { contextModule: "admin" }),
  updateOnboardingOffer: (id, body) =>
    apiClient.patch(`/food/admin/onboarding/offers/${id}`, body ?? {}, { contextModule: "admin" }),
  toggleOnboardingOffer: (id, isActive) =>
    apiClient.patch(`/food/admin/onboarding/offers/${id}/status`, { isActive }, { contextModule: "admin" }),
  deleteOnboardingOffer: (id) =>
    apiClient.delete(`/food/admin/onboarding/offers/${id}`, { contextModule: "admin" }),

  /** Onboarding payment review (admin) */
  getOnboardingPayments: (params = {}, config = {}) =>
    apiClient.get("/food/admin/onboarding/payments", { ...config, params, contextModule: "admin" }),

  /** Fee Settings (admin) */
  getFeeSettings: (params) =>
    apiClient.get("/food/admin/fee-settings", {
      params: params ?? {},
      contextModule: "admin",
    }),
  createOrUpdateFeeSettings: (body) =>
    apiClient.put("/food/admin/fee-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** Referral Settings (admin) */
  getReferralSettings: () =>
    apiClient.get("/food/admin/referral-settings", { contextModule: "admin" }),
  createOrUpdateReferralSettings: (body) =>
    apiClient.put("/food/admin/referral-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** Safety / Emergency Reports (admin) */
  getSafetyEmergencyReports: (params) =>
    apiClient.get("/food/admin/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "admin",
    }),
  updateSafetyEmergencyStatus: (id, status) =>
    apiClient.put(
      `/food/admin/safety-emergency-reports/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),
  updateSafetyEmergencyPriority: (id, priority) =>
    apiClient.put(
      `/food/admin/safety-emergency-reports/${String(id)}/priority`,
      { priority: String(priority) },
      { contextModule: "admin" },
    ),
  deleteSafetyEmergencyReport: (id) =>
    apiClient.delete(`/food/admin/safety-emergency-reports/${String(id)}`, {
      contextModule: "admin",
    }),

  /** Delivery Cash Limit (admin) */
  /** Query: zoneId (omit for the platform default). */
  getDeliveryCashLimit: (params = {}) =>
    apiClient.get("/food/admin/delivery-cash-limit", {
      params,
      contextModule: "admin",
    }),
  updateDeliveryCashLimit: (body) =>
    apiClient.patch("/food/admin/delivery-cash-limit", body ?? {}, {
      contextModule: "admin",
    }),

  /** Delivery Emergency Help (admin) */
  /** Query: zoneId (omit for the platform default). */
  getEmergencyHelp: (params = {}) =>
    apiClient.get("/food/admin/delivery-emergency-help", {
      params,
      contextModule: "admin",
    }),
  createOrUpdateEmergencyHelp: (body) =>
    apiClient.put("/food/admin/delivery-emergency-help", body ?? {}, {
      contextModule: "admin",
    }),

  /** Restaurant add-ons approval (admin) */
  getRestaurantAddons: (params = {}) =>
    apiClient.get("/food/admin/addons", {
      params: params ?? {},
      contextModule: "admin",
    }),
  updateRestaurantAddon: (id, body) =>
    apiClient.patch(
      `/food/admin/addons/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  approveRestaurantAddon: (id) =>
    withPendingFoodApprovalsInvalidation(apiClient.patch(
      `/food/admin/addons/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    )),
  rejectRestaurantAddon: (id, reason) =>
    withPendingFoodApprovalsInvalidation(apiClient.patch(
      `/food/admin/addons/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    )),
  /** Business Settings (admin) */
  getBusinessSettings: () =>
    apiClient.get(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, {
      contextModule: "admin",
    }),
  updateBusinessSettings: async (data, files = {}) => {
    const formData = new FormData();
    // Add JSON data
    formData.append("data", JSON.stringify(data));
    // Add files
    if (files.logo) formData.append("logo", await prepareUploadFile(files.logo));
    if (files.favicon) formData.append("favicon", await prepareUploadFile(files.favicon));

    return apiClient.patch(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      contextModule: "admin",
    });
  },
};

let restaurantOrdersCache = null;
let restaurantOrdersCacheKey = "";
let restaurantOrdersCacheAt = 0;
let restaurantOrdersInFlight = null;
let restaurantOrdersInFlightKey = "";
/**
 * Last good default-page response, kept across invalidation so a tab can paint
 * instantly while it revalidates. Stamped with the session token it was fetched
 * under: a different restaurant signing in on this device must never be shown
 * the previous restaurant's orders, even for one frame.
 */
let restaurantOrdersSnapshot = null;
let restaurantOrdersSnapshotToken = null;
const currentRestaurantToken = () => {
  try {
    return localStorage.getItem("restaurant_accessToken") || null;
  } catch {
    return null;
  }
};

export const invalidateRestaurantOrdersCache = () => {
  restaurantOrdersCache = null;
  restaurantOrdersCacheKey = "";
  restaurantOrdersCacheAt = 0;
  restaurantOrdersInFlight = null;
  restaurantOrdersInFlightKey = "";
};

/** Apply a status change to one cached orders response, in the UI's vocabulary. */
const applyOptimisticStatus = (response, orderId, targetStatus) => {
  const orders = response?.data?.data?.orders;
  if (!Array.isArray(orders)) return;
  const targetStr = String(orderId);
  const raw = String(targetStatus || "");
  const isCancel = raw.includes("cancel");
  orders.forEach((o) => {
    const matchId = String(o._id || o.orderId || o.id);
    if (matchId !== targetStr) return;
    o.orderStatus = targetStatus;
    // Tabs filter on the normalized status (see getOrders). Writing the backend
    // enum here left a just-marked-ready order in no tab until the next fetch.
    o.status = isCancel
      ? "cancelled"
      : raw === "ready_for_pickup"
        ? "ready"
        : raw === "picked_up"
          ? String(o.orderType || "").toLowerCase() === "takeaway"
            ? "completed"
            : "out_for_delivery"
          : targetStatus;
    if (isCancel) {
      o.cancelledAt = new Date().toISOString();
      o.cancelledBy = "restaurant";
    }
  });
};

export const optimisticallyUpdateRestaurantOrderStatus = (orderId, targetStatus) => {
  if (restaurantOrdersCache) {
    applyOptimisticStatus(restaurantOrdersCache, orderId, targetStatus);
    restaurantOrdersCacheAt = Date.now();
  }
  // The snapshot outlives invalidation; keep it in step so an instant paint
  // never shows an order in the tab it just left.
  if (restaurantOrdersSnapshot && restaurantOrdersSnapshot !== restaurantOrdersCache) {
    applyOptimisticStatus(restaurantOrdersSnapshot, orderId, targetStatus);
  }
};

/** Restaurant API - OTP login via new backend; no email/password. */
export const restaurantAPI = {
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestRestaurantOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, _email, fcmToken = null, platform = "web", confirmAction = null, voipExtras = {}) => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyRestaurantOtp(phone, otp, fcmToken, platform, confirmAction, voipExtras);
  },
  reapply: (phone) => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.reapplyRestaurant(phone);
  },
  getMe: () => authService.getMe("restaurant"),
  /** Restaurant dashboard: fetch current restaurant profile (deduped + short-cached). */
  getCurrentRestaurant: () => getRestaurantCurrentOnce(),
  /** Force-refresh current restaurant profile bypassing the short-lived cache. */
  refreshCurrentRestaurant: () => {
    restaurantCurrentCached = null;
    restaurantCurrentCacheTime = 0;
    restaurantCurrentInFlight = null;
    return getRestaurantCurrentOnce();
  },
  /** Finance dashboard for `hub-finance`. */
  getFinance: (params = {}) =>
    apiClient.get("/food/restaurant/finance", {
      contextModule: "restaurant",
      params: params || {},
    }),
  /** Fetch restaurant by owner (stub for missing backend endpoint). */
  getRestaurantByOwner: () =>
    Promise.resolve({
      data: {
        success: true,
        data: {
          restaurant: {
            name: "Your Restaurant",
            restaurantId: "REST000001",
            address: "Your address",
          },
        },
      },
    }),
  /** Submit a real withdrawal request to the backend. */
  createWithdrawalRequest: (amount) =>
    apiClient.post("/food/restaurant/withdraw", { amount: Number(amount) }, {
      contextModule: "restaurant"
    }),
  /** List withdrawal history for current restaurant. */
  getWithdrawalHistory: () =>
    apiClient.get("/food/restaurant/withdrawals", {
      contextModule: "restaurant"
    }),
  /** Platform restaurant settings (public). */
  getRestaurantSettings: () => getRestaurantSettingsOnce(),
  /** Update restaurant profile fields (name/cuisines/location/menuImages). */
  updateProfile: (body) =>
    apiClient
      .patch("/food/restaurant/profile", body ?? {}, {
        contextModule: "restaurant",
      })
      .then((res) => {
        // Keep cache coherent to avoid an immediate refetch storm.
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  updateDiningSettings: (body) =>
    apiClient
      .patch("/food/restaurant/dining-settings", body ?? {}, {
        contextModule: "restaurant",
      })
      .then((res) => {
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  updateTakeawaySettings: (body) =>
    apiClient
      .patch("/food/restaurant/takeaway-settings", body ?? {}, {
        contextModule: "restaurant",
      })
      .then((res) => {
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  requestDiningUpdate: (body) =>
    apiClient.post("/food/restaurant/dining-settings/request", body ?? {}, {
      contextModule: "restaurant",
    }),
  createDiningCategory: (data) =>
    apiClient.post("/food/restaurant/dining-categories", data ?? {}, {
      contextModule: "restaurant",
    }),
  getPendingDiningRequest: () => getPendingDiningOnce(),
  /** PATCH /food/restaurant/availability. Body: { isAcceptingOrders: boolean } */
  updateAcceptingOrders: (isAcceptingOrders) =>
    apiClient
      .patch(
        "/food/restaurant/availability",
        { isAcceptingOrders: Boolean(isAcceptingOrders) },
        { contextModule: "restaurant" },
      )
      .then((res) => {
        // Keep cache coherent to avoid an immediate refetch storm.
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  /** Upload and set restaurant profile image (multipart). Field name: file */
  uploadProfileImage: async (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const prepared = await prepareUploadFile(file, { preset: "profile" });
    const formData = new FormData();
    formData.append("file", prepared);
    return apiClient.post("/food/restaurant/profile/profile-image", formData, {
      contextModule: "restaurant",
      timeout: 60000,
    });
  },
  /** Upload a menu/cover image (multipart). Does not auto-attach; use updateProfile(menuImages) after. */
  uploadMenuImage: async (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const prepared = await prepareUploadFile(file);
    const formData = new FormData();
    formData.append("file", prepared);
    return apiClient.post("/food/restaurant/profile/menu-image", formData, {
      contextModule: "restaurant",
      timeout: 60000,
    });
  },
  uploadCoverImages: async (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const preparedFiles = await prepareUploadFiles(normalizedFiles);
    const formData = new FormData();
    preparedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/food/restaurant/profile/cover-images", formData, {
      contextModule: "restaurant",
      timeout: 90000,
    });
  },
  uploadMenuImages: async (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const preparedFiles = await prepareUploadFiles(normalizedFiles);
    const formData = new FormData();
    preparedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/food/restaurant/profile/menu-images", formData, {
      contextModule: "restaurant",
      timeout: 90000,
    });
  },
  /** Public Offers for users (global/selected restaurant), limited to the user's zone */
  getPublicOffers: () => apiClient.get("/food/restaurant/offers", { params: userZoneParams() }),
  /** Backward-compat helper used by Cart: returns coupons array for an item by adapting public offers */
  getCouponsByItemIdPublic: (restaurantId, _itemId, options = {}) =>
    apiClient.get("/food/restaurant/offers", { params: userZoneParams() }).then((res) => {
      const list = res?.data?.data?.allOffers || res?.data?.allOffers || [];
      const filtered = filterPublicOffers(list, {
        restaurantId,
        restaurantSlug: options?.restaurantSlug,
        restaurant: options?.restaurant,
        orderType: options?.orderType || "delivery",
        requireShowInCart: true,
      });
      const coupons = filtered.map((o) => {
        const isPct = o.discountType === "percentage";
        return {
          couponCode: o.couponCode,
          discountType: o.discountType,
          discountPercentage: isPct ? Number(o.discountValue) || 0 : 0,
          originalPrice: isPct ? 0 : Number(o.discountValue || 0),
          discountedPrice: 0,
          minOrderValue: Number(o.minOrderValue) > 0 ? Number(o.minOrderValue) : null,
          minOrder: Number(o.minOrderValue) > 0 ? Number(o.minOrderValue) : 0,
          maxDiscount: o.maxDiscount != null ? Number(o.maxDiscount) : null,
          customerGroup: o.customerScope || "all",
          isGlobalCoupon: true,
          endDate: o.endDate || null,
          showInCart: o.showInCart !== false,
          couponType: o.couponType || "all",
        };
      });
      return { data: { success: true, data: { coupons } } };
    }),
  /** Categories (restaurant dashboard) */
  getCategories: (params = {}) =>
    // Compact payload for item creation forms (id + name only).
    apiClient.get("/food/restaurant/categories", {
      params: { compact: true, limit: 1000, ...params },
      contextModule: "restaurant",
    }),
  // For MenuCategoriesPage compatibility
  getAllCategories: (params = {}) =>
    apiClient.get("/food/restaurant/categories", {
      params: {
        includeInactive: true,
        withCounts: true,
        limit: 1000,
        ...params,
      },
      contextModule: "restaurant",
    }),
  createCategory: (body) =>
    apiClient.post("/food/restaurant/categories", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/food/restaurant/categories/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  /** Turn a category on/off. Hides or shows its dishes for customers; no re-approval. */
  setCategoryActive: (id, isActive) =>
    apiClient.patch(`/food/restaurant/categories/${String(id)}/status`, { isActive: Boolean(isActive) }, {
      contextModule: "restaurant",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/food/restaurant/categories/${String(id)}`, {
      contextModule: "restaurant",
    }),
  /** Menu (restaurant dashboard) */
  getMenu: (params = {}) =>
    apiClient.get("/food/restaurant/menu", {
      params,
      contextModule: "restaurant",
    }),
  /** Category sequence shown on the dashboard and the customer menu. */
  updateCategoryOrder: (categoryOrder = []) =>
    apiClient.patch("/food/restaurant/menu/category-order", { categoryOrder }, {
      contextModule: "restaurant",
    }),
  /** Orders (restaurant dashboard) */
  getOrders: (params = {}) =>
    apiClient.get("/food/restaurant/orders", {
      params: { limit: 50, page: 1, ...params },
      contextModule: "restaurant",
    }),
  getOrderById: (orderId) =>
    apiClient.get(`/food/restaurant/orders/${String(orderId)}`, {
      contextModule: "restaurant",
    }),
  updateMenu: (body) =>
    apiClient.patch("/food/restaurant/menu", body ?? {}, {
      contextModule: "restaurant",
    }),
  saveFcmToken: (token, platform = "web", { capabilities, voipToken, deviceId, voipSkipReason } = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      {
        token: String(token),
        platform,
        // e.g. ["order_alarm"] from an app build that renders order alarms itself
        ...(Array.isArray(capabilities) ? { capabilities } : {}),
        // iOS only: PushKit token for this install, registered in the same call
        // so new orders can ring as a CallKit call (see voip.service.js).
        ...(voipToken ? { voipToken, ...(deviceId ? { deviceId } : {}) } : {}),
        // Diagnostic only, server-logged: why there's no voipToken on a mobile
        // save (no bridge handler, not actually inside the app, etc.) — this is
        // the only way that reason reaches the server, since the client's own
        // console log never leaves the device.
        ...(!voipToken && voipSkipReason ? { voipSkipReason } : {}),
      },
      { contextModule: "restaurant" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "restaurant",
      },
    );
  },
  /** iOS app: PushKit token so new orders ring as a call (CallKit). */
  saveVoipDevice: ({ voipToken, fcmToken, deviceId } = {}) =>
    apiClient.post(
      "/fcm-tokens/voip/save",
      { voipToken, fcmToken, deviceId },
      { contextModule: "restaurant" },
    ),
  removeVoipDevice: ({ voipToken, fcmToken, deviceId } = {}) =>
    apiClient.delete("/fcm-tokens/voip/remove", {
      data: { voipToken, fcmToken, deviceId },
      contextModule: "restaurant",
    }),
  testVoipCall: () =>
    apiClient.post("/fcm-tokens/voip/test", {}, { contextModule: "restaurant" }),
  testFcmNotification: (options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.post("/fcm-tokens/test", { platform }, { contextModule: "restaurant" });
  },
  /** Outlet timings (restaurant dashboard) */
  getOutletTimings: () =>
    apiClient.get("/food/restaurant/outlet-timings", {
      contextModule: "restaurant",
    }),
  saveOutletTimings: (outletTimings) =>
    apiClient.put(
      "/food/restaurant/outlet-timings",
      { outletTimings: outletTimings || {} },
      { contextModule: "restaurant" },
    ),
  /** Foods (restaurant) - stored in food_items collection */
  getFoodById: (id) =>
    apiClient.get(`/food/restaurant/foods/${String(id)}`, {
      contextModule: "restaurant",
    }),
  createFood: (body) =>
    apiClient.post("/food/restaurant/foods", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateFood: (id, body) =>
    apiClient.patch(`/food/restaurant/foods/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteFood: (id) =>
    apiClient.delete(`/food/restaurant/foods/${String(id)}`, {
      contextModule: "restaurant",
    }),
  invalidateOrdersCache: () => {
    invalidateRestaurantOrdersCache();
  },
  /**
   * Last default-page orders response, whatever its age, or null.
   *
   * For stale-while-revalidate rendering only: a tab paints this instantly and
   * fetches in the same breath. Never use it as the answer to a question.
   */
  peekOrdersCache: () => {
    if (!restaurantOrdersSnapshot) return null;
    if (restaurantOrdersSnapshotToken !== currentRestaurantToken()) return null;
    return restaurantOrdersSnapshot;
  },
  optimisticallyUpdateOrderStatus: (orderId, targetStatus) => {
    optimisticallyUpdateRestaurantOrderStatus(orderId, targetStatus);
  },
  /** Orders (restaurant dashboard) */
  getOrders: (params = {}) => {
    const key = JSON.stringify({ limit: 50, page: 1, ...params });
    const now = Date.now();

    if (restaurantOrdersCache && restaurantOrdersCacheKey === key && now - restaurantOrdersCacheAt < 3000) {
      return Promise.resolve(restaurantOrdersCache);
    }

    if (restaurantOrdersInFlight && restaurantOrdersInFlightKey === key) return restaurantOrdersInFlight;

    restaurantOrdersInFlightKey = key;
    restaurantOrdersInFlight = apiClient
      .get("/food/restaurant/orders", {
        params: { limit: 50, page: 1, ...params },
        contextModule: "restaurant",
      })
      .then((res) => {
        // Backend paginated shape: { data: { data: [...], meta: {...} } }
        // Normalize to { data: { data: { orders: [...], meta } } } for restaurant UI pages.
        const payload = res?.data?.data || {};
        const rowsRaw = Array.isArray(payload.data) ? payload.data : [];

        // Normalize backend order fields to match existing restaurant UI expectations.
        // UI historically uses: order.status, order.address, order.total, order.paymentMethod
        const normalizeStatus = (s, orderType) => {
          const v = String(s || "").toLowerCase();
          // Backend: created -> treat as confirmed/new in UI
          if (v === "created") return "confirmed";
          // Backend: ready_for_pickup -> ready
          if (v === "ready_for_pickup") return "ready";
          // Backend: picked_up for takeaway = completed (terminal). For delivery = out_for_delivery
          if (v === "picked_up") {
            return orderType === "takeaway" ? "completed" : "out_for_delivery";
          }
          if (v.includes("cancel")) return "cancelled";
          return v || "confirmed";
        };

        const rows = rowsRaw.map((o) => {
          const status = normalizeStatus(o.orderStatus || o.status, o.orderType);
          const address = o.deliveryAddress || o.address;
          const total = o.pricing?.total ?? o.total ?? 0;
          const paymentMethod = o.payment?.method || o.paymentMethod || null;
          return { ...o, status, address, total, paymentMethod };
        });
        const meta = payload.meta || {};
        const normalized = {
          ...res,
          data: {
            ...res.data,
            data: { orders: rows, meta },
          },
        };

        restaurantOrdersCache = normalized;
        restaurantOrdersCacheKey = key;
        restaurantOrdersCacheAt = Date.now();
        if (key === JSON.stringify({ limit: 50, page: 1 })) {
          restaurantOrdersSnapshot = normalized;
          restaurantOrdersSnapshotToken = currentRestaurantToken();
        }
        return normalized;
      })
      .finally(() => {
        restaurantOrdersInFlight = null;
        restaurantOrdersInFlightKey = "";
      });

    return restaurantOrdersInFlight;
  },
  updateOrderStatus: (orderId, body) => {
    const raw = body ?? {};
    const outgoing = { ...raw };

    // Translate UI-friendly statuses to backend enum values.
    const normalizeOutgoingStatus = (s) => {
      const v = String(s || "")
        .toLowerCase()
        .trim();
      if (!v) return v;
      if (v === "ready") return "ready_for_pickup";
      if (v === "out_for_delivery") return "picked_up";
      if (v === "cancelled") return "cancelled_by_restaurant";
      return v;
    };

    if (outgoing.orderStatus) {
      outgoing.orderStatus = normalizeOutgoingStatus(outgoing.orderStatus);
    }

    // Optimistically update order status in cache so UI does not clear/flash
    optimisticallyUpdateRestaurantOrderStatus(orderId, outgoing.orderStatus || outgoing.status || "cancelled_by_restaurant");

    return apiClient
      .patch(
        `/food/restaurant/orders/${String(orderId)}/status`,
        outgoing,
        { contextModule: "restaurant" },
      )
      .then((res) => {
        optimisticallyUpdateRestaurantOrderStatus(orderId, outgoing.orderStatus || outgoing.status || "cancelled_by_restaurant");
        return res;
      });
  },
  completeTakeawayOrder: (orderId, otp) => {
    restaurantAPI.invalidateOrdersCache();
    return apiClient
      .post(
        `/food/restaurant/orders/${String(orderId)}/complete-takeaway`,
        { otp },
        { contextModule: "restaurant" },
      )
      .then((res) => {
        restaurantAPI.invalidateOrdersCache();
        return res;
      });
  },
  /**
   * Accept an incoming order (restaurant).
   * UI expects this to move order into "preparing" bucket.
   * Backend supports PATCH /food/restaurant/orders/:orderId/status with { orderStatus }.
   */
  acceptOrder: async (orderId, prepTimeMins = null) => {
    try {
      return await restaurantAPI.updateOrderStatus(orderId, {
        orderStatus: "preparing",
        preparationTime: prepTimeMins,
      });
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      if (statusCode === 400) {
        // Compatibility fallback: some backends treat "confirmed" as accept action.
        return restaurantAPI.updateOrderStatus(orderId, {
          orderStatus: "confirmed",
          preparationTime: prepTimeMins,
        });
      }
      throw error;
    }
  },
  /**
   * Reject/cancel order by restaurant.
   * Backend orderStatus enum: cancelled_by_restaurant.
   */
  rejectOrder: (orderId, reason = "") =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "cancelled_by_restaurant",
      note: reason,
      reason: reason,
      cancellationReason: reason,
    }),
  /** Mark order ready (restaurant handoff). */
  markOrderReady: (orderId) =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "ready_for_pickup",
    }),
  /**
   * Get a single order by id for restaurant screens.
   * Prefer direct endpoint; fallback to list+filter for backward compatibility.
   */
  getOrderById: async (orderId) => {
    return await apiClient.get(`/food/restaurant/orders/${String(orderId)}`, {
      contextModule: "restaurant",
    });
  },
  /** Add-ons (restaurant) - approval handled by admin */
  getAddons: (params = {}) =>
    apiClient.get("/food/restaurant/addons", {
      // Backend validator enforces limit <= 100
      params: { limit: 100, page: 1, ...params },
      contextModule: "restaurant",
    }),
  addAddon: (body) =>
    apiClient.post("/food/restaurant/addons", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateAddon: (id, body) =>
    apiClient.patch(`/food/restaurant/addons/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteAddon: (id) =>
    apiClient.delete(`/food/restaurant/addons/${String(id)}`, {
      contextModule: "restaurant",
    }),
  logout: (refreshToken) => {
    restaurantCurrentInFlight = null;
    restaurantCurrentCached = null;
    restaurantCurrentCacheTime = 0;
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("restaurant_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_restaurant") : null;
    return authService.logout(token, fcmToken, "web");
  },
  /** Backend has no email/password login; use phone OTP only. */
  login: (_email, _password) =>
    Promise.reject(new Error("Please use phone number and OTP to sign in.")),
  /**
   * Register a restaurant (multipart FormData).
   * Backend: POST /v1/food/restaurant/register (path relative to baseURL /api/v1)
   */
  register: (formData, { registrationToken } = {}) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    // The OTP registration token lets a rejected restaurant re-apply over its
    // earlier registration; a brand-new one registers without it.
    return apiClient.post(
      "/food/restaurant/register",
      formData,
      registrationToken ? { headers: { "X-Registration-Token": registrationToken } } : undefined,
    );
  },
  /**
   * Onboarding draft uploads (before the restaurant exists). Authorised by the
   * registration token returned from OTP verification, not an access token.
   * `_retry` keeps a rejected registration token from triggering the access-token
   * refresh/logout flow in the axios interceptor.
   */
  getOnboardingUploads: (registrationToken) =>
    apiClient.get("/food/restaurant/onboarding/uploads", {
      headers: { "X-Registration-Token": registrationToken },
      contextModule: "restaurant",
      _retry: true,
    }),
  uploadOnboardingFile: async (registrationToken, field, file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }
    const prepared = await prepareUploadFile(file, options.compress);
    const formData = new FormData();
    formData.append("field", field);
    formData.append("file", prepared);
    return apiClient.post("/food/restaurant/onboarding/uploads", formData, {
      headers: { "X-Registration-Token": registrationToken },
      contextModule: "restaurant",
      timeout: 60000,
      onUploadProgress: options.onUploadProgress,
      _retry: true,
    });
  },
  removeOnboardingUpload: (registrationToken, field, url) =>
    apiClient.delete("/food/restaurant/onboarding/uploads", {
      headers: { "X-Registration-Token": registrationToken },
      data: { field, url },
      contextModule: "restaurant",
      _retry: true,
    }),
  /**
   * One-time onboarding payment.
   * A restaurant has no access token before approval, so these calls carry the
   * short-lived onboarding token returned by register()/OTP login instead.
   */
  getOnboardingPaymentQuote: (onboardingToken) =>
    apiClient.get("/food/restaurant/onboarding/payment/quote", {
      headers: { "X-Onboarding-Token": onboardingToken },
    }),
  createOnboardingPaymentOrder: (onboardingToken) =>
    apiClient.post("/food/restaurant/onboarding/payment/order", {}, {
      headers: { "X-Onboarding-Token": onboardingToken },
    }),
  verifyOnboardingPayment: (onboardingToken, body) =>
    apiClient.post("/food/restaurant/onboarding/payment/verify", body ?? {}, {
      headers: { "X-Onboarding-Token": onboardingToken },
    }),
  cancelOnboardingPayment: (onboardingToken, body) =>
    apiClient.post("/food/restaurant/onboarding/payment/cancel", body ?? {}, {
      headers: { "X-Onboarding-Token": onboardingToken },
    }),
  /** Public: list approved restaurants for user app */
  getRestaurants: (params = {}, config = {}) =>
    getPublicRestaurantsOnce(params, config),
  /** Public: list restaurants with dishes under ₹250 */
  getRestaurantsUnder250: (params = {}, config = {}) =>
    getPublicRestaurantsUnder250Once(params, config),
  /** Public: get single approved restaurant by id or slug */
  getRestaurantById: (id, config = {}) =>
    apiClient.get(`/food/restaurant/restaurants/${String(id)}`, { ...config }),
  /** Public: get approved menu by restaurant id or slug */
  getMenuByRestaurantId: (id, config = {}) =>
    getPublicRestaurantMenuOnce(id, config),
  /** Public: get outlet timings by restaurant id */
  getOutletTimingsByRestaurantId: (id, config = {}) =>
    getPublicRestaurantOutletTimingsOnce(id, config),
  /** Public: approved foods for user category/search pages (zone + optional category slug) */
  getPublicFoods: (params = {}, config = {}) =>
    getPublicFoodsOnce(params, config),
  /** Public: Eatiefy ₹99 section dishes — server returns only items selling at exactly ₹99 */
  getEatiefy99Foods: (params = {}, config = {}) =>
    apiClient.get("/food/restaurant/public/foods/eatiefy-99", { params, ...config }),
  /** Public (user app): approved add-ons by restaurant id/slug */
  getAddonsByRestaurantId: (id, config = {}) =>
    apiClient.get(`/food/restaurant/restaurants/${String(id)}/addons`, {
      ...config,
    }),
  /** Resend delivery notification (restaurant dashboard) */
  resendDeliveryNotification: (orderId) =>
    apiClient.post(`/food/restaurant/orders/${String(orderId)}/resend-notification`, {}, {
      contextModule: "restaurant",
    }),
  /** List restaurant complaints (for current restaurant dashboard) */
  getComplaints: (params = {}) =>
    apiClient.get("/food/restaurant/complaints", {
      params,
      contextModule: "restaurant",
    }),
  /** Restaurant support tickets */
  createSupportTicket: (body = {}) =>
    apiClient.post("/food/restaurant/support/tickets", body ?? {}, {
      contextModule: "restaurant",
    }),
  getSupportTickets: (params = {}) =>
    apiClient.get("/food/restaurant/support/tickets", {
      params,
      contextModule: "restaurant",
    }),
  /** DELETE /food/restaurant/account - permanently delete restaurant account */
  deleteAccount: () =>
    apiClient.delete("/food/restaurant/account", { contextModule: "restaurant" }),
};

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function createInFlightCache({ ttlMs }) {
  const inFlight = new Map();
  const cached = new Map(); // key -> { t, v }

  const getCached = (key) => {
    const hit = cached.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      cached.delete(key);
      return null;
    }
    return hit.v;
  };

  const getOrCreate = (key, factory) => {
    const cachedValue = getCached(key);
    if (cachedValue) return Promise.resolve(cachedValue);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = Promise.resolve()
      .then(factory)
      .then((res) => {
        cached.set(key, { t: Date.now(), v: res });
        return res;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, p);
    return p;
  };

  return { getOrCreate };
}

// Public user-app endpoints can be called by multiple components/effects on refresh (and React StrictMode in dev).
// A small in-flight + short TTL cache collapses duplicate requests without changing functionality.
const publicRestaurantsCache = createInFlightCache({ ttlMs: 3000 });
const publicRestaurantsUnder250Cache = createInFlightCache({ ttlMs: 3000 });
const publicRestaurantMenuCache = createInFlightCache({ ttlMs: 3000 });
const publicRestaurantOutletTimingsCache = createInFlightCache({ ttlMs: 3000 });
const publicFoodsCache = createInFlightCache({ ttlMs: 3000 });
const publicGenericGetCache = createInFlightCache({ ttlMs: 3000 });

// Long-lived cache for public app config (banners, settings, fees) — shared across routes.
const PUBLIC_CONFIG_CACHE_TTL_MS = 15 * 60 * 1000;
const publicConfigCache = createInFlightCache({ ttlMs: PUBLIC_CONFIG_CACHE_TTL_MS });

export const invalidatePublicConfigCache = () => {
  publicConfigCache.invalidate();
};

export const publicConfigGetOnce = (url, config = {}) => {
  const safeUrl = typeof url === "string" ? url.trim() : "";
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeUrl) return Promise.reject(new Error("url is required"));

  if (noCache) {
    return apiClient.get(safeUrl, { params, ...axiosConfig });
  }

  const keyParams =
    params && typeof params === "object" ? { ...params } : params;
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }

  const key = `CONFIG:${safeUrl}:${stableStringify(keyParams)}`;
  return publicConfigCache.getOrCreate(key, () =>
    apiClient.get(safeUrl, { params, ...axiosConfig }),
  );
};
const adminReadCache = new Map();
const adminReadInFlight = new Map();

const buildAdminReadKey = (url, params = {}) => {
  const safeParams = params && typeof params === "object" ? { ...params } : params;
  if (safeParams && typeof safeParams === "object") {
    delete safeParams._ts;
  }
  return `admin:${String(url || "").trim()}:${stableStringify(safeParams)}`;
};

const adminCachedGet = (url, config = {}, options = {}) => {
  const { noCache, params, ...axiosConfig } = config || {};
  const ttlMs = Number(options?.ttlMs || 0) || 5000;
  const staleOn429Ms = Number(options?.staleOn429Ms || 0) || 60000;

  if (noCache) {
    return apiClient.get(url, { params, ...axiosConfig });
  }

  const key = buildAdminReadKey(url, params);
  const now = Date.now();
  const cached = adminReadCache.get(key);
  if (cached && now - cached.at < ttlMs) {
    return Promise.resolve(cached.res);
  }

  const pending = adminReadInFlight.get(key);
  if (pending) return pending;

  const request = apiClient
    .get(url, { params, ...axiosConfig })
    .then((res) => {
      // Skip caching if invalidateAdminReadCache() dropped this request while it
      // was in flight: it may have read data from before a mutation.
      if (adminReadInFlight.get(key) === request) {
        adminReadCache.set(key, { at: Date.now(), res });
      }
      return res;
    })
    .catch((err) => {
      const status = Number(err?.response?.status || 0);
      const fallback = adminReadCache.get(key);
      if (status === 429 && fallback && now - fallback.at < staleOn429Ms) {
        return fallback.res;
      }
      throw err;
    })
    .finally(() => {
      if (adminReadInFlight.get(key) === request) {
        adminReadInFlight.delete(key);
      }
    });

  adminReadInFlight.set(key, request);
  return request;
};

/**
 * Drop cached and in-flight admin reads for `url` (all params) so the next read
 * hits the server. Call after a mutation that changes what that list returns.
 */
const invalidateAdminReadCache = (url) => {
  const prefix = `admin:${String(url || "").trim()}:`;
  for (const key of [...adminReadCache.keys()]) {
    if (key.startsWith(prefix)) adminReadCache.delete(key);
  }
  for (const key of [...adminReadInFlight.keys()]) {
    if (key.startsWith(prefix)) adminReadInFlight.delete(key);
  }
};

/** Runs an approval mutation, then invalidates the pending-approvals list whether it succeeded or not. */
const withPendingFoodApprovalsInvalidation = (mutation) =>
  mutation.finally(() => {
    invalidateAdminReadCache("/food/admin/foods/pending-approvals");
  });

export const publicGetOnce = (url, config = {}) => {
  const safeUrl = typeof url === "string" ? url.trim() : "";
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeUrl) return Promise.reject(new Error("url is required"));

  if (noCache) {
    return apiClient.get(safeUrl, { params, ...axiosConfig });
  }

  const keyParams =
    params && typeof params === "object" ? { ...params } : params;
  if (keyParams && typeof keyParams === "object") {
    // `_ts` is used as a cache-buster in some call sites; ignore it for dedupe purposes.
    delete keyParams._ts;
  }

  const key = `GET:${safeUrl}:${stableStringify(keyParams)}`;
  return publicGenericGetCache.getOrCreate(key, () =>
    apiClient.get(safeUrl, { params, ...axiosConfig }),
  );
};

const getPublicRestaurantsUnder250Once = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  if (noCache) {
    return apiClient.get("/food/restaurant/under-250", {
      params: params ?? {},
      ...axiosConfig,
    });
  }
  const keyParams = params ?? {};
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }
  const key = `under-250:${stableStringify(keyParams)}`;
  return publicRestaurantsUnder250Cache.getOrCreate(key, () =>
    apiClient.get("/food/restaurant/under-250", {
      params: params ?? {},
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantsOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  if (noCache) {
    return apiClient.get("/food/restaurant/restaurants", {
      params: { limit: 40, ...params },
      ...axiosConfig,
    });
  }
  const keyParams = { limit: 40, ...params };
  // `_ts` is an explicit cache-buster in many call sites; ignore it for dedupe purposes.
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }
  const key = `restaurants:${stableStringify(keyParams)}`;
  return publicRestaurantsCache.getOrCreate(key, () =>
    apiClient.get("/food/restaurant/restaurants", {
      params: { limit: 40, ...params },
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantMenuOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return apiClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      ...axiosConfig,
    });
  }
  const key = `menu:${safeId}`;
  return publicRestaurantMenuCache.getOrCreate(key, () =>
    apiClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      ...axiosConfig,
    }),
  );
};

const getPublicFoodsOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  const keyParams = { ...(params || {}) };
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }
  if (noCache) {
    return apiClient.get("/food/restaurant/public/foods", {
      params: keyParams,
      ...axiosConfig,
    });
  }
  const key = `publicFoods:${stableStringify(keyParams)}`;
  return publicFoodsCache.getOrCreate(key, () =>
    apiClient.get("/food/restaurant/public/foods", {
      params: keyParams,
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantOutletTimingsOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return apiClient.get(
      `/food/restaurant/restaurants/${safeId}/outlet-timings`,
      { ...axiosConfig },
    );
  }
  const key = `outletTimings:${safeId}`;
  return publicRestaurantOutletTimingsCache.getOrCreate(key, () =>
    apiClient.get(`/food/restaurant/restaurants/${safeId}/outlet-timings`, {
      ...axiosConfig,
    }),
  );
};

/** Single in-flight + short cache for restaurant /food/restaurant/current - prevents request storms. */
let restaurantCurrentInFlight = null;
let restaurantCurrentCached = null;
let restaurantCurrentCacheTime = 0;
const RESTAURANT_CURRENT_CACHE_MS = 15000;

const getRestaurantCurrentOnce = () => {
  const now = Date.now();
  if (
    restaurantCurrentCached &&
    now - restaurantCurrentCacheTime < RESTAURANT_CURRENT_CACHE_MS
  ) {
    return Promise.resolve(restaurantCurrentCached);
  }
  if (!restaurantCurrentInFlight) {
    restaurantCurrentInFlight = apiClient
      .get("/food/restaurant/current", { contextModule: "restaurant" })
      .then((res) => {
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        restaurantCurrentInFlight = null;
      });
  }
  return restaurantCurrentInFlight;
};

/** Single in-flight + short cache for the restaurant's accept-order settings */
let restaurantSettingsInFlight = null;
let restaurantSettingsCached = null;
let restaurantSettingsCacheTime = 0;
const RESTAURANT_SETTINGS_CACHE_MS = 15000;

const getRestaurantSettingsOnce = () => {
  const now = Date.now();
  if (
    restaurantSettingsCached &&
    now - restaurantSettingsCacheTime < RESTAURANT_SETTINGS_CACHE_MS
  ) {
    return Promise.resolve(restaurantSettingsCached);
  }
  if (!restaurantSettingsInFlight) {
    restaurantSettingsInFlight = apiClient
      // Resolved for the signed-in restaurant's zone (zone override, else platform default).
      .get("/food/restaurant/accept-order-settings", { contextModule: "restaurant" })
      // Platform default when the zone lookup is unavailable (e.g. maintenance mode).
      .catch(() =>
        apiClient.get("/food/public/restaurant-settings", { contextModule: "restaurant" }),
      )
      .then((res) => {
        restaurantSettingsCached = res;
        restaurantSettingsCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        restaurantSettingsInFlight = null;
      });
  }
  return restaurantSettingsInFlight;
};

/** Single in-flight + short cache for pending dining requests */
let pendingDiningInFlight = null;
let pendingDiningCached = null;
let pendingDiningCacheTime = 0;
const PENDING_DINING_CACHE_MS = 10000;

const getPendingDiningOnce = () => {
  const now = Date.now();
  if (
    pendingDiningCached &&
    now - pendingDiningCacheTime < PENDING_DINING_CACHE_MS
  ) {
    return Promise.resolve(pendingDiningCached);
  }
  if (!pendingDiningInFlight) {
    pendingDiningInFlight = apiClient
      .get("/food/restaurant/dining-settings/pending", { contextModule: "restaurant" })
      .then((res) => {
        pendingDiningCached = res;
        pendingDiningCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        pendingDiningInFlight = null;
      });
  }
  return pendingDiningInFlight;
};

/** Single in-flight + short cache for delivery /auth/me - one call per page load / refresh. */
let deliveryMeInFlight = null;
let deliveryMeCached = null;
let deliveryMeCacheTime = 0;
const DELIVERY_ME_CACHE_MS = 3000;

const getDeliveryMeOnce = () => {
  const now = Date.now();
  if (deliveryMeCached && now - deliveryMeCacheTime < DELIVERY_ME_CACHE_MS) {
    return Promise.resolve(deliveryMeCached);
  }
  if (!deliveryMeInFlight) {
    deliveryMeInFlight = authService
      .getMe("delivery")
      .then((res) => {
        deliveryMeCached = res;
        deliveryMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        deliveryMeInFlight = null;
      });
  }
  return deliveryMeInFlight;
};

/**
 * Profile writes must drop the short-lived /me cache; otherwise the screen re-reads
 * the pre-save profile right after a successful upload/save and looks unsaved.
 */
const invalidateDeliveryMeCache = () => {
  deliveryMeCached = null;
  deliveryMeCacheTime = 0;
  deliveryMeInFlight = null;
};

const afterDeliveryProfileWrite = (promise) =>
  promise.then((res) => {
    invalidateDeliveryMeCache();
    return res;
  });

const withUploadProgress = (options = {}) =>
  typeof options.onUploadProgress === "function"
    ? { onUploadProgress: options.onUploadProgress, timeout: 90000 }
    : { timeout: 90000 };

/** Delivery API - OTP login + registration via new backend. */
export const deliveryAPI = {
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestDeliveryOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, fcmToken = null, platform = "web", confirmAction = null, voipExtras = {}) => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyDeliveryOtp(phone, otp, fcmToken, platform, confirmAction, voipExtras);
  },
  getMe: () => getDeliveryMeOnce(),
  /** Get delivery profile (same as getMe under the hood; maps response to profile shape). */
  getProfile: () =>
    getDeliveryMeOnce().then((res) => ({
      ...res,
      data: {
        ...res.data,
        data: { profile: res.data?.data?.user ?? res.data?.data },
      },
    })),
  /**
   * Force-refresh the delivery partner profile, bypassing the short-lived cache.
   * Approval status is read through this so a partner approved moments ago is
   * not shown a stale "pending" from the cached response.
   */
  refreshMe: () => {
    deliveryMeCached = null;
    deliveryMeCacheTime = 0;
    deliveryMeInFlight = null;
    return getDeliveryMeOnce();
  },
  getReferralStats: () =>
    apiClient.get("/food/delivery/referrals/stats", {
      contextModule: "delivery",
    }),
  logout: (refreshToken) => {
    deliveryMeCached = null;
    deliveryMeCacheTime = 0;
    try {
      localStorage.removeItem("app:isOnline");
    } catch (_) {}
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("delivery_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_delivery") : null;
    return authService.logout(token, fcmToken, "web");
  },
  /** POST /food/delivery/register - multipart FormData (new partner, no token). */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    // Several document photos in one request can outlast the 30s default on mobile data.
    return apiClient.post("/food/delivery/register", formData, { timeout: 90000 });
  },
  /** PATCH /food/delivery/profile - complete profile after OTP (Bearer token required). */
  completeProfile: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return afterDeliveryProfileWrite(apiClient.patch("/food/delivery/profile", formData, {
      contextModule: "delivery",
      timeout: 90000,
    }));
  },
  /** PATCH /food/delivery/profile/details - JSON updates (vehicle number, etc). */
  updateProfileDetails: (payload) =>
    afterDeliveryProfileWrite(apiClient.patch("/food/delivery/profile/details", payload ?? {}, {
      contextModule: "delivery",
    })),
  /** PATCH /food/delivery/profile - multipart updates for photos/documents (uses same endpoint). */
  updateProfileMultipart: (formData, options = {}) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return afterDeliveryProfileWrite(apiClient.patch("/food/delivery/profile", formData, {
      contextModule: "delivery",
      ...withUploadProgress(options),
    }));
  },
  /** POST /food/delivery/profile/photo-base64 - Flutter in-app camera base64 upload. */
  updateProfilePhotoBase64: (payload) =>
    afterDeliveryProfileWrite(apiClient.post("/food/delivery/profile/photo-base64", payload ?? {}, {
      contextModule: "delivery",
    })),
  /** PATCH /food/delivery/profile/bank-details - update bank details + PAN (JSON, Bearer required). */
  updateProfile: (payload) =>
    afterDeliveryProfileWrite(apiClient.patch("/food/delivery/profile/bank-details", payload ?? {}, {
      contextModule: "delivery",
    })),
  /** PATCH /food/delivery/profile/bank-details - multipart updates for bank details + UPI QR (FormData required). */
  updateBankDetailsMultipart: (formData, options = {}) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return afterDeliveryProfileWrite(apiClient.patch("/food/delivery/profile/bank-details", formData, {
      contextModule: "delivery",
      ...withUploadProgress(options),
    }));
  },
  /**
   * Signup document uploads before the partner exists, authorised by the
   * registration token from OTP verification. `_retry` keeps a rejected token
   * away from the access-token refresh/logout flow.
   */
  getOnboardingUploads: (registrationToken) =>
    apiClient.get("/food/delivery/onboarding/uploads", {
      headers: { "X-Registration-Token": registrationToken },
      contextModule: "delivery",
      _retry: true,
    }),
  uploadOnboardingDocument: (registrationToken, field, file, options = {}) => {
    if (!file) return Promise.reject(new Error("File is required for upload"));
    const formData = new FormData();
    formData.append("field", field);
    formData.append("file", file);
    return apiClient.post("/food/delivery/onboarding/uploads", formData, {
      headers: { "X-Registration-Token": registrationToken },
      contextModule: "delivery",
      _retry: true,
      ...withUploadProgress(options),
    });
  },
  removeOnboardingDocument: (registrationToken, field, url) =>
    apiClient.delete("/food/delivery/onboarding/uploads", {
      headers: { "X-Registration-Token": registrationToken },
      data: { field, url },
      contextModule: "delivery",
      _retry: true,
    }),
  saveFcmToken: (token, platform = "web", { voipToken, deviceId, voipSkipReason } = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      {
        token: String(token),
        platform,
        // iOS only: PushKit token for this install, registered in the same call
        // so new delivery offers can ring as a CallKit call (see voip.service.js).
        ...(voipToken ? { voipToken, ...(deviceId ? { deviceId } : {}) } : {}),
        // Diagnostic only, server-logged: why there's no voipToken (see restaurantAPI.saveFcmToken).
        ...(!voipToken && voipSkipReason ? { voipSkipReason } : {}),
      },
      { contextModule: "delivery" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "delivery",
      },
    );
  },
  /** iOS app: PushKit token so new delivery offers ring as a call (CallKit). */
  saveVoipDevice: ({ voipToken, fcmToken, deviceId } = {}) =>
    apiClient.post(
      "/fcm-tokens/voip/save",
      { voipToken, fcmToken, deviceId },
      { contextModule: "delivery" },
    ),
  removeVoipDevice: ({ voipToken, fcmToken, deviceId } = {}) =>
    apiClient.delete("/fcm-tokens/voip/remove", {
      data: { voipToken, fcmToken, deviceId },
      contextModule: "delivery",
    }),
  testVoipCall: () =>
    apiClient.post("/fcm-tokens/voip/test", {}, { contextModule: "delivery" }),
  testFcmNotification: (options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.post("/fcm-tokens/test", { platform }, { contextModule: "delivery" });
  },
  /** GET /food/delivery/support-tickets - list tickets for logged-in delivery partner. */
  getSupportTickets: () =>
    apiClient.get("/food/delivery/support-tickets", {
      contextModule: "delivery",
    }),
  /** POST /food/delivery/support-tickets - create ticket (body: subject, description, category?, priority?). */
  createSupportTicket: (body) =>
    apiClient.post("/food/delivery/support-tickets", body ?? {}, {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/support-tickets/:id - get one ticket (own only). */
  getSupportTicketById: (id) =>
    apiClient.get(`/food/delivery/support-tickets/${id}`, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/availability - set online/offline (and optional lat/lng). */
  updateOnlineStatus: (isOnline) =>
    apiClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline" },
      { contextModule: "delivery" },
    ),
  updateLocation: (latitude, longitude, isOnline, extras = {}) =>
    apiClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline", latitude, longitude, ...extras },
      { contextModule: "delivery" },
    ),
  /** Orders */
  getOrders: (() => {
    // Collapse duplicate list fetches triggered by multiple effects + StrictMode.
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 2500;

    const stableKey = (p = {}) => {
      const safe = p && typeof p === "object" ? { ...p } : {};
      // Ensure stable ordering + defaults.
      const normalized = { limit: 50, page: 1, ...safe };
      // Remove cache-busters if any.
      delete normalized._ts;
      return JSON.stringify(
        Object.keys(normalized)
          .sort()
          .reduce((acc, k) => {
            acc[k] = normalized[k];
            return acc;
          }, {}),
      );
    };

    return (params = {}) => {
      const key = stableKey(params);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get("/food/delivery/orders/available", {
          params: { limit: 50, page: 1, ...params },
          contextModule: "delivery",
        })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  getOrderDetails: (() => {
    // Collapse duplicate calls coming from multiple effects (and React StrictMode in dev).
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 1200;

    const isProbablyOrderIdentity = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return false;
      // Mongo ObjectId
      return /^[a-f0-9]{24}$/i.test(raw);
    };

    return (orderId) => {
      const key = String(orderId || "").trim();
      if (!isProbablyOrderIdentity(key)) {
        return Promise.resolve({
          data: { success: false, message: "Invalid order id", data: null },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        });
      }

      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get(`/food/delivery/orders/${key}`, { contextModule: "delivery" })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  /** GET /food/delivery/current - fallback for some UI hooks */
  getCurrentDelivery: () => apiClient.get("/food/delivery/orders/current", { contextModule: "delivery" }),
  acceptOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/accept`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  rejectOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reject`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /**
   * PATCH /food/delivery/orders/:orderId/reached-pickup
   * Marks "reached pickup" (arrival at restaurant) in backend order deliveryState.
   */
  confirmReachedPickup: (orderId) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-pickup`,
      {},
      { contextModule: "delivery" },
    ),
  /**
   * Confirm order ID and upload bill image (Picked Up slide).
   * Backend endpoint: PATCH /food/delivery/orders/:id/confirm-pickup
   */
  confirmOrderId: (orderId, confirmedOrderId, location = {}, data = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/confirm-pickup`,
      {
        confirmedOrderId,
        latitude: location.lat,
        longitude: location.lng,
        billImageUrl: data.billImageUrl,
      },
      {
        contextModule: "delivery",
      },
    ),
  confirmReachedDrop: (orderId) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-drop`,
      {},
      {
        contextModule: "delivery",
      },
    ),
  verifyDropOtp: (orderId, otp) =>
    apiClient.post(
      `/food/delivery/orders/${String(orderId)}/verify-drop-otp`,
      { otp: String(otp) },
      {
        contextModule: "delivery",
      },
    ),
  /** POST /food/delivery/orders/:orderId/collect/qr - create Razorpay payment link (COD collection) */
  createCollectQr: (orderId, body = {}) =>
    apiClient.post(
      `/food/delivery/orders/${String(orderId)}/collect/qr`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** GET /food/delivery/orders/:orderId/payment-status - check COD/QR payment status */
  getPaymentStatus: (orderId) =>
    apiClient.get(`/food/delivery/orders/${String(orderId)}/payment-status`, {
      contextModule: "delivery",
    }),
  completeDelivery: (orderId, body = {}) => {
    // Backward-compatible: older UI calls completeDelivery(orderId, rating, review)
    // where rating is a number (sent as raw JSON like "3"). Normalize to an object.
    let payload = body ?? {};
    if (
      typeof payload === "number" ||
      typeof payload === "string" ||
      payload == null
    ) {
      payload = { rating: payload == null ? null : Number(payload) };
    }
    return apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/complete`,
      payload,
      {
        contextModule: "delivery",
      },
    );
  },
  updateOrderStatus: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/status`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** Registration Re-verification */
  reverify: () =>
    apiClient.post(
      "/food/delivery/reverify",
      {},
      { contextModule: "delivery" },
    ),
  /** GET /food/delivery/wallet - wallet for Pocket/requests page (backend) */
  getWallet: () =>
    apiClient.get("/food/delivery/wallet", { contextModule: "delivery" }),
  /** GET /food/delivery/earnings - earnings summary for Pocket/requests page */
  getEarnings: (params) =>
    apiClient.get("/food/delivery/earnings", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** Earning Addons (Hotspots/Bonus) */
  getActiveEarningAddons: () =>
    apiClient.get("/food/delivery/earning-addons/active", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/trip-history - completed/cancelled/pending trips for delivery partner */
  getTripHistory: (params) =>
    apiClient.get("/food/delivery/trip-history", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/pocket-details - single-call week details (trips + transactions) */
  getPocketDetails: (params) =>
    apiClient.get("/food/delivery/pocket-details", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/my-reviews - reviews given by customers to the logged-in partner */
  getMyReviews: (params) =>
    apiClient.get("/food/delivery/my-reviews", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/emergency-help - admin-set emergency numbers for delivery partner */
  getEmergencyHelp: () =>
    apiClient.get("/food/delivery/emergency-help", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/cash-limit - admin-set cash limit for delivery partner */
  getCashLimit: () =>
    apiClient.get("/food/delivery/cash-limit", {
      contextModule: "delivery",
    }),
  createWithdrawalRequest: (body) =>
    apiClient.post("/food/delivery/wallet/withdraw", body ?? {}, {
      contextModule: "delivery"
    }),
  createDepositOrder: (amount) =>
    apiClient.post("/food/delivery/wallet/deposit/order", { amount }, {
      contextModule: "delivery"
    }),
  verifyDepositPayment: (body) =>
    apiClient.post("/food/delivery/wallet/deposit/verify", body ?? {}, {
      contextModule: "delivery"
    }),
  submitCashDeposit: (amount) =>
    apiClient.post("/food/delivery/wallet/deposit/cash-submit", { amount }, {
      contextModule: "delivery"
    }),
  /** Wallet transactions - from wallet response (no separate backend endpoint) */
  getWalletTransactions: (params) =>
    apiClient
      .get("/food/delivery/wallet", {
        params: params ?? {},
        contextModule: "delivery",
      })
      .then((res) => ({
        ...res,
        data: {
          ...res.data,
          data: {
            transactions: res?.data?.data?.wallet?.transactions ?? [],
          },
        },
      })),
  /** Zone discovery */
  getZonesInRadius: (lat, lng, radiusKm = 10) =>
    apiClient.get("/food/zones/nearby", {
      params: { lat, lng, radius: radiusKm },
      contextModule: "delivery",
    }),
  /** DELETE /food/delivery/account - permanently delete delivery partner account */
  deleteAccount: () =>
    apiClient.delete("/food/delivery/account", { contextModule: "delivery" }),
};

export const userAPI = {
  getCustomizationSettings: () =>
    apiClient.get("/food/public/customization-settings"),
  /** Get current user profile (Bearer USER). */
  getProfile: () =>
    getUserMeOnce().then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { ...res, data: { ...res.data, data: { user } } };
    }),
  /** PATCH /food/user/profile (Bearer USER) */
  updateProfile: (body) =>
    apiClient.patch("/food/user/profile", body ?? {}, {
      contextModule: "user",
    }),
  /** Upload and set user profile image (multipart). Field name: file */
  uploadProfileImage: async (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const prepared = await prepareUploadFile(file, { preset: "profile" });
    const formData = new FormData();
    formData.append("file", prepared);
    return apiClient.post("/food/user/profile/profile-image", formData, {
      contextModule: "user",
      timeout: 60000,
    });
  },
  /** GET /food/user/wallet (Bearer USER). Deduped + short-cached. */
  getWallet: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/food/user/wallet", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** GET /food/user/referrals/stats (Bearer USER) */
  getReferralStats: () =>
    apiClient.get("/food/user/referrals/stats", { contextModule: "user" }),
  /** GET /food/user/referrals/details (Bearer USER) */
  getReferralDetails: () =>
    apiClient.get("/food/user/referrals/details", { contextModule: "user" }),
  /** POST /food/user/wallet/topup/order (Bearer USER). Body: { amount } */
  createWalletTopupOrder: (amount) =>
    apiClient.post(
      "/food/user/wallet/topup/order",
      { amount: Number(amount) },
      { contextModule: "user" },
    ),
  /** POST /food/user/wallet/topup/verify (Bearer USER) */
  verifyWalletTopupPayment: (body) =>
    apiClient.post("/food/user/wallet/topup/verify", body ?? {}, {
      contextModule: "user",
    }),
  /** GET /food/user/addresses (Bearer USER). Deduped + short-cached. */
  getAddresses: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/food/user/addresses", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** POST /food/user/addresses (Bearer USER) */
  addAddress: (body) =>
    apiClient.post("/food/user/addresses", body ?? {}, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id (Bearer USER) */
  updateAddress: (id, body) =>
    apiClient.patch(`/food/user/addresses/${String(id)}`, body ?? {}, {
      contextModule: "user",
    }),
  /** DELETE /food/user/addresses/:id (Bearer USER) */
  deleteAddress: (id) =>
    apiClient.delete(`/food/user/addresses/${String(id)}`, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id/default (Bearer USER) */
  setDefaultAddress: (id) =>
    apiClient.patch(
      `/food/user/addresses/${String(id)}/default`,
      {},
      { contextModule: "user" },
    ),
  /** POST /food/user/safety-emergency-reports (Bearer USER) */
  createSafetyEmergencyReport: (message) =>
    apiClient.post(
      "/food/user/safety-emergency-reports",
      { message: String(message || "") },
      { contextModule: "user" },
    ),
  /** GET /food/user/safety-emergency-reports (Bearer USER) */
  getMySafetyEmergencyReports: (params) =>
    apiClient.get("/food/user/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "user",
    }),
  /**
   * Legacy UI compatibility: update "current user location".
   * We already persist the user's selected location in localStorage in the UI.
   * Keep this as a no-op success so existing flows don't break.
   */
  updateLocation: (_payload) =>
    Promise.resolve({
      data: { success: true, message: "Location saved (client)", data: null },
    }),
  saveFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      { token: String(token), platform },
      { contextModule: "user" },
    );
  },
  removeFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "user",
      },
    );
  },
  testFcmNotification: (options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.post("/fcm-tokens/test", { platform }, { contextModule: "user" });
  },
  /** DELETE /food/user/account - permanently delete user account */
  deleteAccount: () =>
    apiClient.delete("/food/user/account", { contextModule: "user" }),
};
export const locationAPI = createStubAPI();
export const zoneAPI = {
  /** Public: detect active service zone for a lat/lng point. */
  detectZone: (lat, lng) =>
    apiClient.get("/food/zones/detect", {
      params: { lat, lng },
    }),
  /** Public: list active zones (for onboarding dropdowns). */
  getPublicZones: (params = {}, config = {}) =>
    apiClient.get("/food/zones/public", { params: params ?? {}, ...config }),
};

/** Public geocode proxies — Google API key stays on the backend. */
export const geocodeAPI = {
  reverse: (lat, lng, params = {}, config = {}) =>
    apiClient.get("/food/geocode/reverse", {
      params: { lat, lng, ...params },
      ...config,
    }),
  place: (placeId, config = {}) =>
    apiClient.get("/food/geocode/place", {
      params: { place_id: placeId },
      ...config,
    }),
  nearby: (body, config = {}) => apiClient.post("/food/geocode/nearby", body, config),
  textSearch: (body, config = {}) =>
    apiClient.post("/food/geocode/text-search", body, config),
};
export const uploadAPI = {
  /**
   * Upload a single image. Backend converts it to WebP and stores it on the
   * live server at /var/www/uploads (local backends forward there automatically).
   * Pass replaceUrl so the previous file is deleted after the new one is saved.
   */
  uploadMedia: async (file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }

    const prepared = await prepareUploadFile(file, options.compress);
    const formData = new FormData();
    formData.append("file", prepared);
    if (options.folder) {
      formData.append("folder", options.folder);
    }
    if (options.replaceUrl) {
      formData.append("replaceUrl", options.replaceUrl);
    }

    return apiClient.post("/uploads/image", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
      ...(typeof options.onUploadProgress === "function"
        ? { onUploadProgress: options.onUploadProgress }
        : {}),
    });
  },
  deleteMedia: (url) => {
    if (!url) return Promise.resolve();
    return apiClient.delete("/uploads", { data: { url } });
  },
};
/** Order API (user app – Bearer USER token). Minimal calls: single create/verify, list/details cached by caller. */
export const foodCartAPI = {
  getCart: () => apiClient.get("/food/cart", { contextModule: "user" }),
  addItem: (payload) =>
    apiClient.post("/food/cart/items", payload ?? {}, {
      contextModule: "user",
    }),
  updateItem: (lineId, payload) =>
    apiClient.patch(
      `/food/cart/items/${encodeURIComponent(String(lineId))}`,
      payload ?? {},
      { contextModule: "user" },
    ),
  removeItem: (lineId) =>
    apiClient.delete(`/food/cart/items/${encodeURIComponent(String(lineId))}`, {
      contextModule: "user",
    }),
  clearCart: () =>
    apiClient.delete("/food/cart/clear", { contextModule: "user" }),
  setCoupon: (couponCode) =>
    apiClient.put(
      "/food/cart/coupon",
      { couponCode: couponCode || "" },
      { contextModule: "user" },
    ),
};

export const orderAPI = {
  calculateOrder: (payload) =>
    apiClient.post("/food/orders/calculate", payload ?? {}, {
      contextModule: "user",
    }),
  initiateOnlinePayment: (payload) =>
    apiClient.post("/food/orders/initiate-online-payment", payload ?? {}, {
      contextModule: "user",
    }),
  createOrder: (payload) =>
    apiClient.post("/food/orders", payload ?? {}, { contextModule: "user" }),
  verifyPayment: (body) =>
    apiClient.post("/food/orders/verify-payment", body ?? {}, {
      contextModule: "user",
    }),
  // Pay-at-Pickup: pay an existing unpaid takeaway order when reaching the counter.
  initiatePickupPayment: (orderId) =>
    apiClient.post(`/food/orders/${orderId}/pay-initiate`, {}, {
      contextModule: "user",
    }),
  verifyPickupPayment: (orderId, body) =>
    apiClient.post(`/food/orders/${orderId}/pay-verify`, body ?? {}, {
      contextModule: "user",
    }),
  getOrders: (params = {}) =>
    apiClient
      .get("/food/orders", {
        params: { limit: 20, page: 1, ...params },
        contextModule: "user",
      })
      .then((res) => {
        const payload = res?.data?.data;

        // Normalize backend paginated shape:
        // { data: { data: [...], meta: { total, page, limit, totalPages } } }
        // into UI-friendly:
        // { data: { orders: [...], pagination: { total, page, limit, pages } } }
        if (
          payload &&
          typeof payload === "object" &&
          Array.isArray(payload.data) &&
          payload.meta &&
          typeof payload.meta === "object"
        ) {
          const meta = payload.meta;
          return {
            ...res,
            data: {
              ...res.data,
              data: {
                ...payload,
                orders: payload.data,
                pagination: {
                  total: Number(meta.total || 0),
                  page: Number(meta.page || 1),
                  limit: Number(meta.limit || params.limit || 20),
                  pages: Number(meta.totalPages || 1),
                },
              },
            },
          };
        }

        return res;
      }),
  getOrderDetails: (() => {
    const inFlight = new Map();
    const cache = new Map();
    /** Dedupes overlapping calls (StrictMode, poll + socket) without hiding fresh data for long. */
    const CACHE_MS = 800;

    return (orderId, options = {}) => {
      const key = String(orderId ?? "").trim();
      if (!key) {
        return Promise.reject(new Error("orderId required"));
      }

      const force = options.force === true;
      const now = Date.now();
      if (!force) {
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_MS) {
          return Promise.resolve(hit.res);
        }
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const p = apiClient
        .get(`/food/orders/${key}`, { contextModule: "user" })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  /** GET /food/orders/:id/drop-otp — delivery OTP shown to the customer. */
  getOrderDropOtp: (orderId) =>
    apiClient.get(`/food/orders/${String(orderId)}/drop-otp`, { contextModule: "user" }),
  cancelOrder: (orderId, body = {}) =>
    apiClient.patch(`/food/orders/${String(orderId)}/cancel`, body ?? {}, {
      contextModule: "user",
    }),
  updateOrderInstructions: (orderId, instructions) =>
    apiClient.patch(`/food/orders/${String(orderId)}/instructions`, { instructions }, {
      contextModule: "user",
    }),
  submitOrderRatings: (orderId, body = {}) =>
    apiClient.patch(`/food/orders/${String(orderId)}/ratings`, body ?? {}, { contextModule: "user" }),
  /** Submit a complaint for an order (user). */
  submitComplaint: (payload) =>
    apiClient.post(
      "/food/user/support/ticket",
      {
        type: "order",
        orderId: payload.orderId,
        issueType: payload.complaintType,
        description: payload.subject ? `${payload.subject}: ${payload.description}` : payload.description,
      },
      { contextModule: "user" }
    ),
};

const DINING_BOOKINGS_STORAGE_KEY = "food_dining_bookings_v1";
const safeJsonParse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const getStoredBookings = () => {
  if (typeof localStorage === "undefined") return [];
  const parsed = safeJsonParse(
    localStorage.getItem(DINING_BOOKINGS_STORAGE_KEY) || "[]",
    [],
  );
  return Array.isArray(parsed) ? parsed : [];
};

const saveStoredBookings = (bookings) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    DINING_BOOKINGS_STORAGE_KEY,
    JSON.stringify(Array.isArray(bookings) ? bookings : []),
  );
};

const getStoredModuleUser = (module) => {
  if (typeof localStorage === "undefined") return null;
  const parsed = safeJsonParse(
    localStorage.getItem(`${module}_user`) || "null",
    null,
  );
  return parsed && typeof parsed === "object" ? parsed : null;
};

const normalizeName = (restaurant) =>
  restaurant?.name || restaurant?.restaurantName || "Restaurant";

const normalizeRestaurantShape = (restaurant) => {
  if (!restaurant || typeof restaurant !== "object") return null;
  return {
    _id: restaurant?._id || restaurant?.id || null,
    id: restaurant?.id || restaurant?._id || null,
    restaurantId: restaurant?.restaurantId || restaurant?._id || restaurant?.id || null,
    restaurantNameNormalized:
      restaurant?.restaurantNameNormalized || restaurant?.slug || "",
    slug: restaurant?.slug || "",
    name: normalizeName(restaurant),
    restaurantName: restaurant?.restaurantName || normalizeName(restaurant),
    profileImage: restaurant?.profileImage || null,
    coverImages: Array.isArray(restaurant?.coverImages)
      ? restaurant.coverImages
      : [],
    menuImages: Array.isArray(restaurant?.menuImages) ? restaurant.menuImages : [],
    image:
      restaurant?.coverImages?.[0]?.url ||
      restaurant?.coverImages?.[0] ||
      restaurant?.menuImages?.[0]?.url ||
      restaurant?.menuImages?.[0] ||
      restaurant?.image ||
      restaurant?.profileImage?.url ||
      (typeof restaurant?.profileImage === "string"
        ? restaurant.profileImage
        : ""),
    location: restaurant?.location || null,
  };
};

const collectRestaurantBookingKeys = (candidate) => {
  if (!candidate) return [];

  const raw =
    typeof candidate === "object"
      ? candidate
      : { _id: candidate, id: candidate, restaurantId: candidate };

  // Pull values from current object and nested restaurant object
  const values = [
    raw?._id,
    raw?.id,
    raw?.restaurantId,
    raw?.slug,
    raw?.name,
    raw?.restaurantName,
    raw?.restaurantNameNormalized,
    
    // Check nested restaurant object if it exists
    raw?.restaurant?._id,
    raw?.restaurant?.id,
    raw?.restaurant?.restaurantId,
    raw?.restaurant?.slug,
    raw?.restaurant?.name,
    raw?.restaurant?.restaurantName,
    raw?.restaurant?.restaurantNameNormalized,
    
    // Check restaurantRef if it exists
    raw?.restaurantRef?._id,
    raw?.restaurantRef?.id,
    raw?.restaurantRef?.restaurantId,
    raw?.restaurantRef?.slug,
    raw?.restaurantRef?.name,
  ];

  return Array.from(
    new Set(
      values
        .map((value) => {
          if (value === null || value === undefined) return "";
          if (typeof value === "object") return value._id || value.id || "";
          // Case-insensitive matching for local dev robustness
          return String(value).trim().toLowerCase();
        })
        .filter(Boolean),
    ),
  );
};

const buildLocalBookingId = () =>
  `dbook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const buildDisplayBookingId = () => `TB${Date.now().toString().slice(-8)}`;

const getCurrentUserForBookings = async () => {
  const storedUser = getStoredModuleUser("user");
  if (storedUser) return storedUser;

  try {
    const me = await getUserMeOnce();
    return me?.data?.data?.user || me?.data?.user || me?.data?.data || null;
  } catch {
    return null;
  }
};

const normalizeBookingUser = (candidate) => {
  if (!candidate || typeof candidate !== "object") return null;
  const name = String(candidate?.name || candidate?.fullName || "").trim();
  const phone = String(
    candidate?.phone || candidate?.mobile || candidate?.phoneNumber || "",
  ).trim();
  const email = String(candidate?.email || "").trim();

  return {
    _id: candidate?._id || candidate?.id || null,
    id: candidate?.id || candidate?._id || null,
    name,
    phone,
    email,
  };
};

const byLatest = (a, b) =>
  new Date(b?.createdAt || b?.date || 0).getTime() -
  new Date(a?.createdAt || a?.date || 0).getTime();

export const diningAPI = {
  getCategories: (params = {}) =>
    apiClient.get("/food/dining/categories/public", { params }),
  getRestaurants: (params = {}) =>
    apiClient.get("/food/dining/restaurants/public", { params }),
  getHeroBanners: () => apiClient.get("/food/hero-banners/dining/public"),
  getRestaurantBySlug: (slug) =>
    apiClient.get(`/food/restaurant/restaurants/${String(slug)}`),
  getOfferBanners: () => Promise.resolve({ data: { success: true, data: [] } }),
  getStories: () => Promise.resolve({ data: { success: true, data: [] } }),
  getBankOffers: () => Promise.resolve({ data: { success: true, data: [] } }),
  getBookings: () => apiClient.get("/food/dining/bookings", {
    contextModule: 'user'
  }),
  getBookingById: (id) => apiClient.get(`/food/dining/bookings/${id}`, {
    contextModule: 'user'
  }),
  getRestaurantBookings: (restaurantRef) => {
    const idOrSlug = restaurantRef?._id || restaurantRef?.id || restaurantRef?.restaurantId || (typeof restaurantRef === 'string' ? restaurantRef : '');
    const isRestaurantPortal = typeof window !== 'undefined' && window.location.pathname.includes('/restaurant');
    return apiClient.get(`/food/dining/bookings/by-restaurant/${idOrSlug}`, {
      contextModule: isRestaurantPortal ? 'restaurant' : 'user'
    });
  },
  updateBookingStatusRestaurant: (bookingId, status) =>
    apiClient.patch(`/food/dining/bookings/${bookingId}/status`, { status }, {
      contextModule: 'restaurant'
    }),
  cancelBooking: (bookingId) =>
    apiClient.patch(`/food/dining/bookings/${bookingId}/cancel`, {}, {
      contextModule: 'user'
    }),
  createReview: (payload = {}) => {
    const bookingId = payload?.bookingId;
    return apiClient.post(`/food/dining/bookings/${bookingId}/review`, {
      rating: payload?.rating,
      comment: payload?.comment
    }, {
      contextModule: 'user'
    });
  },
  createBooking: (payload = {}) =>
    apiClient.post("/food/dining/bookings", payload, {
      contextModule: 'user'
    }),
};
export const heroBannerAPI = createStubAPI();
export const publicAPI = createStubAPI();
