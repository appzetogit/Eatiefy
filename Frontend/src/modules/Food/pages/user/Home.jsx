import { useSearchParams, Link, useNavigate } from "react-router-dom";
import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useCallback,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Clock,
  MapPin,
  Heart,
  Search,
  Tag,
  Flame,
  ShoppingBag,
  ShoppingCart,
  Mic,
  SlidersHorizontal,
  CheckCircle2,
  Bookmark,
  BadgePercent,
  X,
  ArrowRightLeft,
  ArrowDownUp,
  Timer,
  CalendarClock,
  ShieldCheck,
  IndianRupee,
  UtensilsCrossed,
  Leaf,
  AlertCircle,
  Loader2,
  Plus,
  Minus,
  ArrowRight,
  Check,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { buildCartLineId } from "@food/utils/foodVariants";
import { isModuleAuthenticated } from "@food/utils/auth";
import {
  isNonVegCategoryScope,
  isVegMenuItem,
  matchesVegRestaurantFilter,
  filterRestaurantsForVegMode,
  filterDishesForVegMode,
  filterCategoriesForVegMode,
  buildVegModeQueryParams,
} from "@food/utils/vegMode";
import VoiceSearchOverlay from "@food/components/user/VoiceSearchOverlay";
import { useVoiceSearch } from "@food/hooks/useVoiceSearch";
import { motion, AnimatePresence } from "framer-motion";
import Footer from "@food/components/user/Footer";
import FoodFilterBar from "@food/components/user/FoodFilterBar";
import dishFallbackImage from "@food/assets/dish_fallback.webp";
import AddToCartButton from "@food/components/user/AddToCartButton";
import DishDetailModal from "@food/components/user/DishDetailModal";
import FloatingHomeDock from "@food/components/user/FloatingHomeDock";
import BackToTopButton from "@food/components/user/BackToTopButton";
import {
  captureHomeScrollBeforeLeave,
  clearHomeScrollState,
  peekHomePageSnapshot,
  peekHomeScrollState,
  stashHomePageSnapshot,
} from "@food/utils/homeScrollRestore";
import {
  CategoryChipRowSkeleton,
  ExploreGridSkeleton,
  HeroBannerSkeleton,
  LoadingSkeletonRegion,
  RestaurantGridSkeleton,
  AppShellSkeleton,
} from "@food/components/ui/loading-skeletons";
import { useProfile } from "@food/context/ProfileContext";
import { useCart } from "@food/context/CartContext";
import { HorizontalCarousel } from "@food/components/ui/horizontal-carousel";
import { DotPattern } from "@food/components/ui/dot-pattern";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@food/components/ui/card";
import { Button } from "@food/components/ui/button";
import { Badge } from "@food/components/ui/badge";
import { Input } from "@food/components/ui/input";
import { Switch } from "@food/components/ui/switch";
import { Checkbox } from "@food/components/ui/checkbox";
import {
  useSearchOverlay,
  useLocationSelector,
} from "@food/components/user/UserLayout";
import PageNavbar from "@food/components/user/PageNavbar";
import { optimizeCloudinaryUrl } from "@/shared/utils/mediaUrl";

const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };
const VEG_MODE_OPTION_STORAGE_KEY = "food_user_veg_mode_option";

// Import shared food images - prevents duplication
import { foodImages, horizontalFoodImages, verticalFoodImages } from "@food/constants/images";

import { Avatar, AvatarFallback } from "@food/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@food/components/ui/dropdown-menu";
import { useDeliveryLocation } from "@food/context/DeliveryLocationContext";
import offerImage from "@food/assets/offerimage.webp";
import api, { restaurantAPI, adminAPI } from "@food/api";
import { usePublicAppConfig } from "@food/context/PublicAppConfigContext";
import { API_BASE_URL } from "@food/api/config";
import OptimizedImage from "@food/components/OptimizedImage";
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability";
import { resolveRestaurantDistance } from "@food/utils/geo";
import { useFoodPageInvalidation } from "@food/hooks/useFoodPageInvalidation";
import HomeHeader, { SearchBarRow } from "@food/components/user/home/HomeHeader";
import QuickSection from "@food/components/user/home/QuickSection";
import PromoRow from "@food/components/user/home/PromoRow";
import PromotionBannerCarousel from "@food/components/user/home/PromotionBannerCarousel";
import OutOfZoneScreen from "@food/components/user/OutOfZoneScreen";
import FreeCashBanner from "@food/components/user/home/FreeCashBanner";
import LazySection from "@food/components/LazySection";

// Explore More Icons
import exploreOffers from "@food/assets/explore more icons/offers.webp";
import exploreGourmet from "@food/assets/explore more icons/gourmet.webp";
import exploreTop10 from "@food/assets/explore more icons/top 10.webp";
import exploreCollection from "@food/assets/explore more icons/collection.webp";

