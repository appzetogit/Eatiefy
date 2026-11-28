/**
 * Central API client for backend (auth and future APIs).
 * - baseURL from VITE_API_BASE_URL (e.g. http://localhost:5000/api/v1)
 * - When baseURL ends with /api/v1, request paths must NOT include /v1 (use /food/..., /auth/...)
 * - Attaches Bearer token (user or admin based on request URL)
 * - On 401: attempts refresh, retries once; on refresh failure logs out
 */

import axios from "axios";

// Prefer explicit env. If not set, default to /api/v1 so the Vite proxy can forward to backend.
// This avoids hardcoding ports like 5000 that may conflict with local setups.
const baseURL =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, "")
    : "/api/v1";

const apiClient = axios.create({
  baseURL: baseURL || undefined,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

function getModuleFromUrl(url = "") {
  const u = typeof url === "string" ? url : (url?.url || "");
  if (!u) return "user";
  
  const normalized = u.toLowerCase();
  
  // Admin detection
  if (
    normalized.includes("/admin/") || 
    normalized.includes("/food/admin/") || 
    normalized.includes("/food/auth/admin") || 
    normalized.includes("/auth/admin") || 
    normalized.includes("admin/login")
  ) return "admin";
  
  // Delivery detection - Catch all delivery-specific functional and auth routes
  if (
    normalized.includes("/food/delivery") || 
    normalized.includes("/auth/delivery") || 
    normalized.includes("/delivery/")
  ) return "delivery";
  
  // Restaurant detection - Catch all restaurant-specific functional and auth routes
  if (
    normalized.includes("/food/restaurant/") || 
    normalized.includes("/auth/restaurant") || 
    normalized.includes("/restaurant/")
  ) {
    // Exception: /food/restaurants (plural) is usually a public user app route
    if (normalized.includes("/food/restaurants") && !normalized.includes("/food/restaurant/")) {
       return "user";
    }
    return "restaurant";
  }
  
  return "user";
}

/**
 * True when the path itself names a module. Shared endpoints such as
 * /uploads/image carry no module in the URL, so URL sniffing alone would
 * silently fall through to "user" and send the wrong token.
 */
function urlNamesModule(url = "") {
  const u = typeof url === "string" ? url : (url?.url || "");
  if (!u) return false;
  const normalized = u.toLowerCase();
  return (
    normalized.includes("/admin") ||
    normalized.includes("/delivery") ||
    normalized.includes("/restaurant") ||
    normalized.includes("/user")
  );
}

/** Which app the browser is currently in — the fallback for shared endpoints. */
function getModuleFromLocation() {
  try {
    const path = (window?.location?.pathname || "").toLowerCase();
    if (path.startsWith("/admin")) return "admin";
    if (path.startsWith("/food/restaurant")) return "restaurant";
    if (path.startsWith("/food/delivery")) return "delivery";
  } catch {
    /* SSR / non-browser */
  }
  return "user";
}

function getModuleFromConfig(config) {
  if (config?.contextModule) return config.contextModule;
  const url = config?.url;
  // Module-agnostic endpoints (uploads, etc.) follow the active app instead.
  if (!urlNamesModule(url)) return getModuleFromLocation();
  return getModuleFromUrl(url);
}

function isCredentialRequest(config) {
  const u = String(typeof config === "string" ? config : config?.url || "").toLowerCase();
  return (
    /\/auth\/(user|restaurant|delivery)\/(request-otp|verify-otp|reapply)/.test(u) ||
    /\/auth\/admin\/(login|forgot-password)/.test(u) ||
    u.includes("/auth/refresh-token")
  );
}

function getAccessToken(config) {
  const module = getModuleFromConfig(config);
  const key = `${module}_accessToken`;
  try {
    // 1. Try module-specific token first
    const moduleToken = localStorage.getItem(key);
    if (moduleToken) return moduleToken;

    // 2. Fallback to generic token if module-specific token is missing
    return localStorage.getItem("accessToken") || null;
  } catch {
    return null;
  }
}

function getRefreshToken(module) {
  try {
    // 1. Try module-specific refresh token
    const moduleRefreshToken = localStorage.getItem(`${module}_refreshToken`);
    if (moduleRefreshToken) return moduleRefreshToken;

    // 2. Fallback to generic refresh token
    return localStorage.getItem("refreshToken") || null;
  } catch {
    return null;
  }
}

function clearModuleAuth(module) {
  try {
    localStorage.removeItem(`${module}_accessToken`);
    localStorage.removeItem(`${module}_refreshToken`);
    localStorage.removeItem(`${module}_authenticated`);
    localStorage.removeItem(`${module}_user`);
  } catch (_) {}
}

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeToRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(newToken, module) {
  refreshSubscribers.forEach((cb) => cb(newToken, module));
  refreshSubscribers = [];
}

function onRefreshFailed(module) {
  clearModuleAuth(module);
  // Fail any queued requests that were waiting for this refresh
  refreshSubscribers.forEach((cb) => cb(null, module));
  refreshSubscribers = [];
  
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("authRefreshFailed", { detail: { module } }));
  }
}

