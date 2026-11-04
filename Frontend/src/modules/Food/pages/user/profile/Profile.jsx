import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useNavigationType, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { applyThemeForPath, getSavedTheme, saveTheme } from "@/shared/utils/appTheme";
import {
  ArrowLeft,
  ChevronRight,
  Wallet,
  Tag,
  User,
  Leaf,
  Palette,
  Bookmark,
  Building2,
  Moon,
  Sun,
  Check,
  Percent,
  Info,
  PenSquare,
  AlertTriangle,
  Settings as SettingsIcon,
  Power,
  ShoppingCart,
  MapPin,
  Share2,
  Utensils,
  Trash2,
  Pencil,
  Camera,
  Upload,
  LifeBuoy
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@food/components/ui/dropdown-menu";

import { getAvatarColor } from "@food/utils/avatarUtils";
import { normalizeImageUrl } from "@food/utils/common";

import AnimatedPage from "@food/components/user/AnimatedPage";
import { Card, CardContent } from "@food/components/ui/card";
import { Button } from "@food/components/ui/button";
import { useProfile } from "@food/context/ProfileContext";
import { useLocationSelector } from "@food/components/user/UserLayout";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@food/components/ui/avatar";
import { useCompanyName } from "@food/hooks/useCompanyName";
import OptimizedImage from "@food/components/OptimizedImage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog";
import { authAPI, userAPI } from "@food/api";
import { firebaseAuth } from "@food/firebase";
import { clearModuleAuth } from "@food/utils/auth";
import { toast } from "sonner";
import { showAccountDeletedToast } from "@/shared/utils/customToasts";
import { resolveProfileBackPath } from "@food/utils/mainTabRoutes";
import useModuleAccess from "@food/hooks/useModuleAccess";

const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };
const USER_SESSION_PREFERENCE_KEYS = ["userVegMode", "userVegModeOption", "food-under-250-filters"];


