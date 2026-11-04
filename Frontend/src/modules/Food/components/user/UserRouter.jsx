import React, { Suspense, lazy } from "react"
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom"
import UserLayout from "./UserLayout"
import Loader from "@food/components/Loader"
import ProtectedRoute from "@food/components/ProtectedRoute"
import AuthRedirect from "@food/components/AuthRedirect"
import useModuleAccess from "@food/hooks/useModuleAccess"

const SearchResults = lazy(() => import("@food/pages/user/search/ProfessionalSearch"))

// Lazy Loading Pages

// Home & Discovery
const DiningCategory = lazy(() => import("@food/pages/user/DiningCategory"))
const DiningExplore50 = lazy(() => import("@food/pages/user/DiningExplore50"))
const DiningExploreNear = lazy(() => import("@food/pages/user/DiningExploreNear"))
const Coffee = lazy(() => import("@food/pages/user/Coffee"))
const Categories = lazy(() => import("@food/pages/user/Categories"))
const Restaurants = lazy(() => import("@food/pages/user/restaurants/Restaurants"))
const RestaurantDetails = lazy(() => import("@food/pages/user/restaurants/RestaurantDetails"))
const DiningRestaurantDetails = lazy(() => import("@food/pages/user/dining/DiningRestaurantDetails"))
const TableBooking = lazy(() => import("@food/pages/user/dining/TableBooking"))
const TableBookingConfirmation = lazy(() => import("@food/pages/user/dining/TableBookingConfirmation"))
const TableBookingSuccess = lazy(() => import("@food/pages/user/dining/TableBookingSuccess"))
const TableModificationPolicy = lazy(() => import("@food/pages/user/dining/TableModificationPolicy"))
const TableCancellationPolicy = lazy(() => import("@food/pages/user/dining/TableCancellationPolicy"))
const TableEditUserPage = lazy(() => import("@food/pages/user/dining/TableEditUserPage"))
const MyBookings = lazy(() => import("@food/pages/user/dining/MyBookings"))
const ProductDetail = lazy(() => import("@food/pages/user/ProductDetail"))

// Cart
const Cart = lazy(() => import("@food/pages/user/cart/Cart"))
const SelectAddress = lazy(() => import("@food/pages/user/cart/SelectAddress"))
const AddressSelectorPage = lazy(() => import("@food/pages/user/cart/AddressSelectorPage"))

// Orders
const Orders = lazy(() => import("@food/pages/user/orders/Orders"))
const OrderTracking = lazy(() => import("@food/pages/user/orders/OrderTracking"))
const OrderInvoice = lazy(() => import("@food/pages/user/orders/OrderInvoice"))
const UserOrderDetails = lazy(() => import("@food/pages/user/orders/UserOrderDetails"))

// Offers
const Offers = lazy(() => import("@food/pages/user/Offers"))
const Reorder = lazy(() => import("@food/pages/user/reorder/Reorder"))

// Gourmet
const Gourmet = lazy(() => import("@food/pages/user/Gourmet"))


// Collections
const Collections = lazy(() => import("@food/pages/user/Collections"))
const CollectionDetail = lazy(() => import("@food/pages/user/CollectionDetail"))



// Profile
const EditProfile = lazy(() => import("@food/pages/user/profile/EditProfile"))
const Payments = lazy(() => import("@food/pages/user/profile/Payments"))
const AddPayment = lazy(() => import("@food/pages/user/profile/AddPayment"))
const EditPayment = lazy(() => import("@food/pages/user/profile/EditPayment"))
const Favorites = lazy(() => import("@food/pages/user/profile/Favorites"))
const Support = lazy(() => import("@food/pages/user/profile/Support"))
const Coupons = lazy(() => import("@food/pages/user/profile/Coupons"))
const About = lazy(() => import("@food/pages/user/profile/About"))
const Terms = lazy(() => import("@food/pages/user/profile/Terms"))
const Privacy = lazy(() => import("@food/pages/user/profile/Privacy"))
const Refund = lazy(() => import("@food/pages/user/profile/Refund"))
const Shipping = lazy(() => import("@food/pages/user/profile/Shipping"))
const Cancellation = lazy(() => import("@food/pages/user/profile/Cancellation"))
const ReportSafetyEmergency = lazy(() => import("@food/pages/user/profile/ReportSafetyEmergency"))
const Accessibility = lazy(() => import("@food/pages/user/profile/Accessibility"))
const Logout = lazy(() => import("@food/pages/user/profile/Logout"))
const ReferEarn = lazy(() => import("@food/pages/user/profile/ReferEarn"))
const UserCMSHelpSupportPage = lazy(() => import("@food/pages/user/profile/UserCMSHelpSupportPage"))
const Settings = lazy(() => import("@food/pages/user/profile/Settings"))

