import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ChevronDown, Search, Mic, Bell, CheckCircle2, Tag, Gift, AlertCircle, Clock, BellOff, X, ChevronRight, ShoppingBag, Menu, Wallet, User } from 'lucide-react';
import { useProfile } from "@food/context/ProfileContext";
import { preciseLocationLabel } from "@food/utils/locationLabel";
import { Badge } from "@food/components/ui/badge";
import { API_BASE_URL } from "@food/api/config";
import foodIcon from "@food/assets/category-icons/food.webp";
import quickIcon from "@food/assets/category-icons/quick.webp";
import taxiIcon from "@food/assets/category-icons/taxi.webp";
import hotelIcon from "@food/assets/category-icons/hotel.webp";
import useNotificationInbox from "@food/hooks/useNotificationInbox";
import { useSearchOverlay } from "../UserLayout";

const BACKEND_ORIGIN = (API_BASE_URL || "").replace(/\/api\/?$/, "");

const resolveImageUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
    return trimmed;
  }
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${BACKEND_ORIGIN}${cleanPath}`;
};

const ICON_MAP = {
  CheckCircle2,
  Tag,
  Gift,
  AlertCircle
};

export function SearchBarRow({
  handleSearchFocus,
  placeholderIndex,
  placeholders,
  handleVegModeChange,
  isVegMode,
  vegModeToggleRef,
  navigate,
  showVegToggle = true,
  isCompact = false,
  vegModeOption = "all",
  onVoiceClick,
}) {
  // Home supplies the real voice-search overlay; fall back to the search page.
  const handleVoice = (e) => {
    e.stopPropagation();
    if (onVoiceClick) {
      onVoiceClick();
      return;
    }
    if (navigate) navigate('/food/user/search?voice=true');
  };
  return (
    <div className="flex items-center gap-2.5 w-full" data-interactive="true" onTouchStart={(e) => e.stopPropagation()}>
      <div 
        data-interactive="true"
        className={`relative z-[60] flex-1 rounded-[1.5rem] flex items-center px-4 border cursor-pointer active:scale-[0.98] group pointer-events-auto transition-all duration-200 ${
          isCompact
            ? "py-1.5 bg-white/95 dark:bg-[#242424] border-gray-200 dark:border-gray-800 shadow-sm"
            : "py-2 bg-black/25 backdrop-blur-md border-white/20 shadow-md text-white"
        }`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (handleSearchFocus) handleSearchFocus();
        }}
        onTouchStart={(e) => e.stopPropagation()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (handleSearchFocus) handleSearchFocus();
          }
        }}
      >
        <Search className={`h-5 w-5 mr-3 transition-colors duration-300 ${isCompact ? "text-gray-400 group-hover:text-[#1F6B45]" : "text-white/80 group-hover:text-white"}`} strokeWidth={2.5} />
        <div className="flex-1 overflow-hidden relative h-5 pointer-events-none">
          <input
            type="text"
            readOnly
            aria-label="Search"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer pointer-events-none"
          />
          <AnimatePresence mode="wait">
            <motion.span
              key={placeholderIndex}
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -15, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={`absolute inset-0 text-[14px] font-bold ${isCompact ? "text-gray-500 dark:text-gray-400" : "text-white/90"}`}
            >
              {placeholders?.[placeholderIndex] || 'Search "paneer"'}
            </motion.span>
          </AnimatePresence>
        </div>
        <div 
          data-interactive="true"
          className={`p-1.5 rounded-full ml-2 transition-all flex items-center justify-center ${isCompact ? "bg-[#1F6B45]/10 border border-[#1F6B45]/20" : "bg-white/20 border border-white/30 hover:bg-white/30"}`}
          onClick={handleVoice}
          onTouchStart={handleVoice}
        >
          <Mic className={`h-4 w-4 ${isCompact ? "text-[#1F6B45]" : "text-white"}`} strokeWidth={2.5} />
        </div>
      </div>

      {showVegToggle && (
        <div className="flex items-center gap-1.5 flex-shrink-0" data-interactive="true" onTouchStart={(e) => e.stopPropagation()}>
          <div 
            data-interactive="true"
            className={`flex flex-col items-center justify-center h-[46px] rounded-full border cursor-pointer active:scale-95 transition-all duration-200 flex-shrink-0 shadow-md ${
              vegModeOption === "non-veg" ? 'w-[58px]' : 'w-[52px]'
            } ${
              isVegMode 
                ? (vegModeOption === "non-veg"
                    ? 'bg-red-950/40 border-red-400/60'
                    : 'bg-emerald-950/40 border-emerald-400/60')
                : 'bg-black/25 backdrop-blur-md border-white/20'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              handleVegModeChange && handleVegModeChange(!isVegMode);
            }}
            onTouchStart={(e) => e.stopPropagation()}
            ref={vegModeToggleRef}
          >
            <span className="text-[7.5px] font-black uppercase tracking-wider leading-none mb-1 text-white text-center">
              {vegModeOption === "non-veg" ? 'Non-Veg' : 'VEG MODE'}
            </span>
            
            <div className={`w-8 h-4 rounded-full p-[1px] relative transition-colors duration-200 ${
              isVegMode 
                ? (vegModeOption === "non-veg" ? 'bg-red-500' : 'bg-emerald-500')
                : 'bg-gray-400/40'
            }`}>
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white shadow-md flex items-center justify-center p-[1px] absolute top-[1px] transition-all duration-200 ${
                  isVegMode ? 'translate-x-[15px]' : 'translate-x-[1px]'
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    isVegMode 
                      ? (vegModeOption === "non-veg" ? 'bg-red-600' : 'bg-emerald-600')
                      : 'bg-gray-400'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HomeHeader({ 
  headerRef,
  activeTab,
  setActiveTab,
  location, 
  savedAddressText, 
  handleLocationClick, 
  handleSearchFocus, 
  placeholderIndex, 
  placeholders,
  handleVegModeChange,
  isVegMode,
  vegModeToggleRef,
  isCategoryStuck = false,
  topBanners = [],
  topBannersLoaded = false,
  vegModeOption = "all",
  onClearNonVegFilter,
  onVoiceClick,
}) {
  const { startVoiceSearch } = useSearchOverlay();
  const navigate = useNavigate();
  const { userProfile } = useProfile();

  /**
   * The header avatar used to be the literal character "A" typed into the JSX —
   * it was never derived from the signed-in user, so every account showed the
   * same letter. Resolve a real profile photo when one is configured, and fall
   * back to the standard user icon rather than any letter.
   */
  const profileImageUrl = useMemo(() => {
    const raw = userProfile?.profileImage;
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "null" || trimmed === "undefined") return "";
    return resolveImageUrl(trimmed);
  }, [userProfile?.profileImage]);

  const [profileImageFailed, setProfileImageFailed] = useState(false);

  useEffect(() => {
    // A newly configured photo deserves a fresh attempt.
    setProfileImageFailed(false);
  }, [profileImageUrl]);

  const showProfileImage = Boolean(profileImageUrl) && !profileImageFailed;

  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('food_user_notifications');
    return saved ? JSON.parse(saved) : [];
  });
  const {
    items: broadcastNotifications,
    unreadCount: broadcastUnreadCount,
    dismiss: dismissBroadcastNotification,
    markAllAsRead: markAllBroadcastRead,
  } = useNotificationInbox("user", { limit: 20 });

  useEffect(() => {
    const syncNotifications = () => {
      const saved = localStorage.getItem('food_user_notifications');
      setNotifications(saved ? JSON.parse(saved) : []);
    };
    window.addEventListener('notificationsUpdated', syncNotifications);
    return () => window.removeEventListener('notificationsUpdated', syncNotifications);
  }, []);

  const mergedNotifications = useMemo(() => {
    const localItems = Array.isArray(notifications)
      ? notifications.map((item) => ({ ...item, source: "local" }))
      : [];
    const broadcastItems = (broadcastNotifications || []).map((item) => ({
      ...item,
      source: "broadcast",
      time: item.createdAt
        ? new Date(item.createdAt).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : "Just now",
      type: "broadcast",
      icon: "Bell",
      iconColor: "text-blue-600",
    }));

    return [...broadcastItems, ...localItems].sort(
      (a, b) =>
        new Date(b.createdAt || b.timestamp || 0).getTime() -
        new Date(a.createdAt || a.timestamp || 0).getTime()
    );
  }, [broadcastNotifications, notifications]);

  const unreadCount = notifications.filter(n => !n.read).length + broadcastUnreadCount;

  const handleDeleteNotification = (id, source = "local") => {
    if (source === "broadcast") {
      dismissBroadcastNotification(id);
      return;
    }
    setNotifications((prev) => {
      const next = prev.filter((notification) => notification.id !== id);
      localStorage.setItem('food_user_notifications', JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('notificationsUpdated', { detail: { count: next.filter((n) => !n.read).length } }));
      return next;
    });
  };

  const [trackIndex, setTrackIndex] = useState(1);
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsHistoryPushedRef = useRef(false);

  // Opening the panel means the notifications have been seen: clear the bell badge.
  useEffect(() => {
    if (!isNotificationsOpen) return;
    if (broadcastUnreadCount > 0) markAllBroadcastRead();
    if (notifications.some((item) => !item.read)) {
      const next = notifications.map((item) => (item.read ? item : { ...item, read: true }));
      setNotifications(next);
      localStorage.setItem('food_user_notifications', JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('notificationsUpdated', { detail: { count: 0 } }));
    }
    // Runs once per opening; items arriving while it is open stay highlighted until reopened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotificationsOpen]);
  
  // Horizontal Swipe & Drag State
  const [dragOffset, setDragOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchCurrentXRef = useRef(0);
  const isHorizontalScrollRef = useRef(null);

  const validBanners = useMemo(() => {
    if (!Array.isArray(topBanners) || topBanners.length === 0) return [];
    return topBanners.filter((b) => {
      const raw = b?.image || b?.imageUrl || b?.videoUrl || b?.url;
      const img = String(resolveImageUrl(raw) || '').toLowerCase();
      if (!img) return false;
      if (img.includes('delivered') || img.includes('app-store') || img.includes('google-play')) return false;
      return true;
    });
  }, [topBanners]);

  // Extended banners array with seamless clone buffers for genuine infinite circular loop
  const extendedBanners = useMemo(() => {
    if (validBanners.length <= 1) return validBanners;
    const first = validBanners[0];
    const last = validBanners[validBanners.length - 1];
    return [last, ...validBanners, first];
  }, [validBanners]);

  // Normalized active index (0 to validBanners.length - 1)
  const activeBannerIndex = useMemo(() => {
    if (validBanners.length <= 1) return 0;
    return (trackIndex - 1 + validBanners.length) % validBanners.length;
  }, [trackIndex, validBanners.length]);

  const activeBanner = validBanners[activeBannerIndex] || null;

  const handleNextSlide = useCallback(() => {
    if (validBanners.length <= 1) return;
    setIsTransitionEnabled(true);
    setTrackIndex((prev) => prev + 1);
  }, [validBanners.length]);

  const handlePrevSlide = useCallback(() => {
    if (validBanners.length <= 1) return;
    setIsTransitionEnabled(true);
    setTrackIndex((prev) => prev - 1);
  }, [validBanners.length]);

  // Handle transition end for silent instant snapping at loop boundaries
  const handleTransitionEnd = () => {
    if (validBanners.length <= 1) return;
    if (trackIndex >= validBanners.length + 1) {
      // Reached right clone (first banner), snap silently to real index 1
      setIsTransitionEnabled(false);
      setTrackIndex(1);
    } else if (trackIndex <= 0) {
      // Reached left clone (last banner), snap silently to real index N
      setIsTransitionEnabled(false);
      setTrackIndex(validBanners.length);
    }
  };

  // Touch Swipe Handlers for Smooth Mobile Gesture
  const handleTouchStart = (event) => {
    if (event.target.closest('button, a, input, [data-interactive="true"]')) {
      return;
    }
    const touch = event.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchCurrentXRef.current = touch.clientX;
    isHorizontalScrollRef.current = null;
    setIsSwiping(true);
    setIsTransitionEnabled(false);
  };

  const handleTouchMove = (event) => {
    if (!isSwiping || validBanners.length <= 1) return;
    const touch = event.touches[0];
    const diffX = touch.clientX - touchStartXRef.current;
    const diffY = touch.clientY - touchStartYRef.current;

    // Detect gesture direction
    if (isHorizontalScrollRef.current === null) {
      if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
        isHorizontalScrollRef.current = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    if (isHorizontalScrollRef.current) {
      touchCurrentXRef.current = touch.clientX;
      setDragOffset(diffX);
    }
  };

  const handleTouchEnd = (event) => {
    if (!isSwiping) return;
    const touch = event.changedTouches?.[0];
    const currentX = touch ? touch.clientX : touchCurrentXRef.current;
    const diffX = currentX - touchStartXRef.current;
    const minSwipeDistance = 45;

    setIsSwiping(false);
    setDragOffset(0);
    const wasHorizontal = isHorizontalScrollRef.current;
    isHorizontalScrollRef.current = null;

    if (wasHorizontal && diffX < -minSwipeDistance) {
      handleNextSlide();
    } else if (wasHorizontal && diffX > minSwipeDistance) {
      handlePrevSlide();
    } else {
      setIsTransitionEnabled(true);
    }
  };

  useEffect(() => {
    if (!isNotificationsOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (!notificationsHistoryPushedRef.current) {
      window.history.pushState({ notificationsPopup: true }, "");
      notificationsHistoryPushedRef.current = true;
    }

    const handlePopState = () => {
      notificationsHistoryPushedRef.current = false;
      setIsNotificationsOpen(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isNotificationsOpen]);

  const closeNotifications = (useHistoryBack = true) => {
    if (useHistoryBack && notificationsHistoryPushedRef.current) {
      notificationsHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    setIsNotificationsOpen(false);
  };

  // Auto-play infinite circular slide timer
  useEffect(() => {
    if (validBanners.length <= 1) {
      setTrackIndex(1);
      return;
    }

    const currentMedia = resolveImageUrl(activeBanner?.image || activeBanner?.imageUrl || activeBanner?.videoUrl || activeBanner?.url || '');
    const isCurrentVideo = Boolean(
      String(currentMedia).match(/\.(mp4|webm|mov|m4v|avi)(\?.*)?$/i) || 
      activeBanner?.mediaType === 'video'
    );

    // If current banner is video, interval is paused; video onEnded will slide to next
    if (isCurrentVideo) return;

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      handleNextSlide();
    }, 4500);

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        handleNextSlide();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [validBanners.length, activeBanner, handleNextSlide]);

  const handleBannerRedirect = useCallback((e) => {
    if (e?.target?.closest('button, a, input, [data-interactive="true"]')) {
      return;
    }
    const rawLink = activeBanner?.ctaLink || activeBanner?.link;
    if (!rawLink) return;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    let target = String(rawLink).trim();
    if (target.startsWith('http://') || target.startsWith('https://')) {
      try {
        const urlObj = new URL(target);
        target = urlObj.pathname + urlObj.search + urlObj.hash;
      } catch {
        // keep
      }
    }

    if (!target.startsWith('/')) {
      target = `/${target}`;
    }
    if (!target.startsWith('/food') && !target.startsWith('/admin') && !target.startsWith('/restaurant')) {
      target = `/food${target}`;
    }

    navigate(target);
  }, [activeBanner, navigate]);

  return (
    <>
      {/* Top Header Section with Full-Cover Background Banner Support */}
      <div 
        ref={headerRef}
        className="relative w-full bg-[#1F6B45] dark:bg-[#C52332] rounded-b-[2.8rem] sm:rounded-b-[4rem] shadow-xl transition-all overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Full-Cover Background Banner Media (Infinite Circular Loop Sliding Track) */}
        {extendedBanners.length > 0 && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div 
              className={`flex h-full w-full ${(!isTransitionEnabled || isSwiping) ? 'transition-none' : 'transition-transform duration-600 ease-out'}`}
              style={{
                transform: `translateX(calc(-${(validBanners.length > 1 ? trackIndex : 0) * 100}% + ${dragOffset}px))`
              }}
              onTransitionEnd={handleTransitionEnd}
            >
              {extendedBanners.map((banner, idx) => {
                const rawUrl = banner?.image || banner?.imageUrl || banner?.videoUrl || banner?.url;
                const mediaUrl = resolveImageUrl(rawUrl);
                const isVideo = Boolean(String(mediaUrl).match(/\.(mp4|webm|mov|m4v|avi)(\?.*)?$/i) || banner?.mediaType === 'video');
                const isCurrent = validBanners.length > 1 ? idx === trackIndex : idx === 0;

                return (
                  <div 
                    key={`${banner._id || idx}-${idx}`}
                    className="relative h-full w-full flex-shrink-0 select-none overflow-hidden"
                  >
                    {isVideo ? (
                      <video 
                        src={mediaUrl}
                        autoPlay
                        muted
                        playsInline
                        preload={isCurrent ? "auto" : "none"}
                        onEnded={handleNextSlide}
                        className="w-full h-full object-cover brightness-105 contrast-105"
                      />
                    ) : (
                      <img 
                        src={mediaUrl} 
                        alt={banner?.title || `Banner ${idx + 1}`}
                        className="w-full h-full object-cover brightness-105 contrast-105 pointer-events-none"
                        loading={idx <= 1 ? "eager" : "lazy"}
                        decoding="async"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {/* Subtle Gradient Overlay for Clean Contrast */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/20 z-10 pointer-events-none" />
          </div>
        )}

        {/* Circular Way Loop Indicator Dots */}
        {validBanners.length > 1 && (
          <div className="absolute bottom-[90px] sm:bottom-[96px] left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 pointer-events-none">
            {validBanners.map((_, dotIdx) => (
              <div 
                key={dotIdx} 
                className={`transition-all duration-300 rounded-full ${
                  dotIdx === activeBannerIndex 
                    ? 'w-5 h-1.5 bg-white shadow-md' 
                    : 'w-1.5 h-1.5 bg-white/50'
                }`}
              />
            ))}
          </div>
        )}

        {/* Header Floating Content Container */}
        <div className="relative z-20 flex flex-col justify-between min-h-[320px] sm:min-h-[400px] md:min-h-[460px] lg:min-h-[520px] pb-6 pt-5 px-4 max-w-md sm:max-w-xl md:max-w-6xl lg:max-w-7xl mx-auto w-full pointer-events-none">
          
          {/* Top Row: Location & Action Badges */}
          <div className="flex items-center justify-between gap-3 min-w-0 pointer-events-auto">
            {/* Location Selector */}
            <div 
              data-interactive="true"
              className="flex items-center gap-2 cursor-pointer group min-w-0 flex-1 z-30 select-none"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (handleLocationClick) handleLocationClick(e);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (handleLocationClick) handleLocationClick(e);
              }}
            >
              <div className="bg-white/25 p-2 rounded-full border border-white/30 backdrop-blur-md shadow-sm flex-shrink-0">
                <MapPin className="h-4.5 w-4.5 text-white" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  <span className="text-[13px] font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">Home</span>
                  <ChevronDown className="h-3.5 w-3.5 text-white stroke-[3]" />
                </div>
                <span className="text-[11px] font-semibold text-white/95 truncate drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] max-w-full">
                  {savedAddressText || preciseLocationLabel(location)}
                </span>
              </div>
            </div>
            
            {/* Top Right Action Badges */}
            <div 
              data-interactive="true" 
              className="flex items-center gap-2 flex-shrink-0 z-30" 
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              {/* Wallet Button */}
              <Link
                to="/food/user/wallet"
                className="h-9 w-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white shadow-md hover:bg-black/60 active:scale-95 transition-all"
              >
                <Wallet className="h-4.5 w-4.5" />
              </Link>

              {/* Profile Avatar Badge — same size/spacing as before, styled to
                  match the wallet button beside it instead of a one-off blue. */}
              <Link
                to="/food/user/profile"
                aria-label="Profile"
                className="h-9 w-9 flex items-center justify-center overflow-hidden rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white shadow-md hover:bg-black/60 active:scale-95 transition-all"
              >
                {showProfileImage ? (
                  <img
                    src={profileImageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={() => setProfileImageFailed(true)}
                  />
                ) : (
                  <User className="h-4.5 w-4.5" strokeWidth={2.5} />
                )}
              </Link>
            </div>
          </div>

          {/* Middle Row: Banner Title (Clean without any extra buttons) */}
          <div className="my-auto pt-2 pb-1 min-h-[36px] flex items-center">
            {activeBanner?.title ? (
              <div 
                className={`max-w-[80%] z-20 pointer-events-auto ${(activeBanner?.ctaLink || activeBanner?.link) ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
                onClick={handleBannerRedirect}
              >
                <span className="bg-amber-400 text-black text-[9.5px] sm:text-xs font-black px-2 py-0.5 rounded shadow-md tracking-wider uppercase mb-1 inline-block">
                  SPECIAL OFFER
                </span>
                <h2 className="text-xl sm:text-3xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] leading-tight uppercase italic">
                  {activeBanner.title}
                </h2>
              </div>
            ) : null}
          </div>

          {/* Bottom Floating Search Bar & Veg Toggle Row */}
          <div className="w-full pt-1 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <SearchBarRow
              handleSearchFocus={handleSearchFocus}
              placeholderIndex={placeholderIndex}
              placeholders={placeholders}
              handleVegModeChange={handleVegModeChange}
              isVegMode={isVegMode || vegModeOption === "non-veg"}
              vegModeToggleRef={vegModeToggleRef}
              navigate={navigate}
              vegModeOption={vegModeOption}
              onVoiceClick={onVoiceClick}
            />
          </div>

        </div>

      </div>

      <AnimatePresence>
        {isNotificationsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/25 backdrop-blur-[1px]"
            onClick={() => closeNotifications()}
          >
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute top-[84px] right-3 w-[calc(100vw-24px)] max-w-80 rounded-2xl overflow-hidden shadow-2xl bg-white dark:bg-[#2e2e2e]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
                <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  Notifications
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="bg-orange-100 text-orange-600 border-none text-[10px] h-4">
                      {unreadCount} New
                    </Badge>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  <Link
                    to="/food/user/notifications"
                    onClick={() => closeNotifications()}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700"
                  >
                    {mergedNotifications.length > 0 ? "View All" : ""}
                  </Link>
                  <button
                    type="button"
                    onClick={() => closeNotifications()}
                    className="rounded-full p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    aria-label="Close notifications"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
                {mergedNotifications.length > 0 ? (
                  mergedNotifications.slice(0, 5).map((notif) => {
                    const Icon = ICON_MAP[notif.icon] || Bell;
                    return (
                      <div
                        key={notif.id}
                        className={`p-4 flex items-start gap-3 border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${!notif.read ? 'bg-orange-50/20' : ''}`}
                      >
                        <div className={`mt-1 p-2 rounded-full ${notif.type === "order" ? "bg-green-100/50 text-green-600" : "bg-orange-100/50 text-orange-600"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{notif.title}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400 whitespace-nowrap">{notif.time}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteNotification(notif.id, notif.source);
                                }}
                                className="rounded-full p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                            {notif.message}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center flex flex-col items-center gap-2">
                    <BellOff className="h-10 w-10 text-gray-200" />
                    <p className="text-xs text-gray-400 font-medium">All caught up!</p>
                  </div>
                )}
              </div>
              <div className="p-3 bg-gray-50/50 dark:bg-gray-800/50 text-center">
                <Link
                  to="/food/user/notifications"
                  onClick={() => closeNotifications()}
                  className="text-xs font-bold text-gray-400 hover:text-gray-600"
                >
                  {mergedNotifications.length > 0 ? "Manage Settings" : "Check Notifications Page"}
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