// Generated High-Quality Food Category Images (Cloudinary CDN URLs - optimized for category icons)
import cloudinaryImages from "@food/constants/cloudinaryImages.json";
const khichdiImg = optimizeCloudinaryUrl(cloudinaryImages.khichdi, { width: 160 });
const sandwichImg = optimizeCloudinaryUrl(cloudinaryImages.sandwich, { width: 160 });
const parathaImg = optimizeCloudinaryUrl(cloudinaryImages.paratha, { width: 160 });
const burgerImg = optimizeCloudinaryUrl(cloudinaryImages.burger, { width: 160 });
const dosaImg = optimizeCloudinaryUrl(cloudinaryImages.dosa, { width: 160 });
const rollsImg = optimizeCloudinaryUrl(cloudinaryImages.rolls, { width: 160 });
const northIndianImg = optimizeCloudinaryUrl(cloudinaryImages.north_indian, { width: 160 });
const friedRiceImg = optimizeCloudinaryUrl(cloudinaryImages.fried_rice, { width: 160 });
const thaliImg = optimizeCloudinaryUrl(cloudinaryImages.thali, { width: 160 });
const paneerImg = optimizeCloudinaryUrl(cloudinaryImages.paneer, { width: 160 });
const pizzaImg = optimizeCloudinaryUrl(cloudinaryImages.pizza, { width: 160 });
const pastaImg = optimizeCloudinaryUrl(cloudinaryImages.pasta, { width: 160 });
const momosImg = optimizeCloudinaryUrl(cloudinaryImages.momos, { width: 160 });
const cakeImg = optimizeCloudinaryUrl(cloudinaryImages.cake, { width: 160 });
const noodlesImg = optimizeCloudinaryUrl(cloudinaryImages.noodles, { width: 160 });
const choleBhatureImg = optimizeCloudinaryUrl(cloudinaryImages.chole_bhature, { width: 160 });
const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const resolveImageUrl = (url, options = {}) => {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
    return optimizeCloudinaryUrl(trimmed, options);
  }
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${BACKEND_ORIGIN}${cleanPath}`;
};

// Animated placeholder for search - moved outside component to prevent recreation
const placeholders = [
  'Search "burger"',
  'Search "biryani"',
  'Search "pizza"',
  'Search "desserts"',
  'Search "chinese"',
  'Search "thali"',
  'Search "momos"',
  'Search "dosa"',
];

const getRestaurantDisplayName = (restaurant) => {
  const nameCandidates = [
    restaurant?.name,
    restaurant?.restaurantName,
    restaurant?.restaurantName?.english,
    restaurant?.restaurantName?.value,
    restaurant?.onboarding?.step1?.restaurantName,
  ];
  const resolvedName = nameCandidates.find(
    (candidate) =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return resolvedName ? resolvedName.trim() : "Restaurant";
};

// Restaurant Image Carousel Component
const RestaurantImageCarousel = React.memo(
  ({
    restaurant,
    priority = false,
    backendOrigin = "",
    className = "h-48 sm:h-56 md:h-60 lg:h-64 xl:h-72",
    roundedClass = "rounded-t-md",
    externalIndex = null,
    onIndexChange = null,
    autoScroll = false, // Disabled auto-scroll by default: cards slide ONLY on hand swipe
  }) => {
    const imageElementRef = useRef(null);

    const resolveCarouselImageUrl = useCallback(
      (url) => {
        if (typeof url !== "string" || !url) return "";
        if (/^data:/i.test(url) || /^blob:/i.test(url)) return url;

        // Resolve relative URLs (e.g. /uploads/...) so they load on mobile when backend is different from frontend.
        const isRelative = !/^(https?:|\/\/|data:|blob:)/i.test(url.trim());
        const resolvedUrl =
          backendOrigin && isRelative
            ? `${backendOrigin.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`
            : url;

        return optimizeCloudinaryUrl(resolvedUrl, { width: 500 });
      },
      [backendOrigin],
    );

    const images = useMemo(() => {
      const list = [];
      if (!restaurant) return [foodImages[0]];
      const hasRecommended = Array.isArray(restaurant?.recommendedItems) && restaurant.recommendedItems.length > 0;

      if (hasRecommended) {
        restaurant.recommendedItems.forEach(item => {
          if (item && item.image) list.push(item.image);
        });
      }

      if (Array.isArray(restaurant?.images) && restaurant.images.length > 0) {
        restaurant.images.forEach(img => {
          if (typeof img === "string" && img.trim()) list.push(img.trim());
        });
      }

      if (restaurant?.image && typeof restaurant.image === "string" && restaurant.image.trim()) {
        list.push(restaurant.image.trim());
      }
      if (restaurant?.coverImage && typeof restaurant.coverImage === "string" && restaurant.coverImage.trim()) {
        list.push(restaurant.coverImage.trim());
      }

      const validImages = list
        .filter(Boolean)
        .map((img) => resolveCarouselImageUrl(img));

      return Array.from(new Set(validImages));
    }, [restaurant, resolveCarouselImageUrl]);

    const [internalIndex, setInternalIndex] = useState(0);
    const currentIndex = externalIndex !== null ? externalIndex : internalIndex;

    const setCurrentIndex = useCallback((val) => {
      const nextIndex = typeof val === 'function' ? val(currentIndex) : val;
      if (onIndexChange) {
        onIndexChange(nextIndex);
      } else {
        setInternalIndex(nextIndex);
      }
    }, [currentIndex, onIndexChange]);

    const [loadedBySrc, setLoadedBySrc] = useState({});
    const [, setAttemptedSrcs] = useState({});
    const [isImageUnavailable, setIsImageUnavailable] = useState(false);
    const [showShimmer, setShowShimmer] = useState(true);
    const [lastGoodSrc, setLastGoodSrc] = useState("");

    const sliderRef = useRef(null);
    const containerRef = useRef(null);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const isSwiping = useRef(false);
    const isPausedRef = useRef(false);
    const pauseTimeoutRef = useRef(null);
    const gestureDirection = useRef('none');
    const currentIdxRef = useRef(0);
    const hasDragged = useRef(false);
    const dragTimeoutRef = useRef(null);

    const safeIndex =
      images.length > 0
        ? ((currentIndex % images.length) + images.length) % images.length
        : 0;
    const primarySrc = images[safeIndex] || "";
    const displaySrc = primarySrc;
    const renderSrc = displaySrc || lastGoodSrc;

    // Sync currentIdxRef with safeIndex
    useEffect(() => {
      currentIdxRef.current = safeIndex;
    }, [safeIndex]);

    // Optional Auto-scroll effect (only runs if autoScroll prop is explicitly true)
    useEffect(() => {
      if (!autoScroll || images.length <= 1) return;

      const intervalId = setInterval(() => {
        if (!isSwiping.current && !isPausedRef.current) {
          setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
        }
      }, 3500);

      return () => clearInterval(intervalId);
    }, [autoScroll, images.length, setCurrentIndex]);

    // Reset transient image state when restaurant or source list changes.
    useEffect(() => {
      setCurrentIndex(0);
      setLoadedBySrc({});
      setAttemptedSrcs({});
      setIsImageUnavailable(images.length === 0);
      setShowShimmer(images.length > 0);
    }, [restaurant?.id, restaurant?.slug, restaurant?.updatedAt, images]);

    // Clear sticky successful source only when card identity changes.
    useEffect(() => {
      setLastGoodSrc("");
    }, [restaurant?.id, restaurant?.slug]);

    useEffect(() => {
      if (!renderSrc) return;
      const imgEl = imageElementRef.current;
      if (!imgEl) return;

      setShowShimmer(true);
      const shimmerTimeout = setTimeout(() => {
        setShowShimmer(false);
      }, 2500);

      if (imgEl.complete) {
        if (imgEl.naturalWidth > 0) {
          setLoadedBySrc((prev) =>
            prev[renderSrc] ? prev : { ...prev, [renderSrc]: true },
          );
          setLastGoodSrc(renderSrc);
          setShowShimmer(false);
        } else {
          setAttemptedSrcs((prev) => ({ ...prev, [renderSrc]: true }));
        }
      }
      return () => clearTimeout(shimmerTimeout);
    }, [renderSrc]);

    // Touch & Mouse drag physics for nested card image slider
    useEffect(() => {
      const sliderNode = sliderRef.current;
      const containerNode = containerRef.current;
      if (!sliderNode || !containerNode || images.length <= 1) return;

      const handleStart = (clientX, clientY) => {
        touchStartX.current = clientX;
        touchStartY.current = clientY;
        isSwiping.current = true;
        isPausedRef.current = true;
        hasDragged.current = false;
        gestureDirection.current = 'none';
        containerNode.style.transition = 'none';

        if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
      };

      const handleMove = (clientX, clientY, e) => {
        if (!isSwiping.current) return;
        const deltaX = clientX - touchStartX.current;
        const deltaY = clientY - touchStartY.current;

        if (gestureDirection.current === 'none') {
          const absX = Math.abs(deltaX);
          const absY = Math.abs(deltaY);
          if (absX >= 3 || absY >= 3) {
            if (absX > absY) {
              gestureDirection.current = 'horizontal';
            } else {
              gestureDirection.current = 'vertical';
              isSwiping.current = false;
              return;
            }
          } else {
            return;
          }
        }

        if (gestureDirection.current === 'horizontal') {
          hasDragged.current = true;
          if (e) {
            e.stopPropagation(); // Stops horizontal scroll from reaching outer cards container
            if (e.cancelable) e.preventDefault();
          }

          const baseTranslate = -currentIdxRef.current * 100;
          const width = containerNode.clientWidth || sliderNode.clientWidth || 100;
          const percentDelta = (deltaX / width) * 100;

          let finalTranslate = baseTranslate + percentDelta;
          if (currentIdxRef.current === 0 && deltaX > 0) {
            finalTranslate = percentDelta * 0.3;
          } else if (currentIdxRef.current === images.length - 1 && deltaX < 0) {
            finalTranslate = baseTranslate + percentDelta * 0.3;
          }

          containerNode.style.transform = `translateX(${finalTranslate}%)`;
        }
      };

      const handleEnd = (clientX) => {
        if (!isSwiping.current) return;
        isSwiping.current = false;

        // Resume auto-scroll 4 seconds after user interaction ends
        if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = setTimeout(() => {
          isPausedRef.current = false;
        }, 4000);

        if (gestureDirection.current !== 'horizontal') return;

        const endX = clientX !== undefined ? clientX : touchStartX.current;
        const deltaX = endX - touchStartX.current;

        containerNode.style.transition = 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)';
        const width = containerNode.clientWidth || sliderNode.clientWidth || 100;
        const threshold = width * 0.15;

        let newIdx = currentIdxRef.current;
        if (deltaX < -threshold) {
          newIdx = Math.min(currentIdxRef.current + 1, images.length - 1);
        } else if (deltaX > threshold) {
          newIdx = Math.max(currentIdxRef.current - 1, 0);
        }

        containerNode.style.transform = `translateX(-${newIdx * 100}%)`;

        setTimeout(() => {
          setCurrentIndex(newIdx);
        }, 300);

        if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
        dragTimeoutRef.current = setTimeout(() => {
          hasDragged.current = false;
        }, 300);
      };

      // Native Touch Listeners on the outer slider node
      const onTouchStart = (e) => {
        if (e.touches.length > 1) return;
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
      };

      const onTouchMove = (e) => {
        if (!isSwiping.current) return;
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY, e);
      };

      const onTouchEnd = (e) => {
        const touch = e.changedTouches[0] || e.touches[0];
        handleEnd(touch ? touch.clientX : touchStartX.current);
      };

      // Mouse drag Listeners for desktop touch-device emulation & mouse drag
      const onMouseDown = (e) => {
        handleStart(e.clientX, e.clientY);
      };

      const onMouseMove = (e) => {
        handleMove(e.clientX, e.clientY, e);
      };

      const onMouseUp = (e) => {
        handleEnd(e.clientX);
      };

      const onMouseEnter = () => {
        isPausedRef.current = true;
      };

      const onMouseLeave = (e) => {
        handleEnd(e.clientX);
        isPausedRef.current = false;
      };

      sliderNode.addEventListener('touchstart', onTouchStart, { passive: true });
      sliderNode.addEventListener('touchmove', onTouchMove, { passive: false });
      sliderNode.addEventListener('touchend', onTouchEnd, { passive: true });

      sliderNode.addEventListener('mousedown', onMouseDown);
      sliderNode.addEventListener('mousemove', onMouseMove);
      sliderNode.addEventListener('mouseup', onMouseUp);
      sliderNode.addEventListener('mouseenter', onMouseEnter);
      sliderNode.addEventListener('mouseleave', onMouseLeave);

      return () => {
        sliderNode.removeEventListener('touchstart', onTouchStart);
        sliderNode.removeEventListener('touchmove', onTouchMove);
        sliderNode.removeEventListener('touchend', onTouchEnd);

        sliderNode.removeEventListener('mousedown', onMouseDown);
        sliderNode.removeEventListener('mousemove', onMouseMove);
        sliderNode.removeEventListener('mouseup', onMouseUp);
        sliderNode.removeEventListener('mouseenter', onMouseEnter);
        sliderNode.removeEventListener('mouseleave', onMouseLeave);
      };
    }, [images.length, setCurrentIndex]);

    const showMultipleImages = images.length > 1;

    return (
      <div
        ref={sliderRef}
        className={`relative ${className} w-full overflow-hidden ${roundedClass} flex-shrink-0 group select-none touch-pan-y`}
        onClick={(e) => {
          if (hasDragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {showShimmer && !isImageUnavailable && Boolean(renderSrc) && (
          <div className="absolute inset-0 z-[1] overflow-hidden bg-gray-200 pointer-events-none">
            <div className="h-full w-full animate-pulse bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
          </div>
        )}

        <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-105 overflow-hidden">
          <div
            ref={containerRef}
            className="flex w-full h-full transition-transform duration-500 ease-in-out touch-pan-y"
            style={{ transform: `translateX(-${safeIndex * 100}%)`, willChange: 'transform' }}
          >
            {images.map((src, idx) => {
              const shouldLoad = idx === safeIndex || (safeIndex > 0 && Math.abs(idx - safeIndex) <= 1);
              return shouldLoad ? (
                <img
                  key={src || idx}
                  ref={idx === safeIndex ? imageElementRef : null}
                  src={src}
                  alt={`${restaurant.name} - Image ${idx + 1}`}
                  className="w-full h-full flex-shrink-0 object-cover pointer-events-none"
                  draggable={false}
                  loading={priority && idx === 0 ? "eager" : "lazy"}
                  fetchPriority={priority && idx === 0 ? "high" : "auto"}
                  decoding="async"
                  onLoad={() => {
                    setLoadedBySrc((prev) => ({ ...prev, [src]: true }));
                    if (idx === safeIndex) {
                      setLastGoodSrc(src);
                      setShowShimmer(false);
                    }
                  }}
                  onError={() => {
                    setAttemptedSrcs((prev) => {
                      const next = { ...prev, [src]: true };
                      const attemptedCount = Object.keys(next).length;

                      if (attemptedCount >= images.length) {
                        setIsImageUnavailable(true);
                      } else if (images.length > 1 && idx === safeIndex) {
                        setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
                      }

                      return next;
                    });
                    if (images.length === 1) {
                      setIsImageUnavailable(true);
                    }
                  }}
                />
              ) : (
                <div key={src || idx} className="w-full h-full flex-shrink-0 bg-gray-100 dark:bg-gray-800" />
              );
            })}
          </div>
        </div>

        {isImageUnavailable && (
          <div className="absolute inset-0 z-[2] flex items-center justify-center bg-gray-100 pointer-events-none">
            <span className="text-xs text-gray-500">Image unavailable</span>
          </div>
        )}

        {/* Image Indicators — compact glass capsule, bottom-right */}
        {showMultipleImages && (
          <div
            className="absolute bottom-2 right-2 z-10 flex items-center gap-[3px] rounded-full border border-white/20 bg-black/55 px-[5px] py-[3px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
            role="tablist"
            aria-label="Restaurant image pages"
          >
            {images.map((_, index) => {
              const isActive = index === safeIndex;
              return (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCurrentIndex(index);
                  }}
                  className="flex h-3 w-3 items-center justify-center rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-white/70 cursor-pointer"
                  aria-label={`Go to image ${index + 1}`}>
                  <span
                    aria-hidden="true"
                    className={`block rounded-full transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${isActive
                        ? "h-[5px] w-[13px] bg-white opacity-100"
                        : "h-[5px] w-[5px] bg-white opacity-[0.35]"
                      }`}
                  />
                </button>
              );
            })}
          </div>
        )}

        {/* Gradient Overlay on Hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />

        {/* Shine Effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full transition-transform duration-1000 group-hover:animate-shine pointer-events-none" />
      </div>
    );
  },
);

const RestaurantCard = React.memo(({
  restaurant,
  index,
  availabilityTick,
  isOutOfService,
  favorite,
  onToggleFavorite,
  BACKEND_ORIGIN,
  restaurantSlug: propRestaurantSlug,
  onNavigateAway,
}) => {
  const navigate = useNavigate();
  const [slideIndex, setSlideIndex] = useState(0);
  const [offerIndex, setOfferIndex] = useState(0);
  const validRecommendedItems = useMemo(() => {
    return (restaurant.recommendedItems || []).filter(item => item && item.image);
  }, [restaurant.recommendedItems]);
  const rotatingOffers = useMemo(() => {
    const summaries = Array.isArray(restaurant.activeOffers)
      ? restaurant.activeOffers
        .map((offer) => String(offer?.summary || "").trim())
        .filter(Boolean)
      : [];

    if (!summaries.length && restaurant.offer) {
      return [String(restaurant.offer).trim()];
    }

    return Array.from(new Set(summaries));
  }, [restaurant.activeOffers, restaurant.offer]);
  const rotatingOffersKey = rotatingOffers.join("|");

  const hasRecommended = validRecommendedItems.length > 0;
  const currentOffer = rotatingOffers[offerIndex] || null;

  const currentDish = hasRecommended ? validRecommendedItems[slideIndex] : null;
  const name = currentDish ? currentDish.name : restaurant.featuredDish;
  const price = currentDish ? currentDish.price : restaurant.featuredPrice;

  const availability = getRestaurantAvailabilityStatus(
    restaurant,
    new Date(availabilityTick),
  );

  const restaurantSlug = useMemo(() => {
    if (propRestaurantSlug) return propRestaurantSlug;
    if (restaurant.slug) return restaurant.slug;
    return (restaurant.name || restaurant.restaurantName || "restaurant")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-");
  }, [propRestaurantSlug, restaurant.slug, restaurant.name, restaurant.restaurantName]);

  const targetUrl = currentDish
    ? `/food/user/restaurants/${restaurantSlug}?dish=${currentDish.id}`
    : `/food/user/restaurants/${restaurantSlug}`;

  useEffect(() => {
    setOfferIndex(0);
  }, [restaurant.id, restaurant.slug, rotatingOffersKey]);

  useEffect(() => {
    if (rotatingOffers.length <= 1) return undefined;

    const intervalId = window.setInterval(() => {
      setOfferIndex((prev) => (prev + 1) % rotatingOffers.length);
    }, 2600);

    return () => window.clearInterval(intervalId);
  }, [rotatingOffers.length, rotatingOffersKey]);

  return (
    <div
      className="h-full transform transition-all duration-300 hover:-translate-y-3 hover:scale-[1.02]"
      style={{
        perspective: 1000,
        animation:
          index < 10
            ? `fade-in-up 0.5s ease-out ${index * 0.05}s backwards`
            : "none",
      }}>
      <div className="h-full group">
        <Card
          className={`overflow-hidden gap-0 border-0 dark:border-gray-800 bg-white dark:bg-[#242424] border-background transition-all duration-500 py-0 rounded-[28px] flex flex-col h-full w-full relative shadow-sm hover:shadow-xl ${isOutOfService || !availability.isOpen
              ? "grayscale opacity-75"
              : ""
            }`}>
          {/* Image Section with Carousel - Deep links to dish */}
          <div
            className="relative block cursor-pointer"
            onClick={(e) => {
              if (e.defaultPrevented) return;
              try { onNavigateAway?.(e); } catch (_) { }
              navigate(targetUrl);
            }}
          >
            <RestaurantImageCarousel
              restaurant={restaurant}
              priority={index < 3}
              backendOrigin={BACKEND_ORIGIN}
              externalIndex={slideIndex}
              onIndexChange={setSlideIndex}
              autoScroll={false}
            />

            {/* Recommended Dish Badge - Top Left */}
            {hasRecommended && (
              <div className="absolute top-4 left-4 flex items-center z-10 transform transition-transform duration-300 group-hover:scale-105">
                <div className="bg-black/70 backdrop-blur-lg text-white px-4 py-1.5 rounded-full text-[11px] font-medium tracking-tight flex items-center shadow-2xl border border-white/20 min-h-[28px] min-w-[100px] justify-center overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${name}-${price}`}
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="whitespace-nowrap flex items-center"
                    >
                      {name} • ₹{price}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          {/* Bookmark Icon - Top Right (Moved outside Image Link to ensure click-through works) */}
          <div className="absolute top-4 right-4 z-20 transform transition-transform duration-300 group-hover:scale-110">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(restaurantSlug, restaurant);
              }}
              aria-label={
                favorite
                  ? "Remove from favorites"
                  : "Add to favorites"
              }
              className={`h-11 w-11 rounded-[20px] shadow-xl flex items-center justify-center transition-all duration-300 ${favorite
                  ? "bg-red-500 text-white"
                  : "bg-white/90 backdrop-blur-sm text-gray-800 hover:bg-white"
                }`}>
              <Bookmark
                className={`h-5 w-5 transition-all duration-300 ${favorite ? "fill-white" : ""
                  }`}
              />
            </Button>
          </div>

          {/* Content Section - Links to restaurant ONLY */}
          <Link
            to={`/food/user/restaurants/${restaurantSlug}`}
            state={{}}
            onClick={() => {
              onNavigateAway?.();
            }}
            className="flex-grow"
          >
            <div className="transform transition-transform duration-300 group-hover:-translate-y-1">
              <CardContent className="p-3 sm:p-4 lg:p-5 pt-3 sm:pt-4 lg:pt-5 flex flex-col h-full">
                {/* Restaurant Name & Rating */}
                <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg lg:text-2xl font-medium text-gray-950 dark:text-white line-clamp-1 leading-tight tracking-tight transition-colors duration-300 group-hover:text-[#E2AD4B]">
                      {restaurant.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest shadow-sm ${availability.isOpen ? "" : "bg-gray-400 text-white"}`}
                        style={availability.isOpen ? {
                          backgroundColor: "var(--module-theme-color, #E2AD4B)",
                          color: "#ffffff",
                          boxShadow: "0 4px 10px rgba(var(--module-theme-rgb, 226,173,75), 0.25)",
                        } : undefined}
                      >
                        {availability.isOpen
                          ? "Open now"
                          : "Offline"}
                      </span>
                      {availability.isOpen &&
                        availability.closingCountdownLabel && (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-medium uppercase tracking-wide">
                            <Timer
                              className="h-3 w-3 flex-shrink-0"
                              strokeWidth={2.5}
                            />
                            <span>
                              {availability.closingCountdownLabel}
                            </span>
                          </div>
                        )}
                    </div>
                  </div>
                  <div
                    className={`flex-shrink-0 ${Number(restaurant.rating) > 0 ? "" : "bg-gray-400"} text-white px-3 py-1.5 rounded-2xl flex items-center gap-1.5 shadow-md transform transition-transform duration-300 group-hover:scale-110`}
                    style={Number(restaurant.rating) > 0 ? {
                      backgroundColor: "var(--module-theme-color, #E2AD4B)",
                      boxShadow: "0 6px 14px rgba(var(--module-theme-rgb, 226,173,75), 0.30)",
                    } : undefined}
                  >
                    <span className="text-sm lg:text-lg font-medium tracking-tight">
                      {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                    </span>
                    {Number(restaurant.rating) > 0 && <Star className="h-3.5 w-3.5 lg:h-4.5 lg:w-4.5 fill-white text-white" strokeWidth={0} />}
                  </div>
                </div>

                {/* Delivery Time */}
                <div className="flex items-center gap-1 text-sm lg:text-base text-gray-500 mb-2 lg:mb-3 transition-opacity duration-300 opacity-70 group-hover:opacity-100">
                  <Clock
                    className="h-4 w-4 lg:h-5 lg:w-5 text-gray-500 dark:text-gray-400"
                    strokeWidth={1.5}
                  />
                  <span className="font-medium dark:text-gray-300 text-gray-700">
                    {restaurant.deliveryTime}
                  </span>
                </div>

                {/* Cuisine & Offers */}
                <div className="mt-auto flex flex-col gap-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-xs lg:text-sm text-gray-500 dark:text-gray-400 line-clamp-1 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors duration-300 shrink min-w-0">
                      {restaurant.cuisine}
                    </p>
                    {currentOffer && (
                      <>
                        <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                        <div
                          className="flex flex-1 items-center gap-1 min-w-0"
                          style={{ color: "#16a34a" }}
                        >
                          <BadgePercent
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: "#16a34a" }}
                          />
                          <div className="flex-1 overflow-hidden min-w-0">
                            <AnimatePresence mode="wait">
                              <motion.span
                                key={`${restaurantSlug}-offer-${offerIndex}-${currentOffer}`}
                                initial={{ y: 10, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -10, opacity: 0 }}
                                transition={{ duration: 0.25, ease: "easeOut" }}
                                className="block truncate text-[11px] lg:text-xs font-semibold"
                                style={{ color: "#16a34a" }}
                                title={currentOffer}
                              >
                                {currentOffer}
                              </motion.span>
                            </AnimatePresence>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  {restaurant.pureVegRestaurant && (
                    <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold uppercase tracking-wider">
                      <Leaf className="h-3 w-3 fill-emerald-600" />
                      <span>Pure Veg</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </div>
          </Link>
        </Card>
      </div>
    </div>
  );
});

export default function Home() {
  const HERO_BANNER_AUTO_SLIDE_MS = 3500;
  const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [heroSearch, setHeroSearch] = useState("");
  const { openSearch, closeSearch, searchValue, setSearchValue } =
    useSearchOverlay();
  const { openLocationSelector } = useLocationSelector();
  const { vegMode, setVegMode: setVegModeContext, vegModeOption, setVegModeOption } = useProfile();
  const [prevVegMode, setPrevVegMode] = useState(vegMode);
  const [showVegModePopup, setShowVegModePopup] = useState(false);
  const [showSwitchOffPopup, setShowSwitchOffPopup] = useState(false);
  const [isApplyingVegMode, setIsApplyingVegMode] = useState(false);
  const [isSwitchingOffVegMode, setIsSwitchingOffVegMode] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0, triangleLeft: 0 });
  const vegModeToggleRef = useRef(null);

  const handleClearNonVegFilter = useCallback(() => {
    setVegModeOption("all");
    setPrevVegMode(false);
  }, [setVegModeOption]);

  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [topBannersData, setTopBannersData] = useState([]);
  const [topBannersLoaded, setTopBannersLoaded] = useState(false);
  const {
    topBanners,
    heroBanners,
    promoBanners,
    exploreIcons,
    refreshUserHome,
    refreshLanding,
  } = usePublicAppConfig();

  useEffect(() => {
    void refreshUserHome();
  }, [refreshUserHome]);

  useEffect(() => {
    const listTop = Array.isArray(topBanners) ? topBanners : [];
    const listHero = Array.isArray(heroBanners) ? heroBanners : [];
    const combined = listTop.length > 0 ? listTop : listHero;
    setTopBannersData(combined);
    if (listTop.length > 0 || listHero.length > 0) setTopBannersLoaded(true);
  }, [topBanners, heroBanners]);
  const [heroBannerImages, setHeroBannerImages] = useState([]);
  const [heroBannersData, setHeroBannersData] = useState([]); // Store full banner data with linked restaurants
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false);
  const [isCategoryStuck, setIsCategoryStuck] = useState(false);
  const isCategoryStuckRef = useRef(false);
  const headerBannerRef = useRef(null);
  const [mealsUnder99, setMealsUnder99] = useState([]);
  const [loadingMealsUnder99, setLoadingMealsUnder99] = useState(true);
  const [meals99RefreshNonce, setMeals99RefreshNonce] = useState(0);
  const [selectedDishForModal, setSelectedDishForModal] = useState(null);
  const [meals99SortBy, setMeals99SortBy] = useState("relevance");
  const [meals99IsVeg, setMeals99IsVeg] = useState(false);
  const [meals99IsNonVeg, setMeals99IsNonVeg] = useState(false);
  const [meals99Rating4Plus, setMeals99Rating4Plus] = useState(false);
  const [meals99HasOffers, setMeals99HasOffers] = useState(false);
  const [meals99Under30Mins, setMeals99Under30Mins] = useState(false);

  const filteredMealsUnder99 = useMemo(() => {
    let result = [...mealsUnder99];

    // Apply global veg mode filter first
    if (vegMode) {
      result = filterDishesForVegMode(result, vegMode, vegModeOption);
    }

    if (meals99IsVeg) {
      result = result.filter((m) => m.isVeg);
    }
    if (meals99IsNonVeg) {
      result = result.filter((m) => !m.isVeg);
    }
    if (meals99Rating4Plus) {
      result = result.filter((m) => (m.rating || 4.2) >= 4.0);
    }
    if (meals99HasOffers) {
      result = result.filter(
        (m) => (m.originalPrice && m.originalPrice > m.price) || m.discount > 0 || m.offer
      );
    }
    if (meals99Under30Mins) {
      result = result.filter((m) => (m.preparationTime || 25) <= 30);
    }

    if (meals99SortBy === "rating") {
      result.sort((a, b) => (b.rating || 4.2) - (a.rating || 4.2));
    } else if (meals99SortBy === "cost_low_to_high") {
      result.sort((a, b) => a.price - b.price);
    } else if (meals99SortBy === "cost_high_to_low") {
      result.sort((a, b) => b.price - a.price);
    } else if (meals99SortBy === "delivery_time") {
      result.sort((a, b) => (a.preparationTime || 25) - (b.preparationTime || 25));
    }

    return result;
  }, [
    mealsUnder99,
    meals99SortBy,
    meals99IsVeg,
    meals99IsNonVeg,
    meals99Rating4Plus,
    meals99HasOffers,
    meals99Under30Mins,
    vegMode,
    vegModeOption,
  ]);
  const [landingCategories, setLandingCategories] = useState([]);
  const [landingExploreMore, setLandingExploreMore] = useState([]);
  const [exploreMoreHeading, setExploreMoreHeading] = useState("Explore More");
  const [recommendedRestaurantIds, setRecommendedRestaurantIds] = useState([]);
  const [
    recommendedRestaurantsFromSettings,
    setRecommendedRestaurantsFromSettings,
  ] = useState([]);
  const [loadingLandingConfig, setLoadingLandingConfig] = useState(true);
  const homeRestoreBootRef = useRef(null);
  if (homeRestoreBootRef.current === null) {
    const pending =
      typeof window !== "undefined" ? peekHomeScrollState() : null;
    const snap =
      typeof window !== "undefined" ? peekHomePageSnapshot() : null;
    const targetCount = pending?.visibleCount || 0;
    const targetScrollY = pending?.scrollY || 0;
    // Restore whenever a locked/pending home position exists.
    // In-app restaurant back often PUSHes `/food/user` (not POP).
    const canRestore = Boolean(
      pending && (targetScrollY > 0 || targetCount > 0),
    );

    homeRestoreBootRef.current = {
      canRestore,
      pending: canRestore ? pending : null,
      snap: canRestore ? snap : null,
      targetCount: Math.max(targetCount, 9),
      targetScrollY: canRestore ? targetScrollY : 0,
    };
  }
  const [restaurantsData, setRestaurantsData] = useState(() => {
    const snap = homeRestoreBootRef.current?.snap?.restaurantsData;
    return Array.isArray(snap) && snap.length > 0 ? snap : [];
  });
  const [loadingRestaurants, setLoadingRestaurants] = useState(() => {
    const snap = homeRestoreBootRef.current?.snap?.restaurantsData;
    return !(Array.isArray(snap) && snap.length > 0);
  });
  const restaurantsDataRef = useRef(restaurantsData);
  const [realCategories, setRealCategories] = useState([]);
  const [loadingRealCategories, setLoadingRealCategories] = useState(true);
  const [menuCategories, setMenuCategories] = useState([]);
  const [loadingMenuCategories, setLoadingMenuCategories] = useState(false);
  const [restaurantDietMeta, setRestaurantDietMeta] = useState({});
  const [showAllCategoriesModal, setShowAllCategoriesModal] = useState(false);
  const [availabilityTick, setAvailabilityTick] = useState(Date.now());
  const RESTAURANTS_BATCH_SIZE = 9;
  const homeScrollRestoreRef = useRef(null);
  if (homeScrollRestoreRef.current === null) {
    const boot = homeRestoreBootRef.current;
    const hasWarmList =
      boot?.canRestore &&
      Array.isArray(boot?.snap?.restaurantsData) &&
      boot.snap.restaurantsData.length > 0;
    homeScrollRestoreRef.current = {
      active: Boolean(boot?.canRestore),
      targetCount: boot?.targetCount || RESTAURANTS_BATCH_SIZE,
      targetScrollY: boot?.targetScrollY || 0,
      appliedVisible: false,
      scrollRestored: !(boot?.canRestore && boot?.targetScrollY > 0),
      settleKey: null,
      warmStart: hasWarmList,
      skipNextFetch: hasWarmList,
    };
  }
  const [visibleRestaurantCount, setVisibleRestaurantCount] = useState(() => {
    const restore = homeScrollRestoreRef.current;
    if (restore?.active && restore.targetCount > RESTAURANTS_BATCH_SIZE) {
      return restore.targetCount;
    }
    return RESTAURANTS_BATCH_SIZE;
  });
  const visibleRestaurantCountRef = useRef(visibleRestaurantCount);
  const isRestoringScroll = Boolean(homeRestoreBootRef.current?.canRestore);
  const homeUiStateRef = useRef({
    activeFilters: [],
    sortBy: null,
    selectedCuisine: null,
    restaurantsData: [],
  });
  const restaurantLoadMoreRef = useRef(null);
  const publicCategoriesCacheRef = useRef(new Map());
  const publicCategoriesInFlightRef = useRef(new Map());
  const isHandlingSwitchOff = useRef(false);
  const heroShellRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const categoryAnchorRef = useRef(null);
  const filtersSentinelRef = useRef(null);
  const lastScrollYRef = useRef(0);
  const tickingRef = useRef(false);
  const [isSmartStickyActive, setIsSmartStickyActive] = useState(false);
  const [smartScrollDirection, setSmartScrollDirection] = useState("down");
  const [isFiltersCrossed, setIsFiltersCrossed] = useState(false);
  const [isCategoriesCrossed, setIsCategoriesCrossed] = useState(false);
  const [showCuisinesModal, setShowCuisinesModal] = useState(false);
  const slugifyCategory = useCallback(
    (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    [],
  );

  // Stable list of restaurant ids for menu-category union so we don't refetch menus
  // when `restaurantsData` changes for reasons like distance recalculation or outletTimings enrichment.
  const menuUnionRestaurantIdsKey = useMemo(() => {
    if (!Array.isArray(restaurantsData) || restaurantsData.length === 0) return "";
    return restaurantsData
      .map((r) => String(r?.restaurantId || r?.id || "").trim())
      .filter(Boolean)
      .sort()
      .join(",");
  }, [restaurantsData]);

  const normalizeImageUrl = useCallback(
    (imageUrl) => {
      if (typeof imageUrl !== "string") return "";
      const trimmed = imageUrl.trim();
      if (!trimmed) return "";
      if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
        return trimmed;
      }
      const appProtocol =
        typeof window !== "undefined" ? window.location?.protocol : "";
      const appHost =
        typeof window !== "undefined" ? window.location?.hostname : "";
      let normalizedInput = trimmed
        .replace(/\\/g, "/")
        .replace(/^(https?):\/(?!\/)/i, "$1://")
        .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1");

      if (/^\/\//.test(normalizedInput)) {
        normalizedInput = `${appProtocol || "https:"}${normalizedInput}`;
      }

      // WebView can fail on unescaped spaces/special chars; keep URLs safely encoded.
      if (/^(https?:)?\/\//i.test(normalizedInput)) {
        try {
          const parsed = new URL(normalizedInput, window.location.origin);

          // In mobile production, localhost/127.0.0.1 inside image URLs is unreachable.
          // Use BACKEND_ORIGIN (API server) for image host, not frontend hostuploads are served by the backend.
          if (
            appHost &&
            appHost !== "localhost" &&
            appHost !== "127.0.0.1" &&
            /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)
          ) {
            try {
              const backendUrl = new URL(BACKEND_ORIGIN);
              parsed.protocol = backendUrl.protocol;
              parsed.hostname = backendUrl.hostname;
              parsed.port = backendUrl.port;
            } catch {
              parsed.protocol = window.location.protocol;
              parsed.hostname = window.location.hostname;
              if (window.location.port) parsed.port = window.location.port;
            }
          }

          // Prevent mixed-content image blocking in HTTPS WebView.
          if (appProtocol === "https:" && parsed.protocol === "http:") {
            parsed.protocol = "https:";
          }

          const finalUrl = parsed.toString();
          // Do not encode signed URLs (S3/Cloudfront/Cloudinary); encoding query params can break signatures.
          const hasSignedParams =
            /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
              finalUrl,
            );
          return hasSignedParams ? finalUrl : encodeURI(finalUrl);
        } catch {
          return normalizedInput;
        }
      }

      const absolutePath = normalizedInput.startsWith("/")
        ? `${BACKEND_ORIGIN}${normalizedInput}`
        : `${BACKEND_ORIGIN}/${normalizedInput.replace(/^\.?\/*/, "")}`;

      try {
        const parsed = new URL(absolutePath, window.location.origin);
        if (appProtocol === "https:" && parsed.protocol === "http:") {
          parsed.protocol = "https:";
        }
        const finalUrl = parsed.toString();
        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            finalUrl,
          );
        return hasSignedParams ? finalUrl : encodeURI(finalUrl);
      } catch {
        return absolutePath;
      }
    },
    [BACKEND_ORIGIN],
  );

  const extractImageFromValue = useCallback(
    (value) => {
      if (!value) return "";

      if (typeof value === "string") {
        return normalizeImageUrl(value);
      }

      if (typeof value === "object") {
        const candidate =
          value.url ||
          value.secure_url ||
          value.imageUrl ||
          value.imageURL ||
          value.image ||
          value.src ||
          value.path ||
          value.location ||
          value.link ||
          value.href ||
          "";
        return typeof candidate === "string"
          ? normalizeImageUrl(candidate)
          : "";
      }

      return "";
    },
    [normalizeImageUrl],
  );

  const buildRestaurantImageCandidates = useCallback(
    (value) => {
      const normalized = extractImageFromValue(value);
      if (!normalized) return [];
      return [normalized];
    },
    [extractImageFromValue],
  );

  const extractImages = useCallback(
    (source) => {
      if (!source) return [];

      const normalizedImages = (Array.isArray(source)
        ? source.flatMap((entry) => buildRestaurantImageCandidates(entry))
        : buildRestaurantImageCandidates(source)
      )
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean);

      // De-duplicate image urls while preserving order.
      return normalizedImages.filter(
        (value, index) => normalizedImages.indexOf(value) === index,
      );

    },
    [buildRestaurantImageCandidates],
  );

  useEffect(() => {
    visibleRestaurantCountRef.current = visibleRestaurantCount;
  }, [visibleRestaurantCount]);

  useEffect(() => {
    restaurantsDataRef.current = restaurantsData;
  }, [restaurantsData]);

  // Persist scroll + lazy-load batch so returning from a restaurant restores place.
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.history?.scrollRestoration) {
        window.history.scrollRestoration = "manual";
      }
    } catch {
      // ignore
    }

    const persist = () => {
      // Avoid clobbering a pending restore payload (e.g. React Strict Mode remount).
      if (homeScrollRestoreRef.current?.active && !homeScrollRestoreRef.current?.scrollRestored) {
        return;
      }
      const ui = homeUiStateRef.current;
      captureHomeScrollBeforeLeave(visibleRestaurantCountRef.current, {
        filters: {
          activeFilters: ui.activeFilters,
          sortBy: ui.sortBy,
          selectedCuisine: ui.selectedCuisine,
        },
        lock: false,
      });
      if (ui.restaurantsData?.length) {
        stashHomePageSnapshot({ restaurantsData: ui.restaurantsData });
      }
    };

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        persist();
      }
    };

    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      persist();
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const captureScrollBeforeRestaurantNav = useCallback(() => {
    const ui = homeUiStateRef.current;
    captureHomeScrollBeforeLeave(visibleRestaurantCountRef.current, {
      filters: {
        activeFilters: ui.activeFilters,
        sortBy: ui.sortBy,
        selectedCuisine: ui.selectedCuisine,
      },
      lock: true,
    });
    if (ui.restaurantsData?.length) {
      stashHomePageSnapshot({ restaurantsData: ui.restaurantsData });
    }
  }, []);

  useEffect(() => {
    const tickAvailability = () => {
      if (typeof document !== "undefined" && document.hidden) return
      setAvailabilityTick(Date.now());
    }
    const intervalId = setInterval(tickAvailability, 60000);
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setAvailabilityTick(Date.now());
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const heroShell = heroShellRef.current;
      const stickyHeader = stickyHeaderRef.current;

      if (!heroShell) {
        setHasScrolledPastBanner(false);
        return;
      }

      const heroRect = heroShell.getBoundingClientRect();
      const stickyHeight = stickyHeader?.getBoundingClientRect().height || 0;
      setHasScrolledPastBanner(heroRect.bottom <= stickyHeight);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  useEffect(() => {
    const commitStuckState = (nextValue) => {
      if (isCategoryStuckRef.current === nextValue) return;
      isCategoryStuckRef.current = nextValue;
      setIsCategoryStuck(nextValue);
    };

    const syncStuckState = () => {
      if (window.innerWidth >= 768) {
        commitStuckState(false);
        return;
      }
      const anchor = categoryAnchorRef.current;
      if (!anchor) return;
      // Use sentinel directly so blur and sticky release on the same scroll tick.
      const shouldStick = anchor.getBoundingClientRect().top <= 72;
      commitStuckState(shouldStick);
    };

    syncStuckState();
    window.addEventListener("scroll", syncStuckState, { passive: true, capture: true });
    window.addEventListener("resize", syncStuckState);

    return () => {
      window.removeEventListener("scroll", syncStuckState, { capture: true });
      window.removeEventListener("resize", syncStuckState);
    };
  }, []);

  // Smart Scroll-Aware Sticky Header Listener (Dynamic Banner Height Based)
  useEffect(() => {
    const handleScroll = () => {
      if (!tickingRef.current) {
        requestAnimationFrame(() => {
          const currentScrollY = window.scrollY || document.documentElement.scrollTop;
          const deltaY = currentScrollY - lastScrollYRef.current;

          // Measure bottom position of the top banner header element
          let bannerBottom = -1;
          let bannerHeight = 360;
          if (headerBannerRef.current) {
            const rect = headerBannerRef.current.getBoundingClientRect();
            bannerBottom = rect.bottom;
            bannerHeight = rect.height || 360;
          }

          // Sticky header active threshold
          const activeThreshold = Math.max(100, bannerHeight - 50);
          setIsSmartStickyActive(currentScrollY > activeThreshold);

          // Scroll direction detection with minimum 4px hysteresis to prevent jitter
          if (Math.abs(deltaY) > 4) {
            setSmartScrollDirection(deltaY > 0 ? "up" : "down");
          }

          // Detect if original filters sentinel has reached/crossed top area
          if (filtersSentinelRef.current) {
            const rect = filtersSentinelRef.current.getBoundingClientRect();
            setIsFiltersCrossed(rect.top <= 140);
          } else {
            setIsFiltersCrossed(false);
          }

          // STRICT CHECK: Banner MUST be 100% offscreen (bottom <= 0 or scrollY > bannerHeight + 10)
          // Add 25px hysteresis gap to prevent stuttering/jitter when scrolling around threshold
          const isBannerFullyOffscreen = bannerBottom !== -1
            ? bannerBottom <= 0
            : currentScrollY > (bannerHeight + 10);

          setIsCategoriesCrossed((prev) => {
            if (isBannerFullyOffscreen) return true;
            // Only turn OFF if user scrolls back UP enough that banner bottom is visible (>= 25px on screen)
            if (bannerBottom >= 25 || currentScrollY < bannerHeight - 20) return false;
            return prev;
          });

          lastScrollYRef.current = currentScrollY;
          tickingRef.current = false;
        });
        tickingRef.current = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    window.addEventListener("resize", handleScroll);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("resize", handleScroll);
    };
  }, []);


  // Merge API explore items with fallback to ensure all 4 cards are shown
  const finalExploreItems = useMemo(() => {
    const fallback = [
      {
        id: "offers",
        label: "Offers",
        image: exploreOffers,
        href: "/food/user/offers",
      },
      {
        id: "gourmet",
        label: "Gourmet",
        image: exploreGourmet,
        href: "/food/user/gourmet",
      },
      {
        id: "collection",
        label: "Collections",
        image: exploreCollection,
        href: "/food/user/profile/favorites",
      },
    ];

    if (!landingExploreMore || landingExploreMore.length === 0) return fallback;

    return fallback.map((item) => {
      const apiItem = landingExploreMore.find(
        (ai) => ai.label?.toLowerCase() === item.label?.toLowerCase(),
      );
      if (apiItem) {
        const href = apiItem.link
          ? apiItem.link.startsWith("/")
            ? apiItem.link
            : `/${apiItem.link}`
          : item.href;
        return {
          ...item,
          image:
            normalizeImageUrl(apiItem.imageUrl || apiItem.image || "") ||
            item.image,
          href,
        };
      }
      return item;
    });
  }, [landingExploreMore, normalizeImageUrl]);

  const normalizedLandingCategories = useMemo(() => {
    return (landingCategories || []).map((category, index) => ({
      id: category.id || category._id || `landing-category-${index}`,
      name: category.label || category.name || "Category",
      image:
        normalizeImageUrl(category.imageUrl || category.image) ||
        foodImages[index % foodImages.length] ||
        foodImages[0],
      slug:
        category.slug || slugifyCategory(category.label || category.name || ""),
      label: category.label || category.name || "Category",
    }));
  }, [landingCategories, normalizeImageUrl, slugifyCategory]);

  const displayCategories = useMemo(() => {
    let list = [];
    if (realCategories.length > 0) list = [...realCategories];
    else if (menuCategories.length > 0) list = [...menuCategories];
    else list = [...normalizedLandingCategories];

    // Required food categories requested by user
    const requiredItems = [
      { id: "cat-pizza", name: "Pizza", slug: "pizza", image: pizzaImg },
      { id: "cat-chatpata", name: "Chatpata", slug: "chatpata", image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-chaat", name: "Chaat", slug: "chaat", image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-biryani", name: "Biryani", slug: "biryani", image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-paneer", name: "paneer", slug: "paneer", image: paneerImg },
      { id: "cat-beverages", name: "Beverages", slug: "beverages", image: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-drinks", name: "Drinks", slug: "drinks", image: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-burger", name: "Burger", slug: "burger", image: burgerImg },
      { id: "cat-rolls", name: "Rolls", slug: "rolls", image: rollsImg },
      { id: "cat-kebabs", name: "Kebabs", slug: "kebabs", image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-main-course", name: "Main Course", slug: "main-course", image: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-combo", name: "Combo", slug: "combo", image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-fried-rice", name: "Fried Rice", slug: "fried-rice", image: friedRiceImg },
      { id: "cat-sandwich", name: "Sandwich", slug: "sandwich", image: sandwichImg },
      { id: "cat-momos", name: "Momos", slug: "momos", image: momosImg },
      { id: "cat-khichdi", name: "Khichdi", slug: "khichdi", image: khichdiImg },
      { id: "cat-dosa", name: "Dosa", slug: "dosa", image: dosaImg },
      { id: "cat-pasta", name: "Pasta", slug: "pasta", image: pastaImg },
      { id: "cat-chole-bhature", name: "Chole Bhature", slug: "chole-bhature", image: choleBhatureImg },
      { id: "cat-cake", name: "Cake", slug: "cake", image: cakeImg },
      { id: "cat-desserts", name: "Desserts", slug: "desserts", image: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-paratha", name: "Paratha", slug: "paratha", image: parathaImg },
      { id: "cat-noodles", name: "Noodles", slug: "noodles", image: noodlesImg },
      { id: "cat-chinese", name: "Chinese", slug: "chinese", image: "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=85" },
      { id: "cat-thali", name: "Thali", slug: "thali", image: thaliImg },
      { id: "cat-north-indian", name: "North Indian", slug: "north-indian", image: northIndianImg },
      { id: "cat-south-indian", name: "South Indian", slug: "south-indian", image: "https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=500&auto=format&fit=crop&q=85" },
    ];

    // Ensure required items are present if missing from API, or update image if item exists
    requiredItems.forEach((req) => {
      const idx = list.findIndex(
        (c) =>
          (c.name || c.label || "").toLowerCase() === req.name.toLowerCase() ||
          (c.slug || "").toLowerCase() === req.slug.toLowerCase()
      );
      if (idx !== -1) {
        list[idx] = { ...list[idx], image: req.image };
      } else {
        list.push(req);
      }
    });

    // Rearrange category order based on user request (Vibrant mixed order):
    if (list.length > 0) {
      const findAndExtract = (predicate) => {
        const idx = list.findIndex(predicate);
        if (idx !== -1) {
          const [item] = list.splice(idx, 1);
          return item;
        }
        return null;
      };

      const paneerItem = findAndExtract((c) => (c.name || c.label || "").toLowerCase().includes("paneer"));
      const beverageItem = findAndExtract((c) => {
        const name = (c.name || c.label || "").toLowerCase();
        return name.includes("beverage") || name.includes("drink");
      });
      const pizzaItem = findAndExtract((c) => (c.name || c.label || "").toLowerCase().includes("pizza"));
      const biryaniItem = findAndExtract((c) => (c.name || c.label || "").toLowerCase().includes("biryani"));
      const burgerItem = findAndExtract((c) => (c.name || c.label || "").toLowerCase().includes("burger"));
      const momosItem = findAndExtract((c) => (c.name || c.label || "").toLowerCase().includes("momo"));

      if (paneerItem) list.splice(1, 0, paneerItem);
      if (beverageItem) list.splice(3, 0, beverageItem);
      if (pizzaItem) list.splice(0, 0, pizzaItem);
      if (biryaniItem) list.splice(2, 0, biryaniItem);
      if (burgerItem) list.splice(5, 0, burgerItem);
      if (momosItem) list.splice(7, 0, momosItem);
    }

    // Veg mode hides non-veg category scopes from the rail.
    if (vegMode) {
      list = list.filter((cat) => !isNonVegCategoryScope(cat));
    }

    return list;
  }, [menuCategories, realCategories, normalizedLandingCategories, vegMode]);

  // Swipe functionality for hero banner carousel
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);
  const isSwiping = useRef(false);
  const autoSlideIntervalRef = useRef(null);

  // Sync prevVegMode when vegMode changes from context
  useEffect(() => {
    if (vegMode !== prevVegMode && !isHandlingSwitchOff.current) {
      setPrevVegMode(vegMode);
    }
  }, [vegMode]);

  // Keep persisted Veg Mode preference; only reset popup UI state on mount.
  useEffect(() => {
    setPrevVegMode(vegMode);
    setShowVegModePopup(false);
    setShowSwitchOffPopup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle vegMode toggle - show popup when turned ON or OFF
  const handleVegModeChange = (newValue) => {
    // Skip if we're handling switch off confirmation
    if (isHandlingSwitchOff.current) {
      return;
    }

    if (newValue && !prevVegMode) {
      // Veg mode was just turned ON
      // Calculate popup position relative to toggle
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320); // 320 is max-w-xs

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
      setShowVegModePopup(true);
      // Don't update context yet - wait for user to apply or cancel
    } else if (!newValue && prevVegMode) {
      // Veg mode was just turned OFF - show switch off confirmation popup
      isHandlingSwitchOff.current = true;
      setShowSwitchOffPopup(true);
      // Don't update context yet - wait for user to confirm
    } else {
      // Normal state change - update context directly
      setVegModeContext(newValue);
      setPrevVegMode(newValue);
    }
  };

  // Listen for top VEG MODE switch clicks from DesktopNavbar
  useEffect(() => {
    const handleTrigger = (e) => {
      e.preventDefault();
      const targetVal = e.detail?.newValue !== undefined ? e.detail.newValue : !vegMode;
      handleVegModeChange(targetVal);
    };
    window.addEventListener("triggerVegModePopup", handleTrigger);
    return () => window.removeEventListener("triggerVegModePopup", handleTrigger);
  }, [handleVegModeChange, vegMode]);

  // Update popup position on scroll/resize
  useEffect(() => {
    if (!showVegModePopup) return;

    const updatePosition = () => {
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320);

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showVegModePopup]);

  // Hero / Promo banners from centralized public config
  useEffect(() => {
    const bannersList = Array.isArray(promoBanners) && promoBanners.length > 0
      ? promoBanners
      : (Array.isArray(heroBanners) ? heroBanners.filter(b => !String(b?.imageUrl || '').match(/\.(mp4|webm|mov|m4v|avi)(\?.*)?$/i)) : []);

    if (bannersList.length === 0 && !Array.isArray(promoBanners)) {
      setLoadingBanners(true);
      return;
    }

    const images = bannersList
      .map((b) => {
        if (!b) return "";
        const raw = b.imageUrl || b.image || b.bannerImage || b.bannerUrl || b.url || (typeof b === "string" ? b : "");
        if (!raw) return "";
        return resolveImageUrl(raw);
      })
      .filter(Boolean);
    setHeroBannerImages(images);
    setHeroBannersData(bannersList);
    setCurrentBannerIndex(0);
    setLoadingBanners(false);
  }, [promoBanners, heroBanners]);

  // Old backend endpoint removed: keep UI stable with empty categories.
  useEffect(() => {
    setLoadingRealCategories(true);
    setRealCategories([]);
    setLoadingRealCategories(false);
  }, []);



  // Keep index within current banner bounds after admin updates/reloads.
  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (heroBannerImages.length === 0) return 0;
      return Math.min(prev, heroBannerImages.length - 1);
    });
  }, [heroBannerImages.length]);

  // Auto-slide hero banner without background preload storms

  const startHeroBannerAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current);
    }

    if (heroBannerImages.length <= 1) return;

    autoSlideIntervalRef.current = setInterval(() => {
      if (!isSwiping.current && (typeof document === "undefined" || !document.hidden)) {
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
    }, HERO_BANNER_AUTO_SLIDE_MS);
  }, [heroBannerImages.length, HERO_BANNER_AUTO_SLIDE_MS]);

  // Auto-cycle hero banner images
  useEffect(() => {
    startHeroBannerAutoSlide();

    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current);
      }
    };
  }, [startHeroBannerAutoSlide]);

  // Helper function to reset auto-slide timer
  const resetAutoSlide = useCallback(() => {
    startHeroBannerAutoSlide();
  }, [startHeroBannerAutoSlide]);

  // Swipe handlers for hero banner carousel
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = true;
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.touches[0].clientX;
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50; // Minimum distance for a swipe

    // Check if it's a horizontal swipe (not vertical scroll)
    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        // Swipe right - go to previous image
        setCurrentBannerIndex(
          (prev) =>
            (prev - 1 + heroBannerImages.length) % heroBannerImages.length,
        );
      } else {
        // Swipe left - go to next image
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    // Reset swipe state after a short delay
    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    // Reset touch positions
    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };

  // Mouse handlers for desktop drag support
  const handleMouseDown = (e) => {
    touchStartX.current = e.clientX;
    touchStartY.current = e.clientY;
    isSwiping.current = true;
  };

  const handleMouseMove = (e) => {
    if (!isSwiping.current) return;
    touchEndX.current = e.clientX;
    touchEndY.current = e.clientY;
  };

  const handleMouseUp = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50;

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        setCurrentBannerIndex(
          (prev) =>
            (prev - 1 + heroBannerImages.length) % heroBannerImages.length,
        );
      } else {
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };
  const [activeFilters, setActiveFilters] = useState(() => {
    const list = homeRestoreBootRef.current?.pending?.filters?.activeFilters;
    return new Set(Array.isArray(list) ? list : []);
  });
  const [sortBy, setSortBy] = useState(
    () => homeRestoreBootRef.current?.pending?.filters?.sortBy ?? null,
  ); // null, 'price-low', 'price-high', 'rating-high', 'rating-low'
  const [selectedCuisine, setSelectedCuisine] = useState(
    () => homeRestoreBootRef.current?.pending?.filters?.selectedCuisine ?? null,
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isVoiceOverlayOpen, setIsVoiceOverlayOpen] = useState(false);
  const voiceSearch = useVoiceSearch((transcript) => {
    navigate(`/food/user/search?q=${encodeURIComponent(transcript)}&mode=delivery`);
    setIsVoiceOverlayOpen(false);
  });
  const openVoiceSearch = useCallback(() => {
    voiceSearch.clearError();
    void voiceSearch.startListening();
    setIsVoiceOverlayOpen(true);
  }, [voiceSearch]);
  const [appliedFilters, setAppliedFilters] = useState(() => {
    const f = homeRestoreBootRef.current?.pending?.filters;
    return {
      activeFilters: new Set(Array.isArray(f?.activeFilters) ? f.activeFilters : []),
      sortBy: f?.sortBy ?? null,
      selectedCuisine: f?.selectedCuisine ?? null,
    };
  });
  const [isLoadingFilterResults, setIsLoadingFilterResults] = useState(false);
  const [activeFilterTab, setActiveFilterTab] = useState("sort");

  const toggleHomeFilter = useCallback((filterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filterKey)) {
        next.delete(filterKey);
      } else {
        next.add(filterKey);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    homeUiStateRef.current = {
      activeFilters: Array.from(activeFilters),
      sortBy,
      selectedCuisine,
      restaurantsData,
    };
  }, [activeFilters, sortBy, selectedCuisine, restaurantsData]);
  const categoryScrollRef = useRef(null);
  const gsapAnimationsRef = useRef([]);
  // Show skeletons immediately while loading — delayed toggles caused visible layout swap (CLS).
  const showBannerSkeleton = loadingBanners;
  const showCategorySkeleton = loadingRealCategories || loadingMenuCategories;
  const showExploreSkeleton = loadingLandingConfig;
  const showRestaurantSkeleton = isLoadingFilterResults || loadingRestaurants;
  // Safely get profile context - handle case when ProfileProvider is not available
  let profileContext = null;
  try {
    profileContext = useProfile();
  } catch (error) {
    debugWarn("ProfileProvider not available, using fallback:", error.message);
    // Fallback values when ProfileProvider is not available
    profileContext = {
      addFavorite: () => debugWarn("ProfileProvider not available"),
      removeFavorite: () => debugWarn("ProfileProvider not available"),
      isFavorite: () => false,
      getFavorites: () => [],
      getDefaultAddress: () => null,
    };
  }

  const {
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavorites,
  } = profileContext;
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart } = useCart();
  const {
    effectiveLocation,
    deliveryAddressMode,
    savedAddressText,
    zoneId,
    zoneStatus,
    isInService,
    isOutOfService,
    zoneLoading,
    zoneError,
  } = useDeliveryLocation();

  useEffect(() => {
    if (Array.isArray(exploreIcons)) {
      setLandingExploreMore(exploreIcons);
    }
  }, [exploreIcons]);

  useEffect(() => {
    let cancelled = false;
    const fetchMealsUnder99 = async () => {
      try {
        setLoadingMealsUnder99(true);
        if (!zoneId && (!Number.isFinite(effectiveLocation?.latitude) || !Number.isFinite(effectiveLocation?.longitude))) {
          setMealsUnder99([]);
          return;
        }

        const params = { limit: 40 };
        if (zoneId) params.zoneId = zoneId;
        if (Number.isFinite(effectiveLocation?.latitude) && Number.isFinite(effectiveLocation?.longitude)) {
          params.lat = effectiveLocation.latitude;
          params.lng = effectiveLocation.longitude;
        }

        // Eligibility (final selling price ₹99 or below) is decided by the backend.
        const foodsResponse = await restaurantAPI.getEatiefy99Foods(params);

        if (cancelled) return;

        const foodsData = foodsResponse?.data?.data || {};
        const foodsRaw = Array.isArray(foodsData.foods) ? foodsData.foods : [];
        const targetPrice = Number(foodsData.targetPrice) || 99;

        const filteredMeals = foodsRaw
          // Defensive only: never render anything the server did not price within the cap.
          .filter((food) => {
            const price = Number(food?.price);
            return food?.isAvailable !== false && price > 0 && price <= targetPrice;
          })
          .map((food) => {
            const rId = String(food?.restaurantId || "").trim();
            const isVeg = isVegMenuItem(food);

            return {
              ...food,
              id: String(food?.id || food?._id || `${rId}-${food?.name || "dish"}`),
              price: Number(food?.price || 0),
              isVeg,
              restaurantName: food?.restaurantName || "Restaurant",
              restaurantId: rId,
              rating: Number(food?.rating || 4.2),
              image: food?.image || "",
            };
          });

        const uniqueMeals = [];
        const seenNames = new Set();
        for (const meal of filteredMeals) {
          const nameKey = meal.name.toLowerCase().trim();
          if (!seenNames.has(nameKey)) {
            seenNames.add(nameKey);
            uniqueMeals.push(meal);
          }
        }

        if (!cancelled) {
          setMealsUnder99(uniqueMeals.slice(0, 15));
        }
      } catch (error) {
        console.error("Error fetching meals under 99:", error);
        if (!cancelled) {
          setMealsUnder99([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingMealsUnder99(false);
        }
      }
    };

    fetchMealsUnder99();
    return () => {
      cancelled = true;
    };
  }, [zoneId, effectiveLocation?.latitude, effectiveLocation?.longitude, meals99RefreshNonce]);

  // Live refresh: a price, menu or pricing-rule change can add/remove ₹99 dishes.
  useFoodPageInvalidation(
    useCallback(() => {
      setMeals99RefreshNonce((n) => n + 1);
    }, []),
  );

  const getCartItemQuantity = (dish) => {
    const variants = dish.variants || [];
    const resolvedVariant = variants.length > 0 ? variants[0] : null;
    const lineItemId = buildCartLineId(dish.id || dish._id || "", resolvedVariant?.id || resolvedVariant?._id || "");
    const item = getCartItem(lineItemId);
    return item ? item.quantity : 0;
  };

  const handleIncreaseQuantity = async (dish, event = null, quantity = 1) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      toast.error("Please login to add items to cart");
      navigate('/food/user/auth/login', { state: { from: window.location.pathname } });
      return;
    }

    const variants = dish.variants || [];
    const resolvedVariant = variants.length > 0 ? variants[0] : null;
    const lineItemId = buildCartLineId(dish.id || dish._id || "", resolvedVariant?.id || resolvedVariant?._id || "");

    if (isOutOfService) {
      toast.error('You are outside the service zone. Please select a location within the service area.');
      return;
    }

    const cartItem = {
      id: lineItemId,
      lineItemId,
      itemId: dish.id || dish._id,
      name: dish.name,
      price: resolvedVariant?.price ?? dish.price,
      variantId: resolvedVariant?.id || "",
      variantName: resolvedVariant?.name || "",
      variantPrice: resolvedVariant?.price ?? dish.price,
      image: dish.image,
      restaurant: dish.restaurantName || "Restaurant",
      restaurantId: dish.restaurantId || undefined,
      description: dish.description || "",
      originalPrice: dish.originalPrice || dish.price,
      foodType: dish.foodType,
      isVeg: dish.isVeg,
      // The cart reads how many to add from the item itself.
      quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
    };

    let sourcePosition = null;
    if (event) {
      const buttonElement = event.currentTarget;
      if (buttonElement) {
        const rect = buttonElement.getBoundingClientRect();
        sourcePosition = {
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          scrollX: window.scrollX || 0,
          scrollY: window.scrollY || 0,
          itemId: lineItemId,
        };
      }
    }

    const result = await addToCart(cartItem, sourcePosition);
    // Cancelled replace prompts are a user choice, not an error worth a toast.
    if (result?.ok === false && !result.cancelled) {
      toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.');
    }
  };

  const handleDecreaseQuantity = (dish, event = null) => {
    const variants = dish.variants || [];
    const resolvedVariant = variants.length > 0 ? variants[0] : null;
    const lineItemId = buildCartLineId(dish.id || dish._id || "", resolvedVariant?.id || resolvedVariant?._id || "");
    const existingCartItem = getCartItem(lineItemId);
    if (!existingCartItem) return;

    const newQuantity = existingCartItem.quantity - 1;

    let sourcePosition = null;
    if (event) {
      const buttonElement = event.currentTarget;
      if (buttonElement) {
        const rect = buttonElement.getBoundingClientRect();
        sourcePosition = {
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          scrollX: window.scrollX || 0,
          scrollY: window.scrollY || 0,
          itemId: lineItemId,
        };
      }
    }

    const productInfo = {
      id: lineItemId,
      name: dish.name,
      imageUrl: dish.image,
    };

    if (newQuantity <= 0) {
      removeFromCart(lineItemId, sourcePosition, productInfo);
    } else {
      updateQuantity(lineItemId, newQuantity, sourcePosition, productInfo);
    }
  };

  // Landing settings (zone-specific) from centralized public config
  useEffect(() => {
    let cancelled = false;
    setLoadingLandingConfig(true);

    void refreshLanding(zoneId, true)
      .then((landing) => {
        if (cancelled || !landing) return;
        setExploreMoreHeading(landing.exploreMoreHeading || "Explore More");
        setRecommendedRestaurantIds(landing.recommendedRestaurantIds || []);
        setRecommendedRestaurantsFromSettings(landing.recommendedRestaurants || []);
      })
      .catch(() => {
        if (!cancelled) {
          setExploreMoreHeading("Explore More");
          setRecommendedRestaurantsFromSettings([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLandingConfig(false);
      });

    return () => {
      cancelled = true;
    };
  }, [zoneId, effectiveLocation?.latitude, effectiveLocation?.longitude, refreshLanding]);
  const [showToast, setShowToast] = useState(false);
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState(null);

  // Fetch categories (zone-aware) for the homepage category rail.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const zoneKey = `${String(zoneId || "global")}_${effectiveLocation?.latitude || 0}_${effectiveLocation?.longitude || 0}`;
      try {
        // Dedupe repeated calls (StrictMode + zone settling). Cache per zoneKey and share in-flight request.
        const cached = publicCategoriesCacheRef.current.get(zoneKey);
        if (cached) {
          if (!cancelled) setRealCategories(cached);
          return;
        }

        const inFlight = publicCategoriesInFlightRef.current.get(zoneKey);
        if (inFlight) {
          const categories = await inFlight;
          if (!cancelled) setRealCategories(categories);
          return;
        }

        setLoadingRealCategories(true);
        const promise = (async () => {
          const params = {};
          if (zoneId) params.zoneId = zoneId;
          if (Number.isFinite(effectiveLocation?.latitude) && Number.isFinite(effectiveLocation?.longitude)) {
            params.lat = effectiveLocation.latitude;
            params.lng = effectiveLocation.longitude;
          }
          const res = await adminAPI.getPublicCategories(params);
          const list =
            res?.data?.data?.categories ||
            res?.data?.categories ||
            [];
          const categories = Array.isArray(list)
            ? list.map((cat, idx) => {
              const nameLower = (cat?.name || "").toLowerCase();
              let customImage = "";
              if (nameLower.includes("thali") || nameLower.includes("main course")) customImage = "/images/categories/thali.png";
              else if (nameLower.includes("beverage") || nameLower.includes("drink")) customImage = "/images/categories/beverages.png";
              else if (nameLower.includes("sweet") || nameLower.includes("cake")) customImage = "/images/categories/sweet.png";
              else if (nameLower.includes("momo")) customImage = "/images/categories/momos.png";

              return {
                id: String(cat?.id || cat?._id || cat?.slug || idx),
                name: cat?.name || "",
                slug: cat?.slug || String(cat?.name || "").toLowerCase().replace(/\s+/g, "-"),
                image:
                  customImage ||
                  normalizeImageUrl(cat?.image || cat?.imageUrl) ||
                  foodImages[idx % foodImages.length] ||
                  foodImages[0],
                type: cat?.type || "",
              };
            })
            : [];

          publicCategoriesCacheRef.current.set(zoneKey, categories);
          return categories;
        })();

        publicCategoriesInFlightRef.current.set(zoneKey, promise);
        const categories = await promise;
        publicCategoriesInFlightRef.current.delete(zoneKey);

        if (!cancelled) setRealCategories(categories);
      } catch (err) {
        debugWarn("Failed to fetch categories:", err);
        if (!cancelled) setRealCategories([]);
      } finally {
        if (!cancelled) setLoadingRealCategories(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [zoneId, effectiveLocation?.latitude, effectiveLocation?.longitude, normalizeImageUrl]);

  // Memoize cartCount to prevent recalculation on every render - use cart directly
  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + (item.quantity || 0), 0),
    [cart],
  );

  const cityName = effectiveLocation?.city || "Select";
  const stateName = effectiveLocation?.state || "Location";
  const hasLiveLocation = useMemo(() => {
    if (!effectiveLocation) return false;

    const isPlaceholder = (value) => {
      if (!value) return true;
      const normalized = String(value).trim().toLowerCase();
      return (
        !normalized ||
        normalized === "select location" ||
        normalized === "current location"
      );
    };

    const hasAddressText =
      !isPlaceholder(effectiveLocation.formattedAddress) ||
      !isPlaceholder(effectiveLocation.address);
    const hasCityState =
      !isPlaceholder(effectiveLocation.city) || !isPlaceholder(effectiveLocation.state);

    return hasAddressText || hasCityState;
  }, [effectiveLocation]);

  const headerSavedAddressText =
    deliveryAddressMode === "saved" ? savedAddressText : "";

  // Mock points value - replace with actual points from context/store
  const userPoints = 99;

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("food");


  // Simple filter toggle function
  const toggleFilter = (filterId) => {
    setActiveFilters((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filterId)) {
        newSet.delete(filterId);
      } else {
        newSet.add(filterId);
      }
      return newSet;
    });
  };

  // Refs for scroll tracking
  const filterSectionRefs = useRef({});
  const [activeScrollSection, setActiveScrollSection] = useState("sort");
  const rightContentRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const restaurantsRequestSeqRef = useRef(0);
  const menuUnionRequestSeqRef = useRef(0);
  const menuUnionCacheRef = useRef(new Map());

  // Scroll tracking effect
  useEffect(() => {
    if (!isFilterOpen || !rightContentRef.current) return;

    const observerOptions = {
      root: rightContentRef.current,
      rootMargin: "-20% 0px -70% 0px",
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      if (isProgrammaticScrollRef.current) return;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute("data-section-id");
          if (sectionId) {
            setActiveScrollSection(sectionId);
            setActiveFilterTab(sectionId);
          }
        }
      });
    }, observerOptions);

    // Observe all filter sections
    Object.values(filterSectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [isFilterOpen]);

  // Fetch restaurants from API with filters
  const fetchRestaurants = useCallback(
    async (filters = {}) => {
      const requestSeq = ++restaurantsRequestSeqRef.current;
      try {
        const restore = homeScrollRestoreRef.current;
        const suppressLoading =
          restore?.active &&
          !restore?.scrollRestored &&
          (restaurantsDataRef.current?.length > 0);
        if (!suppressLoading) {
          setLoadingRestaurants(true);
        }

        // Backend disconnected - new backend in progress. Skip health check.

        // Build query parameters from filters
        const params = {};

        // Always send user coordinates when available so backend can compute distance/sort.
        if (
          Number.isFinite(effectiveLocation?.latitude) &&
          Number.isFinite(effectiveLocation?.longitude)
        ) {
          params.lat = effectiveLocation.latitude;
          params.lng = effectiveLocation.longitude;
        }

        // Sort by
        if (filters.sortBy) {
          params.sortBy = filters.sortBy;
        }

        // Cuisine
        if (filters.selectedCuisine) {
          params.cuisine = filters.selectedCuisine;
        }

        // Rating filters
        if (filters.activeFilters?.has("rating-45-plus")) {
          params.minRating = 4.5;
        } else if (filters.activeFilters?.has("rating-4-plus")) {
          params.minRating = 4.0;
        } else if (filters.activeFilters?.has("rating-35-plus")) {
          params.minRating = 3.5;
        }

        // Delivery time filters
        if (filters.activeFilters?.has("delivery-under-30")) {
          params.maxDeliveryTime = 30;
        } else if (filters.activeFilters?.has("delivery-under-45")) {
          params.maxDeliveryTime = 45;
        }
        // Distance filters
        if (filters.activeFilters?.has("distance-under-1km")) {
          params.radiusKm = 1.0;
        } else if (filters.activeFilters?.has("distance-under-2km")) {
          params.radiusKm = 2.0;
        }

        // Price filters
        if (filters.activeFilters?.has("price-under-200")) {
          params.maxPrice = 200;
        } else if (filters.activeFilters?.has("price-under-500")) {
          params.maxPrice = 500;
        }

        // Veg mode filter (see buildVegModeQueryParams: sending isVeg for every
        // option made the server answer with veg restaurants even for non-veg).
        Object.assign(params, buildVegModeQueryParams({ vegMode, vegModeOption }));

        // Offers filter
        if (filters.activeFilters?.has("has-offers")) {
          params.hasOffers = "true";
        }

        // Trust filters
        if (filters.activeFilters?.has("top-rated")) {
          params.topRated = "true";
        } else if (filters.activeFilters?.has("trusted")) {
          params.trusted = "true";
        }

        // Strict zone-only listing for user home.
        // If zone is not detected yet, don't fetch global restaurants.
        if (!zoneId) {
          const keepWarmList =
            homeScrollRestoreRef.current?.active &&
            !homeScrollRestoreRef.current?.scrollRestored &&
            restaurantsDataRef.current?.length > 0;
          if (!keepWarmList) {
            setRestaurantsData([]);
          }
          if (requestSeq === restaurantsRequestSeqRef.current) {
            setLoadingRestaurants(false);
          }
          return;
        }
        params.zoneId = zoneId;

        debugLog("Fetching restaurants with params:", params);
        const response = await restaurantAPI.getRestaurants(params);
        debugLog("Restaurants API response:", response.data);

        // If a newer request started, ignore this response to avoid races/flicker.
        if (requestSeq !== restaurantsRequestSeqRef.current) return;

        if (
          response.data &&
          response.data.success &&
          response.data.data &&
          response.data.data.restaurants
        ) {
          const restaurantsArray = response.data.data.restaurants;
          debugLog(`Fetched ${restaurantsArray.length} restaurants from API`);

          if (restaurantsArray.length === 0) {
            debugWarn("No restaurants found in API response");
            const keepWarmList =
              homeScrollRestoreRef.current?.active &&
              !homeScrollRestoreRef.current?.scrollRestored &&
              restaurantsDataRef.current?.length > 0;
            if (!keepWarmList) {
              setRestaurantsData([]);
            }
            return;
          }

          // Get user coordinates
          const userLat = effectiveLocation?.latitude;
          const userLng = effectiveLocation?.longitude;

          // Transform API data to match expected format
          const transformedRestaurants = restaurantsArray
            .filter((restaurant) => {
              const name = (restaurant.restaurantName || restaurant.name || "").toLowerCase()
              return true
            })
            .map((restaurant, index) => {
              // Use restaurant data if available, otherwise use defaults
              const deliveryTime =
                restaurant.estimatedDeliveryTime || "25-30 mins";

              // Get first cuisine or default
              const cuisine =
                restaurant.cuisines && restaurant.cuisines.length > 0
                  ? restaurant.cuisines[0]
                  : "Multi-cuisine";

              // Legacy-safe image extraction (supports old schema variants).
              const coverImages = extractImages([
                ...(Array.isArray(restaurant.coverImages) ? restaurant.coverImages : [restaurant.coverImages]).filter(Boolean),
                restaurant.coverImage,
              ]);

              const profileImageCandidates = extractImages([
                ...buildRestaurantImageCandidates(restaurant.profileImage),
                ...buildRestaurantImageCandidates(
                  restaurant.onboarding?.step2?.profileImageUrl,
                ),
                ...buildRestaurantImageCandidates(restaurant.image),
                ...buildRestaurantImageCandidates(restaurant.imageUrl),
              ]);
              const profileImageUrl = profileImageCandidates[0] || "";

              const allImages = Array.from(
                new Set(
                  [
                    ...coverImages,
                    ...profileImageCandidates,
                  ].filter(Boolean),
                ),
              );

              // Keep single image for backward compatibility
              const fallbackImage = horizontalFoodImages[index % horizontalFoodImages.length];
              const image = allImages[0] || profileImageUrl || fallbackImage;
              const activeOffers = Array.isArray(restaurant.activeOffers)
                ? restaurant.activeOffers
                : [];
              const offerText = activeOffers[0]?.summary || restaurant.offer || null;
              const distanceInfo = resolveRestaurantDistance(restaurant, {
                latitude: userLat,
                longitude: userLng,
              });

              return {
                id: restaurant.restaurantId || restaurant._id,
                mongoId: restaurant._id || null,
                name: getRestaurantDisplayName(restaurant),
                cuisine: cuisine,
                cuisines: Array.isArray(restaurant.cuisines)
                  ? restaurant.cuisines
                  : [],
                rating: Number(restaurant.rating) || 0,
                deliveryTime:
                  restaurant.deliveryTime ||
                  restaurant.estimatedDeliveryTime ||
                  (restaurant.estimatedDeliveryTimeMinutes
                    ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
                    : deliveryTime),
                distance: distanceInfo?.label || "",
                distanceInKm: distanceInfo?.km ?? null,
                image: image,
                images: allImages, // Array of cover images for carousel (separate from menu images)
                priceRange: restaurant.priceRange || "$$", // Use from API or default
                featuredDish:
                  restaurant.featuredDish ||
                  (restaurant.cuisines && restaurant.cuisines.length > 0
                    ? `${restaurant.cuisines[0]} Special`
                    : "Special Dish"),
                featuredPrice: restaurant.featuredPrice || 249, // Use from API or default
                offer: offerText,
                activeOffers,
                offerCount:
                  Number(restaurant.offerCount) > 0
                    ? Number(restaurant.offerCount)
                    : activeOffers.length,
                slug: restaurant.slug,
                restaurantId: restaurant.restaurantId,
                // Dropped here before, so the later client-side vegMode filter
                // (which reads foodType, not just the booleans below) could
                // never tell a Non-Veg restaurant apart from a Mixed one.
                foodType: restaurant.foodType || null,
                pureVegRestaurant: restaurant.pureVegRestaurant === true,
                pureVeganRestaurant: restaurant.pureVeganRestaurant === true,
                isVeg: restaurant.isVeg === true || restaurant.pureVegRestaurant === true,
                isPureVeg: restaurant.isPureVeg === true || restaurant.pureVegRestaurant === true,
                isPureVegan: restaurant.isPureVegan === true || restaurant.pureVeganRestaurant === true,
                location: restaurant.location,
                isActive: restaurant.isActive !== false, // Default to true if not specified
                isAcceptingOrders: restaurant.isAcceptingOrders !== false, // Default to true if not specified
                openDays: Array.isArray(restaurant.openDays)
                  ? restaurant.openDays
                  : [],
                deliveryTimings: restaurant.deliveryTimings || null,
                outletTimings: restaurant.outletTimings || null,
                openingTime: restaurant.openingTime || restaurant?.deliveryTimings?.openingTime || null,
                closingTime: restaurant.closingTime || restaurant?.deliveryTimings?.closingTime || null,
                recommendedDishes: Array.isArray(restaurant.recommendedDishes)
                  ? restaurant.recommendedDishes
                  : (Array.isArray(restaurant.recommendedItems) ? restaurant.recommendedItems : []),
                recommendedItems: Array.isArray(restaurant.recommendedItems) ? restaurant.recommendedItems : [],
                hasDishes: restaurant.hasDishes !== undefined ? restaurant.hasDishes : true,
              };
            },
            );

          const sortRestaurantsForDisplay = (restaurants) => {
            if (!userLat || !userLng) return restaurants;
            return [...restaurants].sort((a, b) => {
              // Open-before-closed is NOT decided here: this ran only once, at
              // fetch time, and only when coordinates were known, so the order
              // went stale as restaurants opened/closed. `filteredRestaurants`
              // owns that grouping now and re-applies it on every tick.

              // Apply secondary sort based on sortBy filter
              if (filters.sortBy === "price-low") {
                return (a.featuredPrice || 0) - (b.featuredPrice || 0);
              }
              if (filters.sortBy === "price-high") {
                return (b.featuredPrice || 0) - (a.featuredPrice || 0);
              }
              if (filters.sortBy === "rating-high") {
                return (b.rating || 0) - (a.rating || 0);
              }
              if (filters.sortBy === "rating-low") {
                return (a.rating || 0) - (b.rating || 0);
              }

              // Preserve API order (backend already sorts nearest-first when lat/lng provided)
              return 0;
            });
          };

          debugLog(
            "Transformed and sorted restaurants:",
            transformedRestaurants,
          );
          startTransition(() => {
            setRestaurantsData(sortRestaurantsForDisplay(transformedRestaurants));
          });

          const restaurantsNeedingOutletTimings = transformedRestaurants.filter(
            (restaurant) => restaurant.mongoId && !restaurant.outletTimings,
          );

          // Outlet timings are already resolved by the backend listApprovedRestaurants API
        } else {
          debugWarn("Invalid API response structure:", response.data);
          const keepWarmList =
            homeScrollRestoreRef.current?.active &&
            !homeScrollRestoreRef.current?.scrollRestored &&
            restaurantsDataRef.current?.length > 0;
          if (!keepWarmList) {
            setRestaurantsData([]);
          }
        }
      } catch (error) {
        debugError("Error fetching restaurants:", error);
        debugError("Error details:", error.response?.data || error.message);
        // Don't set hardcoded data here - let the useMemo fallback handle it
        // This way, if API succeeds later, it will show the real data
        const keepWarmList =
          homeScrollRestoreRef.current?.active &&
          !homeScrollRestoreRef.current?.scrollRestored &&
          restaurantsDataRef.current?.length > 0;
        if (!keepWarmList) {
          setRestaurantsData([]);
        }
      } finally {
        if (requestSeq === restaurantsRequestSeqRef.current) {
          setLoadingRestaurants(false);
        }
      }
    },
    [
      extractImages,
      buildRestaurantImageCandidates,
      effectiveLocation?.latitude,
      effectiveLocation?.longitude,
      zoneId,
      vegMode,
      vegModeOption,
    ],
  );

  const applyFiltersAndRefetch = useCallback(
    async (
      nextActiveFilters = activeFilters,
      nextSortBy = sortBy,
      nextSelectedCuisine = selectedCuisine,
    ) => {
      const nextFilterState = {
        activeFilters: new Set(nextActiveFilters),
        sortBy: nextSortBy,
        selectedCuisine: nextSelectedCuisine,
      };

      setAppliedFilters(nextFilterState);
      setIsLoadingFilterResults(true);

      try {
        await fetchRestaurants(nextFilterState);
      } catch (error) {
        debugError("Error applying filters:", error);
      } finally {
        setIsLoadingFilterResults(false);
      }
    },
    [activeFilters, sortBy, selectedCuisine, fetchRestaurants],
  );

  // Fetch restaurants when appliedFilters change
  useEffect(() => {
    const restore = homeScrollRestoreRef.current;
    if (restore?.skipNextFetch) {
      restore.skipNextFetch = false;
      setLoadingRestaurants(false);
      return;
    }
    fetchRestaurants(appliedFilters);
  }, [appliedFilters, fetchRestaurants]);

  // Live refresh: pull restaurants again when the catalog changes (a restaurant
  // went online, edited timings, added a dish) instead of waiting for a reload.
  useFoodPageInvalidation(
    useCallback(() => {
      fetchRestaurants(appliedFilters);
    }, [fetchRestaurants, appliedFilters]),
  );

  // Recalculate distances when user location updates
  // Menu categories are resolved from admin categories / landing config without N+1 menu network requests
  useEffect(() => {
    setLoadingMenuCategories(false);
  }, []);

  const applyClientFilters = useCallback(
    (list) => {
      if (!Array.isArray(list)) return [];

      let result = list;

      // Global Veg Mode filter
      if (vegMode) {
        result = filterRestaurantsForVegMode(result, { vegMode, vegModeOption });
      }

      // Veg filter
      if (activeFilters.has("veg")) {
        result = result.filter((r) => r.pureVegRestaurant === true || r.isVeg === true);
      }

      // Non-Veg filter (pure non-veg only, excludes Mixed restaurants which also have pureVegRestaurant === false)
      if (activeFilters.has("non-veg")) {
        result = result.filter((r) => r.foodType === "Non-Veg");
      }

      // Rating filters
      if (activeFilters.has("rating-4plus") || activeFilters.has("rating-4-plus")) {
        result = result.filter((r) => (Number(r.rating) || 4.2) >= 4.0);
      }
      if (activeFilters.has("rating-35-plus")) {
        result = result.filter((r) => (Number(r.rating) || 4.2) >= 3.5);
      }
      if (activeFilters.has("rating-45-plus")) {
        result = result.filter((r) => (Number(r.rating) || 4.2) >= 4.5);
      }

      // Offers filters
      if (
        activeFilters.has("has-offers") ||
        activeFilters.has("offers") ||
        activeFilters.has("offer-50-percent") ||
        activeFilters.has("offer-40-percent") ||
        activeFilters.has("offer-30-percent") ||
        activeFilters.has("offer-free-delivery") ||
        activeFilters.has("offer-bogo") ||
        activeFilters.has("offer-under-99") ||
        activeFilters.has("offer-under-250")
      ) {
        result = result.filter((r) => {
          if (activeFilters.has("offer-50-percent")) {
            return (r.discount || 0) >= 50 || String(r.offer || "").includes("50");
          }
          if (activeFilters.has("offer-40-percent")) {
            return (r.discount || 0) >= 40 || String(r.offer || "").includes("40");
          }
          if (activeFilters.has("offer-30-percent")) {
            return (r.discount || 0) >= 30 || String(r.offer || "").includes("30");
          }
          if (activeFilters.has("offer-free-delivery")) {
            return r.freeDelivery === true || r.deliveryFee === 0;
          }
          if (activeFilters.has("offer-under-99")) {
            return (r.price || r.avgPrice || 99) <= 99;
          }
          if (activeFilters.has("offer-under-250")) {
            return (r.price || r.avgPrice || 150) <= 250;
          }
          return Boolean(r.offer || r.discount || r.hasOffers || (Array.isArray(r.offers) && r.offers.length > 0));
        });
      }

      // Delivery time filters
      if (activeFilters.has("delivery-under-30") || activeFilters.has("delivery-30min")) {
        result = result.filter((r) => {
          const mins = parseInt(String(r.deliveryTime || "").match(/\d+/)?.[0] || "30", 10);
          return mins <= 30;
        });
      }
      if (activeFilters.has("delivery-under-45")) {
        result = result.filter((r) => {
          const mins = parseInt(String(r.deliveryTime || "").match(/\d+/)?.[0] || "30", 10);
          return mins <= 45;
        });
      }

      // Distance filters
      // Uses numeric km (the label can be "450 m"); unknown distance is left to
      // the server-side radiusKm filter rather than dropped here.
      const isWithinKm = (r, maxKm) =>
        !Number.isFinite(r.distanceInKm) || r.distanceInKm <= maxKm;
      if (activeFilters.has("distance-under-1km")) {
        result = result.filter((r) => isWithinKm(r, 1.0));
      }
      if (activeFilters.has("distance-under-2km")) {
        result = result.filter((r) => isWithinKm(r, 2.0));
      }

      // Dish Price filters
      if (activeFilters.has("price-under-200")) {
        result = result.filter((r) => (r.price || r.avgPrice || 150) <= 200);
      }
      if (activeFilters.has("price-under-500")) {
        result = result.filter((r) => (r.price || r.avgPrice || 150) <= 500);
      }

      // Sorting
      if (sortBy) {
        result = [...result];
        if (sortBy === "price-low" || sortBy === "cost_low_to_high") {
          result.sort((a, b) => (a.price || a.avgPrice || 0) - (b.price || b.avgPrice || 0));
        } else if (sortBy === "price-high" || sortBy === "cost_high_to_low") {
          result.sort((a, b) => (b.price || b.avgPrice || 0) - (a.price || a.avgPrice || 0));
        } else if (sortBy === "rating-high" || sortBy === "rating") {
          result.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
        } else if (sortBy === "rating-low") {
          result.sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
        } else if (sortBy === "delivery_time" || sortBy === "delivery-time-low") {
          result.sort((a, b) => {
            const timeA = parseInt(String(a.deliveryTime || "").match(/\d+/)?.[0] || "30", 10);
            const timeB = parseInt(String(b.deliveryTime || "").match(/\d+/)?.[0] || "30", 10);
            return timeA - timeB;
          });
        }
      }

      return result;
    },
    [activeFilters, sortBy, vegMode, vegModeOption]
  );

  /**
   * Open restaurants first, closed ones after — the final word on ordering.
   *
   * A stable partition rather than a comparator, so whatever order the list
   * already had (backend nearest-first relevance, or the active sortBy applied
   * by applyClientFilters) is preserved untouched inside each group.
   * Nothing is removed; closed restaurants keep their card and status badge.
   */
  const partitionByAvailability = useCallback((list, now) => {
    if (!Array.isArray(list) || list.length === 0) return list;
    const open = [];
    const closed = [];
    for (const restaurant of list) {
      if (getRestaurantAvailabilityStatus(restaurant, now).isOpen) {
        open.push(restaurant);
      } else {
        closed.push(restaurant);
      }
    }
    return closed.length === 0 ? list : [...open, ...closed];
  }, []);

  // Filter restaurants and foods based on active filters
  const filteredRestaurants = useMemo(() => {
    // Grouping runs last so a client sortBy cannot mix closed restaurants back
    // in, and re-runs on availabilityTick so the order tracks the same live
    // status the cards already show.
    return partitionByAvailability(
      applyClientFilters(restaurantsData || []),
      new Date(availabilityTick),
    );
  }, [restaurantsData, applyClientFilters, partitionByAvailability, availabilityTick]);

  const restaurantLazyLoadResetKey = useMemo(() => {
    const activeFilterKey = Array.from(activeFilters).sort().join("|");
    return `${restaurantsData.length}:${activeFilterKey}:${selectedCuisine || ""}:${sortBy || ""}:${vegMode ? "1" : "0"}:${vegModeOption}`;
  }, [activeFilters, restaurantsData.length, selectedCuisine, sortBy, vegMode, vegModeOption]);

  const visibleRestaurants = useMemo(
    () => filteredRestaurants.slice(0, visibleRestaurantCount),
    [filteredRestaurants, visibleRestaurantCount],
  );

  const hasMoreRestaurants =
    visibleRestaurantCount < filteredRestaurants.length;

  const loadMoreRestaurants = useCallback(() => {
    setVisibleRestaurantCount((previous) =>
      Math.min(previous + RESTAURANTS_BATCH_SIZE, filteredRestaurants.length),
    );
  }, [filteredRestaurants.length, RESTAURANTS_BATCH_SIZE]);

  useEffect(() => {
    const restore = homeScrollRestoreRef.current;

    // Hold restored batch until scroll restore finishes so async filter/veg
    // hydration cannot collapse the list mid-restore.
    if (restore.active && restore.targetCount > RESTAURANTS_BATCH_SIZE) {
      if (!restore.scrollRestored) {
        if (filteredRestaurants.length > 0) {
          if (
            !restore.appliedVisible ||
            visibleRestaurantCountRef.current <
            Math.min(restore.targetCount, filteredRestaurants.length)
          ) {
            setVisibleRestaurantCount(
              Math.min(restore.targetCount, filteredRestaurants.length),
            );
            restore.appliedVisible = true;
          }
          // Track latest key while restoring so late veg/filter hydration
          // does not look like a user-driven change after settle.
          restore.settleKey = restaurantLazyLoadResetKey;
        }
        return;
      }

      if (restore.settleKey === restaurantLazyLoadResetKey) {
        return;
      }
      // User changed filters/sort after restore settled.
      restore.active = false;
      restore.targetCount = 0;
    }

    setVisibleRestaurantCount(
      Math.min(RESTAURANTS_BATCH_SIZE, filteredRestaurants.length),
    );
  }, [restaurantLazyLoadResetKey, filteredRestaurants.length, RESTAURANTS_BATCH_SIZE]);

  useEffect(() => {
    if (visibleRestaurantCount <= filteredRestaurants.length) return;
    const restore = homeScrollRestoreRef.current;
    if (
      restore.active &&
      restore.targetCount > RESTAURANTS_BATCH_SIZE &&
      filteredRestaurants.length === 0
    ) {
      return;
    }
    setVisibleRestaurantCount(filteredRestaurants.length);
  }, [filteredRestaurants.length, visibleRestaurantCount, RESTAURANTS_BATCH_SIZE]);

  // Restore window scroll after restaurants are painted with enough rows.
  useLayoutEffect(() => {
    const restore = homeScrollRestoreRef.current;
    if (!restore.active || restore.scrollRestored) return;
    if (restore.targetScrollY <= 0) {
      restore.scrollRestored = true;
      window.setTimeout(() => {
        clearHomeScrollState();
      }, 400);
      return;
    }

    // Jump immediately before paint so Home never flashes at the top.
    window.scrollTo(0, restore.targetScrollY);
    if (document.documentElement) {
      document.documentElement.scrollTop = restore.targetScrollY;
    }
    if (document.body) {
      document.body.scrollTop = restore.targetScrollY;
    }
  }, []);

  useEffect(() => {
    const restore = homeScrollRestoreRef.current;
    if (!restore.active || restore.scrollRestored) return;

    if (restore.targetScrollY <= 0) {
      restore.scrollRestored = true;
      window.setTimeout(() => {
        clearHomeScrollState();
      }, 400);
      return;
    }

    // Allow restore as soon as we have enough painted rows (warm snapshot),
    // even if a background refetch is still in flight.
    if (
      (showRestaurantSkeleton || loadingRestaurants || isLoadingFilterResults) &&
      visibleRestaurants.length === 0
    ) {
      return;
    }
    if (
      restore.targetCount > RESTAURANTS_BATCH_SIZE &&
      filteredRestaurants.length > 0 &&
      !restore.appliedVisible
    ) {
      return;
    }

    const targetY = restore.targetScrollY;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60;

    const finish = () => {
      restore.scrollRestored = true;
      // Short grace so React Strict Mode remount can still peek pending state.
      window.setTimeout(() => {
        clearHomeScrollState();
      }, 400);
    };

    const tryRestore = () => {
      if (cancelled) return;
      attempts += 1;
      const docHeight = Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0,
      );
      const viewport = window.innerHeight || 0;
      const canReach = docHeight >= targetY + Math.min(80, viewport * 0.2);

      window.scrollTo(0, targetY);
      if (document.documentElement) document.documentElement.scrollTop = targetY;
      if (document.body) document.body.scrollTop = targetY;

      const currentY =
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement?.scrollTop ||
        0;
      const closeEnough = Math.abs(currentY - targetY) < 12;

      if ((canReach && closeEnough) || attempts >= maxAttempts) {
        finish();
        return;
      }

      window.setTimeout(() => {
        requestAnimationFrame(tryRestore);
      }, 40);
    };

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(tryRestore);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [
    showRestaurantSkeleton,
    loadingRestaurants,
    isLoadingFilterResults,
    visibleRestaurants.length,
    filteredRestaurants.length,
    RESTAURANTS_BATCH_SIZE,
  ]);

  useEffect(() => {
    if (!hasMoreRestaurants) return;
    if (showRestaurantSkeleton || loadingRestaurants || isLoadingFilterResults) return;
    const target = restaurantLoadMoreRef.current;
    if (!target || typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        startTransition(() => {
          loadMoreRestaurants();
        });
      },
      {
        root: null,
        rootMargin: "240px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [
    hasMoreRestaurants,
    showRestaurantSkeleton,
    loadingRestaurants,
    isLoadingFilterResults,
    loadMoreRestaurants,
  ]);
  const matchesVegMode = useCallback(
    (restaurant) => matchesVegRestaurantFilter(restaurant, { vegMode, vegModeOption }),
    [vegMode, vegModeOption]
  );

  const recommendedForYouRestaurants = useMemo(() => {
    const idsInOrder = (recommendedRestaurantIds || []).map((id) => String(id));
    const hasIds = idsInOrder.length > 0;
    const fromSettings = Array.isArray(recommendedRestaurantsFromSettings)
      ? recommendedRestaurantsFromSettings
      : [];

    const currentZoneRestaurants = Array.isArray(restaurantsData) ? restaurantsData : [];

    // Primary source: restaurants returned by landing settings API (already curated / zone-resolved).
    const fromSettingsMapped = fromSettings
      .filter((restaurant) => {
        if (!restaurant) return false;
        if (zoneId && restaurant?.zoneId && String(restaurant.zoneId) !== String(zoneId)) {
          return false;
        }
        return true;
      })
      .map((restaurant) => {
        const restaurantId = restaurant?._id ? String(restaurant._id) : "";
        const cuisine =
          Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
            ? restaurant.cuisines[0]
            : "Multi-cuisine";
        const imageCandidates = extractImages([
          ...(Array.isArray(restaurant?.coverImages)
            ? restaurant.coverImages
            : [restaurant?.coverImages]
          ).filter(Boolean),
          restaurant?.profileImage,
        ]);
        const image = imageCandidates[0] || foodImages[0];

        const liveMatch = currentZoneRestaurants.find(
          (cr) => String(cr.mongoId || cr.id || cr.restaurantId) === restaurantId || (cr.slug && cr.slug === restaurant.slug)
        );

        const distanceInfo = liveMatch?.distance
          ? { label: liveMatch.distance, km: liveMatch.distanceInKm ?? null }
          : resolveRestaurantDistance(restaurant, {
            latitude: effectiveLocation?.latitude,
            longitude: effectiveLocation?.longitude,
          });

        return {
          id: restaurant?.restaurantId || restaurantId,
          mongoId: restaurantId,
          name: getRestaurantDisplayName(restaurant),
          cuisine,
          cuisines: Array.isArray(restaurant?.cuisines) ? restaurant.cuisines : [],
          rating: Number(liveMatch?.rating || restaurant?.rating) || 0,
          distance: distanceInfo?.label || "",
          distanceInKm: distanceInfo?.km ?? null,
          deliveryTime: liveMatch?.deliveryTime || (restaurant?.estimatedDeliveryTime || "25-30 mins"),
          image: normalizeImageUrl(image) || foodImages[0],
          images: imageCandidates.length > 0 ? imageCandidates : [foodImages[0]],
          slug: restaurant?.slug || restaurant?.restaurantId || restaurantId,
          offer: liveMatch?.offer || restaurant?.offer || null,
          pureVegRestaurant: restaurant?.pureVegRestaurant === true,
          isActive: liveMatch?.isActive ?? (restaurant?.isActive !== false),
          isAcceptingOrders: liveMatch?.isAcceptingOrders ?? (restaurant?.isAcceptingOrders !== false),
          openingTime: liveMatch?.openingTime || restaurant?.openingTime,
          closingTime: liveMatch?.closingTime || restaurant?.closingTime,
          openDays: liveMatch?.openDays || restaurant?.openDays,
          location: liveMatch?.location || restaurant?.location,
        };
      });

    // Keep admin-selected order when IDs exist, while ensuring all recommended restaurants from settings remain included
    let list = [];
    if (fromSettingsMapped.length > 0) {
      if (hasIds) {
        const matched = [];
        const seenIds = new Set();
        for (const id of idsInOrder) {
          const found = fromSettingsMapped.find(
            (r) => String(r.mongoId) === id || String(r.id) === id
          );
          if (found && !seenIds.has(String(found.mongoId || found.id))) {
            matched.push(found);
            seenIds.add(String(found.mongoId || found.id));
          }
        }
        for (const r of fromSettingsMapped) {
          const rKey = String(r.mongoId || r.id);
          if (!seenIds.has(rKey)) {
            matched.push(r);
            seenIds.add(rKey);
          }
        }
        list = matched;
      } else {
        list = fromSettingsMapped;
      }
    }

    // Dynamic fallback: if no picks exist from settings for this location,
    // dynamically recommend the highest-rated approved restaurants in this location!
    if (list.length === 0 && currentZoneRestaurants.length > 0) {
      list = [...currentZoneRestaurants]
        .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
        .slice(0, 10);
    }

    // Deduplicate by restaurant identity
    const uniqueList = [];
    const seen = new Set();
    for (const r of list) {
      const key = String(r.mongoId || r.id || r.slug);
      if (!seen.has(key)) {
        seen.add(key);
        uniqueList.push(r);
      }
    }

    return uniqueList
      .filter(matchesVegMode)
      .slice(0, 15);
  }, [
    recommendedRestaurantIds,
    recommendedRestaurantsFromSettings,
    restaurantsData,
    zoneId,
    effectiveLocation?.latitude,
    effectiveLocation?.longitude,
    extractImages,
    normalizeImageUrl,
    matchesVegMode,
  ]);

  const filteredRecommendedForYou = useMemo(() => {
    // Same rule as the main list: open first, closed after. The partition is
    // stable, so the admin-curated order from landing settings is preserved
    // inside each group — closed picks move to the end, they are not dropped.
    return partitionByAvailability(
      applyClientFilters(recommendedForYouRestaurants || []),
      new Date(availabilityTick),
    );
  }, [
    recommendedForYouRestaurants,
    applyClientFilters,
    partitionByAvailability,
    availabilityTick,
  ]);

  // Featured foods removed - will be handled by restaurants data from API
  const filteredFeaturedFoods = useMemo(() => {
    // Return empty array - featured foods will come from API if needed
    return [];
  }, [activeFilters, sortBy]);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleLocationClick = useCallback(() => {
    openLocationSelector();
  }, [openLocationSelector]);

  const handleSearchFocus = useCallback(() => {
    openSearch();
  }, [openSearch]);

  const handleSearchClose = useCallback(() => {
    closeSearch();
    setHeroSearch("");
  }, [closeSearch]);

  const shouldShowOutOfZoneScreen = useMemo(() => {
    const hasCoords =
      Number.isFinite(Number(effectiveLocation?.latitude)) &&
      Number.isFinite(Number(effectiveLocation?.longitude));
    return hasCoords && zoneStatus === "OUT_OF_SERVICE" && !zoneLoading;
  }, [effectiveLocation?.latitude, effectiveLocation?.longitude, zoneStatus, zoneLoading]);

  // Removed GSAP animations - using CSS and ScrollReveal components instead for better performance
  // Auto-scroll removed - manual scroll only

  // Animated placeholder cycling - same as RestaurantDetails highlight offer animation
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 2000); // Change placeholder every 2 seconds (same as RestaurantDetails)

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, []); // placeholders is a constant, no need for dependency

  // Memoized Hero Banner Component for better perf
  const HeroBannerSection = useMemo(() => {
    if (showBannerSkeleton) {
      return (
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 w-full py-3 sm:py-4">
          <HeroBannerSkeleton className="w-full aspect-[1.85/1] sm:aspect-[2/1] rounded-3xl" />
        </div>
      );
    }

    if (heroBannerImages.length === 0) return null;

    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 w-full py-3 sm:py-4">
        <div
          ref={heroShellRef}
          data-home-hero-shell="true"
          className="relative w-full overflow-hidden aspect-[1.85/1] sm:aspect-[2/1] rounded-3xl sm:rounded-[2.4rem] shadow-xl shadow-gray-200/80 dark:shadow-black/60 border border-gray-100 dark:border-gray-800/90 group cursor-pointer bg-white dark:bg-[#2e2e2e] transition-all duration-300 hover:shadow-2xl hover:scale-[1.005]"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="absolute inset-0 z-0">
            {/* Shining Glint Effect */}
            <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
              <motion.div
                animate={{
                  x: ['-200%', '200%'],
                }}
                transition={{
                  duration: 2.5,
                  repeat: Infinity,
                  repeatDelay: 5,
                  ease: "easeInOut"
                }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[-20deg] w-[150%] h-full"
              />
            </div>
            {heroBannerImages.map((image, index) => (
              <div
                key={`${index}-${image}`}
                className="absolute inset-0 transition-opacity duration-700 ease-in-out z-0"
                style={{
                  opacity: currentBannerIndex === index ? 1 : 0,
                  zIndex: currentBannerIndex === index ? 2 : 1,
                  pointerEvents: "none",
                }}>
                <img
                  src={resolveImageUrl(image)}
                  alt={`Hero Banner ${index + 1}`}
                  className="h-full w-full object-cover"
                  loading={index === currentBannerIndex ? "eager" : "lazy"}
                  fetchPriority={index === currentBannerIndex ? "high" : "low"}
                  draggable={false}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = cloudinaryImages.biryani_clean;
                  }}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            className="absolute inset-0 z-20 h-full w-full border-0 p-0 bg-transparent text-left"
            onClick={() => {
              const bannerData = heroBannersData[currentBannerIndex];
              const ctaLink = bannerData?.ctaLink || bannerData?.link || bannerData?.targetLink;
              if (ctaLink) {
                captureScrollBeforeRestaurantNav();
                let target = String(ctaLink).trim();
                if (target.startsWith('http://') || target.startsWith('https://')) {
                  try {
                    const urlObj = new URL(target);
                    target = urlObj.pathname + urlObj.search + urlObj.hash;
                  } catch {}
                }
                if (!target.startsWith('/')) {
                  target = `/${target}`;
                }
                if (!target.startsWith('/food') && !target.startsWith('/admin') && !target.startsWith('/restaurant')) {
                  target = `/food${target}`;
                }
                navigate(target);
                return;
              }
              const linkedRestaurants = bannerData?.linkedRestaurants || [];
              if (linkedRestaurants.length > 0) {
                const firstRestaurant = linkedRestaurants[0];
                const restaurantSlug = firstRestaurant.slug || firstRestaurant.restaurantId || firstRestaurant._id;
                captureScrollBeforeRestaurantNav();
                navigate(`/food/restaurants/${restaurantSlug}`);
              }
            }}
            aria-label={`Open hero banner ${currentBannerIndex + 1}`}
          />

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-3 py-1.5 bg-black/25 backdrop-blur-md rounded-full border border-white/20 z-30 shadow-md">
            {heroBannerImages.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentBannerIndex(index);
                }}
                className={`h-1.5 rounded-full transition-all duration-300 ${currentBannerIndex === index ? "bg-white w-5 shadow-sm" : "bg-white/40 w-1.5 hover:bg-white/70"
                  }`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }, [heroBannerImages, currentBannerIndex, showBannerSkeleton, heroBannersData, navigate, captureScrollBeforeRestaurantNav]);

  // Memoized Category Rail Header
  const CategoryRailHeader = useMemo(() => {
    return (
      <section className="space-y-4 pt-4 sm:pt-6">
        <div className="px-4 flex items-center justify-between">
          <h2 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
            What are you craving today?
          </h2>
          <button
            type="button"
            onClick={() => setShowCuisinesModal(true)}
            className="text-xs sm:text-sm font-bold text-[#659116] hover:text-[#5ECC11] transition-colors cursor-pointer"
            style={{ color: "var(--module-theme-color, #659116)" }}>
            See more
          </button>
        </div>
      </section>
    );
  }, []);

  // Memoized Category Rail Component
  const CategoryRailSection = useMemo(() => {
    const isPopup = isCategoriesCrossed;

    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 w-full">
        {isPopup && (
          <div className="px-2 pt-0.5 pb-0 flex items-center justify-between">
            <span className="text-[10.5px] sm:text-xs font-black text-gray-800 dark:text-gray-200 tracking-wider uppercase">
              Hungry?
            </span>
          </div>
        )}
        <div
          ref={categoryScrollRef}
          className={`flex overflow-x-auto md:overflow-x-visible overflow-y-visible scrollbar-hide scroll-smooth ${isPopup ? 'gap-2.5 sm:gap-3.5 px-2 py-0.5 sm:py-1' : 'gap-3 sm:gap-4 md:gap-5 lg:gap-6 px-2 sm:px-3 py-1.5 sm:py-2 md:py-3'
            }`}
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            touchAction: "pan-x pan-y pinch-zoom",
            overflowY: "hidden",
          }}
        >
          {showCategorySkeleton ? (
            <CategoryChipRowSkeleton className="py-1" />
          ) : (
            displayCategories.slice(0, 12).map((category, index) => {
              if (!category) return null;
              const catName = category.name || category.label || "Category";
              const catSlug = category.slug || catName.toLowerCase().replace(/\s+/g, "-");
              return (
                <Link
                  key={category.id || category._id || index}
                  to={`/food/user/category/${catSlug}`}
                  className="flex-shrink-0"
                >
                  <motion.div
                    className={`flex flex-col items-center ${isPopup ? 'gap-1 w-[56px] sm:w-16 md:w-20' : 'gap-2 w-[72px] sm:w-24 md:w-28'
                      }`}
                    whileHover={{ scale: 1.08, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    style={{ animation: `fade-in-up 0.5s ease-out forwards ${index * 0.04}s`, opacity: 0 }}
                  >
                    <div
                      className={`rounded-full overflow-hidden shadow-md transition-all border border-gray-100 dark:border-gray-800 bg-white ${isPopup ? 'w-11 h-11 sm:w-14 sm:h-14' : 'w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24'
                        }`}
                    >
                      <img
                        src={category.image || "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=85"}
                        alt={catName}
                        className="w-full h-full object-cover bg-white rounded-full transition-transform duration-300 group-hover:scale-110"
                        loading="lazy"
                        onError={(e) => {
                          if (!e.target.src.includes("photo-1546833999-b9f581a1996d")) {
                            e.target.src = "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=85";
                          }
                        }}
                      />
                    </div>
                    <span
                      className={`font-bold text-gray-800 dark:text-gray-200 text-center leading-tight w-full truncate group-hover:text-[#659116] transition-colors ${isPopup ? 'text-[10.5px] sm:text-xs pb-0.5' : 'text-xs sm:text-sm md:text-base pb-1'
                        }`}
                    >
                      {catName}
                    </span>
                  </motion.div>
                </Link>
              );
            })
          )}

          {/* See All: always show when sticky, otherwise only when >12 categories */}
          {!showCategorySkeleton && (isCategoryStuck || isPopup || displayCategories.length > 12) && (
            <div
              className="flex-shrink-0 cursor-pointer"
              onClick={() => setShowCuisinesModal(true)}
            >
              <motion.div
                className={`flex flex-col items-center ${isPopup ? 'gap-1 w-[56px] sm:w-16 md:w-20' : 'gap-2 w-[72px] sm:w-24 md:w-28'
                  }`}
                whileHover={{ scale: 1.08, y: -2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <div
                  className={`rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center border border-emerald-100 dark:border-emerald-900/50 transition-all shadow-sm ${isPopup ? 'w-11 h-11 sm:w-14 sm:h-14' : 'w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24'
                    }`}
                >
                  <Plus
                    className={`text-[#659116] ${isPopup ? 'w-4 h-4' : 'w-6 h-6'}`}
                    style={{ color: "var(--module-theme-color, #659116)" }}
                  />
                </div>
                <span
                  className={`font-bold text-gray-800 dark:text-gray-200 text-center ${isPopup ? 'text-[10.5px] sm:text-xs pb-0.5' : 'text-xs sm:text-sm md:text-base pb-1'
                    }`}
                >
                  See more
                </span>
              </motion.div>
            </div>
          )}
        </div>
      </div>
    );
  }, [displayCategories, showCategorySkeleton, navigate, isCategoryStuck, isCategoriesCrossed]);

  if (shouldShowOutOfZoneScreen) {
    return <OutOfZoneScreen location={effectiveLocation} />;
  }

  if (loadingLandingConfig && loadingRestaurants && (!restaurantsData || restaurantsData.length === 0)) {
    return <AppShellSkeleton />;
  }

  return (

    <div className="relative min-h-screen bg-white dark:bg-[#141414] pb-[140px] md:pb-6 overflow-x-clip">
      <div className="transition-all duration-300">
        {/* Unified Background for Entire Page - Vibrant Food Theme */}
        <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none overflow-hidden z-0">
          {/* Main Background */}
          <div className="absolute inset-0 bg-white dark:bg-[#141414]"></div>
          {/* Background Elements - Reduced to 2 blobs with CSS animations for better performance */}
          <div className="absolute inset-0 overflow-hidden opacity-20">
            {/* Top right blob - CSS animation */}
            <div
              style={{
                animation: "blob 8s ease-in-out infinite",
                willChange: "transform",
              }}
            />
            {/* Bottom left blob - CSS animation */}
            <div
              style={{
                animation: "blob-reverse 10s ease-in-out infinite",
                willChange: "transform",
              }}
            />
          </div>
          {/* CSS keyframes for animations */}
          <style>{`
          @keyframes blob {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(50px, -30px) scale(1.2);
            }
          }
          @keyframes blob-reverse {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(-40px, 40px) scale(1.3);
            }
          }
          @keyframes fade-in {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes gradient {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes fade-in-up {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes wiggle {
            0%, 100% {
              transform: rotate(0deg);
            }
            25% {
              transform: rotate(10deg);
            }
            75% {
              transform: rotate(-10deg);
            }
          }
          @keyframes placeholderFade {
            0% {
              opacity: 0;
              transform: translateY(20px);
            }
            100% {
              opacity: 0.6;
              transform: translateY(0);
            }
          }
          @keyframes gradientShift {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes slideUp {
            0% {
              opacity: 0;
              transform: translateY(15px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
        </div>

        {/* Clean Sticky Category Popup Overlay (Appears ONLY when Top Banner is 100% Offscreen) */}
        <AnimatePresence mode="wait">
          {isCategoriesCrossed && (
            <motion.div
              ref={stickyHeaderRef}
              initial={{ opacity: 0, y: -25 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -25 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="fixed top-0 left-0 right-0 z-[100] bg-white/95 dark:bg-[#242424]/95 backdrop-blur-xl border-b border-gray-100/60 dark:border-gray-800/80 rounded-b-3xl sm:rounded-b-[2rem] shadow-xl overflow-hidden py-1.5"
            >
              {CategoryRailSection}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative z-10">
          <HomeHeader 
            headerRef={headerBannerRef}
            topBanners={topBannersData}
            topBannersLoaded={topBannersLoaded}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            location={effectiveLocation}
            savedAddressText={headerSavedAddressText}
            handleLocationClick={handleLocationClick}
            handleSearchFocus={handleSearchFocus}
            placeholderIndex={placeholderIndex}
            placeholders={placeholders}
            handleVegModeChange={handleVegModeChange}
            isVegMode={Boolean(vegMode)}
            vegModeToggleRef={vegModeToggleRef}
            isCategoryStuck={isCategoryStuck}
            vegModeOption={vegModeOption}
            onClearNonVegFilter={handleClearNonVegFilter}
            onVoiceClick={openVoiceSearch}
          />

          {/* Category sticky anchor sentinel */}
          <div ref={categoryAnchorRef} aria-hidden="true" />

          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 w-full">
            {CategoryRailHeader}
          </div>

          {/* Category Rail (In-flow layout) */}
          <div
            className={`transition-opacity duration-200 ${isSmartStickyActive && isCategoriesCrossed ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
          >
            {CategoryRailSection}
          </div>

          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 w-full">

            {/* Meals under 99 Section */}
            {(loadingMealsUnder99 || mealsUnder99.length > 0) && (
              <LazySection minHeight="220px" priority={isRestoringScroll}>
                <motion.section
                  className="content-auto space-y-4 pt-4 sm:pt-6"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="px-4 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                        Meals under
                      </h2>
                      <span className="flex items-center justify-center border-[1.5px] border-gray-900 dark:border-white rounded-full px-2 py-0.5 text-xs sm:text-sm font-black text-gray-900 dark:text-white leading-none">
                        ₹99
                      </span>
                    </div>
                    <Link
                      to="/food/user/under-250"
                      className="text-xs sm:text-sm font-bold flex items-center gap-0.5 transition-all hover:opacity-80 active:scale-95"
                      style={{ color: "var(--module-theme-color, #E2AD4B)" }}
                    >
                      See more
                    </Link>
                  </div>

                  {loadingMealsUnder99 ? (
                    <div className="flex gap-3 sm:gap-4 px-4 pb-2 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="flex-shrink-0 w-[140px] flex flex-col gap-2">
                          <div className="w-full h-[140px] rounded-2xl bg-gray-100 dark:bg-neutral-800 animate-pulse" />
                          <div className="h-3 w-12 bg-gray-100 dark:bg-neutral-800 animate-pulse rounded" />
                          <div className="h-4 w-full bg-gray-100 dark:bg-neutral-800 animate-pulse rounded" />
                          <div className="h-4 w-1/2 bg-gray-100 dark:bg-neutral-800 animate-pulse rounded" />
                        </div>
                      ))}
                    </div>
                  ) : filteredMealsUnder99.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                      No meals under ₹99 match the selected filters.
                    </div>
                  ) : (
                    <div
                      className="flex items-stretch gap-3 sm:gap-4 px-4 pb-3 pt-1 overflow-x-auto scrollbar-hide scroll-smooth"
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                        touchAction: "pan-x pan-y pinch-zoom",
                      }}
                    >
                      {filteredMealsUnder99.map((dish) => {
                        const variants = dish.variants || [];
                        const hasVariants = variants && variants.length > 0;
                        const totalQty = getCartItemQuantity(dish);

                        // When the restaurant uploaded no image (or a known
                        // placeholder slipped through), fall back to the branded
                        // golden-dome dish image — never a stock food photo and
                        // never an auto-swap based on the dish name, so real
                        // uploads are shown as uploaded.
                        const getSanitizedImage = (item) => {
                          const img = item.image || "";
                          if (!img || img.includes("transparent") || img.includes("checkerboard") || img.includes("placeholder")) {
                            return dishFallbackImage;
                          }
                          return img;
                        };

                        return (
                          <div
                            key={dish.id}
                            onClick={() => setSelectedDishForModal(dish)}
                            className="flex-shrink-0 w-[145px] sm:w-[155px] flex flex-col justify-between group cursor-pointer transition-transform duration-200 active:scale-[0.98]"
                          >
                            <div className="flex flex-col h-full justify-between">
                              {/* Image container with subtle light border */}
                              <div className="relative w-full h-[135px] sm:h-[145px] rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200/80 dark:border-gray-700/70 shadow-sm overflow-hidden transition-all duration-300 group-hover:shadow-md group-hover:border-gray-300/90 group-hover:-translate-y-0.5">
                                <img
                                  src={optimizeCloudinaryUrl(getSanitizedImage(dish), { width: 320 })}
                                  alt={dish.name}
                                  className="w-full h-full object-cover rounded-2xl bg-white transition-transform duration-300 group-hover:scale-105"
                                  loading="lazy"
                                  decoding="async"
                                  onError={(e) => {
                                    if (e.currentTarget.src !== dishFallbackImage) {
                                      e.currentTarget.src = dishFallbackImage;
                                    }
                                  }}
                                />

                                {/* Rating Badge Overlay */}
                                <div className="absolute bottom-2 left-2 bg-white/95 dark:bg-[#2e2e2e]/95 backdrop-blur-md px-2 py-0.5 rounded-full shadow-md border border-gray-200/80 dark:border-gray-700/70 flex items-center gap-0.5 text-gray-900 dark:text-white text-[10.5px] font-extrabold z-10">
                                  <span className="text-[#24963F] text-[10.5px] leading-none">★</span>
                                  <span className="leading-none">{dish.rating || 4.2}</span>
                                </div>

                                {/* Popular Badge */}
                                <div
                                  className="absolute top-2 left-2 text-white text-[9.5px] font-extrabold px-2 py-0.5 rounded-full shadow-md backdrop-blur-md z-10"
                                  style={{ backgroundColor: "#24963F" }}
                                >
                                  Popular
                                </div>

                                {/* Plus Button or Quantity Selector Overlay */}
                                {totalQty > 0 ? (
                                  <div
                                    className="absolute bottom-2 right-2 h-8 rounded-full bg-white dark:bg-[#2e2e2e] shadow-md flex items-center justify-between border px-1.5 gap-1.5 border-gray-200/90 dark:border-gray-700/80 z-10"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        if (hasVariants) {
                                          setSelectedDishForModal(dish);
                                        } else {
                                          handleDecreaseQuantity(dish, e);
                                        }
                                      }}
                                      className="w-5 h-5 flex items-center justify-center hover:opacity-80 transition-all active:scale-75 text-[#24963F]"
                                    >
                                      <Minus className="h-3.5 w-3.5" strokeWidth={3.5} />
                                    </button>
                                    <span className="text-[12px] font-black text-gray-950 dark:text-white min-w-[12px] text-center select-none">
                                      {totalQty}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        if (hasVariants) {
                                          setSelectedDishForModal(dish);
                                        } else {
                                          handleIncreaseQuantity(dish, e);
                                        }
                                      }}
                                      className="w-5 h-5 flex items-center justify-center hover:opacity-80 transition-all active:scale-75 text-[#24963F]"
                                    >
                                      <Plus className="h-3.5 w-3.5" strokeWidth={3.5} />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      // The card opens the dish popup; without this the tap
                                      // added one AND opened the popup, whose "Add to Cart"
                                      // then made it two.
                                      e.stopPropagation();
                                      if (hasVariants) {
                                        setSelectedDishForModal(dish);
                                      } else {
                                        handleIncreaseQuantity(dish, e);
                                      }
                                    }}
                                    className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white dark:bg-[#2e2e2e] shadow-md flex items-center justify-center border transition-all active:scale-90 border-gray-200/90 dark:border-gray-700/80 hover:bg-gray-50 z-10"
                                  >
                                    <Plus className="h-4 w-4 text-[#24963F]" strokeWidth={3} />
                                  </button>
                                )}
                              </div>

                              {/* Content info */}
                              <div className="flex flex-col justify-between flex-1 gap-0.5 min-w-0 px-0.5 pt-2">
                                <div>
                                  {/* Restaurant Name */}
                                  <span className="text-[10.5px] text-gray-500 dark:text-gray-400 font-semibold truncate block">
                                    {dish.restaurantName}
                                  </span>

                                  {/* Veg/Non-veg Dot & Name */}
                                  <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                                    <div className="shrink-0 w-3.5 h-3.5 border border-gray-300 dark:border-gray-700 rounded flex items-center justify-center p-[2px] bg-white">
                                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dish.isVeg ? "#22c55e" : "#1F6B45" }} />
                                    </div>
                                    <span className="text-xs font-bold text-gray-900 dark:text-white truncate group-hover:text-[#24963F] transition-colors">
                                      {dish.name}
                                    </span>
                                  </div>
                                </div>

                                {/* Price */}
                                <div className="flex items-center justify-between w-full mt-1">
                                  <div className="flex items-center gap-1.5">
                                    {hasVariants && (
                                      <span className="text-[9.5px] font-semibold text-gray-500 dark:text-gray-400">
                                        Starting from
                                      </span>
                                    )}
                                    <span className="text-sm font-black text-gray-900 dark:text-white">
                                      ₹{dish.price}
                                    </span>
                                    {dish.originalPrice && dish.originalPrice > dish.price && (
                                      <span className="text-[11px] font-semibold text-gray-400 line-through">
                                        ₹{dish.originalPrice}
                                      </span>
                                    )}
                                  </div>
                                  {hasVariants && (
                                    <span className="text-[8px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                      Customisable
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* End-of-scroll "See All" Card (2-tier matching structure) */}
                      <Link
                        to="/food/user/under-250"
                        className="flex-shrink-0 w-[145px] sm:w-[155px] flex flex-col group cursor-pointer"
                      >
                        {/* 1. Top Box: Matching Image Box Dimensions */}
                        <div className="relative w-full h-[135px] sm:h-[145px] rounded-2xl border border-emerald-300/80 hover:border-emerald-500 dark:border-emerald-600/40 dark:hover:border-emerald-500 bg-gradient-to-br from-emerald-50 via-emerald-50/50 to-green-100/60 dark:from-emerald-950/40 dark:via-neutral-900 dark:to-neutral-900 shadow-sm flex flex-col items-center justify-center p-3 text-center transition-all duration-300 group-hover:shadow-md group-hover:from-emerald-100/70 group-hover:-translate-y-0.5">
                          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#24963F] text-white flex items-center justify-center shadow-md mb-1.5 group-hover:scale-110 transition-transform duration-300">
                            <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.5} />
                          </div>
                          <span className="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white leading-tight">
                            See all meals
                          </span>
                          <span className="text-[10px] sm:text-[11px] font-bold text-[#24963F] dark:text-emerald-400 mt-0.5">
                            Under ₹99 →
                          </span>
                        </div>

                        {/* 2. Bottom Info: Matching Dish Baseline */}
                        <div className="pt-2 px-0.5 pb-0.5 flex flex-col justify-between min-w-0">
                          <span className="text-[10.5px] text-gray-500 dark:text-gray-400 font-semibold truncate block">
                            Explore more
                          </span>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[11px] sm:text-xs font-bold text-emerald-700 dark:text-emerald-400">
                              View all items
                            </span>
                            <span className="text-[10px] font-extrabold text-gray-400 dark:text-gray-500">
                              →
                            </span>
                          </div>
                        </div>
                      </Link>
                    </div>
                  )}
                </motion.section>
              </LazySection>
            )}

            {/* Filters sentinel to detect when original Filters section is crossed */}
            <div ref={filtersSentinelRef} aria-hidden="true" />

            {/* Main Food & Restaurant Filter Bar */}
            <div
              className={`pt-4 px-0 transition-opacity duration-200 ${isSmartStickyActive && isFiltersCrossed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
            >
              <FoodFilterBar
                sortBy={sortBy || "relevance"}
                onSortChange={(val) => setSortBy(val === "relevance" ? null : val)}
                isVeg={activeFilters.has("veg")}
                onVegToggle={() => toggleHomeFilter("veg")}
                isNonVeg={activeFilters.has("non-veg")}
                onNonVegToggle={() => toggleHomeFilter("non-veg")}
                rating4Plus={activeFilters.has("rating-4plus")}
                onRating4PlusToggle={() => toggleHomeFilter("rating-4plus")}
                hasOffers={activeFilters.has("has-offers")}
                onOffersToggle={() => toggleHomeFilter("has-offers")}
                under30Mins={activeFilters.has("delivery-under-30")}
                onUnder30MinsToggle={() => toggleHomeFilter("delivery-under-30")}
                onFilterButtonClick={() => setIsFilterOpen(true)}
              />
            </div>

            {(loadingLandingConfig || loadingRestaurants || filteredRecommendedForYou.length > 0) && (
              <LazySection minHeight="260px" priority={isRestoringScroll}>
                <motion.section
                  className="content-auto space-y-4 pt-4 sm:pt-6"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}>
                  {/* Header Row */}
                  <div className="px-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-lg sm:text-xl md:text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                          Recommended for you
                        </h2>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
                        Curated picks we think you'll love
                      </p>
                    </div>
                    <button
                      onClick={() => navigate('/food/user/restaurants')}
                      className="flex items-center gap-1 text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-800 px-3 py-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                    >
                      <span>See all</span>
                      <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                  </div>

                  {/* Horizontal Scroll Cards List */}
                  {loadingLandingConfig || loadingRestaurants ? (
                    <div className="flex gap-4 sm:gap-5 px-4 pb-3 overflow-x-auto scrollbar-hide">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="flex-shrink-0 w-[195px] sm:w-[220px] md:w-[235px] rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#242424] p-3 flex flex-col gap-2"
                        >
                          <div className="w-full h-24 sm:h-28 md:h-32 bg-gray-100 dark:bg-neutral-800 animate-pulse rounded-xl" />
                          <div className="h-4 w-3/4 bg-gray-100 dark:bg-neutral-800 animate-pulse rounded" />
                          <div className="h-3 w-1/2 bg-gray-100 dark:bg-neutral-800 animate-pulse rounded" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="flex gap-4 sm:gap-5 px-4 pb-3 overflow-x-auto scrollbar-hide scroll-smooth"
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                        touchAction: "pan-x pan-y pinch-zoom",
                      }}
                    >
                      {filteredRecommendedForYou.map((restaurant, index) => {
                      if (!restaurant) return null;
                      const restaurantName = getRestaurantDisplayName(restaurant) || "Restaurant";
                      const restaurantSlug =
                        restaurant.slug ||
                        restaurant.mongoId ||
                        restaurant.id ||
                        restaurantName.toLowerCase().replace(/\s+/g, "-");

                      const isFav = typeof isFavorite === "function" ? isFavorite(restaurantSlug) : false;

                      const badgeInfo = index % 4 === 0
                        ? { label: "Recommended", icon: "👍" }
                        : index % 4 === 1
                        ? { label: "Top rated", icon: "★" }
                        : index % 4 === 2
                        ? { label: "Trending", icon: "📈" }
                        : { label: "Popular", icon: "❤️" };

                      const fallbackRecommendedImage = horizontalFoodImages[index % horizontalFoodImages.length];

                      const rawCover =
                        restaurant.profileImage?.url ||
                        restaurant.image ||
                        restaurant.coverImages?.[0]?.url ||
                        restaurant.coverImages?.[0] ||
                        fallbackRecommendedImage;

                      const rawLogo =
                        restaurant.logo ||
                        restaurant.profileImage?.url ||
                        restaurant.image ||
                        null;

                      const resolvedCover = typeof rawCover === "string" && rawCover.trim() !== "" ? resolveImageUrl(rawCover, { width: 450 }) : (rawCover?.url ? resolveImageUrl(rawCover.url, { width: 450 }) : fallbackRecommendedImage);
                      const resolvedLogo = typeof rawLogo === "string" ? resolveImageUrl(rawLogo, { width: 80 }) : (rawLogo?.url ? resolveImageUrl(rawLogo.url, { width: 80 }) : null);

                      const cuisinesList =
                        Array.isArray(restaurant.cuisines) && restaurant.cuisines.length > 0
                          ? restaurant.cuisines.join(" • ")
                          : (restaurant.cuisine || "Multi-cuisine");

                      // Restaurants may store just "35"; show it with its unit.
                      const rawDeliveryTime = String(restaurant.deliveryTime || "").trim();
                      const deliveryTimeLabel = /^\d+(\s*-\s*\d+)?$/.test(rawDeliveryTime)
                        ? `${rawDeliveryTime} mins`
                        : rawDeliveryTime;
                      const distanceLabel = String(restaurant.distance || "").trim();
                      const hasRating = Number(restaurant.rating) > 0;
                      const offerLabel = restaurant.offer || null;

                      return (
                        <motion.div
                          key={`recommended-${restaurant.mongoId || restaurant.id || restaurantSlug || index}`}
                          className="flex-shrink-0 w-[195px] sm:w-[220px] md:w-[235px]"
                          initial={{ opacity: 0, y: 12 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.35, delay: index * 0.05 }}
                        >
                          <div
                            className="group relative flex flex-col rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#242424] shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer h-full"
                            onClick={(e) => {
                              if (e.defaultPrevented) return;
                              try { captureHomeScrollBeforeLeave(); } catch (_) { }
                              navigate(`/food/user/restaurants/${restaurantSlug}`);
                            }}
                          >
                            {/* Image Shell (Ultra Compact Height: h-24 sm:h-28 md:h-32) */}
                            <div className="relative w-full h-24 sm:h-28 md:h-32 bg-gray-100 dark:bg-gray-800 overflow-hidden">
                              <img
                                src={resolvedCover}
                                alt={restaurantName}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                                loading="lazy"
                                decoding="async"
                              />

                              {/* Top Right Heart Action Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isFav) {
                                    if (typeof removeFavorite === "function") removeFavorite(restaurantSlug);
                                  } else {
                                    if (typeof addFavorite === "function") {
                                      addFavorite({
                                        slug: restaurantSlug,
                                        name: restaurantName,
                                        cuisine: restaurant.cuisine,
                                        rating: restaurant.rating,
                                        deliveryTime: restaurant.deliveryTime,
                                        distance: restaurant.distance,
                                        image: resolvedCover,
                                      });
                                    }
                                  }
                                }}
                                className="absolute top-2 right-2 z-10 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-md"
                                aria-label="Favorite"
                              >
                                <Heart className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isFav ? "fill-red-500 text-red-500" : "text-white"}`} strokeWidth={2.2} />
                              </button>
                            </div>

                            {/* Overlapping Restaurant Logo Circle */}
                            <div className="relative z-10 -mt-5 ml-3 w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-white dark:border-[#242424] shadow-md bg-white dark:bg-gray-800 overflow-hidden flex items-center justify-center shrink-0">
                              {resolvedLogo ? (
                                <img
                                  src={resolvedLogo}
                                  alt={restaurantName}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-amber-400 to-orange-500 text-white font-extrabold text-[10px] sm:text-xs flex items-center justify-center uppercase">
                                  {restaurantName.slice(0, 2)}
                                </div>
                              )}
                            </div>

                            {/* Card Content Area */}
                            <div className="pt-1.5 px-3 pb-3 flex flex-col justify-between flex-1">
                              <div>
                                {/* Restaurant Name & Rating Row */}
                                <div className="flex items-center justify-between gap-1.5">
                                  <h3 className="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white truncate tracking-tight flex-1">
                                    {restaurantName}
                                  </h3>
                                  <span className={`${hasRating ? "bg-[#24963F]" : "bg-gray-400"} text-white text-[9.5px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 shadow-sm`}>
                                    {hasRating && <Star className="w-2.5 h-2.5 fill-white text-white" />}
                                    {hasRating ? Number(restaurant.rating).toFixed(1) : "NEW"}
                                  </span>
                                </div>

                                <p className="text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5 font-medium">
                                  {cuisinesList}
                                </p>

                                {/* Stats Row: Time • Distance (only real values) */}
                                {(deliveryTimeLabel || distanceLabel) && (
                                  <div className="flex items-center gap-1.5 text-[10.5px] sm:text-[11px] font-extrabold text-gray-600 dark:text-gray-400 mt-1.5 whitespace-nowrap overflow-hidden">
                                    {deliveryTimeLabel && (
                                      <span className="flex items-center gap-0.5 shrink-0">
                                        <Clock className="w-3 h-3 text-gray-400" />
                                        <span>{deliveryTimeLabel}</span>
                                      </span>
                                    )}
                                    {deliveryTimeLabel && distanceLabel && (
                                      <span className="text-gray-300 dark:text-gray-700 font-normal">•</span>
                                    )}
                                    {distanceLabel && (
                                      <span className="flex items-center gap-0.5 shrink-0">
                                        <MapPin className="w-3 h-3 text-gray-400" />
                                        <span>{distanceLabel}</span>
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Offer Row (restaurant's live offer, if any) */}
                                {offerLabel && (
                                  <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-gray-100 dark:border-gray-800/80 min-w-0">
                                    <BadgePercent className="w-3 h-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                    <span className="truncate text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-400" title={offerLabel}>
                                      {offerLabel}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* View Menu Button */}
                              <button className="w-full mt-2 py-1.5 px-2 rounded-lg bg-gray-100 dark:bg-zinc-800 group-hover:bg-gray-900 group-hover:text-white dark:group-hover:bg-amber-500 dark:group-hover:text-black text-gray-900 dark:text-white font-extrabold text-[11px] flex items-center justify-center gap-1 transition-all shadow-sm">
                                <span>View Menu</span>
                                <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.section>
            </LazySection>
          )}

            <LazySection minHeight="180px" priority={isRestoringScroll}>
              <div className="py-4">
                <PromoRow
                  handleVegModeChange={handleVegModeChange}
                  navigate={navigate}
                  isVegMode={Boolean(vegMode)}
                  toggleRef={vegModeToggleRef}
                />
              </div>

              <div className="py-2">
                <FreeCashBanner amount={20} minOrderValue={99} />
              </div>
            </LazySection>

            {/* {HeroBannerSection} */}

            {/* Restaurants - Enhanced with Animations */}
            <LazySection minHeight="400px" priority={isRestoringScroll}>
              <motion.section
                className="content-auto space-y-0 pt-3 sm:pt-4 lg:pt-6 pb-8 md:pb-10"
                initial={false}
                animate={{ opacity: 1 }}>
                <div className="px-4 mb-3 lg:mb-4">
                  <div className="flex flex-col gap-0.5 lg:gap-1">
                    <h2 className="text-xs sm:text-sm lg:text-base font-semibold text-gray-400 tracking-widest uppercase">
                      {filteredRestaurants.length} Restaurants Delivering to You
                    </h2>
                    <span className="text-base sm:text-lg lg:text-2xl text-gray-500 font-normal">
                      Featured
                    </span>
                  </div>
                </div>
                <div
                  className={`relative ${showRestaurantSkeleton ? "min-h-[360px] sm:min-h-[420px]" : ""}`}>
                  {/* Loading Overlay */}
                  <AnimatePresence>
                    {showRestaurantSkeleton && (
                      <motion.div
                        className="absolute inset-0 z-10 rounded-lg bg-white/94 dark:bg-[#242424]/94"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}>
                        <LoadingSkeletonRegion label="Loading restaurants" className="h-full p-1 sm:p-2">
                          <RestaurantGridSkeleton
                            count={3}
                            className="grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
                            compact
                          />
                        </LoadingSkeletonRegion>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div
                    className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-4 lg:gap-5 xl:gap-6 px-4 pt-1 sm:pt-1.5 lg:pt-2 items-stretch ${isLoadingFilterResults || loadingRestaurants ? "opacity-50" : "opacity-100"} transition-opacity duration-300`}>
                    {visibleRestaurants.map((restaurant, index) => {
                      const nameStr =
                        typeof restaurant?.name === "string"
                          ? restaurant.name.trim()
                          : "";
                      const fallbackSlugSource =
                        nameStr ||
                        (typeof restaurant?.restaurantName === "string"
                          ? restaurant.restaurantName.trim()
                          : "") ||
                        String(
                          restaurant?.slug ||
                          restaurant?.id ||
                          restaurant?._id ||
                          `restaurant-${index}`,
                        );

                      const restaurantSlug =
                        typeof restaurant?.slug === "string" &&
                          restaurant.slug.trim()
                          ? restaurant.slug.trim()
                          : fallbackSlugSource.toLowerCase().replace(/\s+/g, "-");

                      const favorite = isFavorite(restaurantSlug);

                      const handleToggleFavorite = (slug, res) => {
                        if (favorite) {
                          setSelectedRestaurantSlug(slug);
                          setShowManageCollections(true);
                        } else {
                          addFavorite({
                            slug: slug,
                            name: res.name,
                            cuisine: res.cuisine,
                            rating: res.rating,
                            deliveryTime: res.deliveryTime,
                            distance: res.distance,
                            priceRange: res.priceRange,
                            image: res.image,
                          });
                          setShowToast(true);
                          setTimeout(() => {
                            setShowToast(false);
                          }, 3000);
                        }
                      };

                      return (
                        <RestaurantCard
                          key={restaurant?.id || restaurant?._id || restaurantSlug || index}
                          restaurant={restaurant}
                          index={index}
                          availabilityTick={availabilityTick}
                          isOutOfService={isOutOfService}
                          favorite={favorite}
                          onToggleFavorite={handleToggleFavorite}
                          BACKEND_ORIGIN={BACKEND_ORIGIN}
                          restaurantSlug={restaurantSlug}
                          onNavigateAway={captureHomeScrollBeforeLeave}
                        />
                      );
                    })}
                  </div>
                  {filteredRestaurants.length === 0 && !showRestaurantSkeleton && (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center mb-3">
                        <SlidersHorizontal className="w-8 h-8 text-[#659116]" />
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-1">
                        No restaurants match your filters
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 max-w-xs mb-4">
                        Try clearing or adjusting your selected filters to see more restaurants.
                      </p>
                      <button
                        onClick={() => {
                          setActiveFilters(new Set());
                          setSortBy(null);
                          setSelectedCuisine(null);
                        }}
                        className="px-4 py-2 rounded-xl bg-[#659116] text-white text-xs sm:text-sm font-bold shadow-sm hover:opacity-90 transition-opacity"
                      >
                        Clear All Filters
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-center pt-2 sm:pt-3 gap-2 px-4">
                  {hasMoreRestaurants && (
                    <Button
                      variant="outline"
                      onClick={loadMoreRestaurants}
                      className="text-sm font-medium border-gray-300 hover:border-gray-400">
                      Load more restaurants
                    </Button>
                  )}
                  <div
                    ref={restaurantLoadMoreRef}
                    className="h-1 w-full"
                    aria-hidden="true"
                  />
                </div>
              </motion.section>
            </LazySection>
          </div>
        </div>
      </div>

      {/* Filter Modal - Bottom Sheet */}
      <AnimatePresence>
        {isFilterOpen && (
          <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={() => setIsFilterOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />

            {/* Modal Content */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#242424] rounded-t-3xl max-h-[85vh] flex flex-col"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 400,
                duration: 0.3,
              }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b dark:border-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Filters and sorting
                </h2>
                <button
                  onClick={() => {
                    setActiveFilters(new Set());
                    setSortBy(null);
                    setSelectedCuisine(null);
                  }}
                  className="text-[#659116] font-bold text-sm">
                  Clear all
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Tabs */}
                <div className="w-24 sm:w-28 bg-gray-50 dark:bg-[#141414] border-r dark:border-gray-800 flex flex-col">
                  {[
                    { id: "sort", label: "Sort By", icon: ArrowDownUp },
                    { id: "time", label: "Time", icon: Timer },
                    { id: "rating", label: "Rating", icon: Star },
                    { id: "distance", label: "Distance", icon: MapPin },
                    { id: "price", label: "Dish Price", icon: IndianRupee },
                    { id: "offers", label: "Offers", icon: BadgePercent },
                    { id: "trust", label: "Trust", icon: ShieldCheck },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeFilterTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveFilterTab(tab.id);
                          isProgrammaticScrollRef.current = true;
                          if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                          
                          const container = rightContentRef.current;
                          const section = filterSectionRefs.current[tab.id];
                          if (container && section) {
                            const offset = section.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
                            container.scrollTo({
                              top: offset,
                              behavior: "smooth"
                            });
                          }

                          scrollTimeoutRef.current = setTimeout(() => {
                            isProgrammaticScrollRef.current = false;
                          }, 800);
                        }}
                        className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive
                            ? "bg-white dark:bg-[#242424] text-[#659116] font-bold"
                            : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                          }`}>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#659116] rounded-r" />
                        )}
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                        <span className="text-xs font-medium leading-tight">
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Content Area - Scrollable */}
                <div
                  ref={rightContentRef}
                  className="flex-1 overflow-y-auto p-4">
                  {/* Sort By Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["sort"] = el)}
                    data-section-id="sort"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Sort by
                    </h3>
                    <div className="flex flex-col gap-3">
                      {[
                        { id: null, label: "Relevance" },
                        { id: "price-low", label: "Price: Low to High" },
                        { id: "price-high", label: "Price: High to Low" },
                        { id: "rating-high", label: "Rating: High to Low" },
                        { id: "rating-low", label: "Rating: Low to High" },
                      ].map((option) => (
                        <button
                          key={option.id || "relevance"}
                          onClick={() => setSortBy(option.id)}
                          className={`px-4 py-3 rounded-xl border text-left transition-colors ${sortBy === option.id
                              ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30 font-bold text-[#659116]"
                              : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                            }`}>
                          <span
                            className={`text-sm font-medium ${sortBy === option.id ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                            {option.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["time"] = el)}
                    data-section-id="time"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Estimated Time
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("delivery-under-30")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-30")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-30") ? "text-[#659116]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-30") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 30 mins
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("delivery-under-45")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-45")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-45") ? "text-[#659116]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-45") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 45 mins
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Rating Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["rating"] = el)}
                    data-section-id="rating"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900  dark:text-white mb-4">
                      Restaurant Rating
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("rating-35-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-35-plus")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-35-plus") ? "text-[#659116] fill-[#659116]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-35-plus") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          3.5+ Rating
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-4-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-4-plus")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-4-plus") ? "text-[#659116] fill-[#659116]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-4-plus") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          4.0+ Rating
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-45-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-45-plus")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-45-plus") ? "text-[#659116] fill-[#659116]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-45-plus") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          4.5+ Rating
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Distance Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["distance"] = el)}
                    data-section-id="distance"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Distance
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("distance-under-1km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-1km")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-1km") ? "text-[#659116]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-1km") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 1 km
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("distance-under-2km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-2km")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-2km") ? "text-[#659116]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-2km") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 2 km
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Price Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["price"] = el)}
                    data-section-id="price"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Dish Price
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("price-under-200")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-200")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-200") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under ₹200
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("price-under-500")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-500")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-500") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under ₹500
                        </span>
                      </button>
                    </div>
                  </div>



                  {/* Offers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["offers"] = el)}
                    data-section-id="offers"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Offers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("has-offers")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("has-offers")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("has-offers") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Restaurants with offers
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Trust Markers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["trust"] = el)}
                    data-section-id="trust"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Trust Markers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("top-rated")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("top-rated")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("top-rated") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Top Rated
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("trusted")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("trusted")
                            ? "border-[#659116] bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#659116]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("trusted") ? "text-[#659116]" : "text-gray-700 dark:text-gray-300"}`}>
                          Trusted by 1000+ users
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 px-4 py-4 border-t dark:border-gray-800 bg-white dark:bg-[#242424]">
                <button
                  onClick={() => setIsFilterOpen(false)}
                  className="flex-1 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                  Close
                </button>
                <button
                  onClick={async () => {
                    setIsFilterOpen(false);
                    await applyFiltersAndRefetch(
                      activeFilters,
                      sortBy,
                      selectedCuisine,
                    );
                  }}
                  className={`flex-1 py-3 font-semibold rounded-xl transition-colors ${activeFilters.size > 0 || sortBy || selectedCuisine
                      ? "bg-[#659116] text-white hover:bg-[#5ECC11]"
                      : "bg-gray-200 text-gray-500"
                    }`}
                  disabled={isLoadingFilterResults}>
                  {isLoadingFilterResults
                    ? "Loading..."
                    : activeFilters.size > 0 || sortBy || selectedCuisine
                      ? `Show results`
                      : "Show results"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Veg Mode Popup */}
      <AnimatePresence>
        {showVegModePopup && (
          <motion.div
            key="veg-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setShowVegModePopup(false);
              setPrevVegMode(vegMode);
            }}
            className="fixed inset-0 bg-black/30 z-[9998] backdrop-blur-sm"
          />
        )}
        {showVegModePopup && (
          /* Popup */
          <motion.div
            key="veg-popup"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white dark:bg-[#242424] rounded-2xl shadow-2xl p-6 pt-7 w-[85%] max-w-xs relative border border-gray-100 dark:border-gray-800">
              <button
                type="button"
                aria-label="Close veg mode popup"
                onClick={() => {
                  setShowVegModePopup(false);
                  setPrevVegMode(vegMode);
                }}
                className="absolute top-4 right-4 p-0.5 text-gray-450 hover:text-gray-700 dark:text-gray-450 dark:hover:text-gray-200 transition-colors z-20"
              >
                <X className="h-4.5 w-4.5" strokeWidth={2.5} />
              </button>

              {/* Title — right padding clears the close button only. */}
              <h3 className="text-base sm:text-lg font-black text-gray-900 dark:text-white mb-4 pr-9 leading-snug">
                I want to see choices from
              </h3>

              {/* Radio Options */}
              <div className="space-y-3 mb-5">
                {/* All restaurants */}
                <label
                  className="flex items-center justify-between cursor-pointer py-1 hover:bg-gray-50/50 dark:hover:bg-gray-800/35 transition-colors w-full"
                  onClick={() => setVegModeOption("all")}
                >
                  <span className={`text-sm font-semibold transition-colors ${vegModeOption === "all" ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"
                    }`}>
                    All restaurants
                  </span>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="vegModeOption"
                      value="all"
                      checked={vegModeOption === "all"}
                      onChange={() => setVegModeOption("all")}
                      className="sr-only"
                    />
                    <div
                      className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "all"
                          ? "border-[#659116] bg-[#659116]"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                        }`}
                    >
                      {vegModeOption === "all" && (
                        <div className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </div>
                  </div>
                </label>

                {/* Pure Veg restaurants only */}
                <label
                  className="flex items-center justify-between cursor-pointer py-1 hover:bg-gray-50/50 dark:hover:bg-gray-800/35 transition-colors w-full"
                  onClick={() => setVegModeOption("pure-veg")}
                >
                  <span className={`text-sm font-semibold transition-colors ${vegModeOption === "pure-veg" ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"
                    }`}>
                    Pure veg restaurants only
                  </span>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="vegModeOption"
                      value="pure-veg"
                      checked={vegModeOption === "pure-veg"}
                      onChange={() => setVegModeOption("pure-veg")}
                      className="sr-only"
                    />
                    <div
                      className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "pure-veg"
                          ? "border-[#659116] bg-[#659116]"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                        }`}
                    >
                      {vegModeOption === "pure-veg" && (
                        <div className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </div>
                  </div>
                </label>

                {/* Non-veg restaurants only */}
                <label
                  className="flex items-center justify-between cursor-pointer py-1 hover:bg-gray-50/50 dark:hover:bg-gray-800/35 transition-colors w-full"
                  onClick={() => setVegModeOption("non-veg")}
                >
                  <span className={`text-sm font-semibold transition-colors ${vegModeOption === "non-veg" ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"
                    }`}>
                    Non-veg restaurants only
                  </span>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="vegModeOption"
                      value="non-veg"
                      checked={vegModeOption === "non-veg"}
                      onChange={() => setVegModeOption("non-veg")}
                      className="sr-only"
                    />
                    <div
                      className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "non-veg"
                          ? "border-[#659116] bg-[#659116]"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                        }`}
                    >
                      {vegModeOption === "non-veg" && (
                        <div className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </div>
                  </div>
                </label>
              </div>

              {/* Apply Button */}
              <button
                onClick={() => {
                  setShowVegModePopup(false);
                  setIsApplyingVegMode(true);
                  // Save preference to context
                  setVegModeContext(true);
                  setVegModeOption(vegModeOption);
                  setPrevVegMode(true);
                  setTimeout(() => {
                    setIsApplyingVegMode(false);
                  }, 300);
                }}
                className="w-full bg-[#659116] hover:bg-[#5ECC11] text-white font-bold py-2.5 rounded-xl transition-colors mb-1 text-sm shadow-md shadow-emerald-500/10 active:scale-[0.98]"
              >
                Show restaurants
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Switch Off Veg Mode Popup */}
      <AnimatePresence>
        {showSwitchOffPopup && (
          <motion.div
            key="off-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setShowSwitchOffPopup(false);
              isHandlingSwitchOff.current = false;
              setPrevVegMode(vegMode);
            }}
            className="fixed inset-0 bg-black/50 z-[9998] backdrop-blur-sm"
          />
        )}
        {showSwitchOffPopup && (
          <motion.div
            key="off-popup"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className="fixed inset-0 z-[9999] flex dark:bg-[#lalala] dark:text-white items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="bg-white dark:bg-[#lalala] dark:text-white rounded-2xl shadow-2xl w-[85%] max-w-sm p-6">
              {/* Warning Icon */}
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-full bg-pink-100 flex items-center justify-center">
                  <AlertCircle
                    className="w-20 h-20 text-white bg-red-500/90 rounded-full p-2"
                    strokeWidth={2.5}
                  />
                </div>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-2">
                {vegModeOption === "non-veg" ? "Switch off Non-Veg Mode?" : "Switch off Veg Mode?"}
              </h2>

              {/* Description */}
              <p className="text-gray-600 dark:text-gray-400 text-center mb-6 text-sm">
                {vegModeOption === "non-veg"
                  ? "You'll see all restaurants, including those serving veg dishes"
                  : "You'll see all restaurants, including those serving non-veg dishes"}
              </p>

              {/* Buttons */}
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setShowSwitchOffPopup(false);
                    setIsSwitchingOffVegMode(true);
                    setTimeout(() => {
                      setIsSwitchingOffVegMode(false);
                      isHandlingSwitchOff.current = false;
                      setVegModeContext(false);
                      setVegModeOption("all");
                      setPrevVegMode(false);
                    }, 300);
                  }}
                  className="w-full bg-transparent text-red-600 font-normal py-1 text-normal rounded-xl hover:bg-red-50 transition-colors text-base">
                  Switch off
                </button>

                <button
                  onClick={() => {
                    setShowSwitchOffPopup(false);
                    isHandlingSwitchOff.current = false;
                    setPrevVegMode(vegMode);
                  }}
                  className="w-full text-gray-900 dark:text-white font-normal py-1 text-center rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors text-base">
                  Keep using this mode
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All Categories Modal */}
      <AnimatePresence>
        {showAllCategoriesModal && (
          <motion.div
            key="cat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowAllCategoriesModal(false)}
            className="fixed inset-0 bg-black/40 z-[9998] backdrop-blur-sm"
          />
        )}
        {showAllCategoriesModal && (
          <motion.div
            key="cat-modal"
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{
              type: "spring",
              damping: 30,
              stiffness: 300,
            }}
            className="fixed inset-x-0 bottom-0 top-12 sm:top-16 md:top-20 z-[9999] bg-white dark:bg-[#242424] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                All Categories
              </h2>
              <button
                onClick={() => setShowAllCategoriesModal(false)}
                className="p-1.5 sm:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close">
                <X className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600 dark:text-gray-400" />
              </button>
            </div>

            {/* Categories Grid - Scrollable */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5">
              <div className="grid grid-cols-3 gap-4 sm:gap-5 md:gap-6">
                {displayCategories.map((category, index) => {
                  const categoryData = {
                    name: category.name || category.label,
                    image: category.image || category.imageUrl,
                    slug: category.slug,
                  };
                  return (
                    <motion.div
                      key={category.id || index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: index * 0.02,
                        type: "spring",
                        stiffness: 100,
                      }}
                      whileTap={{ scale: 0.95 }}>
                      <Link
                        to={`/food/user/category/${categoryData.slug || categoryData.name.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => setShowAllCategoriesModal(false)}
                        className="block">
                        <div className="flex flex-col items-center gap-2 sm:gap-2.5 cursor-pointer w-full">
                          <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full overflow-hidden shadow-md transition-all hover:shadow-lg flex-shrink-0">
                            <OptimizedImage
                              src={categoryData.image}
                              alt={categoryData.name}
                              className="w-full h-full bg-white rounded-full p-1"
                              sizes="(max-width: 640px) 80px, (max-width: 768px) 96px, 112px"
                              objectFit="contain"
                              placeholder="blur"
                              onError={() => { }}
                            />
                          </div>
                          <span className="text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200 text-center leading-tight px-1 w-full min-w-0 line-clamp-2">
                            {categoryData.name}
                          </span>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


          <AnimatePresence>
        {isApplyingVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#141414] flex flex-col items-center justify-center gap-12">
            <div className="relative w-32 h-32 flex items-center justify-center">
              {/* Animated circles - positioned absolutely at the center */}
              {[...Array(8)].map((_, i) => {
                const baseSize = 112;
                const maxSize = 600;
                const isNonVeg = vegModeOption === "non-veg";
                return (
                  <motion.div
                    key={i}
                    initial={{
                      scale: 1,
                      opacity: 0,
                    }}
                    animate={{
                      scale: maxSize / baseSize,
                      opacity: [0, 0.4, 0.2, 0],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeOut",
                      delay: i * 0.15,
                    }}
                    className={`absolute rounded-full border ${
                      isNonVeg
                        ? "border-red-300 dark:border-red-650"
                        : vegModeOption === "all"
                          ? "border-gray-300 dark:border-gray-650"
                          : "border-green-300 dark:border-green-650"
                    }`}
                    style={{
                      width: baseSize,
                      height: baseSize,
                    }}
                  />
                );
              })}

              {/* Diet Mode badge - absolute positioning at exact center */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className={`absolute z-10 w-28 h-28 rounded-full border-2 bg-white dark:bg-[#242424] flex flex-col items-center justify-center shadow-sm ${
                  vegModeOption === "non-veg"
                    ? "border-red-600 dark:border-red-500"
                    : vegModeOption === "all"
                      ? "border-gray-650 dark:border-gray-500"
                      : "border-green-600 dark:border-green-500"
                }`}
              >
                <motion.div
                  className="flex flex-col items-center justify-center w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}>
                  <span className={`font-extrabold leading-none ${
                    vegModeOption === "non-veg"
                      ? "text-red-600 dark:text-red-400 text-2xl"
                      : vegModeOption === "all"
                        ? "text-gray-700 dark:text-gray-400 text-3xl"
                        : "text-green-600 dark:text-green-400 text-3xl"
                  }`}>
                    100%
                  </span>
                  <span className={`font-extrabold leading-none mt-1.5 whitespace-nowrap text-center ${
                    vegModeOption === "non-veg"
                      ? "text-red-600 dark:text-red-400 text-[13px] tracking-wider"
                      : vegModeOption === "all"
                        ? "text-gray-700 dark:text-gray-400 text-2xl"
                        : "text-green-600 dark:text-green-400 text-3xl"
                  }`}>
                    {vegModeOption === "non-veg" ? "NON-VEG" : vegModeOption === "all" ? "ALL" : "VEG"}
                  </span>
                </motion.div>
              </motion.div>
            </div>

            {/* Text below badge */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-xl font-normal text-gray-800 dark:text-gray-200 text-center relative z-10 w-full px-6">
              {vegModeOption === "pure-veg"
                ? "Explore pure veg restaurants only"
                : vegModeOption === "non-veg"
                  ? "Explore non-veg restaurants only"
                  : "Explore dishes from all restaurants"}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Screen - Switching Off Veg Mode */}
      <AnimatePresence>
        {isSwitchingOffVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#141414] flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              {/* Two Circles Spinning in Opposite Directions */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="relative w-16 h-16 flex items-center justify-center">
                {/* Outer Circle - Spins Clockwise */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    rotate: {
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-16 h-16 border-[4px] border-transparent border-t-pink-500 dark:border-t-pink-400 border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />

                {/* Inner Circle - Spins Counter-clockwise */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{
                    rotate: {
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-12 h-12 border-[4px] border-transparent border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />
              </motion.div>

              {/* Loading Text */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center">
                <motion.h2
                  className="text-xl font-normal text-gray-800 dark:text-gray-200 mb-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}>
                  Switching off
                </motion.h2>
                <motion.p
                  className="text-xl font-normal text-gray-800 dark:text-gray-200"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}>
                  {vegModeOption === "non-veg" ? "Non-Veg Mode for you" : "Veg Mode for you"}
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification - Fixed to viewport bottom */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showToast && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ duration: 0.3, type: "spring", damping: 25 }}
                className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[10001] bg-black text-white px-6 py-3 rounded-lg shadow-2xl">
                <p className="text-sm font-medium">Added to bookmark</p>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Manage Collections Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showManageCollections && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowManageCollections(false)}
                />

                {/* Manage Collections Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 z-[10000] bg-white rounded-t-3xl shadow-2xl"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{
                    duration: 0.2,
                    type: "spring",
                    damping: 30,
                    stiffness: 400,
                  }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">
                      Manage Collections
                    </h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center hover:bg-gray-800 transition-colors">
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
                    {/* Bookmarks Collection */}
                    <div
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Don't close modal on click, let checkbox handle it
                      }}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 fill-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900">
                            Bookmarks
                          </span>
                          {selectedRestaurantSlug && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isFavorite(selectedRestaurantSlug)}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    removeFavorite(selectedRestaurantSlug);
                                    setSelectedRestaurantSlug(null);
                                    setShowManageCollections(false);
                                  }
                                }}
                                className="h-5 w-5 rounded border-2 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              />
                            </div>
                          )}
                          {!selectedRestaurantSlug && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {getFavorites().length} restaurant
                          {getFavorites().length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 px-4 py-4">
                    <Button
                      className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-medium"
                      onClick={() => {
                        setSelectedRestaurantSlug(null);
                        setShowManageCollections(false);
                      }}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

        {/* Cuisines and Dishes Bottom Sheet Modal */}
        {createPortal(
          <AnimatePresence>
            {showCuisinesModal && (
              <>
                {/* Backdrop */}
                <motion.div
                  key="cuisines-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"
                  onClick={() => setShowCuisinesModal(false)}
                />

                {/* Bottom Sheet Modal */}
                <motion.div
                  key="cuisines-sheet"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{
                    type: "spring",
                    damping: 28,
                    stiffness: 300,
                  }}
                  className="fixed left-0 right-0 bottom-0 z-[10000] bg-white dark:bg-[#2e2e2e] rounded-t-3xl sm:rounded-t-[2.5rem] max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border-t border-gray-100 dark:border-gray-800"
                >
                  {/* Handle & Header */}
                  <div className="relative pt-3 pb-3.5 px-5 sm:px-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-[#2e2e2e] sticky top-0 z-10">
                    <div className="absolute left-1/2 -translate-x-1/2 top-2.5 w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full" />

                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight mt-3">
                      Cuisines and dishes
                    </h2>

                    <button
                      type="button"
                      onClick={() => setShowCuisinesModal(false)}
                      className="mt-3 w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Scrollable Dishes Grid (4-Column Layout) */}
                  <div className="flex-1 overflow-y-auto overscroll-contain scroll-smooth touch-pan-y max-h-[75vh] px-4 sm:px-6 pt-5 pb-16 scrollbar-hide">
                    <div className="grid grid-cols-4 gap-y-7 gap-x-3 sm:gap-x-5">
                      {displayCategories.map((category, index) => (
                        <div
                          key={category.id || index}
                          onClick={() => {
                            setShowCuisinesModal(false);
                            navigate(
                              `/food/user/category/${
                                category.slug ||
                                category.name.toLowerCase().replace(/\s+/g, "-")
                              }`
                            );
                          }}
                          className="flex flex-col items-center gap-2 cursor-pointer group"
                        >
                          <div className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full overflow-hidden shadow-md border border-gray-100 dark:border-gray-800 bg-white transition-transform duration-300 group-hover:scale-110 group-active:scale-95">
                            <img
                              src={category.image || "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=85"}
                              alt={category.name}
                              className="w-full h-full object-cover rounded-full bg-white transition-transform duration-300 group-hover:scale-105"
                              loading="lazy"
                              onError={(e) => {
                                if (!e.target.src.includes("photo-1546833999-b9f581a1996d")) {
                                  e.target.src = "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=85";
                                }
                              }}
                            />
                          </div>
                          <span className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200 text-center leading-tight line-clamp-2 w-full group-hover:text-[#659116] transition-colors">
                            {category.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      <VoiceSearchOverlay
        isOpen={isVoiceOverlayOpen}
        onClose={() => {
          voiceSearch.stopListening();
          setIsVoiceOverlayOpen(false);
        }}
        onSearchResult={(transcript) => {
          navigate(`/food/user/search?q=${encodeURIComponent(transcript)}&mode=delivery`);
        }}
        voiceSearch={voiceSearch}
        autoStart={false}
      />

      <DishDetailModal
        isOpen={Boolean(selectedDishForModal)}
        dish={selectedDishForModal}
        onClose={() => setSelectedDishForModal(null)}
        onAddToCart={(dishItem, event, variant, qty) => {
          const itemToAdd = variant
            ? { ...dishItem, price: variant.price, variants: [variant] }
            : dishItem;
          // One add carrying the chosen quantity. Firing one add per unit in
          // parallel let the cart drop the repeats for a new item, so picking
          // 3 added only 1.
          handleIncreaseQuantity(itemToAdd, event, qty || 1);
        }}
      />

      <FloatingHomeDock hasBottomNav />
      <BackToTopButton />
    </div>
  );
}
