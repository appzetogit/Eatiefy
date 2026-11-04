import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import PermissionRoute from "./PermissionRoute";
import AdminLayout from "./AdminLayout";
import AuthRedirect from "@food/components/AuthRedirect";
import Loader from "@food/components/Loader";
import useModuleAccess from "@food/hooks/useModuleAccess";
import { AdminShellSkeleton } from "@food/components/ui/loading-skeletons";

const AdminHome = lazy(() => import("@food/pages/admin/AdminHome"));
const PointOfSale = lazy(() => import("@food/pages/admin/PointOfSale"));
const AdminProfile = lazy(() => import("@food/pages/admin/AdminProfile"));
const AdminSettings = lazy(() => import("@food/pages/admin/AdminSettings"));
const NewRefundRequests = lazy(() => import("@food/pages/admin/refunds/NewRefundRequests"));
const FoodApproval = lazy(() => import("@food/pages/admin/restaurant/FoodApproval"));
const OrdersPage = lazy(() => import("@food/pages/admin/orders/OrdersPage"));
const OrderDetectDelivery = lazy(() => import("@food/pages/admin/OrderDetectDelivery"));
const Category = lazy(() => import("@food/pages/admin/categories/Category"));
const FeeSettings = lazy(() => import("@food/pages/admin/fee-settings/FeeSettings"));
// TODO: Referral feature temporarily disabled. Uncomment to re-enable in future.
const ReferralSettings = lazy(() => import("@food/pages/admin/referral-settings/ReferralSettings"));
// Restaurant Management
const ZoneSetup = lazy(() => import("@food/pages/admin/restaurant/ZoneSetup"));
const AddZone = lazy(() => import("@food/pages/admin/restaurant/AddZone"));
const ViewZone = lazy(() => import("@food/pages/admin/restaurant/ViewZone"));
const AllZonesMap = lazy(() => import("@food/pages/admin/restaurant/AllZonesMap"));
const DeliveryBoyViewMap = lazy(() => import("@food/pages/admin/restaurant/DeliveryBoyViewMap"));
const RestaurantsList = lazy(() => import("@food/pages/admin/restaurant/RestaurantsList"));
const AddRestaurant = lazy(() => import("@food/pages/admin/restaurant/AddRestaurant"));
const JoiningRequest = lazy(() => import("@food/pages/admin/restaurant/JoiningRequest"));
const TopRestaurants = lazy(() => import("@food/pages/admin/restaurant/TopRestaurants"));
const RestaurantCommission = lazy(() => import("@food/pages/admin/restaurant/RestaurantCommission"));
const RestaurantComplaints = lazy(() => import("@food/pages/admin/restaurant/RestaurantComplaints"));
const RestaurantReviews = lazy(() => import("@food/pages/admin/restaurant/RestaurantReviews"));
// Food Management
const FoodsList = lazy(() => import("@food/pages/admin/foods/FoodsList"));
const PricingManagement = lazy(() => import("@food/pages/admin/pricing/PricingManagement"));
const OnboardingPricing = lazy(() => import("@food/pages/admin/pricing/OnboardingPricing"));
const AddonsList = lazy(() => import("@food/pages/admin/addons/AddonsList"));
// Promotions Management
const Coupons = lazy(() => import("@food/pages/admin/Coupons"));
const PromotionalBanner = lazy(() => import("@food/pages/admin/PromotionalBanner"));

