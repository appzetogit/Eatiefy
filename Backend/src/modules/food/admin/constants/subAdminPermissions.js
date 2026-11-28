/**
 * Permission modules for Sub Admins — mirrors admin sidebar options.
 * Keys are stable; labels match sidebar display names.
 */
export const SUB_ADMIN_PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete'];

export const SUB_ADMIN_PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard', pathPrefixes: ['/admin/food'] },
  { key: 'point_of_sale', label: 'Point of Sale', pathPrefixes: ['/admin/food/point-of-sale'] },
  { key: 'food_approval', label: 'Food Approval', pathPrefixes: ['/admin/food/food-approval'] },
  { key: 'restaurant_foods_list', label: 'Restaurant Foods List', pathPrefixes: ['/admin/food/foods'] },
  { key: 'restaurant_addons_list', label: 'Restaurant Addons List', pathPrefixes: ['/admin/food/addons'] },
  { key: 'pricing_management', label: 'Pricing Management', pathPrefixes: ['/admin/food/pricing'] },
  { key: 'category', label: 'Category', pathPrefixes: ['/admin/food/categories'] },
  { key: 'zone_setup', label: 'Zone Setup', pathPrefixes: ['/admin/food/zone-setup'] },
  { key: 'restaurants_list', label: 'Restaurants List', pathPrefixes: ['/admin/food/restaurants'] },
  { key: 'new_joining_request', label: 'New Joining Request', pathPrefixes: ['/admin/food/restaurants/joining-request'] },
  { key: 'top_restaurants', label: 'Top Restaurants', pathPrefixes: ['/admin/food/restaurants/top-restaurants'] },
  { key: 'restaurant_commission', label: 'Restaurant Commission', pathPrefixes: ['/admin/food/restaurants/commission'] },
  { key: 'restaurant_reviews', label: 'Restaurant Reviews', pathPrefixes: ['/admin/food/restaurants/reviews'] },
  { key: 'restaurant_complaints', label: 'Restaurant Complaints', pathPrefixes: ['/admin/food/restaurants/complaints'] },
  { key: 'restaurant_settings', label: 'Restaurant Settings', pathPrefixes: ['/admin/food/restaurants/settings'] },
  { key: 'restaurant_earning', label: 'Restaurant Earning', pathPrefixes: ['/admin/food/restaurants/earnings'] },
  { key: 'restaurant_onboarding_pricing', label: 'Onboarding Pricing', pathPrefixes: ['/admin/food/onboarding-pricing'] },
  { key: 'orders', label: 'Orders', pathPrefixes: ['/admin/food/orders', '/admin/food/order-refunds', '/admin/food/refund-requests'] },
  { key: 'order_detect_delivery', label: 'Order Detect Delivery', pathPrefixes: ['/admin/food/order-detect-delivery'] },
  // '/admin/food/restaurant-offers' is the API behind the page's restaurant-offer approvals.
  { key: 'restaurant_coupons_offers', label: 'Restaurant Coupons & Offers', pathPrefixes: ['/admin/food/coupons', '/admin/food/restaurant-offers'] },
  { key: 'customers', label: 'Customers', pathPrefixes: ['/admin/food/customers'] },
  { key: 'support_tickets', label: 'Support Tickets (User & Restaurant)', pathPrefixes: ['/admin/food/support-tickets'] },
  { key: 'delivery_cash_limit', label: 'Delivery Cash Limit', pathPrefixes: ['/admin/food/delivery-cash-limit'] },
  { key: 'multiorder_setting', label: 'Multiorder Setting', pathPrefixes: ['/admin/food/multiorder-setting'] },
  { key: 'delivery_platform_fee', label: 'Delivery & Platform Fee', pathPrefixes: ['/admin/food/fee-settings'] },
  { key: 'cash_confirmations', label: 'Cash Confirmations', pathPrefixes: ['/admin/food/cash-confirmations'] },
  { key: 'cash_limit_settlement', label: 'Cash limit settlement', pathPrefixes: ['/admin/food/cash-limit-settlement'] },
  { key: 'delivery_withdrawal', label: 'Delivery Withdrawal', pathPrefixes: ['/admin/food/delivery-withdrawal'] },
  { key: 'delivery_boy_wallet', label: 'Delivery boy Wallet', pathPrefixes: ['/admin/food/delivery-boy-wallet'] },
  { key: 'delivery_boy_payout', label: 'Delivery Boy Payout', pathPrefixes: ['/admin/food/delivery-boy-commission'] },
  { key: 'delivery_emergency_help', label: 'Delivery Emergency Help', pathPrefixes: ['/admin/food/delivery-emergency-help'] },
  { key: 'delivery_support_tickets', label: 'Delivery Support Tickets', pathPrefixes: ['/admin/food/delivery-support-tickets'] },
  { key: 'deliveryman_join_request', label: 'New Join Request', pathPrefixes: ['/admin/food/delivery-partners/join-request'] },
  { key: 'deliveryman_list', label: 'Deliveryman List', pathPrefixes: ['/admin/food/delivery-partners'] },
  { key: 'deliveryman_reviews', label: 'Deliveryman Reviews', pathPrefixes: ['/admin/food/delivery-partners/reviews'] },
  { key: 'deliveryman_bonus', label: 'Bonus', pathPrefixes: ['/admin/food/delivery-partners/bonus'] },
  { key: 'earning_addon', label: 'Earning Addon', pathPrefixes: ['/admin/food/delivery-partners/earning-addon'] },
  { key: 'earning_addon_history', label: 'Earning Addon History', pathPrefixes: ['/admin/food/delivery-partners/earning-addon-history'] },
  { key: 'delivery_earning', label: 'Delivery Earning', pathPrefixes: ['/admin/food/delivery-partners/earnings'] },
  { key: 'user_feedback', label: 'User Feedback', pathPrefixes: ['/admin/food/contact-messages'] },
  { key: 'safety_emergency_reports', label: 'Safety Emergency Reports', pathPrefixes: ['/admin/food/safety-emergency-reports'] },
  { key: 'transaction_report', label: 'Transaction Report', pathPrefixes: ['/admin/food/transaction-report'] },
  { key: 'order_report', label: 'Order Report', pathPrefixes: ['/admin/food/order-report'] },
  { key: 'tax_report', label: 'Tax Report', pathPrefixes: ['/admin/food/tax-report'] },
  { key: 'admin_earning', label: 'Admin Earning', pathPrefixes: ['/admin/food/admin-earning'] },
  { key: 'restaurant_report', label: 'Restaurant Report', pathPrefixes: ['/admin/food/restaurant-report'] },
  { key: 'feedback_experience', label: 'Feedback Experience', pathPrefixes: ['/admin/food/customer-report/feedback-experience'] },
  { key: 'restaurant_withdraws', label: 'Restaurant Withdraws', pathPrefixes: ['/admin/food/restaurant-withdraws'] },
  { key: 'restaurant_wallet', label: 'Restaurant Wallet', pathPrefixes: ['/admin/food/restaurant-wallet'] },
  { key: 'landing_page_management', label: 'Landing Page Management', pathPrefixes: ['/admin/food/hero-banner-management'] },
  { key: 'dining_banners', label: 'Dining Banners', pathPrefixes: ['/admin/food/dining-management'] },
  { key: 'dining_list', label: 'Dining List', pathPrefixes: ['/admin/food/dining-list'] },
  { key: 'dining_category_request', label: 'Dining Category Request', pathPrefixes: ['/admin/food/dining-requests'] },
  { key: 'broadcast_notification', label: 'Broadcast Notification', pathPrefixes: ['/admin/food/broadcast-notification'] },
  { key: 'business_setup', label: 'Business Setup', pathPrefixes: ['/admin/food/business-setup'] },
  { key: 'customization_settings', label: 'Customization Settings', pathPrefixes: ['/admin/food/customization-settings'] },
  { key: 'archived_accounts', label: 'Archived Accounts', pathPrefixes: ['/admin/food/archived-accounts'] },
  { key: 'about_us', label: 'About Us', pathPrefixes: ['/admin/food/pages-social-media/about'] },
  { key: 'terms_conditions', label: 'Terms & Conditions', pathPrefixes: ['/admin/food/pages-social-media/terms'] },
  { key: 'privacy_policy', label: 'Privacy Policy', pathPrefixes: ['/admin/food/pages-social-media/privacy'] },
  { key: 'support_cms', label: 'Support', pathPrefixes: ['/admin/food/pages-social-media/support'] },
  { key: 'refund_policy', label: 'Refund Policy', pathPrefixes: ['/admin/food/pages-social-media/refund'] },
  { key: 'shipping_policy', label: 'Shipping Policy', pathPrefixes: ['/admin/food/pages-social-media/shipping'] },
  { key: 'cancellation_policy', label: 'Cancellation Policy', pathPrefixes: ['/admin/food/pages-social-media/cancellation'] },
];

