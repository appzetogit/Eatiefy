import React, { Suspense, lazy } from "react"
import RouteErrorBoundary from "@/shared/components/RouteErrorBoundary"
import RestaurantOfflineGate from "./RestaurantOfflineGate"
import RestaurantShell, { RestaurantShellIfSignedIn } from "./RestaurantShell"
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import ProtectedRoute from "@food/components/ProtectedRoute"
import AuthRedirect from "@food/components/AuthRedirect"
import Loader from "@food/components/Loader"
import { OnboardingSkeleton } from "@food/components/ui/loading-skeletons"
import "./restaurantTheme.css"
import { toast } from "sonner"
import useModuleAccess from "@food/hooks/useModuleAccess"
import { useTrackRestaurantHistory } from "@food/hooks/useRestaurantBackNavigation"

// Lazy Loading Components
const RestaurantNotifications = lazy(() => import("@food/pages/restaurant/Notifications"))
const AllOrdersPage = lazy(() => import("@food/pages/restaurant/AllOrdersPage"))
const OrderDetails = lazy(() => import("@food/pages/restaurant/OrderDetails"))
const OrdersMain = lazy(() => import("@food/pages/restaurant/OrdersMain"))
const RestaurantOnboarding = lazy(() => import("@food/pages/restaurant/Onboarding"))
const RestaurantOnboardingPayment = lazy(() => import("@food/pages/restaurant/OnboardingPayment"))
const PrivacyPolicyPage = lazy(() => import("@food/pages/restaurant/PrivacyPolicyPage"))
const TermsAndConditionsPage = lazy(() => import("@food/pages/restaurant/TermsAndConditionsPage"))
const MenuCategoriesPage = lazy(() => import("@food/pages/restaurant/MenuCategoriesPage"))
const RestaurantOffers = lazy(() => import("@food/pages/restaurant/RestaurantOffers"))
const RestaurantStatus = lazy(() => import("@food/pages/restaurant/RestaurantStatus"))
const ExploreMore = lazy(() => import("@food/pages/restaurant/ExploreMore"))
const DeliverySettings = lazy(() => import("@food/pages/restaurant/DeliverySettings"))
const RushHour = lazy(() => import("@food/pages/restaurant/RushHour"))
const OutletTimings = lazy(() => import("@food/pages/restaurant/OutletTimings"))
const DaySlots = lazy(() => import("@food/pages/restaurant/DaySlots"))
const OutletInfo = lazy(() => import("@food/pages/restaurant/OutletInfo"))
const RatingsReviews = lazy(() => import("@food/pages/restaurant/RatingsReviews"))
const EditOwner = lazy(() => import("@food/pages/restaurant/EditOwner"))
const EditCuisines = lazy(() => import("@food/pages/restaurant/EditCuisines"))
const EditRestaurantAddress = lazy(() => import("@food/pages/restaurant/EditRestaurantAddress"))
const Inventory = lazy(() => import("@food/pages/restaurant/Inventory"))
const Feedback = lazy(() => import("@food/pages/restaurant/Feedback"))
const ShareFeedback = lazy(() => import("@food/pages/restaurant/ShareFeedback"))
const DishRatings = lazy(() => import("@food/pages/restaurant/DishRatings"))
const RestaurantSupport = lazy(() => import("@food/pages/restaurant/RestaurantSupport"))
const FssaiDetails = lazy(() => import("@food/pages/restaurant/FssaiDetails"))
const FssaiUpdate = lazy(() => import("@food/pages/restaurant/FssaiUpdate"))
const Hyperpure = lazy(() => import("@food/pages/restaurant/Hyperpure"))
const ItemDetailsPage = lazy(() => import("@food/pages/restaurant/ItemDetailsPage"))
const HubFinance = lazy(() => import("@food/pages/restaurant/HubFinance"))
const FinanceDetailsPage = lazy(() => import("@food/pages/restaurant/FinanceDetailsPage"))
const WithdrawalHistoryPage = lazy(() => import("@food/pages/restaurant/WithdrawalHistoryPage"))
const PhoneNumbersPage = lazy(() => import("@food/pages/restaurant/PhoneNumbersPage"))
const DownloadReport = lazy(() => import("@food/pages/restaurant/DownloadReport"))