export default function Profile() {
  const { diningEnabled } = useModuleAccess();
  const { userProfile, vegMode, setVegMode, vegModeOption, setVegModeOption, getDefaultAddress, addresses, updateUserProfile } =
    useProfile();
  const { openLocationSelector } = useLocationSelector();
  const navigate = useNavigate();
  const location = useLocation();
  const companyName = useCompanyName();
  const defaultAddress = getDefaultAddress?.();
  const savedAddressSummary = defaultAddress
    ? [
      defaultAddress.street,
      defaultAddress.additionalDetails,
      defaultAddress.city,
      defaultAddress.state,
      defaultAddress.zipCode,
    ]
      .filter(Boolean)
      .join(", ")
    : "No address saved. Tap to save Home, Work, or Other.";

  // Popup states
  const [vegModeOpen, setVegModeOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [referralReward, setReferralReward] = useState(0);
  const [walletBalance, setWalletBalance] = useState(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteCaptcha, setDeleteCaptcha] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBalanceWarning, setShowBalanceWarning] = useState(false);
  const [balanceData, setBalanceData] = useState({ balance: 0, type: "Wallet" });
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);



  const navType = useNavigationType();

  // Scroll Restoration
  useEffect(() => {
    if (navType === "POP") {
      const savedScroll = sessionStorage.getItem("profileScrollPos");
      if (savedScroll) {
        setTimeout(() => window.scrollTo(0, parseInt(savedScroll, 10)), 50);
      }
    } else {
      window.scrollTo(0, 0);
    }

    const handleScroll = () => {
      sessionStorage.setItem("profileScrollPos", window.scrollY.toString());
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [navType]);

  // Lock scroll when any popup is open
  useEffect(() => {
    const isPopupOpen = logoutConfirmOpen || deleteAccountOpen || showBalanceWarning || vegModeOpen || appearanceOpen;
    if (isPopupOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [logoutConfirmOpen, deleteAccountOpen, showBalanceWarning, vegModeOpen, appearanceOpen]);

  const handleVegModeUpdate = (nextValue) => {
    setVegMode(nextValue);
    localStorage.setItem("userVegMode", String(nextValue));
  };

  const handleVegModeOptionUpdate = (nextOption) => {
    setVegModeOption(nextOption);
    if (!vegMode) {
      setVegMode(true);
      localStorage.setItem("userVegMode", "true");
    }
  };

  // Settings states
  const [appearance, setAppearance] = useState(() => {
    // Load theme from localStorage or default to 'light'
    return getSavedTheme();
  });

  // Apply theme to document. Saved first, then applied through the shared
  // helper so the preference stays scoped to the user app - the restaurant,
  // delivery and admin panels are light-only and share the same <html>.
  useEffect(() => {
    saveTheme(appearance);
    applyThemeForPath(window.location.pathname);
  }, [appearance]);

  // Get first letter of name for avatar
  const avatarInitial =
    userProfile?.name?.charAt(0)?.toUpperCase() ||
    userProfile?.phone?.charAt(1)?.toUpperCase() ||
    "U";
  const displayName = userProfile?.name || userProfile?.phone || "User";
  // Only show email if it exists and is valid, otherwise show phone or "Not available"
  const hasValidEmail =
    userProfile?.email &&
    userProfile.email.trim() !== "" &&
    userProfile.email.includes("@");
  const displayEmail = hasValidEmail
    ? userProfile.email
    : userProfile?.phone || "Not available";

  // Calculate profile completion percentage
  const calculateProfileCompletion = () => {
    if (!userProfile) return 0;

    // Helper function to check if date field is filled (handles Date objects, date strings, ISO strings)
    const isDateFilled = (dateField) => {
      if (!dateField) return false;

      // Check if it's a Date object
      if (dateField instanceof Date) {
        return !isNaN(dateField.getTime());
      }

      // Check if it's a string
      if (typeof dateField === "string") {
        const trimmed = dateField.trim();
        if (trimmed === "" || trimmed === "null" || trimmed === "undefined")
          return false;

        // Try to parse as date (handles various formats: YYYY-MM-DD, ISO strings, etc.)
        const date = new Date(trimmed);
        if (!isNaN(date.getTime())) {
          // Valid date
          return true;
        }
      }

      return false;
    };

    // Check name - must have value
    const hasName = !!(
      userProfile.name &&
      typeof userProfile.name === "string" &&
      userProfile.name.trim() !== ""
    );

    // Check contact - phone OR email (at least one)
    const hasPhone = !!(
      userProfile.phone &&
      typeof userProfile.phone === "string" &&
      userProfile.phone.trim() !== ""
    );
    const hasContact = hasPhone || hasValidEmail;

    // Check profile image - must have URL string
    const hasImage = !!(
      userProfile.profileImage &&
      typeof userProfile.profileImage === "string" &&
      userProfile.profileImage.trim() !== "" &&
      userProfile.profileImage !== "null" &&
      userProfile.profileImage !== "undefined"
    );

    // Check date of birth
    const hasDateOfBirth = isDateFilled(userProfile.dateOfBirth);

    // Check gender - must be valid value
    const validGenders = ["male", "female", "other", "prefer-not-to-say"];
    const hasGender = !!(
      userProfile.gender &&
      typeof userProfile.gender === "string" &&
      userProfile.gender.trim() !== "" &&
      validGenders.includes(userProfile.gender.trim().toLowerCase())
    );

    // Required fields only (anniversary is NOT counted - it's optional)
    // Only these 5 fields count towards 100%
    const requiredFields = {
      name: hasName,
      contact: hasContact,
      profileImage: hasImage,
      dateOfBirth: hasDateOfBirth,
      gender: hasGender,
    };

    const totalRequiredFields = 5; // Fixed: name, contact, profileImage, dateOfBirth, gender
    const completedRequiredFields =
      Object.values(requiredFields).filter(Boolean).length;

    // Calculate percentage based ONLY on required fields (anniversary NOT included)
    const percentage = Math.round(
      (completedRequiredFields / totalRequiredFields) * 100,
    );

    // Always log for debugging (remove in production if needed)
    debugLog("?? Profile completion check:", {
      requiredFields,
      completedRequiredFields,
      totalRequiredFields,
      percentage,
      fieldStatus: {
        name: hasName ? "?" : "?",
        contact: hasContact ? "?" : "?",
        profileImage: hasImage ? "?" : "?",
        dateOfBirth: hasDateOfBirth ? "?" : "?",
        gender: hasGender ? "?" : "?",
      },
      rawData: {
        name: userProfile.name || "missing",
        phone: userProfile.phone || "missing",
        email: userProfile.email || "missing",
        profileImage: userProfile.profileImage ? "exists" : "missing",
        dateOfBirth: userProfile.dateOfBirth
          ? String(userProfile.dateOfBirth)
          : "missing",
        gender: userProfile.gender || "missing",
      },
    });

    return percentage;
  };

  const profileCompletion = calculateProfileCompletion();
  const isComplete = profileCompletion === 100;
  useEffect(() => {
    let mounted = true;
    userAPI
      .getReferralStats()
      .then((res) => {
        const reward = res?.data?.data?.stats?.rewardAmount;
        if (mounted) setReferralReward(Number(reward) || 0);
      })
      .catch(() => { });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    userAPI
      .getWallet()
      .then((res) => {
        const w = res?.data?.data?.wallet || res?.data?.wallet;
        const bal = Number(w?.balance);
        if (mounted) setWalletBalance(Number.isFinite(bal) ? bal : 0);
      })
      .catch(() => { });
    return () => {
      mounted = false;
    };
  }, []);

  const refId =
    userProfile?._id || userProfile?.id || userProfile?.referralCode || "";
  const referralLink = refId
    ? `${window.location.origin}/food/user/auth/login?ref=${encodeURIComponent(String(refId))}`
    : "";

  const handleShareReferral = async () => {
    if (!referralLink) return;
    const rewardText = referralReward > 0 ? `\u20B9${referralReward}` : "rewards";
    const shareText = `Join ${companyName} and earn ${rewardText}.`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${companyName} referral`,
          text: shareText,
          url: referralLink,
        });
      } else {
        const fallbackUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`;
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      debugError("Failed to share referral:", error);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    if (isLoggingOut) return; // Prevent multiple clicks

    setIsLoggingOut(true);

    try {
      // Call backend logout API to invalidate refresh token
      try {
        let fcmToken = null;
        let platform = "web";
        try {
          if (typeof window !== "undefined") {
            if (window.flutter_inappwebview) {
              platform = "mobile";
              const handlerNames = [
                "getFcmToken",
                "getFCMToken",
                "getPushToken",
                "getFirebaseToken",
              ];
              for (const handlerName of handlerNames) {
                try {
                  const t = await window.flutter_inappwebview.callHandler(
                    handlerName,
                    { module: "user" },
                  );
                  if (t && typeof t === "string" && t.length > 20) {
                    fcmToken = t.trim();
                    break;
                  }
                } catch (e) { }
              }
            } else {
              fcmToken =
                localStorage.getItem("fcm_web_registered_token_user") || null;
            }
          }
        } catch (e) {
          console.warn("Failed to get FCM token during logout", e);
        }
        await authAPI.logout(null, fcmToken, platform);
      } catch (apiError) {
        // Continue with logout even if API call fails (network issues, etc.)
        debugWarn(
          "Logout API call failed, continuing with local cleanup:",
          apiError,
        );
      }

      // Sign out from Firebase if user logged in via Google
      try {
        const { signOut } = await import("firebase/auth");
        // Firebase Auth is lazy-initialized now; only attempt sign out if it was actually used
        if (firebaseAuth) {
          const currentUser = firebaseAuth.currentUser;
          if (currentUser) {
            await signOut(firebaseAuth);
          }
        }
      } catch (firebaseError) {
        // Continue even if Firebase logout fails
        debugWarn(
          "Firebase logout failed, continuing with local cleanup:",
          firebaseError,
        );
      }

      // Clear user module authentication data using utility function
      clearModuleAuth("user");

      // Clear legacy token data for backward compatibility
      localStorage.removeItem("accessToken");
      localStorage.removeItem("user_authenticated");
      localStorage.removeItem("user_user");
      localStorage.removeItem("user");
      localStorage.removeItem("cart");
      USER_SESSION_PREFERENCE_KEYS.forEach((key) => localStorage.removeItem(key));

      // Dispatch auth change event to notify other components
      window.dispatchEvent(new Event("userAuthChanged"));

      // Navigate to sign in page
      navigate("/user/auth/login", { replace: true });
    } catch (err) {
      // Even if there's an error, we should still clear local data and logout
      debugError("Error during logout:", err);

      // Clear local data anyway using utility function
      clearModuleAuth("user");

      // Clear legacy token data for backward compatibility
      localStorage.removeItem("accessToken");
      localStorage.removeItem("user_authenticated");
      localStorage.removeItem("user_user");
      localStorage.removeItem("user");
      localStorage.removeItem("cart");
      USER_SESSION_PREFERENCE_KEYS.forEach((key) => localStorage.removeItem(key));
      window.dispatchEvent(new Event("userAuthChanged"));

      // Still navigate to login page
      navigate("/user/auth/login", { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleLogoutClick = () => {
    if (isLoggingOut) return;
    setLogoutConfirmOpen(true);
  };

  const handleDeleteAccount = async () => {
    if (isDeleting || deleteCaptcha !== "DELETE") return;
    setIsDeleting(true);
    try {
      await authAPI.deleteAccount("user");

      showAccountDeletedToast();

      // Clear user module authentication data
      clearModuleAuth("user");

      // Dispatch auth change event to notify other components
      window.dispatchEvent(new Event("userAuthChanged"));

      // Navigate to sign in page
      navigate("/user/auth/login", { replace: true });
    } catch (error) {
      debugError("Error deleting account:", error);
      toast.error(error?.response?.data?.message || "Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
      setDeleteAccountOpen(false);
    }
  };

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#141414]">
      <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-6 md:py-8 lg:py-10 pb-20 sm:pb-24">
        {/* Header: Back Arrow */}
        <div className="flex items-center mb-5">
          <button
            onClick={() => navigate(resolveProfileBackPath(location.state?.from))}
            className="h-11 w-11 flex items-center justify-center bg-white/70 dark:bg-[#242424]/70 backdrop-blur-md rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:bg-white/90 dark:hover:bg-[#222]/90 active:scale-95 transition-all outline-none border border-black/10 dark:border-white/10"
          >
            <ArrowLeft className="h-6 w-6 text-black dark:text-white" />
          </button>
        </div>

        {/* Profile Info Card */}
        <Card className="bg-white dark:bg-[#242424] py-0 rounded-[20px] shadow-[0_4px_16px_rgba(0,0,0,0.02)] mb-0 border-0 dark:border-gray-800 overflow-hidden">
          <CardContent className="p-4 py-2.3">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-16 w-16 border border-gray-100 dark:border-gray-800 shadow-sm bg-transparent">
                  {(userProfile?.localImagePreview || (userProfile?.profileImage && typeof userProfile.profileImage === "string" && userProfile.profileImage.trim() !== "" && userProfile.profileImage !== "null" && userProfile.profileImage !== "undefined")) ? (
                    <img
                      src={userProfile?.localImagePreview || normalizeImageUrl(userProfile.profileImage)}
                      alt={displayName}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <img
                      src="/assets/images/profile_avatar.webp"
                      alt={displayName}
                      className="w-full h-full object-cover rounded-full"
                    />
                  )}
                </Avatar>
              </div>
              <div className="flex-1">
                <h2 className="text-[19px] font-bold text-gray-900 dark:text-white leading-tight capitalize">
                  {displayName}
                </h2>
                {hasValidEmail && (
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {userProfile.email}
                  </p>
                )}
                {userProfile?.phone && (
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {userProfile.phone}
                  </p>
                )}
                {!hasValidEmail && !userProfile?.phone && (
                  <p className="text-[13px] text-gray-400 mt-0.5">
                    Not available
                  </p>
                )}
                <Link
                  to="/user/profile/edit"
                  className="inline-flex items-center text-[13px] font-medium text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white mt-1 transition-colors"
                >
                  <span>Edit profile</span>
                  <span className="text-[9px] ml-1 leading-none text-gray-500 dark:text-gray-400">▶</span>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Options */}
        <div className="space-y-2 mb-3 mt-3">
          <Link to="/food/user/wallet" state={{ from: "/food/user/profile" }} className="block">
            <motion.div
              whileHover={{ x: 4, scale: 1.01 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
              <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                      whileHover={{ rotate: 15, scale: 1.1 }}
                      transition={{ duration: 0.3 }}>
                      <Wallet className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                    </motion.div>
                    <span className="text-base font-medium text-gray-900 dark:text-white">
                      {companyName} Money
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {walletBalance === null ? (
                      <span className="inline-block w-12 h-4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                    ) : (
                      <span className="text-base font-semibold text-green-600 dark:text-green-400">
                        {"\u20B9"}{Number(walletBalance).toFixed(0)}
                      </span>
                    )}
                    <motion.div
                      whileHover={{ x: 4 }}
                      transition={{ duration: 0.2 }}>
                      <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </motion.div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </Link>

          <Link to="/user/profile/coupons" className="block">
            <motion.div
              whileHover={{ x: 4, scale: 1.01 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
              <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                      whileHover={{ rotate: 15, scale: 1.1 }}
                      transition={{ duration: 0.3 }}>
                      <Tag className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                    </motion.div>
                    <span className="text-base font-medium text-gray-900 dark:text-white">
                      Your coupons
                    </span>
                  </div>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </Link>

          <Link to="/user/profile/refer-earn" className="block">
            <motion.div
              whileHover={{ x: 4, scale: 1.01 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
              <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                      whileHover={{ rotate: 15, scale: 1.1 }}
                      transition={{ duration: 0.3 }}>
                      <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                    </motion.div>
                    <span className="text-base font-medium text-gray-900 dark:text-white">
                      Refer & Earn
                    </span>
                  </div>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </Link>

          <Link to="/user/cart" className="block">
            <motion.div
              whileHover={{ x: 4, scale: 1.01 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
              <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                      whileHover={{ rotate: 15, scale: 1.1 }}
                      transition={{ duration: 0.3 }}>
                      <ShoppingCart className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                    </motion.div>
                    <span className="text-base font-medium text-gray-900 dark:text-white">
                      Your cart
                    </span>
                  </div>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </Link>


          <motion.div
            whileHover={{ x: 4, scale: 1.01 }}
            transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
            <Card
              className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer"
              onClick={openLocationSelector}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <motion.div
                    className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                    whileHover={{ rotate: 15, scale: 1.1 }}
                    transition={{ duration: 0.3 }}>
                    <MapPin className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                  </motion.div>
                  <div className="min-w-0">
                    <p className="text-base font-medium text-gray-900 dark:text-white">
                      Saved addresses
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {savedAddressSummary}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                    {addresses?.length || 0}
                  </span>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </div>
              </CardContent>
            </Card>
          </motion.div>


          <motion.div
            whileHover={{ x: 4, scale: 1.01 }}
            transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
            <Card
              className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer"
              onClick={() => setVegModeOpen(true)}>
              <CardContent className="p-4  flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <motion.div
                    className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                    whileHover={{ rotate: 15, scale: 1.1 }}
                    transition={{ duration: 0.3 }}>
                    <Leaf className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                  </motion.div>
                  <span className="text-base font-medium text-gray-900 dark:text-white">
                    Veg Mode
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <motion.span
                    className="text-base font-medium text-gray-900 dark:text-white"
                    whileHover={{ scale: 1.1 }}
                    transition={{ duration: 0.2 }}>
                    {vegMode
                      ? vegModeOption === "pure-veg"
                        ? "Pure Veg"
                        : "All restaurants"
                      : "OFF"}
                  </motion.span>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </motion.div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            whileHover={{ x: 4, scale: 1.01 }}
            transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
            <Card
              className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer"
              onClick={() => setAppearanceOpen(true)}>
              <CardContent className="p-4  flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <motion.div
                    className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                    whileHover={{ rotate: 15, scale: 1.1 }}
                    transition={{ duration: 0.3 }}>
                    <Palette className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                  </motion.div>
                  <span className="text-base font-medium text-gray-900 dark:text-white">
                    Appearance
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <motion.span
                    className="text-base font-medium text-gray-900 dark:text-white capitalize"
                    whileHover={{ scale: 1.1 }}
                    transition={{ duration: 0.2 }}>
                    {appearance}
                  </motion.span>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </motion.div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Collections Section */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-1 h-4 bg-[#1F6B45] rounded"></div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Collections
            </h3>
          </div>
          <Link to="/user/profile/favorites">
            <motion.div
              whileHover={{ x: 4, scale: 1.01 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
              <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                <CardContent className="p-4  flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                      whileHover={{ rotate: 15, scale: 1.1 }}
                      transition={{ duration: 0.3 }}>
                      <Bookmark className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                    </motion.div>
                    <span className="text-base font-medium text-gray-900 dark:text-white">
                      Your collections
                    </span>
                  </div>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </Link>
        </div>

        {/* Dining Section — gated by diningEnabled */}
        {diningEnabled && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-1 h-4 bg-[#1F6B45] rounded"></div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Dining Bookings
            </h3>
          </div>
          <Link to="/user/profile/dining-bookings">
            <motion.div
              whileHover={{ x: 4, scale: 1.01 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
              <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                      whileHover={{ rotate: 15, scale: 1.1 }}
                      transition={{ duration: 0.3 }}>
                      <Utensils className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                    </motion.div>
                    <div className="flex flex-col">
                      <span className="text-base font-medium text-gray-900 dark:text-white">
                        Your reservations
                      </span>
                      <span className="text-[10px] text-gray-500">View table booking status</span>
                    </div>
                  </div>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </Link>
        </div>
        )}

        {/* Food Orders Section */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-1 h-4 bg-[#1F6B45] rounded"></div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Food Orders
            </h3>
          </div>
          <div className="space-y-2">
            <Link to="/food/user/orders" state={{ from: "profile", backTo: "/food/user/profile" }} className="block">
              <motion.div
                whileHover={{ x: 4, scale: 1.01 }}
                transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
                <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <motion.div
                        className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                        whileHover={{ rotate: 15, scale: 1.1 }}
                        transition={{ duration: 0.3 }}>
                        <Building2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      </motion.div>
                      <span className="text-base font-medium text-gray-900 dark:text-white">
                        Your orders
                      </span>
                    </div>
                    <motion.div
                      whileHover={{ x: 4 }}
                      transition={{ duration: 0.2 }}>
                      <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </Link>
          </div>
        </div>

        {/* More Section */}
        <div className="mb-8 pb-8">
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-1 h-4 bg-[#1F6B45] rounded"></div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              More
            </h3>
          </div>
          <div className="space-y-2">
            <Link to="/user/profile/support" className="block">
              <motion.div
                whileHover={{ x: 4, scale: 1.01 }}
                transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
                <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <motion.div
                        className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                        whileHover={{ rotate: 15, scale: 1.1 }}
                        transition={{ duration: 0.3 }}>
                        <LifeBuoy className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      </motion.div>
                      <span className="text-base font-medium text-gray-900 dark:text-white">
                        Help & Support
                      </span>
                    </div>
                    <motion.div
                      whileHover={{ x: 4 }}
                      transition={{ duration: 0.2 }}>
                      <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </Link>

            <Link to="/user/profile/about" className="block">
              <motion.div
                whileHover={{ x: 4, scale: 1.01 }}
                transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
                <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <motion.div
                        className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                        whileHover={{ rotate: 15, scale: 1.1 }}
                        transition={{ duration: 0.3 }}>
                        <Info className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      </motion.div>
                      <span className="text-base font-medium text-gray-900 dark:text-white">
                        About
                      </span>
                    </div>
                    <motion.div
                      whileHover={{ x: 4 }}
                      transition={{ duration: 0.2 }}>
                      <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </Link>

            <Link to="/user/profile/report-safety-emergency" className="block">
              <motion.div
                whileHover={{ x: 4, scale: 1.01 }}
                transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
                <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <motion.div
                        className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                        whileHover={{ rotate: 15, scale: 1.1 }}
                        transition={{ duration: 0.3 }}>
                        <AlertTriangle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      </motion.div>
                      <span className="text-base font-medium text-gray-900 dark:text-white">
                        Report a safety emergency
                      </span>
                    </div>
                    <motion.div
                      whileHover={{ x: 4 }}
                      transition={{ duration: 0.2 }}>
                      <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </Link>

            <Link to="/user/profile/settings" className="block">
              <motion.div
                whileHover={{ x: 4, scale: 1.01 }}
                transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
                <Card className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <motion.div
                        className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                        whileHover={{ rotate: 15, scale: 1.1 }}
                        transition={{ duration: 0.3 }}>
                        <SettingsIcon className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      </motion.div>
                      <span className="text-base font-medium text-gray-900 dark:text-white">
                        Settings
                      </span>
                    </div>
                    <motion.div
                      whileHover={{ x: 4 }}
                      transition={{ duration: 0.2 }}>
                      <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </Link>

            <motion.div
              whileHover={{ x: 4, scale: 1.01 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300 }}>
              <Card
                className="bg-white dark:bg-[#242424] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleLogoutClick}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="bg-gray-100 dark:bg-gray-800 rounded-full p-2"
                      whileHover={{ rotate: 15, scale: 1.1 }}
                      transition={{ duration: 0.3 }}>
                      <Power
                        className={`h-5 w-5 text-gray-900 dark:text-white ${isLoggingOut ? "animate-pulse" : ""}`}
                      />
                    </motion.div>
                    <span className="text-base font-bold text-gray-900 dark:text-white">
                      {isLoggingOut ? "Logging out..." : "Log out"}
                    </span>
                  </div>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Veg Mode Popup */}
      <Dialog open={vegModeOpen} onOpenChange={setVegModeOpen}>
        <DialogContent className="max-w-sm md:max-w-md lg:max-w-lg w-[calc(100%-2rem)] rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle className="text-lg font-bold text-gray-900">
              Veg Mode
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Filter restaurants and dishes based on your dietary preferences
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 pb-5">
            <button
              onClick={() => {
                handleVegModeOptionUpdate("all");
                setVegModeOpen(false);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center justify-between ${vegMode && vegModeOption === "all"
                ? "border-green-600 bg-green-50"
                : "border-gray-200 bg-white hover:border-gray-300"
                }`}>
              <div className="flex items-center gap-3">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${vegMode && vegModeOption === "all"
                    ? "border-green-600 bg-green-600"
                    : "border-gray-300"
                    }`}>
                  {vegMode && vegModeOption === "all" && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900 text-sm">
                    All restaurants
                  </p>
                  <p className="text-xs text-gray-500">
                    Veg dishes from every restaurant
                  </p>
                </div>
              </div>
              <Leaf
                className={`h-5 w-5 ${vegMode && vegModeOption === "all" ? "text-green-600" : "text-gray-400"}`}
              />
            </button>
            <button
              onClick={() => {
                handleVegModeOptionUpdate("pure-veg");
                setVegModeOpen(false);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center justify-between ${vegMode && vegModeOption === "pure-veg"
                ? "border-green-600 bg-green-50"
                : "border-gray-200 bg-white hover:border-gray-300"
                }`}>
              <div className="flex items-center gap-3">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${vegMode && vegModeOption === "pure-veg"
                    ? "border-green-600 bg-green-600"
                    : "border-gray-300"
                    }`}>
                  {vegMode && vegModeOption === "pure-veg" && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900 text-sm">
                    Pure Veg restaurants only
                  </p>
                  <p className="text-xs text-gray-500">
                    Hide restaurants that serve non-veg
                  </p>
                </div>
              </div>
              <Leaf
                className={`h-5 w-5 ${vegMode && vegModeOption === "pure-veg" ? "text-green-600" : "text-gray-400"}`}
              />
            </button>
            {/* DISABLED: "Vegan restaurants only" is no longer a selectable
                food preference — only Veg, Non-Veg and Mixed are offered.
                Kept here (commented, not deleted) so it can be restored.
            <button
              onClick={() => {
                handleVegModeOptionUpdate("pure-vegan");
                setVegModeOpen(false);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center justify-between ${vegMode && vegModeOption === "pure-vegan"
                ? "border-green-600 bg-green-50"
                : "border-gray-200 bg-white hover:border-gray-300"
                }`}>
              <div className="flex items-center gap-3">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${vegMode && vegModeOption === "pure-vegan"
                    ? "border-green-600 bg-green-600"
                    : "border-gray-300"
                    }`}>
                  {vegMode && vegModeOption === "pure-vegan" && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900 text-sm">
                    Vegan restaurants only
                  </p>
                  <p className="text-xs text-gray-500">
                    Only vegan restaurants — no dairy, ghee, or animal products
                  </p>
                </div>
              </div>
              <Leaf
                className={`h-5 w-5 ${vegMode && vegModeOption === "pure-vegan" ? "text-green-600" : "text-gray-400"}`}
              />
            </button>
            */}
            <button
              onClick={() => {
                handleVegModeUpdate(false);
                setVegModeOpen(false);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center justify-between ${!vegMode
                ? "border-[#14512F] bg-[#fdfafc] dark:bg-[#0F3D24]/10"
                : "border-gray-200 dark:border-gray-800 bg-white hover:border-gray-300"
                }`}>
              <div className="flex items-center gap-3">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${!vegMode ? "border-[#14512F] bg-[#14512F]" : "border-gray-300"
                    }`}>
                  {!vegMode && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900 text-sm">
                    Veg Mode OFF
                  </p>
                  <p className="text-xs text-gray-500">Show all options</p>
                </div>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Logout Confirmation Popup */}
      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto bg-black/60 backdrop-blur-sm">
          <div className="flex min-h-screen items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-sm rounded-2xl bg-white/75 dark:bg-[#242424]/75 backdrop-blur-md shadow-2xl border border-white/20 dark:border-white/10 overflow-hidden p-6 text-center">

              <div className="flex flex-col items-center mb-4">
                <div className="w-14 h-14 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-3">
                  <Power className="h-7 w-7 text-[#FF3131]" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  Log out?
                </h3>
              </div>

              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                Are you sure you want to log out?
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLogoutConfirmOpen(false)}
                  disabled={isLoggingOut}
                  className="flex-1 h-12 rounded-xl text-md font-bold border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#262626] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors outline-none"
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLogoutConfirmOpen(false);
                    handleLogout();
                  }}
                  disabled={isLoggingOut}
                  className="flex-1 h-12 rounded-xl bg-[#FF3131] hover:bg-[#E02626] text-white text-md font-bold shadow-lg shadow-red-500/20 active:scale-95 transition-all outline-none"
                >
                  Yes
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      )}

      {/* Appearance Popup */}
      <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        <DialogContent className="max-w-sm md:max-w-md lg:max-w-lg w-[calc(100%-2rem)] rounded-2xl p-0 overflow-hidden bg-white dark:bg-[#242424] border-gray-200 dark:border-gray-800">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle className="text-lg font-bold text-gray-900 dark:text-white">
              Appearance
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 dark:text-gray-400">
              Choose your preferred theme
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 pb-5">
            <button
              onClick={() => {
                setAppearanceOpen(false);
                setTimeout(() => setAppearance("light"), 250);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${appearance === "light"
                ? "border-[#1F6B45] bg-[#fdfafc] dark:border-[#1F6B45] dark:bg-[#0F3D24]/20"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                }`}>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${appearance === "light"
                  ? "border-[#1F6B45] bg-[#1F6B45]"
                  : "border-gray-300 dark:border-gray-600"
                  }`}>
                {appearance === "light" && (
                  <Check className="h-3 w-3 text-white" />
                )}
              </div>
              <Sun className="h-5 w-5 text-yellow-500 dark:text-yellow-400 flex-shrink-0" />
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white text-sm">
                  Light
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Default light theme
                </p>
              </div>
            </button>
            <button
              onClick={() => {
                setAppearanceOpen(false);
                setTimeout(() => setAppearance("dark"), 250);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${appearance === "dark"
                ? "border-[#1F6B45] dark:border-[#1F6B45] bg-[#fdfafc] dark:bg-[#0F3D24]/20"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                }`}>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${appearance === "dark"
                  ? "border-[#1F6B45] bg-[#1F6B45]"
                  : "border-gray-300 dark:border-gray-600"
                  }`}>
                {appearance === "dark" && (
                  <Check className="h-3 w-3 text-white" />
                )}
              </div>
              <Moon className="h-5 w-5 text-gray-600 dark:text-gray-300 flex-shrink-0" />
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white text-sm">
                  Dark
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Dark theme
                </p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Balance Warning Popup */}
      {showBalanceWarning && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center px-4 backdrop-blur-sm overflow-y-auto py-10">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-[#242424] w-full max-w-sm rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center mb-3">
                <AlertTriangle className="w-8 h-8 text-orange-600 dark:text-orange-400" />
              </div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white">Wait! Balance Found</h3>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-5 text-center">
              <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">{balanceData.type}</p>
              <p className="text-3xl font-black text-black dark:text-white">₹{balanceData.balance.toLocaleString('en-IN')}</p>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 text-center leading-relaxed">
              You still have money in your wallet. Do you want to continue deleting your account or go back and withdraw?
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowBalanceWarning(false);
                  setDeleteCaptcha("");
                  setDeleteAccountOpen(true);
                }}
                className="w-full h-12 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                Continue Anyway
              </button>
              <button
                onClick={() => setShowBalanceWarning(false)}
                className="w-full h-12 rounded-xl bg-black dark:bg-white text-white dark:text-black font-bold hover:bg-gray-900 dark:hover:bg-gray-100 transition-colors"
              >
                Cancel & Withdraw
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Account Confirmation */}
      {deleteAccountOpen && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto bg-black/60 backdrop-blur-sm">
          <div className="flex min-h-screen items-center justify-center p-4 py-10">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#242424] shadow-2xl border border-red-100 dark:border-red-900/30 overflow-hidden p-6">

              {/* Icon + Title centered */}
              <div className="flex flex-col items-center text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
                  <Trash2 className="h-7 w-7 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white">
                  Delete Your Account?
                </h3>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed text-center">
                Are you sure you want to delete your account?
              </p>

              <div className="mb-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-r-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <span className="text-sm font-bold text-red-700 dark:text-red-400">Warning</span>
                </div>
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                  Your account will be Deleted. Admin will keep your historical records for revenue reporting.
                </p>
              </div>

              <div className="mb-6">
                <input
                  type="text"
                  placeholder="Type DELETE to confirm"
                  value={deleteCaptcha}
                  onChange={(e) => setDeleteCaptcha(e.target.value.toUpperCase())}
                  className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:border-red-500 focus:ring-4 focus:ring-red-50 dark:focus:ring-red-900/20 outline-none transition-all font-bold text-center tracking-widest placeholder:tracking-normal placeholder:font-medium placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 rounded-xl text-md font-bold ring-2 ring-gray-300 dark:ring-gray-600"
                  onClick={() => setDeleteAccountOpen(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1 h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white text-md font-bold disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-red-600/20"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting || deleteCaptcha !== "DELETE"}
                >
                  {isDeleting ? "Deleting..." : "Delete Account"}
                </Button>
              </div>
            </motion.div>
          </div>
        </div>
      )}


    </AnimatedPage>
  );
}