// Help & Support
const ContactMessages = lazy(() => import("@food/pages/admin/ContactMessages"));
const SafetyEmergencyReports = lazy(() => import("@food/pages/admin/SafetyEmergencyReports"));
// Customer Management
const Customers = lazy(() => import("@food/pages/admin/Customers"));
const SupportTickets = lazy(() => import("@food/pages/admin/SupportTickets"));
// Deliveryman Management
const DeliveryBoyCommission = lazy(() => import("@food/pages/admin/DeliveryBoyCommission"));
const DeliveryCashLimit = lazy(() => import("@food/pages/admin/DeliveryCashLimit"));
const MultiorderSetting = lazy(() => import("@food/pages/admin/MultiorderSetting"));
const CashLimitSettlement = lazy(() => import("@food/pages/admin/CashLimitSettlement"));
const CashConfirmations = lazy(() => import("@food/pages/admin/CashConfirmations"));
const DeliveryWithdrawal = lazy(() => import("@food/pages/admin/DeliveryWithdrawal"));
const DeliveryBoyWallet = lazy(() => import("@food/pages/admin/DeliveryBoyWallet"));
const DeliveryEmergencyHelp = lazy(() => import("@food/pages/admin/DeliveryEmergencyHelp"));
const DeliverySupportTickets = lazy(() => import("@food/pages/admin/DeliverySupportTickets"));
const JoinRequest = lazy(() => import("@food/pages/admin/delivery-partners/JoinRequest"));
const DeliverymanList = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanList"));
const DeliverymanReviews = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanReviews"));
const DeliverymanBonus = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanBonus"));
const EarningAddon = lazy(() => import("@food/pages/admin/delivery-partners/EarningAddon"));
const EarningAddonHistory = lazy(() => import("@food/pages/admin/delivery-partners/EarningAddonHistory"));
const DeliveryEarnings = lazy(() => import("@food/pages/admin/delivery-partners/DeliveryEarnings"));
// Disbursement Management
// Report Management
const TransactionReport = lazy(() => import("@food/pages/admin/reports/TransactionReport"));
const RegularOrderReport = lazy(() => import("@food/pages/admin/reports/RegularOrderReport"));
const RestaurantReport = lazy(() => import("@food/pages/admin/reports/RestaurantReport"));
const FeedbackExperienceReport = lazy(() => import("@food/pages/admin/reports/FeedbackExperienceReport"));
const TaxReport = lazy(() => import("@food/pages/admin/reports/TaxReport"));
// Transaction Management
const RestaurantWithdraws = lazy(() => import("@food/pages/admin/transactions/RestaurantWithdraws"));
// Employee Management
const SubAdminList = lazy(() => import("@food/pages/admin/sub-admins/SubAdminList"));
const SubAdminPermissions = lazy(() => import("@food/pages/admin/sub-admins/SubAdminPermissions"));
// Business Settings
const BusinessSetup = lazy(() => import("@food/pages/admin/settings/BusinessSetup"));
const TermsAndCondition = lazy(() => import("@food/pages/admin/settings/LegalTerms"));
const PrivacyPolicy = lazy(() => import("@food/pages/admin/settings/LegalPrivacy"));
const AboutUs = lazy(() => import("@food/pages/admin/settings/AboutUs"));
const RefundPolicy = lazy(() => import("@food/pages/admin/settings/RefundPolicy"));
const ShippingPolicy = lazy(() => import("@food/pages/admin/settings/ShippingPolicy"));
const CancellationPolicy = lazy(() => import("@food/pages/admin/settings/CancellationPolicy"));
const SupportCMS = lazy(() => import("@food/pages/admin/settings/SupportCMS"));
// System Settings
const NotificationBroadcast = lazy(() => import("@food/pages/admin/system/NotificationBroadcast"));
const AdminNotifications = lazy(() => import("@food/pages/admin/system/AdminNotifications"));
const PushDebug = lazy(() => import("@food/pages/admin/system/PushDebug"));
const LandingPageManagement = lazy(() => import("@food/pages/admin/system/LandingPageManagement"));
const DiningManagement = lazy(() => import("@food/pages/admin/system/DiningManagement"));
const DiningList = lazy(() => import("@food/pages/admin/system/DiningList"));
const SweetShops = lazy(() => import("@food/pages/admin/system/SweetShops"));
const DiningRequests = lazy(() => import("@food/pages/admin/system/DiningRequests"));
const CustomizationSettings = lazy(() => import("@food/pages/admin/system/CustomizationSettings"));
const ArchivedAccounts = lazy(() => import("@food/pages/admin/system/ArchivedAccounts"));
const RestaurantSettings = lazy(() => import("@food/pages/admin/restaurant/RestaurantSettings"));
const RestaurantEarnings = lazy(() => import("@food/pages/admin/restaurant/RestaurantEarnings"));
const EditRestaurant = lazy(() => import("@food/pages/admin/restaurant/EditRestaurant"));
const AdminLogin = lazy(() => import("@food/pages/admin/auth/AdminLogin"));
const AdminSignup = lazy(() => import("@food/pages/admin/auth/AdminSignup"));
const AdminForgotPassword = lazy(() => import("@food/pages/admin/auth/AdminForgotPassword"));