// Auth
const SignIn = lazy(() => import("@food/pages/user/auth/SignIn"))
const OTP = lazy(() => import("@food/pages/user/auth/OTP"))
const AuthCallback = lazy(() => import("@food/pages/user/auth/AuthCallback"))

// Help
const Help = lazy(() => import("@food/pages/user/help/Help"))
const OrderHelp = lazy(() => import("@food/pages/user/help/OrderHelp"))

// Notifications
const Notifications = lazy(() => import("@food/pages/user/Notifications"))

// Wallet
const Wallet = lazy(() => import("@food/pages/user/Wallet"))

// Complaints
const SubmitComplaint = lazy(() => import("@food/pages/user/complaints/SubmitComplaint"))

import { AppShellSkeleton } from "@food/components/ui/loading-skeletons"
import { Loader2 } from "lucide-react"
import RouteErrorBoundary from "@/shared/components/RouteErrorBoundary"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"

/**
 * Boundary for the order placement -> confirmation -> tracking screens. It sits
 * inside the layout, so a failure keeps the app chrome and offers My Orders
 * (where a placed order always appears) as the way forward - never a blank page.
 */
const OrderFlowBoundary = ({ scope, message, children }) => {
  const location = useLocation()
  return (
    <RouteErrorBoundary
      scope={scope}
      resetKey={location.pathname}
      showDetails={import.meta.env.DEV}
      title="We couldn't load this screen"
      message={message}
      actions={[{ label: "My Orders", to: toFoodUserPath("/user/orders") }]}
    >
      {children}
    </RouteErrorBoundary>
  )
}

const ORDER_SAVED_MESSAGE = "Your order is saved to your account. Try again, or open My Orders to see its latest status."

