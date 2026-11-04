/**
 * Product feature flags.
 *
 * Takeaway and Dining are controlled at runtime from Admin → Customization
 * Settings (`takeaway_enabled` / `dining_enabled`). When a module is off, its
 * routes, tabs and entry points are hidden across the user, restaurant and
 * admin apps.
 *
 * The values are seeded synchronously from the cached customization settings so
 * module-level reads and the first render agree, then refreshed when the public
 * settings call resolves.
 */

const STORAGE_KEY = "ometto_customization_settings";

const DEFAULTS = {
  // Takeaway ships enabled; dining shipped off behind the old build-time flag.
  takeaway_enabled: true,
  dining_enabled: false,
  sweets_enabled: false,
};

const readCachedSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const pickFlags = (settings) => {
  const source = settings && typeof settings === "object" ? settings : {};
  const next = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof source[key] === "boolean") next[key] = source[key];
  }
  return next;
};

let snapshot = pickFlags(readCachedSettings());

const listeners = new Set();

const emit = () => {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      /* a bad subscriber must not break the others */
    }
  }
};

/** Replace the in-memory flags from a settings payload. No-op when unchanged. */
export const applyModuleAccessSettings = (settings) => {
  const next = pickFlags(settings);
  const changed = Object.keys(DEFAULTS).some((key) => next[key] !== snapshot[key]);
  if (!changed) return snapshot;
  snapshot = next;
  emit();
  return snapshot;
};

/** Re-read from the shared localStorage cache (after another tab or hook writes it). */
export const refreshModuleAccessFromCache = () => applyModuleAccessSettings(readCachedSettings());

export const getModuleAccess = () => snapshot;
export const isTakeawayEnabled = () => snapshot.takeaway_enabled === true;
export const isDiningEnabled = () => snapshot.dining_enabled === true;
export const isSweetsEnabled = () => snapshot.sweets_enabled === true;

export const subscribeModuleAccess = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let bootstrapPromise = null;

/**
 * Fetch the public customization settings once per page load.
 *
 * The user app also loads these via useLocation, but the admin and restaurant
 * apps do not import that hook, so the flags are fetched here to keep every app
 * consistent. Resolves immediately after the first call.
 */
export const ensureModuleAccessLoaded = () => {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const { default: apiClient } = await import("@food/api/axios");
      const response = await apiClient.get("/food/public/customization-settings");
      const settings = response?.data?.data || response?.data;
      if (settings && typeof settings === "object") {
        applyModuleAccessSettings(settings);
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const parsed = raw ? JSON.parse(raw) : {};
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, ...settings }));
        } catch {
          /* cache is best-effort */
        }
      }
    } catch {
      // Offline or endpoint down: keep the cached/default flags.
    }
    return snapshot;
  })();

  return bootstrapPromise;
};

if (typeof window !== "undefined") {
  ensureModuleAccessLoaded();
  // useLocation's shared fetch fires this once the public settings land.
  window.addEventListener("customizationSettingsLoaded", refreshModuleAccessFromCache);
  // Admin toggling in another tab.
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === STORAGE_KEY) refreshModuleAccessFromCache();
  });
  // Same-tab admin save.
  window.addEventListener("customizationSettingsUpdated", refreshModuleAccessFromCache);
}

/**
 * @deprecated Build-time snapshot kept for module-scope consumers that cannot
 * subscribe. Prefer `isDiningEnabled()` or the `useModuleAccess()` hook —
 * this constant does not update until the next page load.
 */
export const DINING_ENABLED = snapshot.dining_enabled === true;