function isLocalDevBrowser() {
  try {
    if (typeof window === "undefined") return false;
    if (import.meta.env?.DEV) return true;
    const host = String(window.location.hostname || "").toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

apiClient.interceptors.request.use(
  (config) => {
    config.contextModule = getModuleFromConfig(config);

    // If sending FormData, let the browser set proper multipart boundary.
    if (config.data instanceof FormData) {
      if (config.headers && config.headers["Content-Type"]) {
        delete config.headers["Content-Type"];
      }
    }

    // Same live backend: mark local frontend so maintenance APIs stay open for dev.
    if (isLocalDevBrowser()) {
      config.headers["X-Eatiefy-Client"] = "local-dev";
    }

    const token = getAccessToken(config);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (err) => Promise.reject(err)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (err) => {
    const original = err?.config;
    if (err?.response?.status === 429) {
      return Promise.reject(err);
    }
    if (err?.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(err);
    }
    // A 401 from a credential endpoint (wrong OTP / password) is a normal
    // "invalid input" answer, not an expired session. Treating it as one wiped
    // the stored session and bounced the user to the login page after a single
    // wrong OTP. The calling screen shows its own "Invalid OTP" message.
    if (isCredentialRequest(original)) {
      return Promise.reject(err);
    }
    // Same resolution as the request interceptor, so a shared endpoint refreshes
    // the module the user is actually signed into.
    const module = getModuleFromConfig(original);
    const refreshToken = getRefreshToken(module);
    if (!refreshToken) {
      onRefreshFailed(module);
      return Promise.reject(err);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh((newToken) => {
          if (newToken) {
            original.headers.Authorization = `Bearer ${newToken}`;
            resolve(apiClient(original));
          } else {
            reject(err);
          }
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      // Use relative URL so this works both with an explicit baseURL and with a dev proxy.
      // Use plain axios to avoid interceptor recursion.
      const refreshUrl = baseURL ? `${baseURL}/food/auth/refresh-token` : "/api/v1/food/auth/refresh-token";
      const { data } = await axios.post(refreshUrl, { refreshToken }, { timeout: 10000 });
      const newAccessToken = data?.data?.accessToken || data?.accessToken;
      if (newAccessToken) {
        try {
          localStorage.setItem(`${module}_accessToken`, newAccessToken);
          // Dispatch a custom event specifically for the module that refreshed
          window.dispatchEvent(new CustomEvent("authRefreshed", { 
            detail: { module, token: newAccessToken } 
          }));
        } catch (_) {}
        onRefreshed(newAccessToken, module);
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(original);
      }
    } catch (refreshErr) {
      const status = refreshErr?.response?.status;
      // Only log out if the server explicitly rejected the refresh token
      if (status === 401 || status === 403 || status === 400) {
        onRefreshFailed(module);
      } else {
        // Network error or server error - don't clear auth, just fail the queue
        refreshSubscribers.forEach((cb) => cb(null, module));
        refreshSubscribers = [];
      }
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }

    onRefreshFailed(module);
    return Promise.reject(err);
  }
);

export default apiClient;