/** Admin URLs of retired template pages (see the redirect block in the routes). */
const RETIRED_TEMPLATE_PATHS = [
  "3rd-party-configurations/ai",
  "3rd-party-configurations/analytics",
  "3rd-party-configurations/firebase",
  "3rd-party-configurations/join-us",
  "3rd-party-configurations/offline-payment",
  "3rd-party-configurations/party",
  "addon-activation",
  "advertisement",
  "advertisement/new",
  "advertisement/requests",
  "app-web-settings",
  "banners",
  "business-settings/fcm-index",
  "campaigns/basic",
  "campaigns/food",
  "cashback",
  "chattings",
  "clean-database",
  "delivery-partners/add",
  "disbursement-report/deliverymen",
  "disbursement-report/restaurants",
  "email-template",
  "employee-role",
  "employees",
  "employees/add",
  "expense-report",
  "gallery",
  "landing-page-settings/admin",
  "landing-page-settings/react",
  "login-setup",
  "loyalty-point/report",
  "notification-channels",
  "order-report/campaign",
  "page-meta-data",
  "pages-social-media/react-registration",
  "react-site",
  "restaurant-vat-report",
  "restaurants/bulk-export",
  "restaurants/bulk-import",
  "subscribed-mail-list",
  "theme-settings",
  "wallet/add-fund",
  "wallet/bonus",
  "withdraw-method",
];