const PageLoader = () => (
  <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-6 bg-white dark:bg-[#141414]">
    <Loader2 className="h-10 w-10 animate-spin text-[#1F6B45]" />
    <p className="mt-4 text-gray-500 font-bold uppercase tracking-widest text-[10px]">
      Loading...
    </p>
  </div>
)

/** Main tabs render via MainTabKeepAlive in UserLayout — route match only. */
const MainTabRoutePlaceholder = () => null

/** Plain <Navigate to="/user/auth/login" /> drops the query string (e.g. ?ref= for referral links). */
const RedirectToLogin = () => {
  const location = useLocation()
  return <Navigate to={`/user/auth/login${location.search}`} replace />
}

const RequireInitialAuth = ({ children }) => {
  const location = useLocation();
  const authStatus = localStorage.getItem("user_authenticated");
  const token = localStorage.getItem("user_accessToken");

  // Only enforce initial auth gate for actual user paths, not restaurant/delivery/admin
  const currentPath = location.pathname;
  const isNonUserModulePath = 
    currentPath.startsWith("/food/restaurant") ||
    currentPath.startsWith("/food/delivery") ||
    currentPath.startsWith("/food/admin");

  // If this is a restaurant/delivery/admin path that fell through to catch-all, skip the gate
  if (isNonUserModulePath) {
    return children;
  }

  const isPolicyPage = 
    currentPath.includes('terms') || 
    currentPath.includes('privacy') || 
    currentPath.includes('support') ||
    currentPath.includes('refund') ||
    currentPath.includes('shipping') ||
    currentPath.includes('cancellation');

  // If user has NO explicit auth status and NO token, it means they are a first time visitor
  // or a user who has completely logged out. Force them to the login screen first.
  if (authStatus === null && !token && !isPolicyPage) {
    return <Navigate to="/user/auth/login" replace />;
  }

  return children;
}

export default function UserRouter() {
  const { takeawayEnabled, diningEnabled } = useModuleAccess()

  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <Routes>
        <Route element={<RequireInitialAuth><UserLayout /></RequireInitialAuth>}>
          {/* ========================================== */}
          {/* PUBLIC ROUTES (No login required)          */}
          {/* ========================================== */}
          
          {/* Public Legal Policies & Support */}
          <Route path="profile/terms" element={<Suspense fallback={<PageLoader />}><Terms /></Suspense>} />
          <Route path="profile/privacy" element={<Suspense fallback={<PageLoader />}><Privacy /></Suspense>} />
          <Route path="profile/refund" element={<Suspense fallback={<PageLoader />}><Refund /></Suspense>} />
          <Route path="profile/shipping" element={<Suspense fallback={<PageLoader />}><Shipping /></Suspense>} />
          <Route path="profile/cancellation" element={<Suspense fallback={<PageLoader />}><Cancellation /></Suspense>} />
          <Route path="profile/support" element={<Suspense fallback={<PageLoader />}><Support /></Suspense>} />
          <Route path="profile/support-info" element={<Suspense fallback={<PageLoader />}><UserCMSHelpSupportPage /></Suspense>} />
          <Route path="profile/help-content" element={<Suspense fallback={<PageLoader />}><UserCMSHelpSupportPage /></Suspense>} />
          <Route path="help-content" element={<Suspense fallback={<PageLoader />}><UserCMSHelpSupportPage /></Suspense>} />
          <Route path="help/content" element={<Suspense fallback={<PageLoader />}><UserCMSHelpSupportPage /></Suspense>} />
          
          {/* Help Center */}
          <Route path="help" element={<Help />} />
          <Route path="help/orders/:orderId" element={<OrderHelp />} />

          {/* Auth Redirects & Callbacks */}
          <Route path="login" element={<RedirectToLogin />} />
          <Route path="auth/login" element={
            <AuthRedirect module="user">
              <RedirectToLogin />
            </AuthRedirect>
          } />
          <Route path="auth/sign-in" element={
            <AuthRedirect module="user">
              <RedirectToLogin />
            </AuthRedirect>
          } />
          <Route path="auth/otp" element={
            <AuthRedirect module="user">
              <OTP />
            </AuthRedirect>
          } />
          <Route path="auth/callback" element={<AuthCallback />} />


          {/* ========================================== */}
          {/* PUBLIC DISCOVERY ROUTES (Guest mode allowed) */}
          {/* ========================================== */}
          {/* Home & Discovery — kept alive in UserLayout MainTabKeepAlive */}
          <Route path="" element={<MainTabRoutePlaceholder />} />
          <Route path="home" element={<MainTabRoutePlaceholder />} />
          <Route path="takeaway" element={takeawayEnabled ? <MainTabRoutePlaceholder /> : <Navigate to="/food/user" replace />} />
          {diningEnabled ? (
            <>
              <Route path="dining" element={<MainTabRoutePlaceholder />} />
              <Route path="dining/explore/upto50" element={<DiningExplore50 />} />
              <Route path="dining/explore/near-rated" element={<DiningExploreNear />} />
              <Route path="dining/coffee" element={<Coffee />} />
              <Route path="dining/restaurant/:slug" element={<DiningRestaurantDetails />} />
              <Route path="dining/restaurants/:slug" element={<DiningRestaurantDetails />} />
              <Route path="dining/:diningType/:slug" element={<DiningRestaurantDetails />} />
              <Route path="dining/:category" element={<DiningCategory />} />
            </>
          ) : (
            <Route path="dining/*" element={<Navigate to="/food/user" replace />} />
          )}
          <Route path="under-250" element={<MainTabRoutePlaceholder />} />
          <Route path="reorder" element={<Reorder />} />
          <Route path="categories" element={<Categories />} />
          <Route path="category/:category" element={<MainTabRoutePlaceholder />} />
          <Route path="restaurants" element={<Restaurants />} />
          <Route path="restaurants/:slug" element={<RestaurantDetails />} />
          <Route path="search" element={<SearchResults />} />
          <Route path="product/:id" element={<ProductDetail />} />
          <Route path="address-selector" element={<AddressSelectorPage />} />

          {/* ========================================== */}
          {/* PROTECTED ROUTES (Login required)          */}
          {/* ========================================== */}
          <Route element={<ProtectedRoute requiredRole="user" loginPath="/user/auth/login"><Outlet /></ProtectedRoute>}>
            {/* Dining Table Bookings — gated by the admin Dining toggle */}
            {diningEnabled ? (
              <>
                <Route path="dining/book/:slug" element={<TableBooking />} />
                <Route path="dining/book-confirmation" element={<TableBookingConfirmation />} />
                <Route path="dining/book-success" element={<TableBookingSuccess />} />
                <Route path="dining/modification-policy" element={<TableModificationPolicy />} />
                <Route path="dining/cancellation-policy" element={<TableCancellationPolicy />} />
                <Route path="dining/edit-user" element={<TableEditUserPage />} />
                <Route path="bookings" element={<MyBookings />} />
              </>
            ) : (
              <>
                <Route path="dining/book/*" element={<Navigate to="/food/user" replace />} />
                <Route path="bookings" element={<Navigate to="/food/user" replace />} />
              </>
            )}

            {/* Cart */}
            <Route path="cart" element={<OrderFlowBoundary scope="cart" message="Your cart is saved. Try again, or check My Orders if you already placed this order."><Cart /></OrderFlowBoundary>} />
            <Route path="cart/select-address" element={<SelectAddress />} />

            {/* Orders */}
            <Route path="orders" element={<OrderFlowBoundary scope="orders-list" message="We couldn't show your orders right now. Please try again."><Orders /></OrderFlowBoundary>} />
            <Route path="orders/:orderId" element={<OrderFlowBoundary scope="order-tracking" message={ORDER_SAVED_MESSAGE}><OrderTracking /></OrderFlowBoundary>} />
            <Route path="orders/:orderId/invoice" element={<OrderFlowBoundary scope="order-invoice" message={ORDER_SAVED_MESSAGE}><OrderInvoice /></OrderFlowBoundary>} />
            <Route path="orders/:orderId/details" element={<OrderFlowBoundary scope="order-details" message={ORDER_SAVED_MESSAGE}><UserOrderDetails /></OrderFlowBoundary>} />

            {/* Offers */}
            <Route path="offers" element={<Offers />} />

            {/* Gourmet */}
            <Route path="gourmet" element={<Gourmet />} />

            {/* Collections */}
            <Route path="collections" element={<Collections />} />
            <Route path="collections/:id" element={<CollectionDetail />} />

            {/* Profile — kept alive in UserLayout MainTabKeepAlive */}
            <Route path="profile" element={<MainTabRoutePlaceholder />} />
            <Route path="profile/edit" element={<EditProfile />} />
            <Route path="profile/payments" element={<Payments />} />
            <Route path="profile/payments/new" element={<AddPayment />} />
            <Route path="profile/payments/:id/edit" element={<EditPayment />} />
            <Route path="profile/favorites" element={<Favorites />} />
            <Route path="profile/coupons" element={<Coupons />} />
            <Route path="profile/about" element={<About />} />
            <Route path="profile/report-safety-emergency" element={<ReportSafetyEmergency />} />
            <Route path="profile/accessibility" element={<Accessibility />} />
            <Route path="profile/logout" element={<Logout />} />
            <Route path="profile/refer-earn" element={<ReferEarn />} />
            <Route path="profile/dining-bookings" element={diningEnabled ? <MyBookings /> : <Navigate to="/food/user/profile" replace />} />
            <Route path="profile/settings" element={<Suspense fallback={<Loader />}><Settings /></Suspense>} />

            {/* Notifications */}
            <Route path="notifications" element={<Notifications />} />

            {/* Wallet */}
            <Route path="wallet" element={<Wallet />} />

            {/* Complaints */}
            <Route path="complaints/submit/:orderId" element={<SubmitComplaint />} />
          </Route>

          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to="/food/user" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
