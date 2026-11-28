import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AuthRedirect from "@food/components/AuthRedirect"
import Loader from "@food/components/Loader";

// Auth Pages (Lazy loaded)

const SignIn = lazy(() => import("./pages/auth/SignIn"))
const OTP = lazy(() => import("./pages/auth/OTP"))
const SignupStep1 = lazy(() => import("./pages/auth/SignupStep1"))
const SignupStep2 = lazy(() => import("./pages/auth/SignupStep2"))
const VerificationPending = lazy(() => import("./pages/auth/VerificationPending"))

// V2 Pages
import DeliveryHomeV2 from './pages/DeliveryHomeV2';
import OrdersV2 from './pages/OrdersV2';
import DeliveryRealtimeShell from './components/DeliveryRealtimeShell';
import { PayoutV2 } from './pages/pocket/PayoutV2';
import { PocketStatementV2 } from './pages/pocket/PocketStatementV2';
import { DeductionStatementV2 } from './pages/pocket/DeductionStatementV2';
import { LimitSettlementV2 } from './pages/pocket/LimitSettlementV2';
import { PocketBalanceV2 } from './pages/pocket/PocketBalanceV2';
import { CashLimitInfoV2 } from './pages/pocket/CashLimitInfoV2';
import { ProfileBankV2 } from './pages/profile/ProfileBankV2';
import { ProfileDocsV2 } from './pages/profile/ProfileDocsV2';
import { SupportTicketsV2 } from './pages/help/SupportTicketsV2';
import { CreateSupportTicketV2 } from './pages/help/CreateSupportTicketV2';
import { ViewSupportTicketV2 } from './pages/help/ViewSupportTicketV2';
import ShowIdCardV2 from './pages/help/ShowIdCardV2';
import DeliveryFeedbackV2 from './pages/help/DeliveryFeedbackV2';
import { PocketDetailsV2 } from './pages/pocket/PocketDetailsV2';
import { ProfileDetailsV2 } from './pages/profile/ProfileDetailsV2';
import { MyReviewsV2 } from './pages/profile/MyReviewsV2';
import TermsAndConditionsV2 from './pages/TermsAndConditionsV2';
import PrivacyPolicyV2 from './pages/PrivacyPolicyV2';
import DeliveryCMSHelpSupportPage from './pages/CMSHelpSupportPage';
import NotificationsV2 from './pages/NotificationsV2';



const DeliveryV2Router = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    const handleAuthFailure = (e) => {
      if (e.detail?.module === "delivery") {
        navigate("/food/delivery/login", { replace: true });
      }
    };
    
    // Listen for cross-tab logouts (e.g., if Incognito logs out, Chrome logs out instantly)
    const handleStorageChange = (e) => {
      if (e.key === "delivery_accessToken" && !e.newValue) {
        navigate("/food/delivery/login", { replace: true });
      }
    };

    window.addEventListener("authRefreshFailed", handleAuthFailure);
    window.addEventListener("storage", handleStorageChange);
    
    return () => {
      window.removeEventListener("authRefreshFailed", handleAuthFailure);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [navigate]);

  return (
    <Suspense fallback={<div className="min-h-screen w-full flex items-center justify-center bg-[#121212]"><div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <Routes>
        {/* Auth routes */}

        <Route path="login" element={<AuthRedirect module="delivery"><SignIn /></AuthRedirect>} />
        <Route path="otp" element={<AuthRedirect module="delivery"><SignIn /></AuthRedirect>} />
        <Route path="signup" element={<AuthRedirect module="delivery"><Navigate to="/food/delivery/login" replace /></AuthRedirect>} />
        <Route path="signup/details" element={<AuthRedirect module="delivery"><SignupStep1 /></AuthRedirect>} />
        <Route path="signup/documents" element={<AuthRedirect module="delivery"><SignupStep2 /></AuthRedirect>} />
        <Route path="pending-verification" element={<VerificationPending />} />
        <Route path="terms" element={<TermsAndConditionsV2 />} />
        <Route path="privacy" element={<PrivacyPolicyV2 />} />
        <Route path="profile/terms" element={<TermsAndConditionsV2 />} />
        <Route path="profile/privacy" element={<PrivacyPolicyV2 />} />
        <Route path="help/content" element={<DeliveryCMSHelpSupportPage />} />

        {/* Protected Core Routes */}
        <Route element={
          <ProtectedRoute>
            <DeliveryRealtimeShell />
          </ProtectedRoute>
        }>
          <Route path="" element={<DeliveryHomeV2 tab="feed" />} />
          <Route path="feed" element={<DeliveryHomeV2 tab="feed" />} />
          <Route path="orders" element={<OrdersV2 />} />
          <Route path="pocket" element={<DeliveryHomeV2 tab="pocket" />} />
          <Route path="history" element={<DeliveryHomeV2 tab="history" />} />
          <Route path="profile" element={<DeliveryHomeV2 tab="profile" />} />
          <Route path="notifications" element={<NotificationsV2 />} />
          <Route path="profile/details" element={<ProfileDetailsV2 />} />
          <Route path="profile/reviews" element={<MyReviewsV2 />} />
          <Route path="profile/bank" element={<ProfileBankV2 />} />
          <Route path="profile/documents" element={<ProfileDocsV2 />} />
          
          {/* Support Systems */}
          <Route path="help/tickets" element={<SupportTicketsV2 />} />
          <Route path="help/tickets/create" element={<CreateSupportTicketV2 />} />
          <Route path="help/tickets/:ticketId" element={<ViewSupportTicketV2 />} />
          <Route path="help/id-card" element={<ShowIdCardV2 />} />
          <Route path="help/feedback" element={<DeliveryFeedbackV2 />} />
          <Route path="profile/feedback" element={<DeliveryFeedbackV2 />} />
          {/* Financial Deep-Pages */}
          <Route path="pocket/payout" element={<PayoutV2 />} />
          <Route path="pocket/statement" element={<PocketStatementV2 />} />
          <Route path="pocket/deductions" element={<DeductionStatementV2 />} />
          <Route path="pocket/limit-settlement" element={<LimitSettlementV2 />} />
          <Route path="pocket/balance" element={<PocketBalanceV2 />} />
          <Route path="pocket/cash-limit" element={<CashLimitInfoV2 />} />
          <Route path="pocket/details" element={<PocketDetailsV2 />} />
          <Route path="earnings" element={<Navigate to="/food/delivery/pocket/details" replace />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/food/delivery" replace />} />
      </Routes>
    </Suspense>
  );
};

export default DeliveryV2Router;
