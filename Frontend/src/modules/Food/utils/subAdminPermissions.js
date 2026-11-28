/**
 * Sub-admin permissions are derived from adminSidebarMenu.
 * Add a new sidebar link/subItem → it appears automatically in the permission matrix.
 * Existing path→key mappings stay stable so already-saved permissions keep working.
 */
import { adminSidebarMenu } from "@food/utils/adminSidebarMenu"

export const SUB_ADMIN_PERMISSION_ACTIONS = ["view", "create", "edit", "delete"]

const SKIP_SECTION_LABELS = new Set(["ADMIN ACCESS"])

/** Stable keys for paths that already exist in DB permissions (do not rename). */
const STABLE_KEYS_BY_PATH = {
  "/admin/food": "dashboard",
  "/admin/food/point-of-sale": "point_of_sale",
  "/admin/food/food-approval": "food_approval",
  "/admin/food/foods": "restaurant_foods_list",
  "/admin/food/addons": "restaurant_addons_list",
  "/admin/food/pricing": "pricing_management",
  "/admin/food/onboarding-pricing": "restaurant_onboarding_pricing",
  "/admin/food/categories": "category",
  "/admin/food/zone-setup": "zone_setup",
  "/admin/food/restaurants": "restaurants_list",
  "/admin/food/restaurants/joining-request": "new_joining_request",
  "/admin/food/restaurants/top-restaurants": "top_restaurants",
  "/admin/food/restaurants/commission": "restaurant_commission",
  "/admin/food/restaurants/reviews": "restaurant_reviews",
  "/admin/food/restaurants/complaints": "restaurant_complaints",
  "/admin/food/restaurants/settings": "restaurant_settings",
  "/admin/food/restaurants/earnings": "restaurant_earning",
  "/admin/food/orders": "orders",
  "/admin/food/orders/all": "orders",
  "/admin/food/orders/pending": "orders",
  "/admin/food/orders/processing": "orders",
  "/admin/food/orders/food-on-the-way": "orders",
  "/admin/food/orders/delivered": "orders",
  "/admin/food/orders/canceled": "orders",
  "/admin/food/orders/restaurant-cancelled": "orders",
  "/admin/food/orders/payment-failed": "orders",
  "/admin/food/orders/refunded": "orders",
  "/admin/food/orders/offline-payments": "orders",
  "/admin/food/refund-requests": "orders",
  "/admin/food/order-refunds": "orders",
  "/admin/food/order-detect-delivery": "order_detect_delivery",
  "/admin/food/coupons": "restaurant_coupons_offers",
  "/admin/food/customers": "customers",
  "/admin/food/support-tickets": "support_tickets",
  "/admin/food/delivery-cash-limit": "delivery_cash_limit",
  "/admin/food/multiorder-setting": "multiorder_setting",
  "/admin/food/fee-settings": "delivery_platform_fee",
  "/admin/food/cash-confirmations": "cash_confirmations",
  "/admin/food/cash-limit-settlement": "cash_limit_settlement",
  "/admin/food/delivery-withdrawal": "delivery_withdrawal",
  "/admin/food/delivery-boy-wallet": "delivery_boy_wallet",
  "/admin/food/delivery-boy-commission": "delivery_boy_payout",
  "/admin/food/delivery-emergency-help": "delivery_emergency_help",
  "/admin/food/delivery-support-tickets": "delivery_support_tickets",
  "/admin/food/delivery-partners/join-request": "deliveryman_join_request",
  "/admin/food/delivery-partners": "deliveryman_list",
  "/admin/food/delivery-partners/reviews": "deliveryman_reviews",
  "/admin/food/delivery-partners/bonus": "deliveryman_bonus",
  "/admin/food/delivery-partners/earning-addon": "earning_addon",
  "/admin/food/delivery-partners/earning-addon-history": "earning_addon_history",
  "/admin/food/delivery-partners/earnings": "delivery_earning",
  "/admin/food/contact-messages": "user_feedback",
  "/admin/food/safety-emergency-reports": "safety_emergency_reports",
  "/admin/food/transaction-report": "transaction_report",
  "/admin/food/order-report/regular": "order_report",
  "/admin/food/order-report": "order_report",
  "/admin/food/tax-report": "tax_report",
  "/admin/food/restaurant-report": "restaurant_report",
  "/admin/food/customer-report/feedback-experience": "feedback_experience",
  "/admin/food/restaurant-withdraws": "restaurant_withdraws",
  "/admin/food/restaurant-wallet": "restaurant_wallet",
  "/admin/food/hero-banner-management": "landing_page_management",
  "/admin/food/promotional-banner": "landing_page_management",
  "/admin/food/dining-management": "dining_banners",
  "/admin/food/dining-list": "dining_list",
  "/admin/food/dining-requests": "dining_category_request",
  "/admin/food/broadcast-notification": "broadcast_notification",
  "/admin/food/business-setup": "business_setup",
  "/admin/food/customization-settings": "customization_settings",
  "/admin/food/archived-accounts": "archived_accounts",
  "/admin/food/pages-social-media/about": "about_us",
  "/admin/food/pages-social-media/terms": "terms_conditions",
  "/admin/food/pages-social-media/privacy": "privacy_policy",
  "/admin/food/pages-social-media/support": "support_cms",
  "/admin/food/pages-social-media/refund": "refund_policy",
  "/admin/food/pages-social-media/shipping": "shipping_policy",
  "/admin/food/pages-social-media/cancellation": "cancellation_policy",
}