const ManageOutlets = lazy(() => import("@food/pages/restaurant/ManageOutlets"))
const UpdateBankDetails = lazy(() => import("@food/pages/restaurant/UpdateBankDetails"))
const ZoneSetup = lazy(() => import("@food/pages/restaurant/ZoneSetup"))
const DiningReservations = lazy(() => import("@food/pages/restaurant/DiningReservations"))

const Login = lazy(() => import("@food/pages/restaurant/auth/Login"))
const OTP = lazy(() => import("@food/pages/restaurant/auth/OTP"))
const Signup = lazy(() => import("@food/pages/restaurant/auth/Signup"))
const ForgotPassword = lazy(() => import("@food/pages/restaurant/auth/ForgotPassword"))
const VerificationPending = lazy(() => import("@food/pages/restaurant/auth/VerificationPending"))
const CMSHelpSupportPage = lazy(() => import("@food/pages/restaurant/CMSHelpSupportPage"))

export default function RestaurantRouter() {
  const { diningEnabled } = useModuleAccess()
  const location = useLocation()
  const navigate = useNavigate()
  // Lets back buttons pop the real history entry instead of stacking copies.
  useTrackRestaurantHistory()
  const isOnboarding = location.pathname.includes("/onboarding")

  // Root-level hook for restaurantTheme.css: the compact POS sizing works by
  // shrinking the html font-size (rem), so it has to live on <html> and must
  // not leak into the user/admin apps after leaving the restaurant panel.
  React.useEffect(() => {
    document.documentElement.classList.add("rt-panel")
    return () => document.documentElement.classList.remove("rt-panel")
  }, [])

  React.useEffect(() => {
    const handleAuthFailure = (e) => {
      if (e.detail?.module === "restaurant") {
        toast.error("Session Expired", { description: "Please log in again." })
        navigate("/food/restaurant/login", { replace: true })
      }
    }

    const handleStorageChange = (e) => {
      if (e.key === "restaurant_accessToken" && !e.newValue) {
        toast.error("Session Expired", { description: "Please log in again." })
        navigate("/food/restaurant/login", { replace: true })
      }
    }

    window.addEventListener("authRefreshFailed", handleAuthFailure)
    window.addEventListener("storage", handleStorageChange)
    
    return () => {
      window.removeEventListener("authRefreshFailed", handleAuthFailure)
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [navigate])

  return (
    <div className="restaurant-theme">
      {/* A runtime error in any screen used to blank the whole app. The boundary
          keeps the shell alive and shows a recoverable error state instead. */}
      <RouteErrorBoundary>
      {/* One offline state for every Restaurant screen. It overlays rather than
          replaces the tree, so in-progress form input survives a dropout. */}
      <RestaurantOfflineGate>
      <Suspense fallback={
        isOnboarding ? (
          <OnboardingSkeleton />
        ) : (
          <div className="min-h-screen bg-white dark:bg-[#141414] flex items-center justify-center">
            <div className="relative">
              <div className="w-10 h-10 border-[3px] border-gray-100/30 rounded-full"></div>
              <div className="absolute top-0 left-0 w-10 h-10 border-[3px] border-[#2E7D52] border-t-transparent rounded-full animate-spin"></div>
            </div>
          </div>
        )
      }>
        <Routes>
        {/* Auth Routes */}

        <Route path="login" element={<AuthRedirect module="restaurant"><Login /></AuthRedirect>} />
        <Route path="otp" element={<AuthRedirect module="restaurant"><Login /></AuthRedirect>} />
        <Route path="signup" element={<AuthRedirect module="restaurant"><Signup /></AuthRedirect>} />
        <Route path="forgot-password" element={<AuthRedirect module="restaurant"><ForgotPassword /></AuthRedirect>} />
        <Route path="pending-verification" element={<VerificationPending />} />

        {/* Protected Routes */}
        <Route element={
          <ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login">
            <RestaurantShell>
              <Outlet />
            </RestaurantShell>
          </ProtectedRoute>
        }>
          <Route path="" element={<OrdersMain />} />
          <Route path="orders" element={<Navigate to="/food/restaurant" replace />} />
          <Route path="orders/all" element={<AllOrdersPage />} />
          <Route path="orders/:id" element={<OrderDetails />} />
          <Route path="notifications" element={<RestaurantNotifications />} />
          <Route path="delivery-settings" element={<DeliverySettings />} />
          <Route path="rush-hour" element={<RushHour />} />
          <Route path="menu-categories" element={<MenuCategoriesPage />} />
          <Route path="offers" element={<RestaurantOffers />} />
          <Route path="status" element={<RestaurantStatus />} />
          <Route path="explore" element={<ExploreMore />} />
          <Route path="outlet-timings" element={<OutletTimings />} />
          <Route path="outlet-timings/:day" element={<DaySlots />} />
          <Route path="outlet-info" element={<OutletInfo />} />
          <Route path="ratings-reviews" element={<RatingsReviews />} />
          <Route path="reviews" element={<Navigate to="/food/restaurant/feedback?tab=reviews" replace />} />
          <Route path="edit-owner" element={<EditOwner />} />
          <Route path="edit-cuisines" element={<EditCuisines />} />
          <Route path="edit-address" element={<EditRestaurantAddress />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="share-feedback" element={<ShareFeedback />} />
          <Route path="dish-ratings" element={<DishRatings />} />
          <Route path="fssai" element={<FssaiDetails />} />
          <Route path="fssai/update" element={<FssaiUpdate />} />
          <Route path="hyperpure" element={<Hyperpure />} />
          <Route path="hub-menu/item/:id" element={<ItemDetailsPage />} />
          <Route path="hub-finance" element={<HubFinance />} />
          <Route path="withdrawal-history" element={<WithdrawalHistoryPage />} />
          <Route path="finance-details" element={<FinanceDetailsPage />} />
          <Route path="phone" element={<PhoneNumbersPage />} />
          <Route path="download-report" element={<DownloadReport />} />
          <Route path="manage-outlets" element={<ManageOutlets />} />
          <Route path="update-bank-details" element={<UpdateBankDetails />} />
          <Route path="reservations" element={diningEnabled ? <DiningReservations /> : <Navigate to="/food/restaurant" replace />} />
          <Route path="dining-reservations" element={diningEnabled ? <DiningReservations /> : <Navigate to="/food/restaurant" replace />} />
          <Route path="zone-setup" element={<ZoneSetup />} />
        </Route>
        <Route path="onboarding" element={<RestaurantOnboarding />} />
        <Route path="onboarding/payment" element={<RestaurantOnboardingPayment />} />
        
        {/* Public Legal & Support Routes */}
        <Route path="privacy" element={<RestaurantShellIfSignedIn><PrivacyPolicyPage /></RestaurantShellIfSignedIn>} />
        <Route path="terms" element={<RestaurantShellIfSignedIn><TermsAndConditionsPage /></RestaurantShellIfSignedIn>} />
        <Route path="help-centre/support" element={<RestaurantShellIfSignedIn><RestaurantSupport /></RestaurantShellIfSignedIn>} />
        <Route path="help-content" element={<RestaurantShellIfSignedIn><CMSHelpSupportPage /></RestaurantShellIfSignedIn>} />
        </Routes>
      </Suspense>
      </RestaurantOfflineGate>
      </RouteErrorBoundary>
    </div>
  )
}