export function emptyPermissionActions() {
  return { view: false, create: false, edit: false, delete: false };
}

export function normalizePermissions(input = {}) {
  const result = {};
  for (const mod of SUB_ADMIN_PERMISSION_MODULES) {
    const raw = input?.[mod.key] || {};
    result[mod.key] = {
      view: Boolean(raw.view),
      create: Boolean(raw.create),
      edit: Boolean(raw.edit),
      delete: Boolean(raw.delete),
    };
  }
  // Keep any extra keys from frontend (new sidebar items not yet in backend list)
  for (const [key, raw] of Object.entries(input || {})) {
    if (result[key] || !raw || typeof raw !== 'object') continue;
    result[key] = {
      view: Boolean(raw.view),
      create: Boolean(raw.create),
      edit: Boolean(raw.edit),
      delete: Boolean(raw.delete),
    };
  }
  return result;
}

export function hasModuleAction(permissions, moduleKey, action = 'view') {
  if (!moduleKey) return false;
  return Boolean(permissions?.[moduleKey]?.[action]);
}

/** Longest matching pathPrefix wins (avoids /admin/food matching everything). */
export function findModuleKeyForPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  let best = null;
  let bestLen = -1;

  for (const mod of SUB_ADMIN_PERMISSION_MODULES) {
    for (const prefix of mod.pathPrefixes) {
      const p = String(prefix).replace(/\/+$/, '') || '/';
      const isDashboard = p === '/admin/food';
      const matches = isDashboard
        ? path === '/admin/food' || path === '/admin'
        : path === p || path.startsWith(`${p}/`);
      if (matches && p.length > bestLen) {
        best = mod.key;
        bestLen = p.length;
      }
    }
  }
  return best;
}