function autoKeyFromPath(path) {
  const cleaned = String(path || "").replace(/\/+$/, "") || "/"
  if (cleaned === "/admin/food" || cleaned === "/admin") return "dashboard"
  const rest = cleaned.replace(/^\/admin\/food\/?/, "")
  if (!rest) return "dashboard"
  return rest
    .replace(/\//g, "_")
    .replace(/-/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase()
}

function pathToKey(path) {
  const cleaned = String(path || "").replace(/\/+$/, "") || "/"
  if (STABLE_KEYS_BY_PATH[cleaned]) return STABLE_KEYS_BY_PATH[cleaned]
  return autoKeyFromPath(cleaned)
}

function pushModule(modules, seenKeys, label, path) {
  if (!path || !label) return
  if (String(path).includes("/sub-admins")) return

  const cleaned = String(path).replace(/\/+$/, "") || path
  const key = pathToKey(cleaned)

  // Group order status links under single "Orders" module
  if (key === "orders") {
    if (seenKeys.has("orders")) {
      const existing = modules.find((m) => m.key === "orders")
      if (existing) {
        if (!existing.pathPrefixes.includes("/admin/food/orders")) existing.pathPrefixes.push("/admin/food/orders")
        if (!existing.pathPrefixes.includes("/admin/food/refund-requests")) existing.pathPrefixes.push("/admin/food/refund-requests")
        if (!existing.pathPrefixes.includes("/admin/food/order-refunds")) existing.pathPrefixes.push("/admin/food/order-refunds")
      }
      return
    }
    seenKeys.add("orders")
    modules.push({
      key: "orders",
      label: "Orders",
      pathPrefixes: ["/admin/food/orders", "/admin/food/refund-requests", "/admin/food/order-refunds"],
    })
    return
  }

  // Group landing page / promotional banner links
  if (key === "landing_page_management") {
    if (seenKeys.has("landing_page_management")) {
      const existing = modules.find((m) => m.key === "landing_page_management")
      if (existing) {
        if (!existing.pathPrefixes.includes("/admin/food/hero-banner-management")) existing.pathPrefixes.push("/admin/food/hero-banner-management")
        if (!existing.pathPrefixes.includes("/admin/food/promotional-banner")) existing.pathPrefixes.push("/admin/food/promotional-banner")
      }
      return
    }
    seenKeys.add("landing_page_management")
    modules.push({
      key: "landing_page_management",
      label: String(label).trim(),
      pathPrefixes: ["/admin/food/hero-banner-management", "/admin/food/promotional-banner"],
    })
    return
  }

  if (!key || seenKeys.has(key)) return
  seenKeys.add(key)
  modules.push({
    key,
    label: String(label).trim(),
    pathPrefixes: [cleaned],
  })
}

/** Build permission modules live from the current sidebar menu. */
export function getSubAdminPermissionModules(menu = adminSidebarMenu) {
  const modules = []
  const seenKeys = new Set()

  for (const item of menu || []) {
    if (item.type === "link") {
      pushModule(modules, seenKeys, item.label, item.path)
      continue
    }
    if (item.type !== "section") continue
    if (SKIP_SECTION_LABELS.has(String(item.label || "").toUpperCase())) continue

    for (const sub of item.items || []) {
      if (sub.type === "link") {
        pushModule(modules, seenKeys, sub.label, sub.path)
      } else if (sub.type === "expandable") {
        // Prefer leaf routes; for Orders group under one row
        for (const si of sub.subItems || []) {
          pushModule(modules, seenKeys, si.label, si.path)
        }
      }
    }
  }

  return modules
}

/** Snapshot at import time (fine for most callers); prefer getSubAdminPermissionModules() in UI. */
export const SUB_ADMIN_PERMISSION_MODULES = getSubAdminPermissionModules()

export function emptyPermissionActions() {
  return { view: false, create: false, edit: false, delete: false }
}

export function normalizePermissions(input = {}, modules = getSubAdminPermissionModules()) {
  const result = {}
  for (const mod of modules) {
    const raw = input?.[mod.key] || {}
    result[mod.key] = {
      view: Boolean(raw.view),
      create: Boolean(raw.create),
      edit: Boolean(raw.edit),
      delete: Boolean(raw.delete),
    }
  }
  for (const [key, raw] of Object.entries(input || {})) {
    if (result[key] || !raw || typeof raw !== "object") continue
    result[key] = {
      view: Boolean(raw.view),
      create: Boolean(raw.create),
      edit: Boolean(raw.edit),
      delete: Boolean(raw.delete),
    }
  }
  return result
}

export function isFullAdmin(user) {
  return String(user?.role || "").toUpperCase() === "ADMIN"
}

export function isSubAdmin(user) {
  return String(user?.role || "").toUpperCase() === "SUB_ADMIN"
}

export function findModuleKeyForPath(pathname, modules = getSubAdminPermissionModules()) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/"
  let best = null
  let bestLen = -1

  for (const mod of modules) {
    for (const prefix of mod.pathPrefixes) {
      const p = String(prefix).replace(/\/+$/, "") || "/"
      const isDashboard = p === "/admin/food"
      const matches = isDashboard
        ? path === "/admin/food" || path === "/admin"
        : path === p || path.startsWith(`${p}/`)
      if (matches && p.length > bestLen) {
        best = mod.key
        bestLen = p.length
      }
    }
  }
  return best
}

/** Full ADMIN always allowed. SUB_ADMIN needs view (or any action) on matching module. */
export function canAccessPath(user, pathname) {
  if (!user) return false
  if (isFullAdmin(user)) return true
  if (!isSubAdmin(user)) return false

  const path = String(pathname || "")
  // Profile & Settings always available — same navbar options as full admin
  if (path.includes("/admin/food/profile") || path.includes("/admin/food/settings")) {
    return true
  }
  if (path.includes("/admin/food/sub-admins")) return false

  const key = findModuleKeyForPath(pathname)
  if (!key) return false
  const perms = user.permissions?.[key]
  return Boolean(perms?.view || perms?.create || perms?.edit || perms?.delete)
}

/**
 * Granular action check.
 * - view: true if view OR any write flag (so writers can open the page)
 * - create/edit/delete: must be explicitly granted (view alone is never enough)
 */
export function hasPermission(user, pathnameOrKey, action = "view") {
  if (!user) return false
  if (isFullAdmin(user)) return true
  if (!isSubAdmin(user)) return false

  const target = String(pathnameOrKey || "")
  if (target.includes("/admin/food/profile") || target.includes("/admin/food/settings")) {
    return true
  }
  if (target.includes("/admin/food/sub-admins") || target === "sub_admins") return false

  // Direct module key check or path prefix resolution
  let key = target
  if (!user.permissions?.[key]) {
    key = findModuleKeyForPath(target)
  }
  if (!key) return false
  const perms = user.permissions?.[key]
  if (!perms) return false

  if (action === "view") {
    return Boolean(perms.view || perms.create || perms.edit || perms.delete)
  }
  return Boolean(perms[action])
}

export function getFirstAllowedPath(user) {
  if (!user || isFullAdmin(user)) return "/admin/food"
  for (const mod of getSubAdminPermissionModules()) {
    const perms = user.permissions?.[mod.key]
    if (perms?.view || perms?.create || perms?.edit || perms?.delete) {
      return mod.pathPrefixes[0]
    }
  }
  return "/admin/food/profile"
}

export function canAccessSidebarPath(user, path) {
  return canAccessPath(user, path)
}

/** Filter sidebar menu for the logged-in admin/sub-admin. */
export function filterSidebarMenuByPermissions(menu, user) {
  if (!user || isFullAdmin(user)) return menu
  if (!isSubAdmin(user)) return menu

  const canPath = (path) => canAccessSidebarPath(user, path)

  return menu
    .map((item) => {
      if (item.type === "link") {
        return canPath(item.path) ? item : null
      }
      if (item.type === "section") {
        if (String(item.label || "").toUpperCase().includes("ADMIN ACCESS")) {
          return null
        }
        const items = (item.items || [])
          .map((sub) => {
            if (sub.type === "link") {
              return canPath(sub.path) ? sub : null
            }
            if (sub.type === "expandable") {
              const subItems = (sub.subItems || []).filter((si) => canPath(si.path))
              if (subItems.length === 0) return null
              return { ...sub, subItems }
            }
            return null
          })
          .filter(Boolean)
        if (items.length === 0) return null
        return { ...item, items }
      }
      return item
    })
    .filter(Boolean)
}

export { useAdminPermissions } from "@food/hooks/useAdminPermissions"
