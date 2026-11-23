import { useState, useEffect, useRef, Component, useMemo, useCallback } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { useParams, useNavigate, useSearchParams, useLocation as useRouterLocation } from "react-router-dom"
import { restaurantAPI, diningAPI, orderAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { toast } from "sonner"
import { useLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { filterPublicOffers } from "@food/utils/offerUtils"
import {
  ArrowLeft,
  Search,
  MoreVertical,
  MapPin,
  Clock,
  ChevronDown,
  Star,
  SlidersHorizontal,
  Utensils,
  Flame,
  Bookmark,
  Share2,
  Plus,
  Minus,
  X,
  RotateCcw,
  Zap,
  Check,
  Lock,
  Percent,
  Tag,
  Eye,
  Users,
  AlertCircle,
  Copy,
  MessageCircle,
  Send,
  Mail,
  Info,
  Phone,
  Store,
  Timer,
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import { Checkbox } from "@food/components/ui/checkbox"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import AddToCartAnimation from "@food/components/user/AddToCartAnimation"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { isModuleAuthenticated } from "@food/utils/auth"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import { useFoodPageInvalidation } from "@food/hooks/useFoodPageInvalidation"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { isMongoObjectId, toRestaurantUrlSlug } from "@food/utils/mainTabRoutes"
import {
  buildCartLineId,
  getDefaultFoodVariant,
  getFoodDisplayPrice,
  getFoodPriceLabel,
  getFoodVariants,
  hasFoodVariants,
} from "@food/utils/foodVariants"
import { RestaurantDetailSkeleton } from "@food/components/ui/loading-skeletons"
import { isVegMenuItem } from "@food/utils/vegMode"
import { getUserRestaurantDistance } from "@food/utils/geo"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import OptimizedImage from "@food/components/OptimizedImage"
import SafeImage from "@food/components/SafeImage"
import { useRestaurantItemOffers, ItemOfferBadge, RestaurantOffersStrip } from "@food/components/user/RestaurantItemOffers"

const fssaiLogo = "/assets/images/fssai.png?v=3"



const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }



const FOOD_IMAGE_FALLBACK = dishFallbackImage
const RUPEE_SYMBOL = "₹"
const RESTAURANT_DETAILS_FILTERS_STORAGE_KEY = "food-restaurant-details-filters"

// Optimized Image for Dishes
const DishImage = ({ src, alt, className }) => (
  <div className={`relative overflow-hidden ${className}`}>
    <img
      src={src || FOOD_IMAGE_FALLBACK}
      alt={alt || "Dish"}
      className="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
      onError={(e) => {
        if (e.currentTarget.src !== FOOD_IMAGE_FALLBACK) {
          e.currentTarget.src = FOOD_IMAGE_FALLBACK
        }
      }}
    />
  </div>
)

const ScallopBadge = ({ className = "" }) => (
  <svg
    viewBox="0 0 100 100"
    className={`text-[#2563EB] fill-current flex-shrink-0 ${className}`}
  >
    <path d="M 86.29 42.78 Q 95.00 50.00 86.29 57.22 Q 91.57 67.22 80.76 70.56 Q 81.82 81.82 70.56 80.76 Q 67.22 91.57 57.22 86.29 Q 50.00 95.00 42.78 86.29 Q 32.78 91.57 29.44 80.76 Q 18.18 81.82 19.24 70.56 Q 8.43 67.22 13.71 57.22 Q 5.00 50.00 13.71 42.78 Q 8.43 32.78 19.24 29.44 Q 18.18 18.18 29.44 19.24 Q 32.78 8.43 42.78 13.71 Q 50.00 5.00 57.22 13.71 Q 67.22 8.43 70.56 19.24 Q 81.82 18.18 80.76 29.44 Q 91.57 32.78 86.29 42.78 Z" />
    <text
      x="50"
      y="63"
      textAnchor="middle"
      fontSize="42"
      fontWeight="900"
      fill="white"
      className="select-none font-sans"
    >
      %
    </text>
  </svg>
)




function RestaurantDetailsContent() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const goBack = useAppBackNavigation()
  const [searchParams, setSearchParams] = useSearchParams()
  const showOnlyUnder250 = searchParams.get('under250') === 'true'
  const targetDishId = useMemo(() => String(searchParams.get('dish') || '').trim(), [searchParams])
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart, itemCount } = useCart()
  const { vegMode, vegModeOption, addDishFavorite, removeDishFavorite, isDishFavorite, getDishFavorites, getFavorites, addFavorite, removeFavorite, isFavorite, orderType, getDefaultAddress } = useProfile()
  const seededRestaurant = routerLocation.state?.restaurantData || null
  const seededMongoId = useMemo(() => {
    const candidates = [
      seededRestaurant?.mongoId,
      seededRestaurant?._id,
      seededRestaurant?.restaurantId,
      seededRestaurant?.id,
    ]
    for (const c of candidates) {
      const v = String(c || "").trim()
      if (isMongoObjectId(v)) return v
    }
    return ""
  }, [seededRestaurant])

  // Veg mode ON: never keep a Non-veg chip selected
  useEffect(() => {
    if (!vegMode) return
    setFilters((prev) =>
      prev.vegNonVeg === "non-veg" ? { ...prev, vegNonVeg: null } : prev,
    )
  }, [vegMode])
  const { location: userLocation } = useLocation() // Mode-aware: current GPS or saved address
  // Match header/cart: useLocation already applies deliveryAddressMode.
  const distanceOrigin = useMemo(() => {
    if (
      Number.isFinite(Number(userLocation?.latitude)) &&
      Number.isFinite(Number(userLocation?.longitude))
    ) {
      return {
        latitude: Number(userLocation.latitude),
        longitude: Number(userLocation.longitude),
      }
    }
    const saved = getDefaultAddress?.() || null
    const coords = saved?.location?.coordinates
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0])
      const lat = Number(coords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng }
      }
    }
    const lat = Number(saved?.latitude ?? saved?.lat)
    const lng = Number(saved?.longitude ?? saved?.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng }
    }
    return null
  }, [getDefaultAddress, userLocation?.latitude, userLocation?.longitude])
  const { zoneId, zone, loading: loadingZone, isOutOfService } = useZone(userLocation) // Get user's zone for zone-based filtering
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [quantities, setQuantities] = useState({})
  const [showManageCollections, setShowManageCollections] = useState(false)
  const [constraintsContainer, setConstraintsContainer] = useState(null)
  const menuButtonRef = useRef(null)
  const [menuButtonWidth, setMenuButtonWidth] = useState(120)
  const [menuButtonHeight, setMenuButtonHeight] = useState(48)
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const [showItemDetail, setShowItemDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedVariantId, setSelectedVariantId] = useState("")
  const [itemDetailQuantity, setItemDetailQuantity] = useState(1)
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [showLocationSheet, setShowLocationSheet] = useState(false)
  const [showScheduleSheet, setShowScheduleSheet] = useState(false)

  const [allOffers, setAllOffers] = useState([])
  const [loadingOffers, setLoadingOffers] = useState(true)
  const [showOffersSheet, setShowOffersSheet] = useState(false)
  const [currentCouponIndex, setCurrentCouponIndex] = useState(0)

  const formatCouponStripText = (coupon) => {
    if (!coupon) return ""
    const minOrderValue = Number(coupon.minOrderValue)
    const minOrderText = Number.isFinite(minOrderValue) && minOrderValue > 0 ? ` above ₹${minOrderValue}` : ""
    if (coupon.discountType === "percentage") {
      const discountPercentage = coupon.discountPercentage ?? coupon.discountValue ?? 0
      const limitText = coupon.maxDiscount ? ` up to ₹${coupon.maxDiscount}` : ""
      return `${discountPercentage}% OFF${minOrderText}${limitText}`
    }
    const value = coupon.originalPrice || coupon.discountValue || 0
    return `Flat ₹${value} OFF${minOrderText}`
  }

  const formatCouponTitle = (coupon) => {
    return formatCouponStripText(coupon)
  }

  const handleCopyCoupon = (code) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code)
        .then(() => {
          toast.success(`Coupon code ${code} copied!`)
        })
        .catch((err) => {
          debugError("Failed to copy coupon code:", err)
          toast.error("Failed to copy code.")
        })
    } else {
      toast.success(`Coupon code ${code} copied!`)
    }
  }

  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null)
  const [expandedCoupons, setExpandedCoupons] = useState(new Set())
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [availabilityTick, setAvailabilityTick] = useState(Date.now())
  const [showMenuOptionsSheet, setShowMenuOptionsSheet] = useState(false)
  const showMoreInfo = searchParams.get('info') === 'true'
  const setShowMoreInfo = (val) => {
    if (val) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('info', 'true')
        return next
      }, { replace: true })
    } else {
      // Never navigate(-1) here — that pops restaurant→category and feels like stuck back.
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('info')
        return next
      }, { replace: true })
    }
  }
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [expandedAddButtons, setExpandedAddButtons] = useState(new Set())
  const [expandedSections, setExpandedSections] = useState(new Set([0])) // Default: Recommended section is expanded
  const [highlightedDishId, setHighlightedDishId] = useState(null)
  const [loadingMenuItems, setLoadingMenuItems] = useState(true)
  const [selectedMenuCategory, setSelectedMenuCategory] = useState("all")
  const dishCardRefs = useRef({})
  const hasScrolledRef = useRef(false)

  const [loadRemaining, setLoadRemaining] = useState(false)
  useEffect(() => {
    if (typeof window !== "undefined" && window.scrollY > 0) {
      setLoadRemaining(true)
      return
    }

    const handleScroll = () => {
      setLoadRemaining(true)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })

    const timer = setTimeout(() => {
      setLoadRemaining(true)
    }, 1500)

    return () => {
      window.removeEventListener("scroll", handleScroll)
      clearTimeout(timer)
    }
  }, [])


  const getLineItemIdForDish = (item, variant = null) =>
    buildCartLineId(item?.id || item?._id || "", variant?.id || variant?._id || "")

  const getVariantForDish = (item, preferredVariantId = "") => {
    const variants = getFoodVariants(item)
    if (variants.length === 0) return null
    return variants.find((variant) => String(variant.id || variant._id || "") === String(preferredVariantId || "")) || variants[0]
  }

  const getDishQuantity = (item, preferredVariantId = "") => {
    if (preferredVariantId) {
      const variant = getVariantForDish(item, preferredVariantId)
      const lineItemId = getLineItemIdForDish(item, variant)
      return quantities[lineItemId] || 0
    }
    if (hasFoodVariants(item)) {
      const variants = getFoodVariants(item)
      return variants.reduce((sum, v) => {
        const lineItemId = getLineItemIdForDish(item, v)
        return sum + (quantities[lineItemId] || 0)
      }, 0)
    }
    const lineItemId = getLineItemIdForDish(item, null)
    return quantities[lineItemId] || 0
  }

  // For a variant dish, returns the single variant currently in the cart (if
  // exactly one is present) so the +/- stepper can adjust it directly like a
  // normal item. Returns null when 0 or 2+ variants are in the cart, in which
  // case the +/- opens the variant picker instead (avoids ambiguous updates).
  const getSoleActiveVariant = (item) => {
    if (!hasFoodVariants(item)) return null
    const variants = getFoodVariants(item)
    const active = variants.filter(
      (v) => (quantities[getLineItemIdForDish(item, v)] || 0) > 0
    )
    return active.length === 1 ? active[0] : null
  }

  // Initialize filters from localStorage if available
  const [filters, setFilters] = useState(() => {
    if (typeof window === "undefined" || !slug) {
      return {
        sortBy: null,
        vegNonVeg: null,
        highlyReordered: false,
        spicy: false,
      }
    }
    try {
      const raw = window.localStorage.getItem(RESTAURANT_DETAILS_FILTERS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const savedFilters = parsed?.[slug]
        if (savedFilters && typeof savedFilters === "object") {
          return {
            sortBy:
              savedFilters.sortBy === "low-to-high" || savedFilters.sortBy === "high-to-low"
                ? savedFilters.sortBy
                : null,
            vegNonVeg:
              savedFilters.vegNonVeg === "veg" || savedFilters.vegNonVeg === "non-veg"
                ? savedFilters.vegNonVeg
                : null,
            highlyReordered: savedFilters.highlyReordered === true,
            spicy: savedFilters.spicy === true,
          }
        }
      }
    } catch (error) {
      debugWarn("Failed to initialize restaurant filters from localStorage:", error)
    }
    return {
      sortBy: null,
      vegNonVeg: null,
      highlyReordered: false,
      spicy: false,
    }
  })

  // Restaurant data state
  const [restaurant, setRestaurant] = useState(null)
  const [loadingRestaurant, setLoadingRestaurant] = useState(true)
  const [restaurantError, setRestaurantError] = useState(null)
  const fetchedRestaurantRef = useRef(false) // Track if restaurant has been fetched for current slug
  const fetchedSlugRef = useRef(null)

  // Live refresh: a restaurant-side change (online/offline, timings, menu)
  // must land here without the user reloading the page.
  const [refreshNonce, setRefreshNonce] = useState(0)
  useFoodPageInvalidation(
    useCallback(() => {
      fetchedRestaurantRef.current = false
      setRefreshNonce((n) => n + 1)
    }, []),
  )

  const coupons = useMemo(() => {
    if (!allOffers || allOffers.length === 0) return []

    const rId = restaurant?.id || restaurant?.restaurantId || restaurant?.mongoId || restaurant?._id

    return filterPublicOffers(allOffers, {
      restaurantId: rId,
      restaurantSlug: slug,
      restaurant,
      orderType,
      requireShowInCart: true,
    }).map((o) => {
      const isPct = o.discountType === "percentage"
      return {
        couponCode: o.couponCode,
        discountType: o.discountType,
        discountPercentage: isPct ? Number(o.discountValue) || 0 : 0,
        originalPrice: isPct ? 0 : Number(o.discountValue || 0),
        discountedPrice: 0,
        minOrderValue: Number(o.minOrderValue) > 0 ? Number(o.minOrderValue) : null,
        minOrder: Number(o.minOrderValue) > 0 ? Number(o.minOrderValue) : 0,
        maxDiscount: o.maxDiscount != null ? Number(o.maxDiscount) : null,
        customerGroup: o.customerScope || "all",
        isGlobalCoupon: true,
        endDate: o.endDate || null,
        showInCart: o.showInCart !== false,
        couponType: o.couponType || "all",
      }
    })
  }, [allOffers, restaurant, orderType, slug])

  // Restaurant-run offers live right now (display only; checkout applies them server-side).
  const { offers: restaurantItemOffers, offersForItem } = useRestaurantItemOffers([
    restaurant?.mongoId,
    restaurant?._id,
    restaurant?.id,
    restaurant?.restaurantId,
  ])

  // Fetch active public offers from API (runs on mount/slug change)
  useEffect(() => {
    if (!slug) return

    const fetchOffers = async () => {
      setLoadingOffers(true)
      try {
        const res = await restaurantAPI.getPublicOffers()
        const list = res?.data?.data?.allOffers || res?.data?.allOffers || []
        setAllOffers(list)
      } catch (err) {
        debugError("Failed to fetch public offers:", err)
      } finally {
        setLoadingOffers(false)
      }
    }

    fetchOffers()
  }, [slug])

  const couponsKey = (coupons || []).map((c) => c.couponCode || "").join(",")

  // Reset coupon carousel index when coupons change (only if codes or length change)
  useEffect(() => {
    setCurrentCouponIndex(0)
  }, [couponsKey])

  // Automatically cycle through coupons (carousel)
  useEffect(() => {
    if (coupons.length <= 1) return
    const timer = setInterval(() => {
      setCurrentCouponIndex((prev) => (prev + 1) % coupons.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [couponsKey, coupons.length])

  // Lock body scroll when any bottom sheet or modal is open
  useEffect(() => {
    const anySheetOpen = showOffersSheet || showMenuSheet || showFilterSheet || showLocationSheet || showMenuOptionsSheet || showItemDetail || showShareModal || showManageCollections || showScheduleSheet
    if (anySheetOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showOffersSheet, showMenuSheet, showFilterSheet, showLocationSheet, showMenuOptionsSheet, showItemDetail, showShareModal, showManageCollections, showScheduleSheet])

  useEffect(() => {
    const intervalId = setInterval(() => {
      setAvailabilityTick(Date.now())
    }, 60000)

    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    // Reset state when entering a new restaurant page to prevent flash of old content
    fetchedRestaurantRef.current = false
    fetchedSlugRef.current = null
    setCurrentCouponIndex(0)
    setSelectedMenuCategory("all")
    setRestaurantError(null)

    // Instant header from navigation state (name/image) while full API loads
    if (seededRestaurant) {
      const seedName =
        seededRestaurant.name ||
        seededRestaurant.restaurantName ||
        "Restaurant"
      const seedId =
        seededMongoId ||
        seededRestaurant.mongoId ||
        seededRestaurant._id ||
        seededRestaurant.restaurantId ||
        null
      setRestaurant({
        id: seedId,
        mongoId: seededMongoId || seedId,
        name: seedName,
        cuisine: seededRestaurant.cuisine || seededRestaurant.topCategory || "",
        rating: seededRestaurant.rating || 0,
        reviews: seededRestaurant.reviews || seededRestaurant.totalRatings || 0,
        deliveryTime: seededRestaurant.deliveryTime || "25-30 mins",
        // Don't seed distance from home card — wait for cart-matched driving API.
        distance: "",
        distanceInKm: null,
        distanceMode: null,
        distanceOriginKey: null,
        location: seededRestaurant.location || "",
        image: seededRestaurant.image || seededRestaurant.profileImage || null,
        coverImages: seededRestaurant.coverImages || [],
        menuImages: seededRestaurant.menuImages || [],
        menuSections: [],
        slug,
        restaurantId: seedId,
        outletTimings: seededRestaurant.outletTimings || null,
        deliveryTimings: seededRestaurant.deliveryTimings || null,
        isActive: seededRestaurant.isActive !== false,
        isAcceptingOrders: seededRestaurant.isAcceptingOrders !== false,
      })
      setLoadingRestaurant(false)
      setLoadingMenuItems(true)
    } else {
      setRestaurant(null)
      setLoadingRestaurant(true)
      setLoadingMenuItems(true)
    }
    setAllOffers([])
    setLoadingOffers(true)
  }, [slug, seededRestaurant, seededMongoId])

  // Fetch restaurant data from API
  useEffect(() => {
    const fetchRestaurant = async () => {
      if (!slug) return

      // Prevent re-fetching for the same slug+origin once driving distance is resolved.
      // If delivery-address origin changes, refetch so distance matches cart.
      const originKey =
        Number.isFinite(Number(distanceOrigin?.latitude)) &&
        Number.isFinite(Number(distanceOrigin?.longitude))
          ? `${Number(distanceOrigin.latitude)},${Number(distanceOrigin.longitude)}`
          : ""
      const hasDrivingDistance =
        restaurant?.distanceMode === "driving" ||
        (Number.isFinite(Number(restaurant?.distanceInKm)) && Number(restaurant.distanceInKm) > 0)
      const sameOrigin = Boolean(originKey) && restaurant?.distanceOriginKey === originKey
      if (
        fetchedRestaurantRef.current &&
        fetchedSlugRef.current === slug &&
        restaurant &&
        sameOrigin &&
        hasDrivingDistance
      ) {
        return
      }
      if (
        fetchedRestaurantRef.current &&
        fetchedSlugRef.current === slug &&
        restaurant &&
        !originKey
      ) {
        return
      }

      try {
        // Keep the existing page visible on background retries.
        setLoadingRestaurant(!fetchedRestaurantRef.current && !restaurant)
        setRestaurantError(null)

        debugLog('Fetching restaurant with slug:', slug)
        let response = null
        let apiRestaurant = null

        // Try dining API only for slug deep-links (skip when we already have ObjectId from nav state)
        if (!seededMongoId && !isMongoObjectId(slug)) {
          try {
            response = await diningAPI.getRestaurantBySlug(slug)
            if (response?.data?.success && response?.data?.data) {
              apiRestaurant = response.data.data
              debugLog('? Found restaurant in dining API:', apiRestaurant)
            } else {
              debugLog('? Dining API returned no restaurant, falling back to restaurant API...')
            }
          } catch (diningError) {
            if (diningError?.response?.status === 404) {
              debugLog('? Restaurant not found in dining API, trying restaurant API...')
            } else {
              debugWarn('? Dining API failed, trying restaurant API...', diningError?.message)
            }
          }
        }

        // Restaurant API: ObjectId first (root cause fix). Slug is only fallback for deep links.
        if (!apiRestaurant) {
          try {
            const lookupKeys = []
            if (seededMongoId) lookupKeys.push(seededMongoId)
            if (isMongoObjectId(slug)) lookupKeys.push(slug)
            // Only hit slug endpoint when we have no ObjectId (avoids noisy 404s like naviscafe)
            if (!seededMongoId && !isMongoObjectId(slug) && slug) lookupKeys.push(slug)

            for (const key of lookupKeys) {
              try {
                const locationParams = {}
                if (
                  Number.isFinite(Number(distanceOrigin?.latitude)) &&
                  Number.isFinite(Number(distanceOrigin?.longitude))
                ) {
                  locationParams.lat = Number(distanceOrigin.latitude)
                  locationParams.lng = Number(distanceOrigin.longitude)
                }
                response = await restaurantAPI.getRestaurantById(key, {
                  params: locationParams,
                })
                if (response?.data?.success && response?.data?.data) {
                  apiRestaurant = response.data.data
                  debugLog('? Found restaurant in restaurant API by key:', key)
                  break
                }
              } catch (directLookupError) {
                debugLog('? Lookup failed for key:', key)
              }
            }

            if (!apiRestaurant) {
              // Deep-link fallback: resolve pretty slug via list, then fetch by ObjectId
              debugLog('? Direct lookup failed, trying search by name...')

              const searchVariants = zoneId
                ? [{ limit: 100, zoneId: zoneId, _ts: Date.now() }, { limit: 100, _ts: Date.now() }]
                : [{ limit: 100, _ts: Date.now() }]

              const slugCompact = String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, "")
              const slugHyphen = String(slug || "").toLowerCase()

              for (const searchParams of searchVariants) {
                try {
                  const searchResponse = await restaurantAPI.getRestaurants(searchParams, { noCache: true })
                  const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []

                  const matchingRestaurant = restaurants.find(r => {
                    const name = String(r.restaurantName || r.name || "").toLowerCase()
                    const nameSlug = toRestaurantUrlSlug(name)
                    const nameCompact = name.replace(/[^a-z0-9]/g, "")
                    const rSlug = toRestaurantUrlSlug(r.slug || "")
                    return (
                      rSlug === slugHyphen ||
                      nameSlug === slugHyphen ||
                      nameCompact === slugCompact ||
                      String(r._id) === seededMongoId ||
                      String(r.restaurantId) === seededMongoId
                    )
                  })

                  if (matchingRestaurant) {
                    const locationParams = {}
                    if (
                      Number.isFinite(Number(distanceOrigin?.latitude)) &&
                      Number.isFinite(Number(distanceOrigin?.longitude))
                    ) {
                      locationParams.lat = Number(distanceOrigin.latitude)
                      locationParams.lng = Number(distanceOrigin.longitude)
                    }
                    const fullResponse = await restaurantAPI.getRestaurantById(
                      matchingRestaurant._id || matchingRestaurant.restaurantId,
                      { params: locationParams },
                    )
                    if (fullResponse.data && fullResponse.data.success && fullResponse.data.data) {
                      apiRestaurant = fullResponse.data.data
                      debugLog('? Found restaurant in restaurant API by name search:', apiRestaurant)
                      break
                    }
                  }
                } catch (searchError) {
                  debugWarn('? Search fallback failed for params:', searchParams, searchError?.message)
                }
              }
            }
          } catch (restaurantError) {
            debugError('? Restaurant not found in restaurant API either:', restaurantError)
          }
        }

        if (apiRestaurant) {
          debugLog('? Fetched restaurant from API:', apiRestaurant)
          debugLog('? Restaurant data keys:', Object.keys(apiRestaurant))
          debugLog('? Restaurant name field:', apiRestaurant?.name)
          debugLog('? Restaurant restaurantId:', apiRestaurant?.restaurantId)
          debugLog('? Restaurant _id:', apiRestaurant?._id)
          debugLog('? Restaurant.restaurant:', apiRestaurant?.restaurant)

          // Check if this is a dining restaurant with nested restaurant data
          const actualRestaurant = apiRestaurant?.restaurant || apiRestaurant

          // Helper function to format address with zone and pin code
          const formatRestaurantAddress = (locationObj) => {
            if (!locationObj) return "Location"

            // If location is a string, return it as is
            if (typeof locationObj === 'string') {
              return locationObj
            }

            // PRIORITY 1: Use formattedAddress if it's complete and has pin code
            // formattedAddress usually has the most complete information from Google Maps
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const formattedAddr = locationObj.formattedAddress.trim()
                // Check if it contains a pin code (6 digit number)
                const hasPinCode = /\b\d{6}\b/.test(formattedAddr)
                // If it has pin code, it's complete - use it directly
                if (hasPinCode) {
                  // Clean up the address - remove Google Plus Code if present (e.g., "PV6X+JXX, ")
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
                // If it has multiple parts (3+), it's likely complete
                if (formattedAddr.split(',').length >= 3) {
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
              }
            }

            // PRIORITY 2: Build address from location object components (with zone and pin code)
            // This ensures we always show zone and pin code if available
            const addressParts = []

            // Add addressLine1 if available
            if (locationObj.addressLine1 && locationObj.addressLine1.trim() !== "") {
              addressParts.push(locationObj.addressLine1.trim())
            }

            // Add addressLine2 if available
            if (locationObj.addressLine2 && locationObj.addressLine2.trim() !== "") {
              addressParts.push(locationObj.addressLine2.trim())
            }

            // Add area (zone) if available
            if (locationObj.area && locationObj.area.trim() !== "") {
              addressParts.push(locationObj.area.trim())
            }

            // Add city if available
            if (locationObj.city && locationObj.city.trim() !== "") {
              addressParts.push(locationObj.city.trim())
            }

            // Add state if available
            if (locationObj.state && locationObj.state.trim() !== "") {
              addressParts.push(locationObj.state.trim())
            }

            // Add pin code (priority: pincode > zipCode > postalCode)
            const pinCode = locationObj.pincode || locationObj.zipCode || locationObj.postalCode
            if (pinCode && pinCode.toString().trim() !== "") {
              addressParts.push(pinCode.toString().trim())
            }

            // If we have at least 3 parts (complete address), use it
            if (addressParts.length >= 3) {
              return addressParts.join(', ')
            }

            // If we have at least 2 parts, use it
            if (addressParts.length >= 2) {
              return addressParts.join(', ')
            }

            // PRIORITY 3: Fallback to formattedAddress (even if incomplete)
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const cleanedAddr = locationObj.formattedAddress.trim().replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                return cleanedAddr
              }
            }

            // PRIORITY 4: Fallback to address field
            if (locationObj.address && locationObj.address.trim() !== "") {
              return locationObj.address.trim()
            }

            // PRIORITY 5: Last fallback - use area or city
            return locationObj.area || locationObj.city || "Location"
          }

          // Get location object for address formatting
          const locationObj = actualRestaurant?.location || apiRestaurant?.location
          debugLog('? Location Object for formatting:', locationObj)
          debugLog('? formattedAddress field:', locationObj?.formattedAddress)
          const formattedAddress = formatRestaurantAddress(locationObj)
          debugLog('? Final Formatted Address:', formattedAddress)

          // Calculate distance from user to restaurant using SAME backend
          // driving-distance API as cart / home list (not air/haversine).
          const restaurantLat = locationObj?.latitude || (locationObj?.coordinates && Array.isArray(locationObj.coordinates) ? locationObj.coordinates[1] : null)
          const restaurantLng = locationObj?.longitude || (locationObj?.coordinates && Array.isArray(locationObj.coordinates) ? locationObj.coordinates[0] : null)

          debugLog('? Restaurant coordinates:', { restaurantLat, restaurantLng, locationObj })

          const userLat = distanceOrigin?.latitude
          const userLng = distanceOrigin?.longitude

          debugLog('? User location (cart-matched):', { userLat, userLng, distanceOrigin })

          const apiDistance =
            actualRestaurant?.distance ||
            apiRestaurant?.distance ||
            actualRestaurant?.distanceFromUser ||
            apiRestaurant?.distanceFromUser ||
            null
          const apiDistanceInKm = Number(
            actualRestaurant?.distanceInKm ?? apiRestaurant?.distanceInKm,
          )
          const calculatedDistance =
            (actualRestaurant?.distanceMode === 'driving' || apiRestaurant?.distanceMode === 'driving') &&
            apiDistance
              ? apiDistance
              : Number.isFinite(apiDistanceInKm) && apiDistanceInKm > 0
                ? (apiDistanceInKm >= 1
                    ? `${apiDistanceInKm.toFixed(1)} km`
                    : `${Math.round(apiDistanceInKm * 1000)} m`)
                : apiDistance ||
                  // API gave no distance: straight-line from the user's location.
                  getUserRestaurantDistance(
                    { latitude: userLat, longitude: userLng },
                    { latitude: restaurantLat, longitude: restaurantLng },
                  )?.label ||
                  null

          if (!calculatedDistance) {
            debugWarn('? Driving distance missing from API — pass lat/lng on restaurant fetch', {
              hasUserLocation: !!(userLat && userLng),
              hasRestaurantLocation: !!(restaurantLat && restaurantLng),
              distanceMode: actualRestaurant?.distanceMode || apiRestaurant?.distanceMode,
            })
          } else {
            debugLog('? Using backend driving distance:', calculatedDistance)
          }

          // Resolve display category/cuisine with broad API compatibility
          const categoryFromArray = (list) => {
            if (!Array.isArray(list) || list.length === 0) return null
            const firstEntry = list[0]
            if (typeof firstEntry === "string") return firstEntry
            if (firstEntry && typeof firstEntry === "object") {
              return firstEntry.name || firstEntry.label || firstEntry.title || null
            }
            return null
          }

          const resolvedTopCategory =
            actualRestaurant?.topCategory ||
            apiRestaurant?.topCategory ||
            categoryFromArray(actualRestaurant?.topCategories) ||
            categoryFromArray(apiRestaurant?.topCategories) ||
            categoryFromArray(actualRestaurant?.cuisines) ||
            categoryFromArray(apiRestaurant?.cuisines) ||
            categoryFromArray(actualRestaurant?.categories) ||
            categoryFromArray(apiRestaurant?.categories) ||
            actualRestaurant?.cuisine ||
            apiRestaurant?.cuisine ||
            actualRestaurant?.category ||
            apiRestaurant?.category ||
            "Multi-cuisine"

          const onboardingStep2 = actualRestaurant?.onboarding?.step2 || apiRestaurant?.onboarding?.step2 || {}
          const onboardingStep4 = actualRestaurant?.onboarding?.step4 || apiRestaurant?.onboarding?.step4 || {}
          const normalizedProfileImage = actualRestaurant?.profileImage || apiRestaurant?.profileImage || onboardingStep2?.profileImageUrl || null
          const normalizedCoverImages =
            Array.isArray(actualRestaurant?.coverImages) && actualRestaurant.coverImages.length > 0
              ? actualRestaurant.coverImages
              : Array.isArray(apiRestaurant?.coverImages) && apiRestaurant.coverImages.length > 0
                ? apiRestaurant.coverImages
                : []
          const normalizedMenuImages =
            Array.isArray(actualRestaurant?.menuImages) && actualRestaurant.menuImages.length > 0
              ? actualRestaurant.menuImages
              : Array.isArray(apiRestaurant?.menuImages) && apiRestaurant.menuImages.length > 0
                ? apiRestaurant.menuImages
                : Array.isArray(onboardingStep2?.menuImageUrls)
                  ? onboardingStep2.menuImageUrls
                  : []
          const normalizedRestaurantOffers = actualRestaurant?.restaurantOffers || apiRestaurant?.restaurantOffers || {}

          // Transform API data to match expected format with comprehensive fallbacks
          // Handle both dining restaurant and regular restaurant data structures
          const transformedRestaurant = {
            id: actualRestaurant?.restaurantId || actualRestaurant?._id || actualRestaurant?.id || apiRestaurant?.restaurantId || apiRestaurant?._id || null,
            mongoId: actualRestaurant?._id || apiRestaurant?._id || null,
            name:
              actualRestaurant?.name ||
              actualRestaurant?.restaurantName ||
              apiRestaurant?.name ||
              apiRestaurant?.restaurantName ||
              "Unknown Restaurant",
            cuisine: resolvedTopCategory,
            topCategory: resolvedTopCategory,
            rating: actualRestaurant?.rating || apiRestaurant?.rating || actualRestaurant?.averageRating || apiRestaurant?.averageRating || 0,
            reviews: actualRestaurant?.totalRatings || apiRestaurant?.totalRatings || actualRestaurant?.reviewCount || apiRestaurant?.reviewCount || actualRestaurant?.reviews?.length || apiRestaurant?.reviews?.length || 0,
            deliveryTime: actualRestaurant?.estimatedDeliveryTime || apiRestaurant?.estimatedDeliveryTime || actualRestaurant?.deliveryTime || apiRestaurant?.deliveryTime || actualRestaurant?.avgDeliveryTime || apiRestaurant?.avgDeliveryTime || "25-30 mins",
            distance: calculatedDistance || "",
            distanceInKm: Number.isFinite(apiDistanceInKm) ? apiDistanceInKm : (actualRestaurant?.distanceInKm ?? apiRestaurant?.distanceInKm ?? null),
            distanceMode: actualRestaurant?.distanceMode || apiRestaurant?.distanceMode || null,
            distanceOriginKey:
              Number.isFinite(Number(distanceOrigin?.latitude)) &&
              Number.isFinite(Number(distanceOrigin?.longitude))
                ? `${Number(distanceOrigin.latitude)},${Number(distanceOrigin.longitude)}`
                : null,
            location: formattedAddress,
            locationObject: locationObj, // Store full location object for reference
            image: normalizedCoverImages?.[0]?.url
              || normalizedCoverImages?.[0]
              || normalizedProfileImage?.url
              || normalizedProfileImage
              || (normalizedMenuImages.length > 0
                ? (normalizedMenuImages[0]?.url || normalizedMenuImages[0])
                : null)
              || actualRestaurant?.image
              || apiRestaurant?.image
              || null,
            priceRange: actualRestaurant?.priceRange || apiRestaurant?.priceRange || onboardingStep4?.priceRange || "$$",
            offers: Array.isArray(actualRestaurant?.offers) ? actualRestaurant.offers : (Array.isArray(apiRestaurant?.offers) ? apiRestaurant.offers : []), // Will be populated from menu/offers API later
            offerText: actualRestaurant?.offer || apiRestaurant?.offer || onboardingStep4?.offer || "FLAT 50% OFF",
            offerCount: actualRestaurant?.offerCount || apiRestaurant?.offerCount || 0,
            restaurantOffers: {
              goldOffer: {
                title: normalizedRestaurantOffers?.goldOffer?.title || "Gold exclusive offer",
                description: apiRestaurant?.restaurantOffers?.goldOffer?.description || "Free delivery above ₹99",
                unlockText: normalizedRestaurantOffers?.goldOffer?.unlockText || "join Gold to unlock",
                buttonText: apiRestaurant?.restaurantOffers?.goldOffer?.buttonText || "Add Gold - ₹1",
              },
              coupons: Array.isArray(normalizedRestaurantOffers?.coupons)
                ? normalizedRestaurantOffers.coupons
                : [],
            },
            outlets: Array.isArray(actualRestaurant?.outlets) ? actualRestaurant.outlets : (Array.isArray(apiRestaurant?.outlets) ? apiRestaurant.outlets : []),
            categories: Array.isArray(actualRestaurant?.categories) ? actualRestaurant.categories : (Array.isArray(apiRestaurant?.categories) ? apiRestaurant.categories : []),
            menu: Array.isArray(actualRestaurant?.menu) ? actualRestaurant.menu : (Array.isArray(apiRestaurant?.menu) ? apiRestaurant.menu : []),
            slug: actualRestaurant?.slug?.replace(/[\s\/]+/g, '-') || apiRestaurant?.slug?.replace(/[\s\/]+/g, '-') || actualRestaurant?.name?.toLowerCase().replace(/[\s\/]+/g, '-') || apiRestaurant?.name?.toLowerCase().replace(/[\s\/]+/g, '-') || slug || "unknown",
            restaurantId: actualRestaurant?.restaurantId || actualRestaurant?._id || actualRestaurant?.id || apiRestaurant?.restaurantId || apiRestaurant?._id || apiRestaurant?.id || null,
            // Add other fields with defaults
            featuredDish: actualRestaurant?.featuredDish || apiRestaurant?.featuredDish || onboardingStep4?.featuredDish || "Special Dish",
            featuredPrice: actualRestaurant?.featuredPrice || apiRestaurant?.featuredPrice || onboardingStep4?.featuredPrice || 249,
            // Additional safety fields
            openDays: Array.isArray(actualRestaurant?.openDays)
              ? actualRestaurant.openDays
              : (Array.isArray(apiRestaurant?.openDays) ? apiRestaurant.openDays : (Array.isArray(onboardingStep2?.openDays) ? onboardingStep2.openDays : [])),
            deliveryTimings: actualRestaurant?.deliveryTimings || apiRestaurant?.deliveryTimings || {
              openingTime: actualRestaurant?.openingTime || apiRestaurant?.openingTime || onboardingStep2?.deliveryTimings?.openingTime || "",
              closingTime: actualRestaurant?.closingTime || apiRestaurant?.closingTime || onboardingStep2?.deliveryTimings?.closingTime || "",
            },
            outletTimings: actualRestaurant?.outletTimings || apiRestaurant?.outletTimings || null,
            cuisines: Array.isArray(actualRestaurant?.cuisines) ? actualRestaurant.cuisines : (Array.isArray(apiRestaurant?.cuisines) ? apiRestaurant.cuisines : (Array.isArray(onboardingStep2?.cuisines) ? onboardingStep2.cuisines : [])),
            profileImage: normalizedProfileImage,
            coverImages: normalizedCoverImages,
            menuImages: normalizedMenuImages,
            // Menu sections for display (will be populated from menu API)
            menuSections: [],
            // Onboarding data including FSSAI license
            onboarding: actualRestaurant?.onboarding || apiRestaurant?.onboarding || null,
            ownerName: actualRestaurant?.ownerName || apiRestaurant?.ownerName || actualRestaurant?.onboarding?.step1?.ownerName || apiRestaurant?.onboarding?.step1?.ownerName || null,
            fssaiNumber: actualRestaurant?.fssaiNumber || apiRestaurant?.fssaiNumber || actualRestaurant?.onboarding?.step3?.fssai?.registrationNumber || apiRestaurant?.onboarding?.step3?.fssai?.registrationNumber || null,
            gstNumber: actualRestaurant?.gstNumber || apiRestaurant?.gstNumber || actualRestaurant?.onboarding?.step3?.gst?.gstNumber || apiRestaurant?.onboarding?.step3?.gst?.gstNumber || null,
            gstRegistered: typeof actualRestaurant?.gstRegistered === 'boolean' ? actualRestaurant.gstRegistered : (typeof apiRestaurant?.gstRegistered === 'boolean' ? apiRestaurant.gstRegistered : (actualRestaurant?.onboarding?.step3?.gst?.isRegistered || apiRestaurant?.onboarding?.step3?.gst?.isRegistered || false)),
            phone: actualRestaurant?.primaryContactNumber || actualRestaurant?.ownerPhone || apiRestaurant?.primaryContactNumber || apiRestaurant?.ownerPhone || actualRestaurant?.phone || apiRestaurant?.phone || "",
            diningSettings: actualRestaurant?.diningSettings || apiRestaurant?.diningSettings || null,
            takeawaySettings: actualRestaurant?.takeawaySettings || apiRestaurant?.takeawaySettings || null,
            // Availability fields for grayscale styling
            isActive: actualRestaurant?.isActive !== false, // Default to true if not specified
            isAcceptingOrders: actualRestaurant?.isAcceptingOrders !== false, // Default to true if not specified
          }

          debugLog('? Transformed restaurant:', transformedRestaurant)
          debugLog('? Restaurant ID for menu fetch:', transformedRestaurant.id)

          if (!transformedRestaurant.id) {
            debugError('? No restaurant ID found! Cannot fetch menu.')
          }

          setRestaurant(transformedRestaurant)
          fetchedRestaurantRef.current = true // Mark as fetched
          fetchedSlugRef.current = slug

          // Menu / outlet / inventory: Mongo ObjectId only (never name-slug — that caused 30s cancels)
          const objectIdForApis = [
            seededMongoId,
            transformedRestaurant.mongoId,
            actualRestaurant?._id,
            apiRestaurant?._id,
            transformedRestaurant.id,
            transformedRestaurant.restaurantId,
          ]
            .map((v) => String(v || "").trim())
            .find((v) => isMongoObjectId(v))

          setLoadingMenuItems(true)
          if (!objectIdForApis) {
            debugWarn('? No Mongo ObjectId for menu/timings — skipping secondary fetches')
            setLoadingMenuItems(false)
          } else {
            const hasPreviousOrderForRestaurant = !!actualRestaurant?.hasOrderedBefore || !!apiRestaurant?.hasOrderedBefore

            const [outletResult, menuResult] = await Promise.allSettled([
              restaurantAPI.getOutletTimingsByRestaurantId(objectIdForApis),
              restaurantAPI.getMenuByRestaurantId(objectIdForApis),
            ])

            if (outletResult.status === "fulfilled") {
              const outletTimingsData =
                outletResult.value?.data?.data?.outletTimings ||
                outletResult.value?.data?.outletTimings
              if (outletTimingsData) {
                setRestaurant((prev) => (prev ? { ...prev, outletTimings: outletTimingsData } : prev))
              }
            } else {
              debugWarn("Outlet timings fetch failed, falling back to delivery timings:", outletResult.reason?.message)
            }

            try {
              const menuResponse =
                menuResult.status === "fulfilled" && menuResult.value?.data?.success
                  ? menuResult.value
                  : null
              if (!menuResponse) {
                if (menuResult.status === "rejected" && menuResult.reason?.response?.status !== 404) {
                  throw menuResult.reason
                }
                throw Object.assign(new Error('Menu not found'), { response: { status: 404 } })
              }
              debugLog('? Menu resolved using ObjectId:', objectIdForApis)
              if (menuResponse.data && menuResponse.data.success && menuResponse.data.data && menuResponse.data.data.menu) {
                const rawSections = menuResponse.data.data.menu.sections || []
                const toArray = (value) => {
                  if (Array.isArray(value)) return value
                  if (!value || typeof value !== "object") return []
                  return Object.values(value).filter((entry) => entry && typeof entry === "object")
                }
                const normalizeItem = (item = {}) => {
                  const isRecommended = item.isRecommended === true || item.isRecommended === 1 || String(item.isRecommended) === "true"
                  const isSpicy = item.isSpicy === true || item.isSpicy === 1 || String(item.isSpicy) === "true"
                  const isVeg = isVegMenuItem(item, transformedRestaurant)
                  const isVegan = item?.isVegan === true || String(item?.foodType || "").toLowerCase() === "vegan"
                  const foodType = item.foodType || (isVeg ? "Veg" : "Non-Veg")

                  return {
                    ...item,
                    id: String(item.id || item._id || `${Date.now()}-${Math.random()}`),
                    name: item.name || "Unnamed Item",
                    foodType,
                    isVeg, // Explicitly set isVeg
                    isVegan,
                    price: getFoodDisplayPrice(item),
                    variants: getFoodVariants(item),
                    variations: getFoodVariants(item),
                    isAvailable: item.isAvailable !== false,
                    isRecommended,
                    isSpicy,
                    description: typeof item.description === "string" ? item.description : "",
                  }
                }
                const menuSections = toArray(rawSections).map((section, sectionIndex) => ({
                  ...section,
                  id: String(section.id || section._id || `section-${sectionIndex}`),
                  name: section.name || section.title || "Unnamed Section",
                  items: toArray(section.items).map(normalizeItem),
                  subsections: toArray(section.subsections).map((subsection, subsectionIndex) => ({
                    ...subsection,
                    id: String(subsection.id || subsection._id || `subsection-${sectionIndex}-${subsectionIndex}`),
                    name: subsection.name || "Unnamed Subsection",
                    items: toArray(subsection.items).map(normalizeItem),
                  })),
                }))

                // Collect all recommended items from all sections
                // Only include items that are both recommended (isRecommended === true) AND available (isAvailable !== false)
                const recommendedItems = []
                menuSections.forEach(section => {
                  // Check direct items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.items && Array.isArray(section.items)) {
                    section.items.forEach(item => {
                      // Strict check: isRecommended must be exactly boolean true
                      // This will exclude: false, undefined, null, 0, "", and any other falsy values
                      if (isRecommendedItem(item) && item.isAvailable !== false) {
                        recommendedItems.push(item)
                      }
                    })
                  }
                  // Check subsection items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.subsections && Array.isArray(section.subsections)) {
                    section.subsections.forEach(subsection => {
                      if (subsection.items && Array.isArray(subsection.items)) {
                        subsection.items.forEach(item => {
                          // Strict check: isRecommended must be exactly boolean true
                          // This will exclude: false, undefined, null, 0, "", and any other falsy values
                          if (isRecommendedItem(item) && item.isAvailable !== false) {
                            recommendedItems.push(item)
                          }
                        })
                      }
                    })
                  }
                })

                // Debug log to verify recommended items and their isRecommended values
                debugLog('Recommended items collected:', recommendedItems.map(item => ({
                  name: item.name,
                  isRecommended: item.isRecommended,
                  isRecommendedType: typeof item.isRecommended,
                  preparationTime: item.preparationTime
                })))

                // Debug log to check preparationTime in menu sections
                debugLog('Menu sections with preparationTime:', menuSections.map(section => ({
                  sectionName: section.name,
                  items: section.items?.map(item => ({
                    name: item.name,
                    preparationTime: item.preparationTime
                  })) || []
                })))

                // Dynamically inject the specifically searched dish at the very top of Recommended if targetDishId is present
                if (targetDishId) {
                  const allItemsInMenu = []
                  menuSections.forEach(s => {
                    if (s.items) allItemsInMenu.push(...s.items)
                    if (s.subsections) {
                      s.subsections.forEach(ss => {
                        if (ss.items) allItemsInMenu.push(...ss.items)
                      })
                    }
                  })
                  const matchedItem = allItemsInMenu.find(item => String(item.id || item._id || "").trim() === targetDishId)
                  if (matchedItem) {
                    // Check if it's already in recommendedItems, if so remove it
                    const existingIdx = recommendedItems.findIndex(item => String(item.id || item._id || "").trim() === targetDishId)
                    if (existingIdx > -1) {
                      recommendedItems.splice(existingIdx, 1)
                    }
                    // Add/Move to the very front
                    recommendedItems.unshift(matchedItem)
                    debugLog('Moved matched item to front of Recommended:', matchedItem.name)
                  }
                }

                // Deduplicate "Recommended for you" sections
                let finalMenuSections = menuSections.filter(s => {
                  const name = (s.name || s.title || "").toLowerCase().trim()
                  return name !== "recommended" && name !== "recommended for you"
                })

                if (recommendedItems.length > 0) {
                  finalMenuSections = [{ name: "Recommended for you", items: recommendedItems, subsections: [] }, ...finalMenuSections]
                }

                setRestaurant(prev => ({
                  ...prev,
                  menuSections: finalMenuSections,
                }))

                // Set all sections as expanded by default so users don't have to manually click
                const defaultExpandedSections = new Set(
                  finalMenuSections.map((_, idx) => idx)
                )

                // Also expand all sub-sections by default
                finalMenuSections.forEach((section, originalIndex) => {
                  if (section.subsections && Array.isArray(section.subsections)) {
                    section.subsections.forEach((_, subIndex) => {
                      defaultExpandedSections.add(`${originalIndex}-${subIndex}`)
                    })
                  }
                })

                setExpandedSections(defaultExpandedSections)

                debugLog('Fetched menu sections with recommended items:', finalMenuSections)
              }
            } catch (menuError) {
              if (menuError.response && menuError.response.status === 404) {
                debugLog('? Menu not found for this restaurant (might be a dining-only listing).')
              } else {
                debugError('? Error fetching menu:', menuError)
              }
            } finally {
              setLoadingMenuItems(false)
            }

            try {
              debugLog('? Fetching inventory for restaurant ID:', objectIdForApis)
              const inventoryResponse = await restaurantAPI.getInventoryByRestaurantId(objectIdForApis)
              if (inventoryResponse?.data?.success && inventoryResponse?.data?.data?.inventory) {
                const inventoryCategories = inventoryResponse.data.data.inventory.categories || []

                // Normalize inventory categories to ensure proper structure
                const normalizedInventory = inventoryCategories.map((category, index) => ({
                  id: category.id || `category-${index}`,
                  name: category.name || "Unnamed Category",
                  description: category.description || "",
                  itemCount: category.itemCount || (category.items?.length || 0),
                  inStock: category.inStock !== undefined ? category.inStock : true,
                  items: Array.isArray(category.items) ? category.items.map(item => ({
                    id: String(item.id || Date.now() + Math.random()),
                    name: item.name || "Unnamed Item",
                    inStock: item.inStock !== undefined ? item.inStock : true,
                    isVeg: item.isVeg !== undefined ? item.isVeg : true,
                    stockQuantity: item.stockQuantity || "Unlimited",
                    unit: item.unit || "piece",
                    expiryDate: item.expiryDate || null,
                    lastRestocked: item.lastRestocked || null,
                  })) : [],
                  order: category.order !== undefined ? category.order : index,
                }))

                setRestaurant(prev => ({
                  ...prev,
                  inventory: normalizedInventory,
                }))
                debugLog('? Fetched and normalized inventory categories:', normalizedInventory)
              }
            } catch (inventoryError) {
              if (inventoryError.response && inventoryError.response.status === 404) {
                debugLog('? Inventory not found for this restaurant (might be a dining-only listing).')
              } else {
                debugError('? Error fetching inventory:', inventoryError)
              }
            }
          }
        } else {
          debugError('? No restaurant data found in API response')
          debugError('? Response:', response)
          debugError('? apiRestaurant:', apiRestaurant)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Restaurant not found')
            setRestaurant(null)
          }
        }
      } catch (error) {
        // Check if it's a network error (backend not running)
        const isNetworkError = error.code === 'ERR_NETWORK' || error.message === 'Network Error'

        // Check if it's a 404 error (restaurant doesn't exist)
        const is404Error = error.response?.status === 404

        if (isNetworkError) {
          // Network error - backend is not running
          // Don't show "Restaurant not found" for network errors
          // The axios interceptor will show a toast notification
          debugError('Network error fetching restaurant (backend may not be running):', error)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Backend server is not connected. Please make sure the backend is running.')
            setRestaurant(null)
          }
        } else if (is404Error) {
          // 404 error - restaurant doesn't exist in database
          debugLog(`Restaurant "${slug}" not found in database`)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Restaurant not found')
            setRestaurant(null)
          }
        } else {
          // Other errors
          debugError('Error fetching restaurant:', error)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError(error.message || 'Failed to load restaurant')
            setRestaurant(null)
          }
        }
      } finally {
        setLoadingRestaurant(false)
        setLoadingMenuItems(false)
      }
    }

    // Reset fetched flag only when URL slug changes.
    // Do not compare with restaurant.slug because canonical API slug may differ
    // from route slug (e.g. "restaurant-2513"), causing refetch loops.
    if (fetchedRestaurantRef.current && fetchedSlugRef.current !== slug) {
      fetchedRestaurantRef.current = false
      fetchedSlugRef.current = null
    }

    fetchRestaurant()
  }, [slug, zoneId, seededMongoId, distanceOrigin?.latitude, distanceOrigin?.longitude, refreshNonce])

  // Track previous values to prevent unnecessary recalculations
  const prevCoordsRef = useRef({ userLat: null, userLng: null, restaurantLat: null, restaurantLng: null })
  const prevDistanceRef = useRef(null)

  // Extract restaurant coordinates as stable values (not array references)
  const restaurantLat = restaurant?.locationObject?.latitude ||
    (restaurant?.locationObject?.coordinates && Array.isArray(restaurant.locationObject.coordinates)
      ? restaurant.locationObject.coordinates[1]
      : null)
  const restaurantLng = restaurant?.locationObject?.longitude ||
    (restaurant?.locationObject?.coordinates && Array.isArray(restaurant.locationObject.coordinates)
      ? restaurant.locationObject.coordinates[0]
      : null)



  // Sync quantities from cart on mount and when restaurant changes
  useEffect(() => {
    if (!restaurant || !restaurant.name) return

    /*
     * Key by dish+variant, never by the cart line's own id.
     *
     * For a signed-in user the server's line id is the Mongo _id of the cart
     * sub-document, while every lookup on this page uses
     * buildCartLineId(dishId, variantId) ("<dishId>::base"). Keying the map by
     * item.id therefore never matched: the optimistic update in
     * updateItemQuantity set the right key, then this sync overwrote the map
     * with unmatchable ones, so the +/- stepper flipped straight back to ADD
     * even though the item was in the cart. (Guests happened to work, because
     * the guest cart stores the id this page generated.)
     */
    const cartQuantities = {}
    const restaurantIdsForPage = [
      restaurant?.restaurantId,
      restaurant?._id,
      restaurant?.id,
    ]
      .filter(Boolean)
      .map((value) => String(value))

    cart.forEach((item) => {
      const belongsToThisRestaurant =
        (item.restaurantId && restaurantIdsForPage.includes(String(item.restaurantId))) ||
        item.restaurant === restaurant.name
      if (!belongsToThisRestaurant) return

      const dishId = item.itemId || item.productId || item.id
      if (!dishId) return
      const lineItemId = buildCartLineId(dishId, item.variantId || "")
      cartQuantities[lineItemId] = (cartQuantities[lineItemId] || 0) + (item.quantity || 0)
    })
    setQuantities(cartQuantities)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.name, cart])

  useEffect(() => {
    if (!selectedItem) {
      setSelectedVariantId("")
      setItemDetailQuantity(1)
      return
    }
    const variants = getFoodVariants(selectedItem)
    const variantInCart = variants.find(v => {
      const lineItemId = getLineItemIdForDish(selectedItem, v)
      return (quantities[lineItemId] || 0) > 0
    })
    
    let activeVar = null
    if (variantInCart) {
      const vId = variantInCart.id || variantInCart._id || ""
      setSelectedVariantId(vId)
      activeVar = variantInCart
    } else {
      const defaultVariant = getDefaultFoodVariant(selectedItem)
      const vId = defaultVariant?.id || defaultVariant?._id || ""
      setSelectedVariantId(vId)
      activeVar = defaultVariant
    }

    const currentLineItemId = getLineItemIdForDish(selectedItem, activeVar)
    const cartQty = quantities[currentLineItemId] || 0
    setItemDetailQuantity(cartQty > 0 ? cartQty : 1)
  }, [selectedItem])

  // Helper function to update item quantity in both local state and cart
  const updateItemQuantity = async (item, newQuantity, event = null, preferredVariant = null) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      window.dispatchEvent(new CustomEvent('show-login-required'))
      return
    }

    // CRITICAL: Check if user is in service zone or restaurant is available
    if (isOutOfService) {
      toast.error('You are outside the service zone. Please select a location within the service area.');
      return;
    }

    const availability = getRestaurantAvailabilityStatus(restaurant)
    if (!availability.isOpen) {
      toast.error("Restaurant is currently offline. Please try again later.")
      return
    }

    const resolvedVariant = preferredVariant || getDefaultFoodVariant(item)
    const lineItemId = getLineItemIdForDish(item, resolvedVariant)

    // Update local state
    setQuantities((prev) => ({
      ...prev,
      [lineItemId]: newQuantity,
    }))

    // CRITICAL: Validate restaurant data before adding to cart
    if (!restaurant || !restaurant.name) {
      debugError('? Cannot add item to cart: Restaurant data is missing!');
      toast.error('Restaurant information is missing. Please refresh the page.');
      return;
    }

    // Ensure we have a valid restaurantId
    const validRestaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id;
    if (!validRestaurantId) {
      debugError('? Cannot add item to cart: Restaurant ID is missing!', {
        restaurant: restaurant,
        restaurantId: restaurant?.restaurantId,
        _id: restaurant?._id,
        id: restaurant?.id
      });
      toast.error('Restaurant ID is missing. Please refresh the page.');
      return;
    }

    // Log for debugging
    debugLog('? Adding item to cart:', {
      itemName: item.name,
      restaurantName: restaurant.name,
      restaurantId: validRestaurantId,
      restaurant_id: restaurant._id,
      restaurant_restaurantId: restaurant.restaurantId
    });

    // Prepare cart item with all required properties (selling price already includes admin markup).
    const cartItem = {
      id: lineItemId,
      lineItemId,
      itemId: item.id,
      name: item.name,
      price: resolvedVariant?.price ?? item.price,
      basePrice: resolvedVariant?.basePrice ?? item.basePrice ?? resolvedVariant?.price ?? item.price,
      markupAmount: resolvedVariant?.markupAmount ?? item.markupAmount ?? 0,
      variantId: resolvedVariant?.id || "",
      variantName: resolvedVariant?.name || "",
      variantPrice: resolvedVariant?.price ?? item.price,
      image: item.image,
      restaurant: restaurant.name, // Use restaurant.name directly (already validated)
      restaurantId: validRestaurantId, // Use validated restaurantId
      restaurantZoneId: restaurant.zoneId ? String(restaurant.zoneId) : "",
      description: item.description,
      isVeg: isVegMenuItem(item, restaurant),
      foodType: item.foodType || (isVegMenuItem(item, restaurant) ? 'Veg' : 'Non-Veg'),
      preparationTime: item.preparationTime, // Add preparationTime property
      pricingScope: resolvedVariant?.pricingScope ?? item.pricingScope ?? null,
      appliedPricingType: resolvedVariant?.appliedPricingType ?? item.appliedPricingType ?? null,
      appliedPricingValue: resolvedVariant?.appliedPricingValue ?? item.appliedPricingValue ?? null,
    }

    // Get source position for animation from event target
    // Prefer currentTarget (the button) over target (might be icon inside button)
    let sourcePosition = null
    if (event) {
      // Use currentTarget (the button element) for accurate button position
      // If currentTarget is not available, try to find the button element
      let buttonElement = event.currentTarget
      if (!buttonElement && event.target) {
        // If we clicked on an icon inside, find the closest button
        buttonElement = event.target.closest('button') || event.target
      }

      if (buttonElement) {
        // Store button reference and current viewport position
        // We'll recalculate position right before animation to account for scroll
        const rect = buttonElement.getBoundingClientRect()
        const scrollX = window.pageXOffset || window.scrollX || 0
        const scrollY = window.pageYOffset || window.scrollY || 0

        // Store both viewport position and scroll at capture time
        // This allows us to adjust for scroll changes later
        sourcePosition = {
          // Viewport-relative position at capture time
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          // Scroll position at capture time
          scrollX: scrollX,
          scrollY: scrollY,
          // Store button identifier to potentially find it again
          itemId: lineItemId,
        }
      }
    }

    // Update cart context
    if (newQuantity <= 0) {
      // Pass sourcePosition and product info for removal animation
      const productInfo = {
        id: lineItemId,
        name: item.name,
        imageUrl: item.image,
      }
      removeFromCart(lineItemId, sourcePosition, productInfo)
    } else {
      const existingCartItem = getCartItem(lineItemId)
      if (existingCartItem) {
        // Prepare product info for animation
        const productInfo = {
          id: lineItemId,
          name: item.name,
          imageUrl: item.image,
        }

        // If incrementing quantity, trigger add animation with sourcePosition
        if (newQuantity > existingCartItem.quantity && sourcePosition) {
          const result = await addToCart(cartItem, sourcePosition)
          if (result?.ok === false) {
            if (!result.cancelled) {
              toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
            }
            return
          }
          if (newQuantity > existingCartItem.quantity + 1) {
            updateQuantity(lineItemId, newQuantity)
          }
        }
        // If decreasing quantity, trigger removal animation with sourcePosition
        else if (newQuantity < existingCartItem.quantity && sourcePosition) {
          updateQuantity(lineItemId, newQuantity, sourcePosition, productInfo)
        }
        // Otherwise just update quantity without animation
        else {
          updateQuantity(lineItemId, newQuantity)
        }
      } else {
        // Add to cart first (adds with quantity 1), then update to desired quantity
        // Pass sourcePosition when adding a new item
        const result = await addToCart(cartItem, sourcePosition)
        if (result?.ok === false) {
          if (!result.cancelled) {
            toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
          }
          return
        }
        if (newQuantity > 1) {
          updateQuantity(lineItemId, newQuantity)
        }
      }
    }
  }

  const isRecommendedSection = (section) => {
    const sectionName = section?.name || section?.title || ""
    if (typeof sectionName !== "string") return false
    const name = sectionName.trim().toLowerCase()
    return name === "recommended for you" || name === "result for your search"
  }

  const isRecommendedItem = (item) => {
    return item?.isRecommended === true || item?.isRecommended === 1 || String(item?.isRecommended) === "true"
  }

  const getSectionDisplayName = (section) => {
    if (isRecommendedSection(section)) {
      return "Recommended for you"
    }
    if (section?.name && typeof section.name === "string" && section.name.trim()) {
      return section.name.trim()
    }
    if (section?.title && typeof section.title === "string" && section.title.trim()) {
      return section.title.trim()
    }
    return "Unnamed Section"
  }

  const normalizeMenuCategoryId = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")

  const toRenderableArray = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== "object") return []
    return Object.values(value).filter((entry) => entry && typeof entry === "object")
  }

  const getSectionCategoryImage = (section) => {
    const directImage = typeof section?.image === "string" ? section.image.trim() : ""
    if (directImage) return directImage

    const firstSectionItemImage = toRenderableArray(section?.items).find(
      (item) => typeof item?.image === "string" && item.image.trim(),
    )?.image
    if (firstSectionItemImage) return firstSectionItemImage

    const firstSubsectionImage = toRenderableArray(section?.subsections)
      .flatMap((subsection) => toRenderableArray(subsection?.items))
      .find((item) => typeof item?.image === "string" && item.image.trim())?.image

    return firstSubsectionImage || ""
  }

  // Menu categories - built from raw sections but item count respects veg mode inline
  const menuCategories = useMemo(() => {
    if (!restaurant?.menuSections || !Array.isArray(restaurant.menuSections)) return []

    return restaurant.menuSections
      .map((section, index) => {
        if (isRecommendedSection(section)) return null

        const sectionTitle = getSectionDisplayName(section)

        // Count only items that pass veg mode filter
        const countVisibleItems = (items) =>
          toRenderableArray(items).filter((item) => {
            if (item?.isAvailable === false) return false
            if (vegMode) {
              if (!isVegMenuItem(item)) return false
            }
            return true
          }).length

        const itemCount = countVisibleItems(section?.items)
        const subsectionCount = toRenderableArray(section?.subsections)
          .reduce((sum, sub) => sum + countVisibleItems(sub?.items), 0)
        const totalCount = itemCount + subsectionCount

        if (totalCount <= 0) return null

        return {
          id: normalizeMenuCategoryId(section?.categoryId || sectionTitle || index) || `section-${index}`,
          name: sectionTitle,
          image: getSectionCategoryImage(section),
          count: totalCount,
          sectionIndex: index,
        }
      })
      .filter(Boolean)
  }, [restaurant?.menuSections, vegMode, vegModeOption])

  // Count active filters
  const getActiveFilterCount = () => {
    let count = 0
    if (filters.sortBy) count++
    if (filters.vegNonVeg) count++
    if (filters.highlyReordered) count++
    if (filters.spicy) count++
    return count
  }

  const activeFilterCount = getActiveFilterCount()

  useEffect(() => {
    if (typeof window === "undefined" || !slug) return

    try {
      const raw = window.localStorage.getItem(RESTAURANT_DETAILS_FILTERS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const nextState = parsed && typeof parsed === "object" ? parsed : {}
      nextState[slug] = filters
      window.localStorage.setItem(RESTAURANT_DETAILS_FILTERS_STORAGE_KEY, JSON.stringify(nextState))
    } catch (error) {
      debugWarn("Failed to persist restaurant filters:", error)
    }
  }, [filters, slug])

  useEffect(() => {
    if (selectedMenuCategory === "all") return
    const categoryStillVisible = menuCategories.some((category) => category.id === selectedMenuCategory)
    if (!categoryStillVisible) {
      setSelectedMenuCategory("all")
    }
  }, [menuCategories, selectedMenuCategory])

  // Handle bookmark click
  const handleBookmarkClick = (item) => {
    const restaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id
    if (!restaurantId) {
      toast.error("Restaurant information is missing")
      return
    }

    const dishId = item.id || item._id
    if (!dishId) {
      toast.error("Dish information is missing")
      return
    }

    const isFavorite = isDishFavorite(dishId, restaurantId)

    if (isFavorite) {
      // If already bookmarked, remove it
      removeDishFavorite(dishId, restaurantId)
      toast.success("Dish removed from favorites")
    } else {
      // Add to favorites
      const dishData = {
        id: dishId,
        name: item.name,
        description: item.description,
        price: item.price,
        originalPrice: item.originalPrice,
        image: item.image,
        restaurantId: restaurantId,
        restaurantName: restaurant?.name || "",
        restaurantSlug: restaurant?.slug || slug || "",
        foodType: item.foodType,
        isSpicy: item.isSpicy,
        customisable: item.customisable,
      }
      addDishFavorite(dishData)
      toast.success("Dish added to favorites")
    }
  }

  // Handle add to collection
  const handleAddToCollection = () => {
    const restaurantSlug = restaurant?.slug || slug || ""

    if (!restaurantSlug) {
      toast.error("Restaurant information is missing")
      return
    }

    if (!restaurant) {
      toast.error("Restaurant data not available")
      return
    }

    const isAlreadyFavorite = isFavorite(restaurantSlug)

    if (isAlreadyFavorite) {
      // Remove from collection
      removeFavorite(restaurantSlug)
      toast.success("Restaurant removed from collection")
    } else {
      // Add to collection
      addFavorite({
        slug: restaurantSlug,
        name: restaurant.name || "",
        cuisine: restaurant.cuisine || "",
        rating: restaurant.rating || 0,
        deliveryTime: restaurant.deliveryTime || restaurant.estimatedDeliveryTime || "",
        distance: restaurant.distance || "",
        priceRange: restaurant.priceRange || "",
        image: restaurant.profileImageUrl?.url || restaurant.image || ""
      })
      toast.success("Restaurant added to collection")
    }

    setShowMenuOptionsSheet(false)
  }

  // Handle share restaurant
  const handleShareRestaurant = async () => {
    const companyName = await getCompanyNameAsync()
    const restaurantSlug = restaurant?.slug || slug || ""
    const restaurantName = restaurant?.name || "this restaurant"

    // Create share URL
    const shareUrl = `${window.location.origin}/user/restaurants/${restaurantSlug}`
    const shareText = `Check out ${restaurantName} on ${companyName}! ${shareUrl}`

    const payload = {
      title: restaurantName,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      setShowMenuOptionsSheet(false)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Restaurant shared successfully")
      setShowMenuOptionsSheet(false)
      return
    }

    openShareModal(payload)
    setShowMenuOptionsSheet(false)
  }



  // Handle share click
  const handleShareClick = async (item) => {
    const dishId = item.id || item._id
    const restaurantSlug = restaurant?.slug || slug || ""

    // Create share URL
    const shareUrl = `${window.location.origin}/user/restaurants/${restaurantSlug}?dish=${dishId}`
    const shareText = `Check out ${item.name} from ${restaurant?.name || "this restaurant"}! ${shareUrl}`

    const payload = {
      title: `${item.name} - ${restaurant?.name || ""}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Dish shared successfully")
      return
    }

    openShareModal(payload)
  }

  // Copy to clipboard helper
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Link copied to clipboard!")
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand("copy")
        toast.success("Link copied to clipboard!")
      } catch (err) {
        toast.error("Failed to copy link")
      }
      if (document.body.contains(textArea)) {
        document.body.removeChild(textArea)
      }
    }
  }

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
  }

  const openShareModal = (payload) => {
    setSharePayload(payload)
    setShowShareModal(true)
  }

  const tryNativeShare = async (payload) => {
    if (typeof navigator === "undefined" || !navigator.share) return false
    try {
      await navigator.share(payload)
      return true
    } catch (error) {
      if (error?.name === "AbortError") return true
      return false
    }
  }

  const openShareTarget = (target) => {
    if (!sharePayload?.url) return

    const text = sharePayload.text || ""
    const url = sharePayload.url
    const encodedText = encodeURIComponent(text)
    const encodedUrl = encodeURIComponent(url)

    let shareLink = ""

    if (target === "whatsapp") {
      shareLink = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "telegram") {
      shareLink = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    } else if (target === "email") {
      shareLink = `mailto:?subject=${encodeURIComponent(sharePayload.title || "Check this out")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    }

    if (shareLink) {
      window.open(shareLink, "_blank", "noopener,noreferrer")
      setShowShareModal(false)
    }
  }

  const copyShareLink = async () => {
    if (!sharePayload?.url) return
    await copyToClipboard(sharePayload.url)
    setShowShareModal(false)
  }

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  // Prefetch only when we don't already have the list image decoded
  const preloadDishImage = (src) =>
    new Promise((resolve) => {
      if (!src) {
        resolve()
        return
      }
      const img = new Image()
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const timeoutId = setTimeout(finish, 500)
      img.onload = () => {
        clearTimeout(timeoutId)
        finish()
      }
      img.onerror = () => {
        clearTimeout(timeoutId)
        finish()
      }
      img.src = src
      if (img.complete) {
        clearTimeout(timeoutId)
        finish()
      }
    })

  const itemDetailOpenSeqRef = useRef(0)

  // Reuse the exact URL the list already loaded (srcset/webp). Raw item.image is a
  // different URL, so the browser treats the popup as a fresh download otherwise.
  const handleItemClick = async (item, event) => {
    const seq = ++itemDetailOpenSeqRef.current
    const listImg = event?.currentTarget?.querySelector?.("img")
    const cachedSrc = listImg?.currentSrc || listImg?.src || ""
    const imageSrc = cachedSrc || item?.image || ""
    setSelectedItem({ ...item, displayImage: imageSrc })

    const alreadyReady = Boolean(listImg?.complete && cachedSrc)
    if (!alreadyReady) {
      await preloadDishImage(imageSrc)
    }
    if (seq !== itemDetailOpenSeqRef.current) return
    setShowItemDetail(true)
  }

  const closeItemDetail = () => {
    setShowItemDetail(false)
  }

  // Helper function to calculate final price after discount
  const getFinalPrice = (item) => {
    // If discount exists, calculate from originalPrice, otherwise use price directly
    if (item.originalPrice && item.discountAmount && item.discountAmount > 0) {
      // Calculate discounted price from originalPrice
      let discountedPrice = item.originalPrice;
      if (item.discountType === 'Percent') {
        discountedPrice = item.originalPrice - (item.originalPrice * item.discountAmount / 100);
      } else if (item.discountType === 'Fixed') {
        discountedPrice = item.originalPrice - item.discountAmount;
      }
      return Math.max(0, discountedPrice);
    }
    // Otherwise, use price as the final price
    return Math.max(0, item.price || 0);
  };

  // Eatiefy ₹99 section cap — mirrors the backend rule (selling price, cheapest variant).
  const EATIEFY_99_PRICE = 99;
  const isWithinEatiefy99 = (item) => {
    const price = hasFoodVariants(item) ? getFoodDisplayPrice(item) : getFinalPrice(item);
    return price > 0 && price <= EATIEFY_99_PRICE;
  };

  // Filter menu items based on active filters
  const filterMenuItems = (items) => {
    if (!items) return items

    return items.filter((item) => {
      // ₹99 filter (when coming from the Eatiefy ₹99 page)
      if (showOnlyUnder250 && !isWithinEatiefy99(item)) return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const itemName = item.name?.toLowerCase() || ""
        if (!itemName.includes(query)) return false
      }

      // VegMode filter - when vegMode is ON, show only Veg items
      // When vegMode is false/null/undefined, show all items (Veg and Non-Veg)
      if (vegMode === true) {
        if (!isVegMenuItem(item)) return false
      }

      // Veg/Non-veg filter (local filter override) — Non-veg chip disabled while vegMode is ON
      if (filters.vegNonVeg === "veg") {
        if (!isVegMenuItem(item)) return false
      }
      if (!vegMode && filters.vegNonVeg === "non-veg") {
        if (isVegMenuItem(item)) return false
      }

      if (filters.highlyReordered && !isRecommendedItem(item)) return false
      if (filters.spicy && item.isSpicy !== true) return false

      return true
    })
  }

  // Sort items based on sortBy filter
  const sortMenuItems = (items) => {
    if (!items) return items
    if (!filters.sortBy) return items

    const sorted = [...items]
    if (filters.sortBy === "low-to-high") {
      return sorted.sort((a, b) => getFinalPrice(a) - getFinalPrice(b))
    } else if (filters.sortBy === "high-to-low") {
      return sorted.sort((a, b) => getFinalPrice(b) - getFinalPrice(a))
    }
    return sorted
  }

  const getSectionSortValue = (section) => {
    const allItems = [
      ...toRenderableArray(section?.items),
      ...toRenderableArray(section?.subsections).flatMap((subsection) => toRenderableArray(subsection?.items)),
    ]

    if (allItems.length === 0) return null

    const prices = allItems
      .map((item) => getFinalPrice(item))
      .filter((price) => Number.isFinite(price))

    if (prices.length === 0) return null

    if (filters.sortBy === "low-to-high") {
      return Math.min(...prices)
    }

    if (filters.sortBy === "high-to-low") {
      return Math.max(...prices)
    }

    return null
  }

  // Helper function to check if a section has any items at ₹99 or below
  const sectionHasItemsUnder250 = (section) => {
    if (!showOnlyUnder250) return true; // If not filtering, show all sections

    // Check direct items
    if (section.items && section.items.length > 0) {
      const hasUnder250Items = section.items.some(item => {
        if (item.isAvailable === false) return false;
        return isWithinEatiefy99(item);
      });
      if (hasUnder250Items) return true;
    }

    // Check subsection items
    if (section.subsections && section.subsections.length > 0) {
      for (const subsection of section.subsections) {
        if (subsection.items && subsection.items.length > 0) {
          const hasUnder250Items = subsection.items.some(item => {
            if (item.isAvailable === false) return false;
            return isWithinEatiefy99(item);
          });
          if (hasUnder250Items) return true;
        }
      }
    }

    return false;
  }

  // Build renderable sections from the current filter state so section/subsection visibility
  // stays in sync with the actual filtered items shown on screen.
  const getFilteredSections = () => {
    if (!restaurant?.menuSections) return []

    const visibleSections = restaurant.menuSections
      .map((section, index) => {
        const filteredItems = sortMenuItems(
          filterMenuItems(
            toRenderableArray(section?.items).filter((item) => item?.isAvailable !== false)
          )
        )

        const filteredSubsections = toRenderableArray(section?.subsections)
          .map((subsection) => ({
            ...subsection,
            items: sortMenuItems(
              filterMenuItems(
                toRenderableArray(subsection?.items).filter((item) => item?.isAvailable !== false)
              )
            ),
          }))
          .filter((subsection) => subsection.items.length > 0)

        return {
          section: {
            ...section,
            items: filteredItems,
            subsections: filteredSubsections,
          },
          originalIndex: index,
        }
      })
      .filter(({ section }) => {
        if (selectedMenuCategory !== "all") {
          if (isRecommendedSection(section)) return false
          const sectionCategoryId = normalizeMenuCategoryId(section?.categoryId || getSectionDisplayName(section))
          if (sectionCategoryId !== selectedMenuCategory) {
            return false
          }
        }

        const hasVisibleItems = toRenderableArray(section?.items).length > 0
        const hasVisibleSubsections = toRenderableArray(section?.subsections).length > 0
        return hasVisibleItems || hasVisibleSubsections
      })

    if (!filters.sortBy) {
      return visibleSections
    }

    return [...visibleSections].sort((left, right) => {
      const leftValue = getSectionSortValue(left.section)
      const rightValue = getSectionSortValue(right.section)

      if (leftValue == null && rightValue == null) return 0
      if (leftValue == null) return 1
      if (rightValue == null) return -1

      return filters.sortBy === "low-to-high"
        ? leftValue - rightValue
        : rightValue - leftValue
    })
  }

  const hasActiveMenuFilters = Boolean(
    showOnlyUnder250 ||
    searchQuery.trim() ||
    vegMode === true ||
    filters.sortBy ||
    filters.vegNonVeg ||
    filters.highlyReordered ||
    filters.spicy
  )

  // User-explicitly-applied filters (excludes vegMode — vegMode is a global preference, not a manual filter)
  const hasUserAppliedFilters = Boolean(
    showOnlyUnder250 ||
    searchQuery.trim() ||
    filters.sortBy ||
    filters.vegNonVeg ||
    filters.highlyReordered ||
    filters.spicy
  )

  const filteredSections = useMemo(
    () => getFilteredSections(),
    [restaurant?.menuSections, showOnlyUnder250, searchQuery, vegMode, vegModeOption, filters, selectedMenuCategory]
  )

  useEffect(() => {
    if (menuButtonRef.current) {
      setMenuButtonWidth(menuButtonRef.current.offsetWidth)
      setMenuButtonHeight(menuButtonRef.current.offsetHeight)
    }
  }, [restaurant, filteredSections, windowSize])

  useEffect(() => {
    if (!hasActiveMenuFilters) return

    const nextExpanded = new Set()
    filteredSections.forEach(({ section, originalIndex }) => {
      nextExpanded.add(originalIndex)
      toRenderableArray(section?.subsections).forEach((_, subIndex) => {
        nextExpanded.add(`${originalIndex}-${subIndex}`)
      })
    })

    setExpandedSections(nextExpanded)
  }, [filteredSections, hasActiveMenuFilters])

  useEffect(() => {
    if (!restaurant?.menuSections || !targetDishId) return

    let matchedItem = null
    const sectionKeysToExpand = new Set()

    restaurant.menuSections.forEach((section, originalIndex) => {
      const sectionItems = toRenderableArray(section?.items)
      const matchedSectionItem = sectionItems.find(
        (item) => String(item?.id || item?._id || "").trim() === targetDishId,
      )

      if (matchedSectionItem && !matchedItem) {
        matchedItem = matchedSectionItem
        sectionKeysToExpand.add(originalIndex)
      }

      const sectionSubsections = toRenderableArray(section?.subsections)
      sectionSubsections.forEach((subsection, subIndex) => {
        const subsectionItems = toRenderableArray(subsection?.items)
        const matchedSubsectionItem = subsectionItems.find(
          (item) => String(item?.id || item?._id || "").trim() === targetDishId,
        )

        if (matchedSubsectionItem && !matchedItem) {
          matchedItem = matchedSubsectionItem
          sectionKeysToExpand.add(originalIndex)
          sectionKeysToExpand.add(`${originalIndex}-${subIndex}`)
        }
      })
    })

    if (!matchedItem || hasScrolledRef.current) return

    hasScrolledRef.current = true

    setExpandedSections((prev) => {
      const next = new Set(prev)
      sectionKeysToExpand.forEach((key) => next.add(key))
      return next
    })

    // Ensure we start at the top of the page on mount
    window.scrollTo({
      top: 0,
      behavior: "instant"
    })

    // Delay applying the highlight slightly so the CSS transition can smoothly fade it in
    const applyHighlightTimer = window.setTimeout(() => {
      setHighlightedDishId(targetDishId)
    }, 50)

    const highlightTimer = window.setTimeout(() => {
      setHighlightedDishId(null)
    }, 3000)

    return () => {
      window.clearTimeout(applyHighlightTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [loadingMenuItems, targetDishId])

  // Highlight offers/texts for the blue offer line
  const highlightOffers = [
    "Upto 50% OFF",
    restaurant?.offerText || "",
    ...(Array.isArray(restaurant?.offers) ? restaurant.offers.map((offer) => offer?.title || "") : []),
  ]
  const rotatingOffers = highlightOffers
    .map((offer) => String(offer || "").trim())
    .filter(Boolean)
  const offersForDisplay = rotatingOffers.length > 0 ? rotatingOffers : ["Offers available"]
  const activeOfferText = offersForDisplay[highlightIndex % offersForDisplay.length]
  const offerIndicatorCount = Math.min(offersForDisplay.length, 5)
  const activeOfferIndicator = offerIndicatorCount > 0 ? highlightIndex % offerIndicatorCount : 0
  const primaryOffer = Array.isArray(restaurant?.offers) && restaurant.offers.length > 0
    ? restaurant.offers[0]
    : null
  const offerHeadline = primaryOffer?.title || restaurant?.offerText || activeOfferText
  const offerSubline =
    primaryOffer?.description ||
    primaryOffer?.subtitle ||
    (primaryOffer?.code ? `Use ${primaryOffer.code}` : "Tap to view all offers")

  // Auto-rotate images every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => {
        const offersLength = Array.isArray(restaurant?.offers) && restaurant.offers.length > 0
          ? restaurant.offers.length
          : 1
        return (prev + 1) % offersLength
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [restaurant?.offers?.length || 0])

  // Auto-rotate highlight offer text every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setHighlightIndex((prev) => (prev + 1) % highlightOffers.length)
    }, 2000)

    return () => clearInterval(interval)
  }, [highlightOffers.length])

  // Show loading state
  if (loadingRestaurant || loadingOffers) {
    return <RestaurantDetailSkeleton />
  }

  // Show error state if restaurant not found or network error
  if (restaurantError && !restaurant) {
    const isNetworkError = restaurantError.includes('Backend server is not connected')
    const isNotFoundError = restaurantError === 'Restaurant not found'

    return (
      <AnimatedPage>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className={`h-12 w-12 ${isNetworkError ? 'text-[#DC2626]' : 'text-red-500'}`} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                {isNetworkError ? 'Connection Error' : isNotFoundError ? 'Restaurant not found' : 'Error'}
              </h2>
              <p className="text-sm text-gray-600 mb-4 max-w-md">{restaurantError}</p>
              {isNetworkError && (
                <p className="text-xs text-gray-500 mb-4">
                  Make sure the backend server is running at {API_BASE_URL.replace('/api', '')}
                </p>
              )}
              <Button onClick={goBack} variant="outline">
                Go Back
              </Button>
            </div>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  // Show error if restaurant is still null
  if (!restaurant) {
    return (
      <AnimatedPage>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <span className="text-sm text-gray-600">Restaurant not found</span>
            <Button onClick={goBack} variant="outline">
              Go Back
            </Button>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  const availabilityStatus = getRestaurantAvailabilityStatus(restaurant, new Date(availabilityTick))
  const isRestaurantOffline = !availabilityStatus.isOpen
  const shouldShowGrayscale = isOutOfService || isRestaurantOffline

  if (showMoreInfo) {
    const ownerName = restaurant?.ownerName || "";
    const gstNumber = typeof restaurant?.gstNumber === "string" ? restaurant.gstNumber.trim() : "";
    const fssaiNumber = restaurant?.fssaiNumber || "";
    const address = restaurant?.location || "";
    const phone = restaurant?.phone || "";

    const maskGST = (gst) => {
      if (!gst) return "";
      const trimmed = gst.trim();
      if (trimmed.length < 15) return trimmed;
      return trimmed.substring(0, 2) + "X".repeat(10) + trimmed.substring(12);
    };

    const formatTimeLabel = (timeValue) => {
      if (!timeValue) return "";
      const parts = timeValue.split(":");
      if (parts.length < 2) return timeValue;
      let hour = parseInt(parts[0], 10);
      const minute = parseInt(parts[1], 10);
      if (isNaN(hour) || isNaN(minute)) return timeValue;
      const period = hour >= 12 ? "pm" : "am";
      const hour12 = hour % 12 || 12;
      const formattedMin = String(minute).padStart(2, "0");
      return `${hour12}:${formattedMin} ${period}`;
    };

    const getProvidesText = () => {
      const isDiningEnabled = restaurant?.diningSettings?.isEnabled === true;
      const isTakeawayEnabled = restaurant?.takeawaySettings?.isEnabled === true;

      const services = ["delivery"];
      if (isDiningEnabled) services.push("dining");
      if (isTakeawayEnabled) services.push("takeaway");

      if (services.length === 1) {
        return "Provides delivery";
      } else if (services.length === 2) {
        return `Provides both ${services[0]} & ${services[1]}`;
      } else {
        return `Provides ${services[0]}, ${services[1]} & ${services[2]}`;
      }
    };

    return (
      <AnimatedPage
        className="min-h-screen bg-gray-50 dark:bg-[#181818] flex flex-col transition-all duration-300"
      >
        {/* Header - Back arrow */}
        <div className="px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 pt-4 pb-4 bg-gray-50 dark:bg-[#181818]">
          <div className="max-w-xl mx-auto flex items-center">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-10 w-10 border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#242424]"
              onClick={() => setShowMoreInfo(false)}
            >
              <ArrowLeft className="h-5 w-5 text-gray-900 dark:text-white" />
            </Button>
          </div>
        </div>

        {/* Content Section */}
        <div className="flex-1 max-w-xl mx-auto w-full px-4 sm:px-6 pt-2 pb-12">
          {/* Card 1: Restaurant Info & Call Button & Timings */}
          <div className="bg-white dark:bg-[#242424] rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
              {restaurant?.name || "Restaurant Name"}
            </h1>

            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 pb-4 border-b border-gray-100 dark:border-gray-800 leading-relaxed">
              {address}
            </p>

            {phone && (
              <div className="pt-4 pb-4 flex items-center gap-3.5">
                <a
                  href={`tel:${phone}`}
                  className="inline-flex items-center justify-center h-12 w-12 rounded-full border border-red-200 bg-red-50 text-[#1F6B45] dark:bg-red-900/20 dark:border-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all duration-200 active:scale-95 shadow-sm shrink-0"
                  title={`Call ${restaurant?.name}`}
                >
                  <Phone className="h-5 w-5" />
                </a>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    Contact to restaurant
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    Contact restaurant directly for any inquiries, order updates, or support
                  </span>
                </div>
              </div>
            )}

            {/* Separator line & Timings / Provisions */}
            <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
              {/* Timing info */}
              <div className="flex items-center gap-2.5 text-sm">
                <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400 mt-0.5" />
                {availabilityStatus?.isOpen ? (
                  <div className="text-gray-700 dark:text-gray-300">
                    <span className="text-green-600 dark:text-green-500 font-semibold">Open now</span>
                    {availabilityStatus?.closingCountdownLabel && (
                      <span> • {availabilityStatus.closingCountdownLabel}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-700 dark:text-gray-300">
                    <span className="text-red-600 dark:text-red-500 font-semibold">Closed now</span>
                    {availabilityStatus?.openingTime && (
                      <span> • Opens at {formatTimeLabel(availabilityStatus.openingTime)}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Service info */}
              <div className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                <Store className="h-4 w-4 text-gray-500 dark:text-gray-400 mt-0.5" />
                <span>{getProvidesText()}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Legal Details Card */}
          <div className="bg-white dark:bg-[#242424] rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm mt-4 space-y-4">
            {/* Legal Name */}
            <div className="pb-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0 last:pb-0">
              <p className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">
                Legal Name
              </p>
              <p className="text-base font-semibold text-gray-900 dark:text-white mt-1">
                {ownerName || "Not Provided"}
              </p>
            </div>

            {/* GST Number - only if provided in onboarding */}
            {gstNumber && (
              <div className="pb-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0 last:pb-0">
                <p className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">
                  GST Number
                </p>
                <p className="text-base font-semibold text-gray-900 dark:text-white mt-1 tracking-wide">
                  {maskGST(gstNumber)}
                </p>
              </div>
            )}

            {/* FSSAI Lic No */}
            {fssaiNumber && (
              <div className="pt-1">
                <img
                  src={fssaiLogo}
                  alt="FSSAI"
                  loading="eager"
                  fetchPriority="high"
                  decoding="sync"
                  className="h-8 w-auto object-contain opacity-80"
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 font-medium">
                  Lic. No. {fssaiNumber}
                </p>
              </div>
            )}
          </div>

          {/* Go back to menu button */}
          <div className="mt-8">
            <button
              onClick={() => setShowMoreInfo(false)}
              className="w-full bg-[#1F6B45] hover:bg-[#1A5C3B] text-white py-3.5 rounded-xl font-bold text-base transition-all duration-200 active:scale-[0.98] shadow-md shadow-red-500/10 flex items-center justify-center"
            >
              Go back to menu
            </button>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage
      instant
      id="scrollingelement"
      className={`min-h-screen bg-white dark:bg-[#141414] flex flex-col ${shouldShowGrayscale ? 'grayscale opacity-75' : ''
        }`}
    >
      {/* Header - Back, Search, Menu (like reference image) */}
      <div className="px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 pt-3 md:pt-4 lg:pt-5 pb-2 md:pb-3 bg-white dark:bg-[#141414]">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Back Button */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full h-10 w-10 border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#242424] relative z-50 touch-manipulation"
            onClick={goBack}
          >
            <ArrowLeft className="h-5 w-5 text-gray-900 dark:text-white" />
          </Button>

          {/* Right side: Search pill + menu */}
          <div className="flex items-center gap-3">
            {!showSearch ? (
              <Button
                variant="outline"
                className="rounded-full h-10 px-4 border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#242424] flex items-center gap-2 text-gray-900 dark:text-white"
                onClick={() => setShowSearch(true)}
              >
                <Search className="h-4 w-4" />
                <span className="text-sm font-medium">Search</span>
              </Button>
            ) : (
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search for dishes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 rounded-full border border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#242424] text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1F6B45] focus:border-transparent"
                    autoFocus
                    onBlur={() => {
                      if (!searchQuery) {
                        setShowSearch(false)
                      }
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("")
                        setShowSearch(false)
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-10 w-10 border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#242424]"
              onClick={() => setShowMenuOptionsSheet(true)}
            >
              <MoreVertical className="h-5 w-5 text-gray-900 dark:text-white" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-white dark:bg-[#141414] rounded-t-3xl relative z-10 min-h-[40vh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-5 md:py-6 lg:py-8 space-y-3 md:space-y-4 lg:space-y-5 pb-0">
          {/* Restaurant Summary */}
          <div className="relative">
            <div className="relative rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#242424] shadow-[0_16px_40px_rgba(15,23,42,0.08)] p-4 sm:p-5 space-y-4 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#1F6B45] via-[#8a4b77] to-[#b36b8f]" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight break-words">
                    {restaurant?.name || "Unknown Restaurant"}
                  </h1>
                  <div className="mt-1 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <Utensils className="h-4 w-4" />
                    <span>{restaurant?.topCategory || restaurant?.cuisine || "Multi-cuisine"}</span>
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-sm bg-[#257d3c]">
                    <Star className="h-3 w-3 fill-white" />
                    {Number(restaurant?.rating || 0) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                  </div>
                  <span className="mt-1 text-xs text-gray-500 whitespace-nowrap text-center">
                    {Number(restaurant?.rating || 0) > 0 ? (
                      restaurant.reviews === 1
                        ? "1 rating"
                        : `${(restaurant.reviews || 0).toLocaleString()}${restaurant.reviews >= 100 ? '+' : ''} ratings`
                    ) : "No ratings yet"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 min-w-0"
                  onClick={() => setShowLocationSheet(true)}
                >
                  <MapPin className="h-4 w-4" />
                  <span className="truncate">
                    {restaurant?.distance ? `${restaurant.distance} | ` : ""}{restaurant?.location || "Location"}
                  </span>
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </button>
                <div
                  className={`inline-flex flex-col items-center justify-center rounded-xl px-2.5 py-1 text-[10px] font-bold text-white leading-tight shadow-sm ${isRestaurantOffline ? "bg-rose-600" : "bg-[#257d3c]"
                    }`}
                >
                  {isRestaurantOffline ? (
                    <span>Offline</span>
                  ) : (
                    <>
                      <span>Open</span>
                      <span>now</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300 flex-wrap">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>{restaurant?.deliveryTime || "25-30 mins"}</span>
                </div>
                {availabilityStatus?.isOpen && availabilityStatus?.closingCountdownLabel && (
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40 text-[11px] font-semibold">
                    <Timer className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2.5} />
                    <span>{availabilityStatus.closingCountdownLabel}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {isRestaurantOffline && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {restaurant?.name || "This restaurant"} is currently offline. Orders are unavailable right now.
            </div>
          )}



          {/* Offers strip — only shown when restaurant has dishes */}
          {(() => {
            // Determine if restaurant has any dishes (after menu loads)
            const totalDishCount = !loadingMenuItems && restaurant?.menuSections
              ? restaurant.menuSections.reduce((sum, s) => sum + (s.items?.length || 0), 0)
              : null // null = still loading / unknown
            const restaurantHasDishes = totalDishCount === null ? true : totalDishCount > 0

            if (!restaurantHasDishes) return null

            if (loadingOffers) return (
              // Skeleton placeholder - shows immediately while offers load
              <div className="flex items-center justify-between border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#242424] px-3.5 py-2.5 rounded-xl mb-3 shadow-sm">
                <div className="flex items-center gap-2 flex-1 mr-4">
                  <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
                  <div className="h-3.5 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                </div>
                <div className="h-3 w-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            )

            if (!coupons || coupons.length === 0) return null

            return (
              <div
                onClick={() => setShowOffersSheet(true)}
                className="flex items-center justify-between border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#242424] px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-all duration-200 mb-3 shadow-sm"
              >
                <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4">
                  <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                    <ScallopBadge className="h-6 w-6 text-[#2563EB]" />
                  </div>
                  <div className="flex-1 h-[20px] overflow-hidden relative min-w-0">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={`${coupons[currentCouponIndex]?.couponCode || currentCouponIndex}-${currentCouponIndex}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="absolute inset-x-0 top-0 bottom-0 text-xs font-semibold text-gray-800 dark:text-gray-200 truncate flex items-center"
                      >
                        {formatCouponStripText(coupons[currentCouponIndex])}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap pl-2 flex-shrink-0">
                  <span>{coupons.length} offer{coupons.length > 1 ? "s" : ""}</span>
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>
            )
          })()}

          {restaurantItemOffers.length > 0 && (
            <div className="mb-3">
              <RestaurantOffersStrip offers={restaurantItemOffers} />
            </div>
          )}

          {/* Filter/Category Buttons */}
          {restaurant?.menuSections && Array.isArray(restaurant.menuSections) && restaurant.menuSections.length > 0 && (
            <div className="border-y border-gray-200 py-3 -mx-4 px-4 overflow-x-auto scrollbar-hide">
              <div className="flex flex-col gap-2 w-max">
                <div className="flex items-center gap-2 w-max">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1.5 whitespace-nowrap border-gray-300 dark:border-gray-700 bg-white dark:bg-[#242424] relative"
                    onClick={() => setShowFilterSheet(true)}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-semibold">
                        {activeFilterCount}
                      </span>
                    )}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`flex items-center gap-1.5 whitespace-nowrap border-gray-300 dark:border-gray-700 bg-white dark:bg-[#242424] dark:text-white rounded-full ${filters.vegNonVeg === "veg" ? "border-green-600 bg-green-50 text-green-700 font-bold dark:border-green-500 dark:bg-green-900/20 dark:text-green-400" : ""
                      }`}
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg",
                      }))
                    }
                  >
                    <div className="h-3 w-3 rounded-full bg-green-600" />
                    Veg
                    {filters.vegNonVeg === "veg" && (
                      <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                    )}
                  </Button>
                  {!vegMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={`flex items-center gap-1.5 whitespace-nowrap border-gray-300 dark:border-gray-700 bg-white dark:bg-[#242424] dark:text-white rounded-full ${filters.vegNonVeg === "non-veg" ? "border-red-600 bg-red-50 text-red-600 dark:border-red-500 dark:bg-red-900/20 dark:text-red-400" : ""
                      }`}
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg",
                      }))
                    }
                  >
                    <div className="h-3 w-3 rounded-full bg-red-600" />
                    Non-veg
                    {filters.vegNonVeg === "non-veg" && (
                      <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                    )}
                  </Button>
                  )}
                </div>

                {menuCategories.length > 0 && (
                  <div className="flex items-center gap-2 w-max">
                    <button
                      type="button"
                      onClick={() => setSelectedMenuCategory("all")}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${selectedMenuCategory === "all"
                          ? "border-[#1F6B45] bg-[#1F6B4515] text-[#1F6B45]"
                          : "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#242424] text-gray-700 dark:text-gray-300"
                        }`}
                    >
                      All
                    </button>
                    {menuCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setSelectedMenuCategory(category.id)}
                        className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${selectedMenuCategory === category.id
                            ? "border-[#1F6B45] bg-[#1F6B4515] text-[#1F6B45]"
                            : "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#242424] text-gray-700 dark:text-gray-300"
                          }`}
                      >
                        {category.image ? (
                          <img
                            src={category.image}
                            alt={category.name}
                            className="h-6 w-6 rounded-full object-cover border border-white/70 shadow-sm"
                            onError={(event) => {
                              event.currentTarget.style.display = "none"
                            }}
                          />
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold uppercase text-gray-500">
                            {category.name?.charAt(0) || "C"}
                          </span>
                        )}
                        {category.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Menu Items Section */}
        {restaurant && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-6 sm:py-8 md:py-10 lg:py-12 space-y-6 md:space-y-8 lg:space-y-10">
            {filteredSections.length === 0 && hasUserAppliedFilters && (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-[#242424] px-5 py-8 text-center">
                <p className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
                  No dishes match the selected filters.
                </p>
                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Clear filters or try a different combination.
                </p>
              </div>
            )}
            {filteredSections.length === 0 && !hasUserAppliedFilters && !loadingMenuItems && (() => {
              // Check if the raw menu has any dishes at all (before veg filtering)
              const rawSections = restaurant?.menuSections || [];
              const rawHasAnyDish = rawSections.some(s =>
                (Array.isArray(s?.items) && s.items.length > 0) ||
                (Array.isArray(s?.subsections) && s.subsections.some(sub => Array.isArray(sub?.items) && sub.items.length > 0))
              );
              const showNoVegMessage = vegMode && rawHasAnyDish;

              return (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <div className="bg-gray-100 dark:bg-gray-800/50 p-6 rounded-full mb-6">
                    <Utensils className="h-12 w-12 text-gray-400" />
                  </div>
                  {showNoVegMessage ? (
                    <>
                      <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-2">No Veg Dishes Available</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                        {restaurant?.name || "This restaurant"} doesn't have any veg dishes on their menu right now.
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Menu Coming Soon</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                        {restaurant?.name || "This restaurant"} is still setting up their menu. We'll notify you as soon as their delicious dishes are available!
                      </p>
                    </>
                  )}
                </div>
              );
            })()}

            {(() => {
              let overallItemCount = 0
              return filteredSections.map(({ section, originalIndex }, sectionIndex) => {
                // Handle section name - check for valid non-empty string
                const isRecommended = isRecommendedSection(section)
                const sectionId = `menu-section-${originalIndex}`
                const sectionItems = toRenderableArray(section?.items)
                const sectionSubsections = toRenderableArray(section?.subsections)

                const totalItemsInThisSection = sectionItems.length + sectionSubsections.reduce((sum, sub) => sum + toRenderableArray(sub?.items).length, 0)
                const sectionStartIdx = overallItemCount
                const hasPriorityItems = sectionStartIdx < 5

                if (!hasPriorityItems && !loadRemaining) {
                  overallItemCount += totalItemsInThisSection
                  return null
                }

                const isExpanded = expandedSections.has(originalIndex)

                return (
                  <div key={sectionIndex} id={sectionId} className="space-y-1 scroll-mt-20">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                          {(section?.name && typeof section.name === 'string' && section.name.trim())
                            ? section.name.trim()
                            : (section?.title && typeof section.title === 'string' && section.title.trim())
                              ? section.title.trim()
                              : "Unnamed Section"}
                        </h2>
                        {section.subtitle && (
                          <button className="text-sm text-blue-600 dark:text-blue-400 underline">
                            {section.subtitle}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedSections(prev => {
                            const newSet = new Set(prev)
                            if (newSet.has(originalIndex)) {
                              newSet.delete(originalIndex)
                            } else {
                              newSet.add(originalIndex)
                            }
                            return newSet
                          })
                        }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                      >
                        <ChevronDown
                          className={`h-5 w-5 text-gray-600 dark:text-gray-400 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'
                            }`}
                        />
                      </button>
                    </div>

                    {/* Direct Items */}
                    {isExpanded && isRecommended && !loadingMenuItems && sectionItems.length === 0 && (
                      <div className="text-center py-8">
                        <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">
                          No dish recommended
                        </p>
                      </div>
                    )}
                    {isExpanded && loadingMenuItems && (
                      <div className="space-y-3 px-1 py-2 animate-pulse">
                        <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
                        <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
                      </div>
                    )}
                    {isExpanded && sectionItems.length > 0 && (
                      <div className="space-y-0">
                        {sectionItems.map((item) => {
                          const quantity = getDishQuantity(item)
                          // Determine veg/non-veg based on foodType and classification
                          const isVeg = isVegMenuItem(item, restaurant)
                          const currentItemIndex = overallItemCount++
                          const isPriority = currentItemIndex < 5 || loadRemaining

                          if (!isPriority) return null

                          // Debug: Log preparationTime for troubleshooting
                          if (item.preparationTime) {
                            debugLog(`[FRONTEND] Item "${item.name}" preparationTime:`, item.preparationTime, 'Type:', typeof item.preparationTime)
                          }

                          return (
                            <div
                              key={item.id}
                              ref={(node) => {
                                if (node) {
                                  dishCardRefs.current[item.id] = node
                                } else {
                                  delete dishCardRefs.current[item.id]
                                }
                              }}
                              className={`flex gap-4 p-4 ${highlightedDishId === item.id && isRecommended ? "border-b-transparent" : "border-b border-gray-100 dark:border-gray-800 last:border-none"} relative transition-all duration-300 ${highlightedDishId === item.id && isRecommended ? "bg-[#1F6B4505] dark:bg-[#1F6B4510] rounded-2xl" : ""}`}
                            >
                              {/* Vibrant Red Background Gradient Highlight - Recommended Section Only */}
                              <AnimatePresence>
                                {highlightedDishId === item.id && isRecommended && (
                                  <>
                                    <motion.div
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      exit={{ opacity: 0 }}
                                      transition={{ duration: 0.4 }}
                                      className="absolute inset-0 bg-red-500/5 dark:bg-red-500/10 rounded-2xl -z-10 overflow-hidden"
                                    >
                                      <motion.div
                                        initial={{ x: "-40%" }}
                                        animate={{ x: "100%" }}
                                        transition={{
                                          duration: 2.5,
                                          ease: "easeInOut"
                                        }}
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-red-500/40 to-transparent"
                                      />
                                    </motion.div>
                                    {/* Redish Glow Outline */}
                                    <motion.div
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      exit={{ opacity: 0 }}
                                      className="absolute -inset-[1.5px] rounded-2xl border-2 border-red-600/80 pointer-events-none -z-10 shadow-[0_0_20px_rgba(220,38,38,0.3)]"
                                    />
                                    <motion.div
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: [0, 0.1, 0] }}
                                      exit={{ opacity: 0 }}
                                      transition={{ duration: 4, times: [0, 0.5, 1] }}
                                      className="absolute inset-0 bg-[#1F6B45]/10 rounded-2xl pointer-events-none"
                                    />
                                  </>
                                )}
                              </AnimatePresence>


                              {/* Left Side - Details */}
                              <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-gray-800 dark:text-white text-lg leading-tight flex items-start gap-2">
                                  {isVeg ? (
                                    <div className="w-4 h-4 border-2 border-[#15803D] flex items-center justify-center rounded-sm flex-shrink-0 p-[2px] mt-1">
                                      <div className="w-full h-full bg-[#15803D] rounded-full"></div>
                                    </div>
                                  ) : (
                                    <div className="w-4 h-4 border-2 border-red-600 flex items-center justify-center rounded-sm flex-shrink-0 p-[2px] mt-1">
                                      <div className="w-full h-full bg-red-600 rounded-full"></div>
                                    </div>
                                  )}
                                  <span className="min-w-0">{item.name}</span>
                                </h3>

                                {/* Highly Reordered Progress Bar - Removed static version */}

                                <div className="flex flex-col gap-0.5 mt-1">
                                  {hasFoodVariants(item) && (
                                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Starting from</p>
                                  )}
                                  <div className="flex items-center gap-3">
                                    <p className="font-semibold text-gray-900 dark:text-white">
                                      ₹{Math.round(getFoodDisplayPrice(item))}
                                    </p>
                                    <ItemOfferBadge offers={offersForItem(item.id)} />
                                    {/* Preparation Time - Show if available */}
                                    {item.preparationTime && String(item.preparationTime).trim() && (
                                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                                        <Clock size={12} className="text-gray-500" />
                                        <span>{String(item.preparationTime).trim()}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Description - Show if available */}
                                {item.description && (
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                                )}

                                {/* Mobile-only action buttons */}
                                <div className="flex gap-4 mt-3 md:hidden">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      handleBookmarkClick(item)
                                    }}
                                    className={`p-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${isDishFavorite(item.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)
                                      ? "border-red-500 text-red-500 bg-red-50 dark:bg-red-900/20"
                                      : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                                      }`}
                                  >
                                    <Bookmark
                                      size={18}
                                      className={isDishFavorite(item.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id) ? "fill-red-500" : ""}
                                    />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      handleShareClick(item)
                                    }}
                                    className="p-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                  >
                                    <Share2 size={18} />
                                  </button>
                                </div>

                              </div>

                              {/* Right Side - Image and Add Button */}
                              <div className="relative w-32 h-32 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => handleItemClick(item, e)}
                                  className="w-full h-full rounded-2xl overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F6B45]"
                                  aria-label={`View ${item.name} details`}
                                >
                                   <OptimizedImage
                                     src={item.image}
                                     alt={item.name}
                                     priority={isPriority}
                                     className="w-full h-full object-cover rounded-2xl shadow-sm"
                                     fallbackImage={FOOD_IMAGE_FALLBACK}
                                   />
                                </button>
                                {quantity > 0 ? (
                                  <div
                                    className={`absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white border border-[#1F6B45] text-[#1F6B45] font-bold px-4 py-1.5 rounded-lg shadow-md flex items-center gap-1 ${shouldShowGrayscale
                                      ? 'bg-gray-50 border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                      : 'hover:bg-[#FFF5F5]'
                                      }`}
                                  >
                                    {(
                                      <>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (shouldShowGrayscale) return
                                            const sole = getSoleActiveVariant(item)
                                            if (hasFoodVariants(item) && !sole) {
                                              handleItemClick(item)
                                            } else {
                                              updateItemQuantity(item, Math.max(0, quantity - 1), e, sole)
                                            }
                                          }}
                                          disabled={shouldShowGrayscale}
                                          className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-[#1F6B45] hover:text-[#14512F]'}
                                        >
                                          <Minus size={14} />
                                        </button>
                                        <span className={`mx-2 text-sm ${shouldShowGrayscale ? 'text-gray-400' : 'text-[#1F6B45]'}`}>{quantity}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (shouldShowGrayscale) return
                                            const sole = getSoleActiveVariant(item)
                                            if (hasFoodVariants(item) && !sole) {
                                              handleItemClick(item)
                                            } else {
                                              updateItemQuantity(item, quantity + 1, e, sole)
                                            }
                                          }}
                                          disabled={shouldShowGrayscale}
                                          className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-[#1F6B45] hover:text-[#14512F]'}
                                        >
                                          <Plus size={14} className="stroke-[3px]" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (!shouldShowGrayscale) {
                                          const sole = getSoleActiveVariant(item)
                                          if (hasFoodVariants(item) && !sole) {
                                            handleItemClick(item, e)
                                          } else {
                                            updateItemQuantity(item, 1, e, sole || getDefaultFoodVariant(item))
                                          }
                                        }
                                      }}
                                      disabled={shouldShowGrayscale}
                                      className={`absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white border border-[#1F6B45] text-[#1F6B45] font-bold px-6 py-1.5 rounded-lg shadow-md flex items-center gap-1 transition-all ${shouldShowGrayscale
                                        ? 'bg-gray-50 border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                        : 'hover:bg-[#FFF5F5] hover:scale-105 active:scale-95'
                                        }`}
                                    >
                                      ADD <Plus size={14} className="stroke-[3px]" />
                                    </button>
                                    {hasFoodVariants(item) && !getSoleActiveVariant(item) && (
                                      <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 tracking-tight whitespace-nowrap mt-0.5 select-none text-center block">
                                        customisable
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Subsections */}
                    {isExpanded && sectionSubsections.length > 0 && (
                      <div className="space-y-4">
                        {sectionSubsections.map((subsection, subIndex) => {
                          const subsectionKey = `${originalIndex}-${subIndex}`
                          const isSubsectionExpanded = expandedSections.has(subsectionKey)
                          const subsectionItems = toRenderableArray(subsection?.items)

                          return (
                            <div key={subIndex} className="space-y-4">
                              {/* Subsection Header */}
                              <div className="flex items-center justify-between">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                  {subsection?.name || subsection?.title || "Subsection"}
                                </h3>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setExpandedSections(prev => {
                                      const newSet = new Set(prev)
                                      if (newSet.has(subsectionKey)) {
                                        newSet.delete(subsectionKey)
                                      } else {
                                        newSet.add(subsectionKey)
                                      }
                                      return newSet
                                    })
                                  }}
                                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                                >
                                  <ChevronDown
                                    className={`h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isSubsectionExpanded ? '' : '-rotate-90'
                                      }`}
                                  />
                                </button>
                              </div>

                              {/* Subsection Items */}
                              {isSubsectionExpanded && subsectionItems.length > 0 && (
                                <div className="space-y-0">
                                  {subsectionItems.map((item) => {
                                    const quantity = getDishQuantity(item)
                                    // Determine veg/non-veg based on foodType and classification
                                    const isVeg = isVegMenuItem(item, restaurant)
                                    const currentItemIndex = overallItemCount++
                                    const isPriority = currentItemIndex < 5 || loadRemaining

                                    if (!isPriority) return null

                                    // Debug: Log preparationTime for troubleshooting
                                    if (item.preparationTime) {
                                      debugLog(`[FRONTEND] Subsection item "${item.name}" preparationTime:`, item.preparationTime)
                                    }

                                    return (
                                      <div
                                        key={item.id}
                                        ref={(node) => {
                                          if (node) {
                                            dishCardRefs.current[item.id] = node
                                          } else {
                                            delete dishCardRefs.current[item.id]
                                          }
                                        }}
                                        className={`flex gap-4 p-4 border-b border-gray-100 dark:border-gray-800 last:border-none relative transition-all duration-300 ${highlightedDishId === item.id ? "bg-[#1F6B4505] ring-2 ring-[#1F6B45] ring-inset dark:bg-[#1F6B4510] rounded-2xl" : ""}`}
                                      >
                                        {/* Left Side - Details */}
                                        <div className="flex-1 min-w-0">
                                          <h3 className="font-bold text-gray-800 dark:text-white text-lg leading-tight flex items-start gap-2">
                                            {isVeg ? (
                                              <div className="w-4 h-4 border-2 border-[#15803D] flex items-center justify-center rounded-sm flex-shrink-0 p-[2px] mt-1">
                                                <div className="w-full h-full bg-[#15803D] rounded-full"></div>
                                              </div>
                                            ) : (
                                              <div className="w-4 h-4 border-2 border-red-600 flex items-center justify-center rounded-sm flex-shrink-0 p-[2px] mt-1">
                                                <div className="w-full h-full bg-red-600 rounded-full"></div>
                                              </div>
                                            )}
                                            <span className="min-w-0">{item.name}</span>
                                          </h3>

                                          {/* Highly Reordered Progress Bar - Removed static version */}

                                          <div className="flex flex-col gap-0.5 mt-1">
                                            {hasFoodVariants(item) && (
                                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Starting from</p>
                                            )}
                                            <div className="flex items-center gap-3">
                                              <p className="font-semibold text-gray-900 dark:text-white">
                                                ₹{Math.round(getFoodDisplayPrice(item))}
                                              </p>
                                              <ItemOfferBadge offers={offersForItem(item.id)} />
                                              {/* Preparation Time - Show if available */}
                                              {item.preparationTime && String(item.preparationTime).trim() && (
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                                                  <Clock size={12} className="text-gray-500" />
                                                  <span>{String(item.preparationTime).trim()}</span>
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {/* Description - Show if available */}
                                          {item.description && (
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                                          )}

                                          {/* Mobile-only action buttons */}
                                          <div className="flex gap-4 mt-3 md:hidden">
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                handleBookmarkClick(item)
                                              }}
                                              className={`p-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${isDishFavorite(item.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)
                                                ? "border-red-500 text-red-500 bg-red-50 dark:bg-red-900/20"
                                                : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                                                }`}
                                            >
                                              <Bookmark
                                                size={18}
                                                className={isDishFavorite(item.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id) ? "fill-red-500" : ""}
                                              />
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                handleShareClick(item)
                                              }}
                                              className="p-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                            >
                                              <Share2 size={18} />
                                            </button>
                                          </div>

                                        </div>

                                        {/* Right Side - Image and Add Button */}
                                        <div className="relative w-32 h-32 flex-shrink-0">
                                          <button
                                            type="button"
                                            onClick={(e) => handleItemClick(item, e)}
                                            className="w-full h-full rounded-2xl overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F6B45]"
                                            aria-label={`View ${item.name} details`}
                                          >
                                            <OptimizedImage
                                              src={item.image}
                                              alt={item.name}
                                              priority={isPriority}
                                              className="w-full h-full object-cover rounded-2xl shadow-sm"
                                              fallbackImage={FOOD_IMAGE_FALLBACK}
                                            />
                                          </button>
                                          {quantity > 0 ? (
                                            <motion.div
                                              initial={{ opacity: 0, scale: 0.8 }}
                                              animate={{ opacity: 1, scale: 1 }}
                                              className={`absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white border font-bold px-4 py-1.5 rounded-lg shadow-md flex items-center gap-1 ${shouldShowGrayscale
                                                ? 'border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                                : 'border-[#1F6B45] text-[#1F6B45] hover:bg-[#1F6B4505]'
                                                }`}
                                            >
                                              {(
                                                <>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation()
                                                      if (shouldShowGrayscale) return
                                                      const sole = getSoleActiveVariant(item)
                                                      if (hasFoodVariants(item) && !sole) {
                                                        handleItemClick(item)
                                                      } else {
                                                        updateItemQuantity(item, Math.max(0, quantity - 1), e, sole)
                                                      }
                                                    }}
                                                    disabled={shouldShowGrayscale}
                                                    className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-[#1F6B45] hover:text-[#14512F]'}
                                                  >
                                                    <Minus size={14} />
                                                  </button>
                                                  <span className={`mx-2 text-sm ${shouldShowGrayscale ? 'text-gray-400' : ''}`}>{quantity}</span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation()
                                                      if (shouldShowGrayscale) return
                                                      const sole = getSoleActiveVariant(item)
                                                      if (hasFoodVariants(item) && !sole) {
                                                        handleItemClick(item)
                                                      } else {
                                                        updateItemQuantity(item, quantity + 1, e, sole)
                                                      }
                                                    }}
                                                    disabled={shouldShowGrayscale}
                                                    className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-[#1F6B45] hover:text-[#14512F]'}
                                                  >
                                                    <Plus size={14} className="stroke-[3px]" />
                                                  </button>
                                                </>
                                              )}
                                            </motion.div>
                                          ) : (
                                            <>
                                              <motion.button
                                              layoutId={`add-button-sub-${item.id}`}
                                              initial={{ opacity: 0, scale: 0.9 }}
                                              animate={{ opacity: 1, scale: 1 }}
                                              transition={{ duration: 0.3, type: "spring", damping: 20, stiffness: 300 }}
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                if (!shouldShowGrayscale) {
                                                  const sole = getSoleActiveVariant(item)
                                                  if (hasFoodVariants(item) && !sole) {
                                                    handleItemClick(item, e)
                                                  } else {
                                                    updateItemQuantity(item, 1, e, sole || getDefaultFoodVariant(item))
                                                  }
                                                }
                                              }}
                                              disabled={shouldShowGrayscale}
                                              className={`absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white border border-[#1F6B45] text-[#1F6B45] font-bold px-6 py-1.5 rounded-lg shadow-md flex items-center gap-1 transition-all ${shouldShowGrayscale
                                                ? 'bg-gray-50 border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                                : 'hover:bg-[#FFF5F5] hover:scale-105 active:scale-95'
                                                }`}
                                            >
                                              ADD <Plus size={14} className="stroke-[3px]" />
                                            </motion.button>
                                            {hasFoodVariants(item) && !getSoleActiveVariant(item) && (
                                              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 tracking-tight whitespace-nowrap mt-0.5 select-none text-center block">
                                                customisable
                                              </span>
                                            )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>

      {/* FSSAI License Information - Bottom of page */}
      {restaurant?.onboarding?.step3?.fssai?.registrationNumber && (
        <div className="px-4 py-4 mt-2 mb-24 border-t border-dashed border-gray-200 dark:border-gray-800 bg-gray-50/30 dark:bg-white/5 mx-4 rounded-xl">
          <div className="flex items-center gap-4">
            <div className="h-12 w-20 flex items-center justify-center bg-white rounded-lg p-1.5 shadow-sm border border-gray-100">
              <img
                src={fssaiLogo}
                alt="FSSAI"
                className="h-full w-auto object-contain"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest font-bold mb-1">
                License No.
              </p>
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 font-mono tracking-wide">
                {restaurant?.onboarding?.step3?.fssai?.registrationNumber}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Floating Menu Button - Rendered via Portal, pinned bottom-centre.
          It used to be draggable (framer-motion `drag`), which let it wander
          anywhere on screen and never settle in one place. It now stays fixed
          just above the cart bar, centred, so it is always where the user
          expects it. */}
      {typeof window !== "undefined" && !showFilterSheet && !showMenuSheet && !showMenuOptionsSheet && restaurant && filteredSections.length > 0 &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: itemCount > 0 ? 150 : 80,
              backfaceVisibility: 'hidden',
              WebkitFontSmoothing: 'antialiased',
              zIndex: 9998
            }}
            className="pointer-events-auto"
          >
            <Button
              ref={menuButtonRef}
              className="bg-[#5a5e66] hover:bg-[#4a4e56] text-white flex items-center gap-2.5 shadow-lg border border-white/10 px-6 py-3 h-auto rounded-[22px] active:scale-95 transition-all group"
              size="lg"
              onClick={() => setShowMenuSheet(true)}
            >
              <Utensils className="h-5 w-5 text-white group-hover:scale-110 transition-transform" />
              <span className="text-[17px] font-medium antialiased tracking-wide">Menu</span>
            </Button>
          </div>,
          document.body
        )
      }

      {/* Menu Categories Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowMenuSheet(false)}
                />

                {/* Menu Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#242424] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[85vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-6">
                    <div className="space-y-1">
                      {menuCategories.map((category, index) => (
                        <button
                          key={index}
                          className="w-full flex items-center justify-between py-3 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                          onClick={() => {
                            setShowMenuSheet(false)
                            // Scroll to category section
                            setTimeout(() => {
                              const sectionId = `menu-section-${category.sectionIndex}`
                              const sectionElement = document.getElementById(sectionId)
                              if (sectionElement) {
                                sectionElement.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start'
                                })
                              }
                            }, 300) // Small delay to allow sheet to close
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {category.image ? (
                              <img
                                src={category.image}
                                alt={category.name}
                                className="h-10 w-10 rounded-xl object-cover border border-gray-200"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none"
                                }}
                              />
                            ) : (
                              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold uppercase text-gray-500">
                                {category.name?.charAt(0) || "C"}
                              </span>
                            )}
                            <span className="text-base font-medium text-gray-900 dark:text-white truncate">
                              {category.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {category.count}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Close Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#242424]">
                    <Button
                      className="w-full bg-[#1F6B45] hover:bg-[#14512F] text-white border-0 flex items-center justify-center gap-2 py-6 rounded-xl font-bold transition-all shadow-lg text-sm"
                      onClick={() => setShowMenuSheet(false)}
                    >
                      <X className="h-4 w-4" />
                      Close
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Filters and Sorting Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showFilterSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowFilterSheet(false)}
                />

                {/* Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#242424] rounded-t-3xl md:rounded-3xl shadow-2xl h-[80vh] md:h-auto md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header with X button */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters and Sorting</h2>
                    <button
                      onClick={() => setShowFilterSheet(false)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                    >
                      <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                    {/* Sort by */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Sort by:</h3>
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "low-to-high" ? null : "low-to-high",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "low-to-high"
                            ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - low to high
                        </button>
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "high-to-low" ? null : "high-to-low",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "high-to-low"
                            ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - high to low
                        </button>
                      </div>
                    </div>

                    {/* Veg/Non-veg preference */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Veg/Non-veg preference:</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg",
                            }))
                          }
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "veg"
                            ? "border-green-600 dark:border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          <div className="h-4 w-4 rounded-full bg-green-600 dark:bg-green-500" />
                          <span className="font-medium">Veg</span>
                        </button>
                        {!vegMode && (
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg",
                            }))
                          }
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "non-veg"
                            ? "border-red-600 dark:border-red-600 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-gray-300"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          <div className="h-4 w-4 rounded-full bg-red-600" />
                          <span className="font-medium">Non-veg</span>
                        </button>
                        )}
                      </div>
                    </div>

                    {/* Top picks */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Top picks:</h3>
                      <button
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            highlyReordered: !prev.highlyReordered,
                          }))
                        }
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all w-full ${filters.highlyReordered
                          ? "border-[#1F6B45] dark:border-[#1F6B45] bg-[#F9F9FB] dark:bg-[#1F6B45]/20 text-[#1F6B45] dark:text-[#1F6B45]"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                      >
                        <RotateCcw className="h-4 w-4" />
                        <span className="font-medium">Highly reordered</span>
                      </button>
                    </div>

                    {/* Dietary preference */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Dietary preference:</h3>
                      <button
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            spicy: !prev.spicy,
                          }))
                        }
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all w-full ${filters.spicy
                          ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                      >
                        <Flame className="h-4 w-4" />
                        <span className="font-medium">Spicy</span>
                      </button>
                    </div>
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between bg-white dark:bg-[#242424]">
                    <button
                      onClick={() => {
                        setFilters({
                          sortBy: null,
                          vegNonVeg: null,
                          highlyReordered: false,
                          spicy: false,
                        })
                      }}
                      className="text-red-600 dark:text-red-400 font-medium text-sm hover:text-red-700 dark:hover:text-red-500"
                    >
                      Clear All
                    </button>
                    <Button
                      className="bg-[#1F6B45] hover:bg-[#14512F] text-white px-6 py-2.5 rounded-lg font-bold"
                      onClick={() => setShowFilterSheet(false)}
                    >
                      Apply {activeFilterCount > 0 && `(${activeFilterCount})`}
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Location Outlets Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showLocationSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowLocationSheet(false)}
                />

                {/* Centered Modal */}
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10000] bg-white dark:bg-[#242424] rounded-3xl shadow-2xl w-[88vw] max-w-sm flex flex-col max-h-[80vh]"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.18, type: "spring", damping: 25, stiffness: 400 }}
                >
                  {/* Header */}
                  <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{restaurant?.name || "Unknown Restaurant"}</h2>
                    <button
                      onClick={() => setShowLocationSheet(false)}
                      className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Outlets List */}
                  <div className="flex-1 overflow-y-auto px-4 pb-4">
                    {restaurant?.outlets && Array.isArray(restaurant.outlets) && restaurant.outlets.length > 0 ? (
                      <div className="space-y-2">
                        {restaurant.outlets.map((outlet) => (
                          <div
                            key={outlet?.id || Math.random()}
                            className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a]"
                          >
                            {outlet?.isNearest && (
                              <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-[#F9F9FB] dark:bg-[#1F6B45]/20 rounded-md">
                                <Zap className="h-3.5 w-3.5 text-[#1F6B45] dark:text-[#1F6B45] fill-[#1F6B45] dark:fill-[#1F6B45]" />
                                <span className="text-xs font-semibold text-[#1F6B45] dark:text-[#1F6B45]">
                                  Nearest available outlet
                                </span>
                              </div>
                            )}
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                              {outlet?.location || "Location"}
                            </h3>
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  <span>{outlet?.deliveryTime || "25-30 mins"}</span>
                                </div>
                                {outlet?.distance && (
                                  <div className="flex items-center gap-1">
                                    <MapPin className="h-3.5 w-3.5" />
                                    <span>{outlet.distance}</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1">
                                  <Star className="h-3.5 w-3.5 text-[#8CC63F] dark:text-green-500 fill-[#8CC63F] dark:fill-green-500" />
                                  <span className="text-xs font-medium text-gray-900 dark:text-white">
                                    {outlet?.rating ? outlet.rating : "NEW"}
                                  </span>
                                </div>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {(outlet?.reviews || 0) === 1 ? "1 rating" : (outlet?.reviews || 0) < 100
                                    ? `${outlet?.reviews || 0} ratings`
                                    : (outlet?.reviews || 0) < 1000
                                      ? `${Math.floor((outlet?.reviews || 0) / 100) * 100}+ ratings`
                                      : `${((outlet?.reviews || 0) / 1000).toFixed(1)}K+ ratings`}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="pt-1 pb-3">
                        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Restaurant Address</p>
                        <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-[#2a2a2a] border border-gray-100 dark:border-gray-700">
                          <MapPin className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            {restaurant?.location || "Address not available"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  {restaurant?.outlets && Array.isArray(restaurant.outlets) && restaurant.outlets.length > 5 && (
                    <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 bg-white dark:bg-[#242424]">
                      <button className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400 font-medium text-sm w-full">
                        <span>See all {restaurant.outlets.length} outlets</span>
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
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
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#242424] rounded-t-3xl md:rounded-3xl shadow-2xl md:max-w-lg w-full md:w-auto"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Manage Collections</h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 dark:bg-gray-600 flex items-center justify-center hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2">
                    {/* Bookmarks Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        // Don't close modal on click, let checkbox handle it
                      }}
                    >
                      <div className="h-12 w-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 dark:text-red-400 fill-red-500 dark:fill-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900 dark:text-white">Bookmarks</span>
                          {selectedItem && (
                            <Checkbox
                              checked={isDishFavorite(selectedItem.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)}
                              onCheckedChange={(checked) => {
                                if (!checked && selectedItem) {
                                  const restaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id
                                  removeDishFavorite(selectedItem.id, restaurantId)
                                  setShowManageCollections(false)
                                }
                              }}
                              className="h-5 w-5 rounded border-2 border-green-500 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          {!selectedItem && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {getDishFavorites().length} dishes � {getFavorites().length} restaurant
                        </p>
                      </div>
                    </button>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}
                    >
                      <div className="h-12 w-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500 dark:text-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900 dark:text-white">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4">
                    <Button
                      className="w-full bg-[#1F6B45] hover:bg-[#14512F] text-white py-3 rounded-lg font-bold"
                      onClick={() => {
                        setShowManageCollections(false)
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Item Detail Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showItemDetail && selectedItem && (
              <motion.div
                className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                onClick={closeItemDetail}
              >
                {/* Item Detail Modal */}
                <motion.div
                  className="relative bg-white dark:bg-[#242424] rounded-3xl shadow-2xl max-h-[90vh] w-full max-w-[450px] md:max-w-2xl flex flex-col overflow-hidden"
                  initial={{ opacity: 0, scale: 0.97, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 12 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Inside Top Right */}
                  <button
                    onClick={closeItemDetail}
                    className="absolute top-4 right-4 z-[10001] h-8 w-8 rounded-full bg-gray-900/90 shadow-md flex items-center justify-center hover:bg-black transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>

                  {/* Image Section — uses the same cached URL as the list thumb for instant paint */}
                  <div className="relative w-full h-64 overflow-hidden rounded-t-3xl bg-gray-100 dark:bg-gray-800">
                    <SafeImage
                      src={selectedItem.displayImage || selectedItem.image}
                      fallbackSrc={FOOD_IMAGE_FALLBACK}
                      alt={selectedItem.name}
                      className="w-full h-full object-cover"
                      decoding="sync"
                      loading="eager"
                      fetchPriority="high"
                    />
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Item Name and Indicator */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-1">
                        <div className={`h-5 w-5 rounded border-2 ${isVegMenuItem(selectedItem, restaurant) ? "border-[#15803D] bg-green-50" : "border-red-600 bg-red-50"} dark:border-gray-600 dark:bg-[#2e2e2e]/30 flex items-center justify-center flex-shrink-0`}>
                          <div className={`h-2.5 w-2.5 rounded-full ${isVegMenuItem(selectedItem, restaurant) ? "bg-[#15803D]" : "bg-red-600"}`} />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                          {selectedItem.name}
                        </h2>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                      {selectedItem.description}
                    </p>

                    {/* Highly Reordered Progress Bar - Removed static version */}

                    {/* Not Eligible for Coupons */}
                    {selectedItem.notEligibleForCoupons && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-4">
                        NOT ELIGIBLE FOR COUPONS
                      </p>
                    )}

                    {hasFoodVariants(selectedItem) && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2.5">
                          <div>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">Quantity</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Select any 1 option</p>
                          </div>
                          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2.5 py-0.5 rounded-full border border-red-200/60 dark:border-red-800/40">
                            Required
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          {getFoodVariants(selectedItem).map((variant) => {
                            const vId = variant.id || variant._id
                            const isSelected = String(selectedVariantId || "") === String(vId)
                            return (
                              <button
                                key={vId}
                                type="button"
                                onClick={() => {
                                  setSelectedVariantId(vId)
                                  const lineId = getLineItemIdForDish(selectedItem, variant)
                                  const qtyInCart = quantities[lineId] || 0
                                  setItemDetailQuantity(qtyInCart > 0 ? qtyInCart : 1)
                                }}
                                className={`w-full flex items-center justify-between p-3.5 sm:p-4 rounded-2xl border transition-all text-left cursor-pointer ${
                                  isSelected
                                    ? "border-red-500 bg-red-50/50 dark:border-red-500/70 dark:bg-red-950/20 shadow-sm ring-1 ring-red-500/20"
                                    : "border-gray-200 dark:border-gray-700/80 bg-white dark:bg-[#1e1e1e] hover:border-gray-300 dark:hover:border-gray-600"
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                                      isSelected
                                        ? "border-red-500 bg-white dark:bg-[#1e1e1e]"
                                        : "border-gray-400 dark:border-gray-500"
                                    }`}
                                  >
                                    {isSelected && (
                                      <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                    )}
                                  </div>
                                  <span
                                    className={`text-sm sm:text-base ${
                                      isSelected
                                        ? "font-bold text-gray-900 dark:text-white"
                                        : "font-semibold text-gray-700 dark:text-gray-300"
                                    }`}
                                  >
                                    {variant.name}
                                  </span>
                                </div>
                                <span
                                  className={`text-sm sm:text-base font-bold ${
                                    isSelected ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"
                                  }`}
                                >
                                  {RUPEE_SYMBOL}{Math.round(variant.price)}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 bg-white/95 dark:bg-[#242424]/95 backdrop-blur-md">
                    <div className="flex items-center gap-3 sm:gap-4">
                      {/* Quantity Selector */}
                      <div className={`flex items-center justify-between border-2 rounded-2xl px-2 h-[48px] bg-white dark:bg-[#2a2a2a] gap-2 sm:gap-3 shadow-sm flex-shrink-0 ${shouldShowGrayscale
                        ? 'border-gray-300 dark:border-gray-700 opacity-50'
                        : 'border-gray-200 dark:border-gray-700'
                        }`}>
                        <button
                          type="button"
                          onClick={() => setItemDetailQuantity((q) => Math.max(1, q - 1))}
                          disabled={itemDetailQuantity <= 1 || shouldShowGrayscale}
                          className="w-8 h-8 rounded-full flex items-center justify-center text-red-500 disabled:opacity-30 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        >
                          <Minus className="h-4 w-4 stroke-[2.5]" />
                        </button>
                        <span className={`text-base font-bold min-w-[1.5rem] text-center select-none ${shouldShowGrayscale
                          ? 'text-gray-400 dark:text-gray-600'
                          : 'text-gray-900 dark:text-white'
                          }`}>
                          {itemDetailQuantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => setItemDetailQuantity((q) => q + 1)}
                          disabled={shouldShowGrayscale}
                          className="w-8 h-8 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        >
                          <Plus className="h-4 w-4 stroke-[2.5]" />
                        </button>
                      </div>

                      {/* Add / Update Item Button */}
                      {(() => {
                        const activeVariant = getVariantForDish(selectedItem, selectedVariantId) || getDefaultFoodVariant(selectedItem);
                        const lineItemId = getLineItemIdForDish(selectedItem, activeVariant);
                        const inCartQty = quantities[lineItemId] || 0;
                        const unitPrice = activeVariant?.price ?? selectedItem.price ?? 0;
                        const totalPrice = Math.round(unitPrice * itemDetailQuantity);

                        return (
                          <Button
                            className={`flex-1 h-[48px] rounded-2xl font-bold flex items-center justify-between px-4 sm:px-5 transition-all active:scale-[0.99] ${shouldShowGrayscale
                              ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-600 cursor-not-allowed opacity-50'
                              : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20'
                              }`}
                            onClick={(e) => {
                              if (!shouldShowGrayscale) {
                                updateItemQuantity(
                                  selectedItem,
                                  itemDetailQuantity,
                                  e,
                                  activeVariant,
                                )
                                closeItemDetail()
                              }
                            }}
                            disabled={shouldShowGrayscale}
                          >
                            <span className="text-sm sm:text-base font-bold truncate">
                              {inCartQty > 0
                                ? "Update cart"
                                : (hasFoodVariants(selectedItem) ? `Add (${activeVariant?.name || "Item"})` : "Add item")}
                            </span>
                            <span className="text-base sm:text-lg font-extrabold whitespace-nowrap">
                              {RUPEE_SYMBOL}{totalPrice}
                            </span>
                          </Button>
                        );
                      })()}
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      {/* Schedule Delivery Time Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showScheduleSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowScheduleSheet(false)}
                />

                {/* Schedule Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#242424] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[60vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Centered Overlapping */}
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-10">
                    <button
                      onClick={() => setShowScheduleSheet(false)}
                      className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-900 transition-colors shadow-lg"
                    >
                      <X className="h-5 w-5 text-white" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 pt-10 pb-4">
                    {/* Title */}
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
                      Select your delivery time
                    </h2>

                    {/* Date Selection */}
                    <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                      {(() => {
                        const today = new Date()
                        const tomorrow = new Date(today)
                        tomorrow.setDate(tomorrow.getDate() + 1)
                        const dayAfter = new Date(today)
                        dayAfter.setDate(dayAfter.getDate() + 2)

                        const dates = [
                          { date: today, label: "Today" },
                          { date: tomorrow, label: "Tomorrow" },
                          { date: dayAfter, label: dayAfter.toLocaleDateString('en-US', { weekday: 'short' }) }
                        ]

                        return dates.map((item, index) => {
                          const dateStr = item.date.toISOString().split('T')[0]
                          const day = String(item.date.getDate()).padStart(2, '0')
                          const month = item.date.toLocaleDateString('en-US', { month: 'short' })
                          const isSelected = selectedDate === dateStr

                          return (
                            <button
                              key={index}
                              onClick={() => setSelectedDate(dateStr)}
                              className="flex flex-col items-center gap-0.5 flex-shrink-0 pb-1"
                            >
                              <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                {day} {month} {item.label}
                              </span>
                              {isSelected && (
                                <div className="h-0.5 w-full bg-red-500 mt-0.5" />
                              )}
                            </button>
                          )
                        })
                      })()}
                    </div>

                    {/* Time Slot Selection */}
                    <div className="space-y-2 mb-4">
                      {["6:30 - 7 PM", "7 - 7:30 PM", "7:30 - 8 PM", "8 - 8:30 PM"].map((slot, index) => {
                        const isSelected = selectedTimeSlot === slot
                        return (
                          <button
                            key={index}
                            onClick={() => setSelectedTimeSlot(slot)}
                            className={`w-full text-left px-4 py-2.5 rounded-lg transition-all ${isSelected
                              ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600"
                              : "bg-white dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent"
                              }`}
                          >
                            <span className="text-sm font-medium">{slot}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Confirm Button - Fixed at bottom */}
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                    <Button
                      className="w-full bg-red-500 hover:bg-red-600 text-white py-3 rounded-lg font-semibold"
                      onClick={() => {
                        setShowScheduleSheet(false)
                        // Handle schedule confirmation
                      }}
                    >
                      Confirm
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}



      {/* Menu Options Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuOptionsSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowMenuOptionsSheet(false)}
                />

                {/* Menu Options Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#242424] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[70vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      {restaurant?.name || "Unknown Restaurant"}
                    </h2>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Menu Options List */}
                    <div className="space-y-1">
                      {/* Add to Collection */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleAddToCollection}
                      >
                        <Bookmark className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">
                          {isFavorite(restaurant?.slug || slug || "") ? "Remove from Collection" : "Add to Collection"}
                        </span>
                      </button>

                      {/* Share this restaurant */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleShareRestaurant}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">Share this restaurant</span>
                      </button>

                      {/* See more about this restaurant */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={() => {
                          setShowMenuOptionsSheet(false)
                          setShowMoreInfo(true)
                        }}
                      >
                        <Info className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">See more about this restaurant</span>
                      </button>

                    </div>

                    {/* Disclaimer Text */}
                    <div className="mt-6 px-2">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Menu items, prices, photos and descriptions are set directly by the restaurant. In case you see any incorrect information, please report it to us.
                      </p>
                    </div>

                    {/* FSSAI License Information */}
                    {restaurant?.onboarding?.step3?.fssai?.registrationNumber && (
                      <div className="mt-4 px-2 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3 opacity-80 mb-2">
                        <div className="h-8 w-14 flex items-center justify-center bg-white rounded p-1 border border-gray-100">
                          <img
                            src={fssaiLogo}
                            alt="FSSAI"
                            loading="eager"
                            fetchPriority="high"
                            decoding="sync"
                            className="h-full w-auto object-contain"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
                            Lic. No.
                          </p>
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            {restaurant?.onboarding?.step3?.fssai?.registrationNumber}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Handle */}
                  <div className="px-4 pb-2 pt-2 flex justify-center">
                    <div className="h-1 w-12 bg-gray-300 rounded-full" />
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Share Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showShareModal && sharePayload && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/50 z-[10020]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowShareModal(false)}
                />
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10021] w-[92vw] max-w-md bg-white dark:bg-[#242424] rounded-2xl shadow-2xl"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">Share</h3>
                    <button
                      className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setShowShareModal(false)}
                      aria-label="Close share modal"
                    >
                      <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>

                  <div className="px-5 py-4 space-y-2">
                    {typeof navigator !== "undefined" && navigator.share && (
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                        onClick={handleSystemShareFromModal}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Share via system apps</span>
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("whatsapp")}
                    >
                      <MessageCircle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">WhatsApp</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("telegram")}
                    >
                      <Send className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Telegram</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("email")}
                    >
                      <Mail className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Email</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={copyShareLink}
                    >
                      <Copy className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Copy link</span>
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Offers Bottom Sheet */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showOffersSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/60 z-[10020] pointer-events-auto"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowOffersSheet(false)}
                />
                {/* Container for bottom sheet / centered modal */}
                <div className="fixed inset-0 flex items-end sm:items-center justify-center z-[10021] pointer-events-none p-0 sm:p-4">
                  <div className="relative w-full max-w-lg pointer-events-auto">
                    {/* Unified Close Button - matches Cart popup styling */}
                    <motion.button
                      onClick={() => setShowOffersSheet(false)}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 sm:bottom-auto sm:top-4 sm:right-4 sm:left-auto sm:translate-x-0 w-12 h-12 sm:w-8 sm:h-8 rounded-full bg-neutral-800/80 backdrop-blur-sm border border-white/15 sm:border-0 sm:bg-gray-100 sm:dark:bg-gray-800 flex items-center justify-center text-white sm:text-gray-500 sm:dark:text-gray-400 hover:bg-neutral-700/80 sm:hover:bg-gray-200 sm:dark:hover:bg-gray-700 transition-colors z-[10022] cursor-pointer shadow-lg"
                      aria-label="Close coupons"
                    >
                      <X className="h-5 w-5 sm:h-4 sm:w-4" />
                    </motion.button>

                    {/* Sheet Content */}
                    <motion.div
                      className="relative bg-white dark:bg-[#242424] rounded-t-3xl sm:rounded-3xl w-full overflow-hidden flex flex-col max-h-[80vh] sm:max-h-[75vh] shadow-2xl border border-gray-100 dark:border-gray-800"
                      initial={{ y: "100%", opacity: 0.5 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: "100%", opacity: 0.5 }}
                      transition={{ type: "spring", damping: 30, stiffness: 300 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="px-5 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                          Offers at {restaurant?.name || "this restaurant"}
                        </h2>
                      </div>

                      <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                          Restaurant coupons
                        </h3>
                        <div className="space-y-3 pb-6">
                          {coupons.map((coupon, idx) => (
                            <div
                              key={coupon.couponCode || idx}
                              className="border border-gray-100 dark:border-gray-850 rounded-2xl p-4 bg-white dark:bg-[#222222] shadow-sm relative overflow-hidden"
                            >
                              <div className="flex items-start gap-4">
                                {/* Blue Scallop Badge */}
                                <div className="flex-shrink-0">
                                  <ScallopBadge className="h-10 w-10" />
                                </div>

                                {/* Coupon details */}
                                <div className="flex-1 min-w-0 pr-6">
                                  <h4 className="text-base font-bold text-gray-950 dark:text-gray-50 leading-tight">
                                    {formatCouponTitle(coupon)}
                                  </h4>
                                  <p className="text-xs text-gray-500 dark:text-gray-405 mt-1">
                                    Use code <span className="font-semibold text-gray-750 dark:text-gray-250">{coupon.couponCode}</span>
                                  </p>

                                  {/* Dashed Copy Box */}
                                  <div className="mt-3.5">
                                    <button
                                      onClick={() => handleCopyCoupon(coupon.couponCode)}
                                      className="inline-flex items-center gap-2 px-3 py-1.5 border border-dashed border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 text-xs font-bold text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100/30 dark:hover:bg-blue-950/40 transition-colors focus:outline-none cursor-pointer"
                                    >
                                      <span>{coupon.couponCode}</span>
                                      <Copy className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Add to Cart Animation Component - Rendered via Portal to prevent transform interference */}
      {typeof window !== "undefined" &&
        createPortal(
          <AddToCartAnimation
            bottomOffset={80}
            linkTo="/food/user/cart"
            hideOnPages={true}
          />,
          document.body
        )}
    </AnimatedPage>
  )
}

class RestaurantDetailsErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error("RestaurantDetails crashed:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <AnimatedPage>
          <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  Something went wrong
                </h2>
                <p className="text-sm text-gray-600 mb-4 max-w-md">
                  We could not load this restaurant page right now.
                </p>
                <Button onClick={() => window.location.reload()} variant="outline">
                  Reload Page
                </Button>
              </div>
            </div>
          </div>
        </AnimatedPage>
      )
    }

    return this.props.children
  }
}

export default function RestaurantDetails() {
  return (
    <RestaurantDetailsErrorBoundary>
      <RestaurantDetailsContent />
    </RestaurantDetailsErrorBoundary>
  )
}