export default function AdminRouter() {
  const { diningEnabled, sweetsEnabled } = useModuleAccess();
  // Admin-specific fallback. `null` here left a blank screen on slow networks,
  // and the outer boundary would otherwise have shown the customer app shell.
  return (
    <Suspense fallback={<AdminShellSkeleton />}>
      <Routes>
        {/* Protected Routes - With Layout */}
        {/* Admin Login - Same as earlier */}
        {/* Admin Auth Routes */}
        <Route path="login" element={<AuthRedirect module="admin"><AdminLogin /></AuthRedirect>} />
        <Route path="forgot-password" element={<AuthRedirect module="admin"><AdminForgotPassword /></AuthRedirect>} />
        <Route path="signup" element={<AuthRedirect module="admin"><AdminSignup /></AuthRedirect>} />

        {/* Protected Routes - With Layout */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          {/* Default Admin Redirect */}
          <Route path="/" element={<Navigate to="food" replace />} />

          {/* Direct aliases for restaurant routes accessed without /food prefix */}
          <Route path="restaurants/add" element={<Navigate to="/admin/food/restaurants/add" replace />} />
          <Route path="restaurants/edit/:id" element={<Navigate to="/admin/food/restaurants" replace />} />
          <Route path="restaurants" element={<Navigate to="/admin/food/restaurants" replace />} />
          <Route path="restaurants/*" element={<Navigate to="/admin/food/restaurants" replace />} />

          {/* FOOD ADMIN - All food related routes nested here */}
          <Route path="food/*">
            <Route index element={<AdminHome />} />
            <Route path="point-of-sale" element={<PointOfSale />} />
            <Route path="profile" element={<AdminProfile />} />
            <Route path="settings" element={<AdminSettings />} />
            
            {/* ORDER MANAGEMENT */}
            <Route path="orders/all" element={<OrdersPage statusKey="all" />} />
            <Route path="orders/scheduled" element={<OrdersPage statusKey="scheduled" />} />
            <Route path="orders/pending" element={<OrdersPage statusKey="pending" />} />
            {/* ... other order routes ... */}
            <Route path="orders/processing" element={<OrdersPage statusKey="processing" />} />
            <Route path="orders/food-on-the-way" element={<OrdersPage statusKey="food-on-the-way" />} />
            <Route path="orders/delivered" element={<OrdersPage statusKey="delivered" />} />
            <Route path="orders/canceled" element={<OrdersPage statusKey="canceled" />} />
            <Route path="orders/restaurant-cancelled" element={<OrdersPage statusKey="restaurant-cancelled" />} />
            <Route path="orders/payment-failed" element={<OrdersPage statusKey="payment-failed" />} />
            <Route path="orders/refunded" element={<OrdersPage statusKey="refunded" />} />
            <Route path="orders/offline-payments" element={<OrdersPage statusKey="offline-payments" />} />
            <Route path="order-detect-delivery" element={<OrderDetectDelivery />} />
            <Route path="order-refunds/new" element={<NewRefundRequests />} />

            {/* RESTAURANT MANAGEMENT */}
            <Route path="zone-setup" element={<ZoneSetup />} />
            <Route path="zone-setup/map" element={<AllZonesMap />} />
            <Route path="zone-setup/delivery-boy-view" element={<DeliveryBoyViewMap />} />
            <Route path="zone-setup/add" element={<AddZone />} />
            <Route path="zone-setup/edit/:id" element={<AddZone />} />
            <Route path="zone-setup/view/:id" element={<ViewZone />} />
            <Route path="food-approval" element={<FoodApproval />} />
            <Route path="restaurants" element={<RestaurantsList />} />
            <Route path="restaurants/add" element={<AddRestaurant />} />
            <Route path="restaurants/edit/:id" element={<EditRestaurant />} />
            <Route path="restaurants/joining-request" element={<JoiningRequest />} />
            <Route path="restaurants/top-restaurants" element={<TopRestaurants />} />
            <Route path="restaurants/commission" element={<RestaurantCommission />} />
            <Route path="restaurants/complaints" element={<RestaurantComplaints />} />
            <Route path="restaurants/reviews" element={<RestaurantReviews />} />
            <Route path="restaurants/settings" element={<RestaurantSettings />} />
            <Route path="restaurants/earnings" element={<RestaurantEarnings />} />
            <Route path="restaurant-earnings" element={<RestaurantEarnings />} />

            {/* FOOD & CATEGORY MANAGEMENT */}
            <Route path="categories" element={<Category />} />
            <Route path="fee-settings" element={<FeeSettings />} />
            <Route path="referral-settings" element={<ReferralSettings />} />
            <Route path="foods" element={<FoodsList />} />
            <Route path="food/list" element={<FoodsList />} />
            <Route path="pricing" element={<PricingManagement />} />
            <Route path="onboarding-pricing" element={<OnboardingPricing />} />
            <Route path="addons" element={<AddonsList />} />

            {/* PROMOTIONS, CUSTOMERS, DELIVERYMEN, etc. */}
            <Route path="coupons" element={<Coupons />} />
            <Route path="promotional-banner" element={<PromotionalBanner />} />
            
            <Route path="contact-messages" element={<ContactMessages />} />
            <Route path="safety-emergency-reports" element={<SafetyEmergencyReports />} />
            
            <Route path="customers" element={<Customers />} />
            <Route path="support-tickets" element={<SupportTickets />} />

            <Route path="delivery-boy-commission" element={<DeliveryBoyCommission />} />
            <Route path="delivery-cash-limit" element={<DeliveryCashLimit />} />
            <Route path="multiorder-setting" element={<MultiorderSetting />} />
            <Route path="cash-confirmations" element={<CashConfirmations />} />
            <Route path="cash-limit-settlement" element={<CashLimitSettlement />} />
            <Route path="delivery-withdrawal" element={<DeliveryWithdrawal />} />
            <Route path="delivery-boy-wallet" element={<DeliveryBoyWallet />} />
            <Route path="delivery-emergency-help" element={<DeliveryEmergencyHelp />} />
            <Route path="delivery-support-tickets" element={<DeliverySupportTickets />} />
            <Route path="delivery-partners" element={<DeliverymanList />} />
            <Route path="delivery-partners/join-request" element={<JoinRequest />} />
            <Route path="delivery-partners/reviews" element={<DeliverymanReviews />} />
            <Route path="delivery-partners/bonus" element={<DeliverymanBonus />} />
            <Route path="delivery-partners/earning-addon" element={<EarningAddon />} />
            <Route path="delivery-partners/earning-addon-history" element={<EarningAddonHistory />} />
            <Route path="delivery-partners/earnings" element={<DeliveryEarnings />} />


            {/* REPORTS & SETTINGS */}
            <Route path="transaction-report" element={<TransactionReport />} />
            <Route path="order-report/regular" element={<RegularOrderReport />} />
            <Route path="restaurant-report" element={<RestaurantReport />} />
            <Route path="customer-report/feedback-experience" element={<FeedbackExperienceReport />} />
            <Route path="tax-report" element={<TaxReport />} />
            
            <Route path="restaurant-withdraws" element={<RestaurantWithdraws />} />
            

            {/* SUB ADMIN MANAGEMENT (full ADMIN only) */}
            <Route
              path="sub-admins"
              element={
                <PermissionRoute requireFullAdmin>
                  <SubAdminList />
                </PermissionRoute>
              }
            />
            <Route
              path="sub-admins/:id/permissions"
              element={
                <PermissionRoute requireFullAdmin>
                  <SubAdminPermissions />
                </PermissionRoute>
              }
            />

            {/* SYSTEM & BUSINESS SETTINGS */}
            <Route path="business-setup" element={<BusinessSetup />} />
            <Route path="pages-social-media/terms" element={<TermsAndCondition />} />
            <Route path="pages-social-media/privacy" element={<PrivacyPolicy />} />
            <Route path="pages-social-media/about" element={<AboutUs />} />
            <Route path="pages-social-media/refund" element={<RefundPolicy />} />
            <Route path="pages-social-media/shipping" element={<ShippingPolicy />} />
            <Route path="pages-social-media/cancellation" element={<CancellationPolicy />} />
            <Route path="pages-social-media/support" element={<SupportCMS />} />
            
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="broadcast-notification" element={<NotificationBroadcast />} />
            <Route path="push-debug" element={<PushDebug />} />
            <Route path="hero-banner-management" element={<LandingPageManagement />} />
            {/*
              Retired StackFood template pages. None of them has a backend: they
              showed invented records ("Hungry Puppets", "John Doe") and several
              reported fake success - "Fund added", "Database cleared",
              "Deliveryman added" - without changing anything. They were not in
              the sidebar, but were reachable by URL, so bookmarks now land on
              the dashboard instead. The page files are kept in pages/admin for
              reference if any of these features is built for real.
            */}
            {RETIRED_TEMPLATE_PATHS.map((retiredPath) => (
              <Route key={retiredPath} path={retiredPath} element={<Navigate to="/admin/food" replace />} />
            ))}
            <Route path="dining-management" element={diningEnabled ? <DiningManagement /> : <Navigate to="/admin/food" replace />} />
            <Route path="dining-list" element={diningEnabled ? <DiningList /> : <Navigate to="/admin/food" replace />} />
            <Route path="sweet-shops" element={sweetsEnabled ? <SweetShops /> : <Navigate to="/admin/food" replace />} />
            <Route path="dining-requests" element={diningEnabled ? <DiningRequests /> : <Navigate to="/admin/food" replace />} />
            <Route path="customization-settings" element={<CustomizationSettings />} />
            <Route path="archived-accounts" element={<ArchivedAccounts />} />
          </Route>

          {/* TAXI ADMIN - Placeholder for future implementation */}
          <Route path="taxi/*" element={<div className="p-8 text-center text-gray-500 bg-white min-h-[50vh] flex items-center justify-center border rounded-xl m-4">Taxi Administration - Coming Soon</div>} />

          {/* QUICK COMMERCE ADMIN - Placeholder for future implementation */}
          <Route path="quick-commerce/*" element={<div className="p-8 text-center text-gray-500 bg-white min-h-[50vh] flex items-center justify-center border rounded-xl m-4">Quick Commerce Administration - Coming Soon</div>} />
        </Route>

        {/* Redirect unknown admin routes to food admin */}
        <Route path="*" element={<Navigate to="/admin/food" replace />} />
      </Routes>
    </Suspense>
  );
}
