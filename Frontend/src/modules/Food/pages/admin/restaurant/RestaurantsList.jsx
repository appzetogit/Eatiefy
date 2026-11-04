import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Search, Download, ChevronDown, Eye, Settings, ArrowUpDown, Loader2, X, MapPin, Phone, Mail, Clock, Star, Building2, User, FileText, CreditCard, Calendar, Image as ImageIcon, ExternalLink, ShieldX, AlertTriangle, Plus, ShieldCheck, CheckCircle2, Utensils, UtensilsCrossed, Store } from "lucide-react"
import { adminAPI, restaurantAPI, uploadAPI } from "@food/api"
import { clearModuleAuth } from "@food/utils/auth"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { exportRestaurantsToPDF } from "@food/components/admin/restaurants/restaurantsExportUtils"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { formatRestaurantDisplayAddress, getRestaurantDisplayAddress } from "@food/utils/restaurantLocation"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"

// Import icons from Dashboard-icons
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// Inline restaurant placeholder SVG icons (clean subtle slate container with utensils icon, no broken '?' mark)
const PLACEHOLDER_40 = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40' fill='none'%3E%3Crect width='40' height='40' fill='%23F1F5F9'/%3E%3Cpath d='M13 11v6a2.5 2.5 0 0 0 2.5 2.5h0a2.5 2.5 0 0 0 2.5-2.5v-6M15.5 19.5V29M27 11v18M23 11v4.5a2.5 2.5 0 0 0 2.5 2.5H27' stroke='%2394A3B8' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
const PLACEHOLDER_128 = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128' fill='none'%3E%3Crect width='128' height='128' fill='%23F1F5F9'/%3E%3Cpath d='M41.6 35.2v19.2a8 8 0 0 0 8 8h0a8 8 0 0 0 8-8V35.2M49.6 62.4v30.4M86.4 35.2v57.6M73.6 35.2v14.4a8 8 0 0 0 8 8h4.8' stroke='%2394A3B8' stroke-width='5.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"

const normalizeApprovalStatus = (restaurant) => {
  const raw = String(restaurant?.status || "").trim().toLowerCase()
  if (raw === "approved" || raw === "pending" || raw === "rejected" || raw === "banned") return raw
  return "pending"
}

const approvalStatusLabel = (status) => {
  if (status === "approved") return "Approved"
  if (status === "rejected") return "Rejected"
  if (status === "banned") return "Banned"
  return "Pending"
}

const approvalStatusBadgeClass = (status) => {
  if (status === "approved") return "bg-emerald-100 text-emerald-700"
  if (status === "rejected") return "bg-rose-100 text-rose-700"
  if (status === "banned") return "bg-rose-100 text-rose-700"
  return "bg-amber-100 text-amber-700"
}

const normalizeTimeValue = (value) => {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmm) {
    const h = Number(hhmm[1]); const m = Number(hhmm[2])
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return ""
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (ampm) {
    let h = Number(ampm[1]); const m = Number(ampm[2]); const p = ampm[3].toUpperCase()
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 1 || h > 12 || m < 0 || m > 59) return ""
    if (p === "AM") h = h === 12 ? 0 : h
    if (p === "PM") h = h === 12 ? 12 : h + 12
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`
  }
  return ""
}

const timeToMinutes = (value) => {
  const normalized = normalizeTimeValue(value)
  if (!normalized) return null
  const [h, m] = normalized.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

const formatTime12Hour = (value) => {
  const normalized = normalizeTimeValue(value)
  if (!normalized) return value || "N/A"
  const [h, m] = normalized.split(":").map(Number)
  const hour12 = h % 12 === 0 ? 12 : h % 12
  const period = h >= 12 ? "PM" : "AM"
  return `${String(hour12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`
}

const normalizeImageUrl = (image) => {
  if (!image) return ""
  if (typeof image === "string") {
    const trimmed = image.trim()
    if (!trimmed || trimmed === "null" || trimmed === "undefined") return ""
    return trimmed
  }
  if (typeof image === "object") {
    const url = image.url || image.secure_url || image.path || ""
    if (typeof url === "string") {
      const trimmed = url.trim()
      if (!trimmed || trimmed === "null" || trimmed === "undefined") return ""
      return trimmed
    }
  }
  return ""
}

const getPrimaryRestaurantImage = (restaurant, fallback = "") => {
  if (!restaurant) return fallback
  const directImage =
    normalizeImageUrl(restaurant?.profileImage) ||
    normalizeImageUrl(restaurant?.logo) ||
    normalizeImageUrl(restaurant?.restaurantImage) ||
    normalizeImageUrl(restaurant?.image) ||
    normalizeImageUrl(restaurant?.onboarding?.step2?.profileImageUrl)
  if (directImage) return directImage

  const coverImages = Array.isArray(restaurant?.coverImages) ? restaurant.coverImages : []
  const firstCoverImage = coverImages.map(normalizeImageUrl).find(Boolean)
  if (firstCoverImage) return firstCoverImage

  const menuImages = Array.isArray(restaurant?.menuImages) ? restaurant.menuImages : []
  const firstMenuImage = menuImages.map(normalizeImageUrl).find(Boolean)
  if (firstMenuImage) return firstMenuImage

  return fallback
}


export default function RestaurantsList() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState("")
  const [restaurants, setRestaurants] = useState([])
  const [bannedRestaurants, setBannedRestaurants] = useState([])
  const [rejectedRestaurants, setRejectedRestaurants] = useState([])
  const [viewMode, setViewMode] = useState("active") // 'active' or 'banned'
  const [bannedCount, setBannedCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [rejectedCount, setRejectedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [restaurantDetails, setRestaurantDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [banConfirmDialog, setBanConfirmDialog] = useState(null) // { restaurant, action: 'ban' | 'unban' }
  const [banning, setBanning] = useState(false)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" })
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState({
    name: "",
    foodType: "Mixed",
    pureVegRestaurant: false,
    pureVeganRestaurant: false,
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    primaryContactNumber: "",
    email: "",
    estimatedDeliveryTime: "",
    openingTime: "",
    closingTime: "",
    isActive: true,
  })
  const [profileImageFile, setProfileImageFile] = useState(null)
  const [profileImagePreview, setProfileImagePreview] = useState("")
  const [isEditingLocation, setIsEditingLocation] = useState(false)
  const [savingLocation, setSavingLocation] = useState(false)
  const [locationEditError, setLocationEditError] = useState("")
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [locationForm, setLocationForm] = useState({
    zoneId: "",
    latitude: "",
    longitude: "",
    formattedAddress: "",
    addressLine1: "",
    addressLine2: "",
    area: "",
    city: "",
    state: "",
    landmark: "",
    pincode: "",
  })
  const locationSearchInputRef = useRef(null)
  const placesAutocompleteRef = useRef(null)
  const {
    zones: filterZones,
    zonesLoading: filterZonesLoading,
    zoneId: selectedZoneId,
    setZoneId: setSelectedZoneId,
  } = useAdminZoneFilter()
  // Only the newest list fetch may write state, so a quick zone switch cannot
  // be overwritten by the slower response of the previous zone.
  const fetchSeqRef = useRef(0)

  // Format Restaurant ID to REST format (e.g., REST422829)
  const formatRestaurantId = (id) => {
    if (!id) return "REST000000"

    const idString = String(id)
    // Extract last 6 digits from the ID
    // Handle formats like "REST-1768045396242-2829" or "1768045396242-2829"
    const parts = idString.split(/[-.]/)
    let lastDigits = ""

    // Get the last part and extract digits
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1]
      // Extract only digits from the last part
      const digits = lastPart.match(/\d+/g)
      if (digits && digits.length > 0) {
        // Get last 6 digits from all digits found
        const allDigits = digits.join("")
        lastDigits = allDigits.slice(-6).padStart(6, "0")
      } else {
        // If no digits in last part, look for digits in all parts
        const allParts = parts.join("")
        const allDigits = allParts.match(/\d+/g)
        if (allDigits && allDigits.length > 0) {
          const combinedDigits = allDigits.join("")
          lastDigits = combinedDigits.slice(-6).padStart(6, "0")
        }
      }
    }

    // If no digits found, use a hash of the ID
    if (!lastDigits) {
      const hash = idString.split("").reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0) | 0
      }, 0)
      lastDigits = Math.abs(hash).toString().slice(-6).padStart(6, "0")
    }

    return `REST${lastDigits}`
  }

  // Fetch zones from backend API
  useEffect(() => {
    let cancelled = false
    const fetchZones = async () => {
      try {
        setZonesLoading(true)
        const response = await adminAPI.getZones({ page: 1, limit: 1000 })
        const zoneData = response?.data?.data
        const list = Array.isArray(zoneData?.zones)
          ? zoneData.zones
          : Array.isArray(zoneData)
            ? zoneData
            : []
        if (!cancelled) setZones(list)
      } catch (err) {
        debugError("Error fetching zones:", err)
        if (!cancelled) setZones([])
      } finally {
        if (!cancelled) setZonesLoading(false)
      }
    }
    fetchZones()
    return () => { cancelled = true }
  }, [])

  // Fetch restaurants from backend API
  const fetchRestaurants = useCallback(async () => {
    const seq = ++fetchSeqRef.current
    const isLatest = () => seq === fetchSeqRef.current
    try {
      setLoading(true)
      setError(null)

      // Filtered by zone on the server, so lists, counts and export all match the selected zone.
      const zoneParams = selectedZoneId ? { zoneId: selectedZoneId } : {}
      const [response, bannedResponse, pendingResponse, rejectedOnlyResponse, zonesResponse] = await Promise.all([
        adminAPI.getApprovedRestaurants({ status: "approved", limit: 1000, page: 1, ...zoneParams }),
        adminAPI.getApprovedRestaurants({ status: "banned", limit: 1000, page: 1, ...zoneParams }).catch(() => null),
        adminAPI.getPendingRestaurants({ limit: 1000, page: 1, ...zoneParams }).catch(() => null),
        adminAPI.getApprovedRestaurants({ status: "rejected", limit: 1000, page: 1, ...zoneParams }).catch(() => null),
        adminAPI.getZones({ page: 1, limit: 1000 }).catch(() => null),
      ])
      if (!isLatest()) return

      const fetchedZones = Array.isArray(zonesResponse?.data?.data?.zones)
        ? zonesResponse.data.data.zones
        : Array.isArray(zonesResponse?.data?.data)
          ? zonesResponse.data.data
          : []
      if (fetchedZones.length > 0) {
        setZones(fetchedZones)
      }

      const zoneLabelFromRestaurant = (restaurant, availableZones = fetchedZones) => {
        const zid = restaurant?.zoneId || restaurant?.location?.zoneId
        const zoneName =
          (typeof zid === "object" ? (zid?.name || zid?.zoneName || zid?.serviceLocation) : "") ||
          ""
        if (zoneName) return zoneName

        const zoneIdString =
          typeof zid === "string"
            ? zid
            : (zid?._id || zid?.id || "")
        const lookupList = Array.isArray(availableZones) && availableZones.length > 0 ? availableZones : zones
        if (zoneIdString && Array.isArray(lookupList) && lookupList.length > 0) {
          const match = lookupList.find((z) => String(z?._id || z?.id) === String(zoneIdString))
          const label = match?.name || match?.zoneName || match?.serviceLocation
          if (label) return label
        }

        return (
          restaurant?.zone ||
          restaurant?.location?.area ||
          restaurant?.location?.city ||
          restaurant?.area ||
          restaurant?.city ||
          "N/A"
        )
      }

      const extractRestaurantPayload = (apiResponse) => {
        const body = apiResponse?.data
        const data = body?.data
        const list = Array.isArray(data?.restaurants)
          ? data.restaurants
          : Array.isArray(data)
            ? data
            : Array.isArray(body?.restaurants)
              ? body.restaurants
              : []
        const total = Number(data?.total ?? body?.total ?? list.length) || list.length
        return { list, total, body }
      }

      let mappedBanned = []
      let bannedCnt = 0
      if (bannedResponse?.data) {
        const { list: bannedList, total } = extractRestaurantPayload(bannedResponse)
        bannedCnt = total
        mappedBanned = bannedList.map((restaurant, index) => {
          const zid = restaurant?.zoneId || restaurant?.location?.zoneId
          const zoneIdStr = typeof zid === "string" ? zid : String(zid?._id || zid?.id || "")
          return {
            id: restaurant._id || restaurant.id || index + 1,
            _id: restaurant._id,
            name: restaurant.name || restaurant.restaurantName || "N/A",
            ownerName: restaurant.ownerName || "N/A",
            ownerPhone: restaurant.ownerPhone || restaurant.phone || "N/A",
            zone: zoneLabelFromRestaurant(restaurant, fetchedZones),
            zoneId: zoneIdStr,
            approvalStatus: "banned",
            isActive: false,
            rating: restaurant.ratings?.average || restaurant.rating || 0,
            logo: getPrimaryRestaurantImage(restaurant, PLACEHOLDER_40),
            originalData: restaurant,
          }
        })
      }
      setBannedCount(bannedCnt)
      setBannedRestaurants(mappedBanned)

      let pendingCnt = 0
      let rejectedCnt = 0
      let mappedRejectedList = []
      if (pendingResponse?.data) {
        const { list } = extractRestaurantPayload(pendingResponse)
        pendingCnt = list.filter((r) => String(r.status || "").toLowerCase() === "pending").length
      }
      if (rejectedOnlyResponse?.data) {
        const { list: rawRejected, total } = extractRestaurantPayload(rejectedOnlyResponse)
        rejectedCnt = total
        mappedRejectedList = rawRejected.map((restaurant, index) => {
          const zid = restaurant?.zoneId || restaurant?.location?.zoneId
          const zoneIdStr = typeof zid === "string" ? zid : String(zid?._id || zid?.id || "")
          return {
            id: restaurant._id || restaurant.id || index + 1,
            _id: restaurant._id,
            name: restaurant.restaurantName || restaurant.name || "N/A",
            ownerName: restaurant.ownerName || "N/A",
            ownerPhone: restaurant.ownerPhone || restaurant.phone || "N/A",
            zone: restaurant.zone || zoneLabelFromRestaurant(restaurant, fetchedZones),
            zoneId: zoneIdStr,
            approvalStatus: "rejected",
            isActive: false,
            rating: restaurant.ratings?.average || restaurant.rating || 0,
            logo: getPrimaryRestaurantImage(restaurant, PLACEHOLDER_40),
            originalData: restaurant,
          }
        })
      } else if (pendingResponse?.data) {
        const { list } = extractRestaurantPayload(pendingResponse)
        const rawRejected = list.filter((r) => String(r.status || "").toLowerCase() === "rejected")
        rejectedCnt = rawRejected.length
        mappedRejectedList = rawRejected.map((restaurant, index) => {
          const zid = restaurant?.zoneId || restaurant?.location?.zoneId
          const zoneIdStr = typeof zid === "string" ? zid : String(zid?._id || zid?.id || "")
          return {
            id: restaurant._id || restaurant.id || index + 1,
            _id: restaurant._id,
            name: restaurant.restaurantName || restaurant.name || "N/A",
            ownerName: restaurant.ownerName || "N/A",
            ownerPhone: restaurant.ownerPhone || restaurant.phone || "N/A",
            zone: restaurant.zone || zoneLabelFromRestaurant(restaurant, fetchedZones),
            zoneId: zoneIdStr,
            approvalStatus: "rejected",
            isActive: false,
            rating: restaurant.ratings?.average || restaurant.rating || 0,
            logo: getPrimaryRestaurantImage(restaurant, PLACEHOLDER_40),
            originalData: restaurant,
          }
        })
      }
      setPendingCount(pendingCnt)
      setRejectedCount(rejectedCnt)
      setRejectedRestaurants(mappedRejectedList)

      const { list: rawList, body } = extractRestaurantPayload(response)

      if (rawList.length > 0 || body?.success === true) {
        const mappedRestaurants = rawList.map((restaurant, index) => {
          const zid = restaurant?.zoneId || restaurant?.location?.zoneId
          const zoneIdStr = typeof zid === "string" ? zid : String(zid?._id || zid?.id || "")
          return {
            id: restaurant._id || restaurant.id || index + 1,
            _id: restaurant._id,
            name: restaurant.name || restaurant.restaurantName || "N/A",
            ownerName: restaurant.ownerName || "N/A",
            ownerPhone: restaurant.ownerPhone || restaurant.phone || "N/A",
            zone: zoneLabelFromRestaurant(restaurant, fetchedZones),
            zoneId: zoneIdStr,
            approvalStatus: normalizeApprovalStatus(restaurant),
            isActive: restaurant.isActive !== false && restaurant.status !== 'banned',
            rating: restaurant.ratings?.average || restaurant.rating || 0,
            logo: getPrimaryRestaurantImage(restaurant, PLACEHOLDER_40),
            originalData: restaurant,
          }
        })
        setRestaurants(mappedRestaurants)
      } else {
        setRestaurants([])
      }
    } catch (err) {
      debugError("Error fetching restaurants:", err)
      if (!isLatest()) return
      const status = err?.response?.status
      const serverMessage = err?.response?.data?.message || err?.response?.data?.error
      if (status === 401) {
        setError(serverMessage || "Session expired or not logged in. Please log in as admin.")
        setRestaurants([])
        try {
          clearModuleAuth("admin")
        } catch (_) {}
        navigate("/admin/login", { replace: true, state: { from: "/admin/food/restaurants" } })
        return
      }
      setError(serverMessage || err.message || "Failed to fetch restaurants")
      setRestaurants([])
    } finally {
      if (isLatest()) setLoading(false)
    }
  }, [navigate, selectedZoneId])

  useEffect(() => {
    fetchRestaurants()
  }, [fetchRestaurants])


  const [searchParams] = useSearchParams()
  const restaurantIdFromUrl = searchParams.get("restaurantId")

  useEffect(() => {
    if (restaurantIdFromUrl && restaurants.length > 0) {
      const restaurant = restaurants.find(r => r.id === restaurantIdFromUrl || r._id === restaurantIdFromUrl)
      if (restaurant) {
        handleViewDetails(restaurant)
      }
    }
  }, [restaurantIdFromUrl, restaurants])

  const [filters, setFilters] = useState({
    all: "All",
    businessModel: "",
  })

  // The zone filter is applied by the API (see fetchRestaurants), so these lists
  // already belong to the selected zone.
  const filteredRestaurants = useMemo(() => {
    let result = []
    if (viewMode === "active") {
      result = [...restaurants]
    } else if (viewMode === "banned") {
      result = [...bannedRestaurants]
    } else if (viewMode === "rejected") {
      result = [...rejectedRestaurants]
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter(restaurant =>
        restaurant.name.toLowerCase().includes(query) ||
        restaurant.ownerName.toLowerCase().includes(query) ||
        restaurant.ownerPhone.includes(query)
      )
    }

    if (filters.all !== "All") {
      if (filters.all === "Active") {
        result = result.filter(restaurant => restaurant.isActive === true)
      } else if (filters.all === "Inactive") {
        result = result.filter(restaurant => restaurant.isActive !== true)
      }
    }

    // Apply Sorting
    if (sortConfig.key) {
      result.sort((a, b) => {
        let aValue, bValue;

        switch (sortConfig.key) {
          case 'sl':
            aValue = restaurants.indexOf(a);
            bValue = restaurants.indexOf(b);
            break;
          case 'name':
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
          case 'owner':
            aValue = a.ownerName.toLowerCase();
            bValue = b.ownerName.toLowerCase();
            break;
          case 'zone':
            aValue = a.zone.toLowerCase();
            bValue = b.zone.toLowerCase();
            break;
          case 'rating':
            aValue = Number(a.rating) || 0;
            bValue = Number(b.rating) || 0;
            break;
          case 'status':
            aValue = String(a.approvalStatus || "").toLowerCase();
            bValue = String(b.approvalStatus || "").toLowerCase();
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result
  }, [restaurants, bannedRestaurants, rejectedRestaurants, viewMode, searchQuery, filters.all, sortConfig])

  const modalRestaurant = restaurantDetails || selectedRestaurant?.originalData || selectedRestaurant
  const detailsApprovalStatus = modalRestaurant ? normalizeApprovalStatus(modalRestaurant) : "pending"

  const handleSort = (key) => {
    let direction = "asc"
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc"
    }
    setSortConfig({ key, direction })
  }

  const totalRestaurants = restaurants.length + bannedRestaurants.length + rejectedRestaurants.length
  const activeRestaurants = restaurants.filter(r => r.isActive === true).length
  const inactiveRestaurants = restaurants.filter(r => r.isActive !== true).length
  const displayRejectedCount = rejectedRestaurants.length
  const displayBannedCount = bannedRestaurants.length

  // Show full phone number without masking
  const formatPhone = (phone) => {
    if (!phone) return ""
    return phone
  }

  const renderStars = (rating) => {
    const fullStars = Math.floor(rating || 0);
    return (
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <Star 
            key={i} 
            className={`w-3.5 h-3.5 ${i < fullStars ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'}`} 
          />
        ))}
        <span className="ml-1 text-slate-600">({rating || 0})</span>
      </div>
    )
  }

  const getLocationFromRestaurant = (restaurant) => {
    return (
      restaurant?.onboarding?.step1?.location ||
      restaurant?.location ||
      restaurant?.originalData?.location ||
      {}
    )
  }

  const formatLocationAddress = (location = {}, fallback = "N/A") => {
    return formatRestaurantDisplayAddress(location) || fallback
  }

  const normalizeLocationFormFromRestaurant = (restaurant) => {
    const loc = getLocationFromRestaurant(restaurant)
    const rawLat = loc.latitude ?? (Array.isArray(loc.coordinates) ? loc.coordinates[1] : "")
    const rawLng = loc.longitude ?? (Array.isArray(loc.coordinates) ? loc.coordinates[0] : "")
    const latNum = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat))
    const lngNum = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng))
    const hasValidNumbers = Number.isFinite(latNum) && Number.isFinite(lngNum)
    // Guard against common "unset" coordinates (0,0 or near-zero) that render as blank ocean.
    const looksUnset = hasValidNumbers && Math.abs(latNum) < 1 && Math.abs(lngNum) < 1
    const latitude = (hasValidNumbers && !looksUnset) ? latNum : ""
    const longitude = (hasValidNumbers && !looksUnset) ? lngNum : ""

    return {
      zoneId: restaurant?.zoneId || restaurant?.location?.zoneId || "",
      latitude: latitude || "",
      longitude: longitude || "",
      formattedAddress: loc.formattedAddress || loc.address || "",
      addressLine1: loc.addressLine1 || "",
      addressLine2: loc.addressLine2 || "",
      area: loc.area || "",
      city: loc.city || "",
      state: loc.state || "",
      landmark: loc.landmark || "",
      pincode: loc.pincode || loc.zipCode || loc.postalCode || "",
    }
  }

  const loadGoogleMapsScript = async () => {
    if (window.google?.maps?.places?.Autocomplete) return true

    const apiKey = await getGoogleMapsApiKey()
    if (!apiKey) {
      setLocationEditError("Google Maps API key is missing in Admin Environment Variables.")
      return false
    }

    // Surface auth/key/billing/referrer issues instead of showing a blank map.
    // Google invokes this global when the JS API loads but auth fails.
    window.gm_authFailure = () => {
      setLocationEditError(
        "Google Maps authentication failed. Check: Maps JavaScript API enabled, billing enabled, and HTTP referrer restrictions allow this domain."
      )
    }

    const existingScript = document.getElementById("admin-google-maps-script")
    if (existingScript) {
      await new Promise((resolve, reject) => {
        if (window.google?.maps?.places?.Autocomplete) {
          resolve()
          return
        }
        existingScript.addEventListener("load", resolve, { once: true })
        existingScript.addEventListener("error", reject, { once: true })
      })
      return !!window.google?.maps?.places?.Autocomplete
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.id = "admin-google-maps-script"
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`
      script.async = true
      script.defer = true
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })

    return !!window.google?.maps?.places?.Autocomplete
  }

  const initPlacesAutocomplete = async () => {
    if (!locationSearchInputRef.current) return
    if (placesAutocompleteRef.current) return
    setLocationEditError("")
    const loaded = await loadGoogleMapsScript()
    if (!loaded || !window.google?.maps?.places?.Autocomplete) {
      setLocationEditError("Unable to load Google Places Autocomplete.")
      return
    }

    placesAutocompleteRef.current = new window.google.maps.places.Autocomplete(
      locationSearchInputRef.current,
      {
        fields: ["formatted_address", "address_components", "geometry"],
        componentRestrictions: { country: "in" },
      }
    )

    const parsePlace = (place) => {
      const formattedAddress = place?.formatted_address || ""
      const comps = Array.isArray(place?.address_components) ? place.address_components : []
      const get = (types) => comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""
      const area =
        get(["sublocality_level_1", "sublocality", "neighborhood"]) ||
        get(["locality"])
      const city =
        get(["locality"]) ||
        get(["administrative_area_level_2"])
      const state = get(["administrative_area_level_1"])
      const pincode = get(["postal_code"])
      const lat = place?.geometry?.location?.lat?.()
      const lng = place?.geometry?.location?.lng?.()
      return {
        formattedAddress,
        area,
        city,
        state,
        pincode,
        latitude: Number.isFinite(lat) ? Number(lat.toFixed(6)) : "",
        longitude: Number.isFinite(lng) ? Number(lng.toFixed(6)) : "",
      }
    }

    placesAutocompleteRef.current.addListener("place_changed", () => {
      const place = placesAutocompleteRef.current.getPlace()
      const parsed = parsePlace(place)
      setLocationForm((prev) => ({
        ...prev,
        formattedAddress: parsed.formattedAddress || prev.formattedAddress,
        addressLine1: parsed.formattedAddress || prev.addressLine1,
        area: parsed.area || prev.area,
        city: parsed.city || prev.city,
        state: parsed.state || prev.state,
        pincode: parsed.pincode || prev.pincode,
        latitude: parsed.latitude !== "" ? parsed.latitude : prev.latitude,
        longitude: parsed.longitude !== "" ? parsed.longitude : prev.longitude,
      }))
    })
  }

  // Handle view restaurant details
  const handleViewDetails = async (restaurant) => {
    setIsEditingDetails(false)
    setProfileImageFile(null)
    setProfileImagePreview("")
    setIsEditingLocation(false)
    setSelectedRestaurant(restaurant)
    setLoadingDetails(true)
    setRestaurantDetails(null)

    try {
      // Always fetch full details from Admin API so the modal matches the
      // original joining-request data instead of the compact list payload.
      const restaurantId = restaurant._id || restaurant.id || restaurant.restaurantId
      if (!restaurantId || !adminAPI.getRestaurantById) {
        setRestaurantDetails(restaurant.originalData || restaurant)
        return
      }

      const response = await adminAPI.getRestaurantById(restaurantId)
      if (!response?.data?.success) {
        setRestaurantDetails(restaurant.originalData || restaurant)
        return
      }

      const data = response?.data?.data
      if (data && (data.restaurantName || data._id)) {
        setRestaurantDetails(data)
        return
      }

      setRestaurantDetails(restaurant.originalData || restaurant)
    } catch (err) {
      debugError("Error fetching restaurant details:", err)
      // Use the restaurant data we already have
      setRestaurantDetails(restaurant.originalData || restaurant)
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleEditLocation = async (restaurant) => {
    await handleViewDetails(restaurant)
    setIsEditingLocation(true)
  }

  const handleSaveLocation = async () => {
    if (!selectedRestaurant) return

    const restaurantId = selectedRestaurant._id || selectedRestaurant.id
    const latitude = Number(locationForm.latitude)
    const longitude = Number(locationForm.longitude)

    if (!locationForm.zoneId) {
      alert("Please select a zone")
      return
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !locationForm.formattedAddress) {
      alert("Please select a location from dropdown")
      return
    }

    try {
      setSavingLocation(true)
      const locationPayload = {
        zoneId: locationForm.zoneId,
        latitude,
        longitude,
        coordinates: [longitude, latitude],
        formattedAddress: locationForm.formattedAddress || "",
        address: locationForm.formattedAddress || "",
        addressLine1: locationForm.addressLine1 || locationForm.formattedAddress || "",
        addressLine2: locationForm.addressLine2 || "",
        area: locationForm.area || "",
        city: locationForm.city || "",
        state: locationForm.state || "",
        landmark: locationForm.landmark || "",
        pincode: locationForm.pincode || "",
        zipCode: locationForm.pincode || "",
        postalCode: locationForm.pincode || "",
      }

      const response = await adminAPI.updateRestaurantLocation(restaurantId, locationPayload)
      const updatedRestaurant = response?.data?.data?.restaurant

      if (updatedRestaurant?.location) {
        setRestaurantDetails((prev) => ({
          ...(prev || {}),
          ...updatedRestaurant,
          location: updatedRestaurant.location,
          onboarding: {
            ...(prev?.onboarding || {}),
            step1: {
              ...(prev?.onboarding?.step1 || {}),
              location: updatedRestaurant.location,
            },
          },
        }))

        setRestaurants((prev) =>
          prev.map((item) =>
            (item._id === restaurantId || item.id === restaurantId)
              ? {
                ...item,
                zone:
                  updatedRestaurant.location.area ||
                  updatedRestaurant.location.city ||
                  item.zone,
                originalData: {
                  ...(item.originalData || {}),
                  location: updatedRestaurant.location,
                },
              }
              : item,
          ),
        )
      }

      setIsEditingLocation(false)
      alert("Restaurant location updated successfully")
      fetchRestaurants().catch(() => {})
    } catch (err) {
      debugError("Error saving restaurant location:", err)
      alert(err?.response?.data?.message || "Failed to update restaurant location")
    } finally {
      setSavingLocation(false)
    }
  }

  useEffect(() => {
    if (!isEditingLocation || !selectedRestaurant) return

    const sourceRestaurant = restaurantDetails || selectedRestaurant?.originalData || selectedRestaurant
    const initialForm = normalizeLocationFormFromRestaurant(sourceRestaurant)
    setLocationForm(initialForm)
    setLocationEditError("")

    setZonesLoading(true)
    adminAPI.getZones({ limit: 1000 })
      .then((res) => {
        const zoneData = res?.data?.data
        const list = Array.isArray(zoneData?.zones)
          ? zoneData.zones
          : Array.isArray(zoneData)
            ? zoneData
            : []
        setZones(list)
      })
      .catch(() => setZones([]))
      .finally(() => setZonesLoading(false))

    // Init dropdown autocomplete after mount.
    requestAnimationFrame(() => initPlacesAutocomplete())

    return () => {
      placesAutocompleteRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingLocation, selectedRestaurant, restaurantDetails?._id])

  const getDetailsEditSource = () => {
    return restaurantDetails || selectedRestaurant?.originalData || selectedRestaurant || null
  }

  const buildDetailsFormFromRestaurant = (restaurant) => {
    if (!restaurant) {
      return {
        name: "",
        foodType: "Mixed",
        pureVegRestaurant: false,
        pureVeganRestaurant: false,
        ownerName: "",
        ownerEmail: "",
        ownerPhone: "",
        primaryContactNumber: "",
        email: "",
        estimatedDeliveryTime: "",
        openingTime: "",
        closingTime: "",
        isActive: true,
      }
    }

    const openingTimeValue =
      restaurant.openingTime ||
      restaurant.deliveryTimings?.openingTime ||
      restaurant.onboarding?.step2?.deliveryTimings?.openingTime ||
      ""
    const closingTimeValue =
      restaurant.closingTime ||
      restaurant.deliveryTimings?.closingTime ||
      restaurant.onboarding?.step2?.deliveryTimings?.closingTime ||
      ""
    const estimatedDeliveryTimeValue =
      restaurant.estimatedDeliveryTime ||
      restaurant.onboarding?.step4?.estimatedDeliveryTime ||
      ""

    return {
      name: restaurant.restaurantName || restaurant.name || "",
      foodType:
        restaurant.foodType ||
        (typeof restaurant.pureVegRestaurant === "boolean"
          ? (restaurant.pureVegRestaurant ? "Veg" : "Mixed")
          : "Mixed"),
      pureVegRestaurant:
        typeof restaurant.pureVegRestaurant === "boolean"
          ? restaurant.pureVegRestaurant
          : false,
      pureVeganRestaurant: restaurant.pureVeganRestaurant === true,
      ownerName: restaurant.ownerName || "",
      ownerEmail: restaurant.ownerEmail || "",
      ownerPhone: restaurant.ownerPhone || restaurant.phone || "",
      primaryContactNumber: restaurant.primaryContactNumber || restaurant.ownerPhone || "",
      email: restaurant.email || restaurant.ownerEmail || "",
      estimatedDeliveryTime: estimatedDeliveryTimeValue,
      openingTime: openingTimeValue,
      closingTime: closingTimeValue,
      isActive: restaurant.isActive !== false,
    }
  }

  const handleStartEditDetails = () => {
    const source = getDetailsEditSource()
    setDetailsForm(buildDetailsFormFromRestaurant(source))
    setProfileImageFile(null)
    setProfileImagePreview(getPrimaryRestaurantImage(source))
    setIsEditingLocation(true)
    setIsEditingDetails(true)
  }

  const handleCancelEditDetails = () => {
    setIsEditingDetails(false)
    setProfileImageFile(null)
    setProfileImagePreview("")
  }

  const handleSaveDetails = async () => {
    if (!selectedRestaurant) return
    const restaurantId = selectedRestaurant._id || selectedRestaurant.id

    try {
      setSavingDetails(true)

      let profileImage = undefined
      if (profileImageFile) {
        const uploadRes = await uploadAPI.uploadMedia(profileImageFile, {
          folder: "eatiefy/restaurant/profile",
        })
        const media = uploadRes?.data?.data?.file || uploadRes?.data?.data || uploadRes?.data?.file
        if (media?.url) {
          profileImage = { url: media.url, publicId: media.publicId || media.public_id }
        }
      }

      const normalizedOpeningTime = normalizeTimeValue(detailsForm.openingTime.trim())
      const normalizedClosingTime = normalizeTimeValue(detailsForm.closingTime.trim())
      const openingMinutes = timeToMinutes(normalizedOpeningTime)
      const closingMinutes = timeToMinutes(normalizedClosingTime)
      if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
          alert("Opening time and closing time cannot be same")
          return
        }
        // A closing time before the opening time means the outlet trades past
        // midnight (10:00 -> 02:00), which the backend already supports.
      }

      const payload = {
        name: detailsForm.name.trim(),
        foodType: detailsForm.foodType,
        pureVeganRestaurant: detailsForm.pureVeganRestaurant === true,
        ownerName: detailsForm.ownerName.trim(),
        ownerEmail: detailsForm.ownerEmail.trim(),
        ownerPhone: detailsForm.ownerPhone.trim(),
        primaryContactNumber: detailsForm.primaryContactNumber.trim(),
        email: detailsForm.email.trim(),
        estimatedDeliveryTime: detailsForm.estimatedDeliveryTime.trim(),
        openingTime: normalizedOpeningTime,
        closingTime: normalizedClosingTime,
        isActive: detailsForm.isActive,
      }

      if (profileImage) {
        payload.profileImage = profileImage
      }

      const response = await adminAPI.updateRestaurant(restaurantId, payload)
      const updatedRestaurant = response?.data?.data?.restaurant

      if (updatedRestaurant) {
        setRestaurantDetails(updatedRestaurant)
        setRestaurants((prev) =>
          prev.map((item) =>
            (item._id === restaurantId || item.id === restaurantId)
              ? {
                ...item,
                name: updatedRestaurant.name || item.name,
                ownerName: updatedRestaurant.ownerName || item.ownerName,
                ownerPhone: updatedRestaurant.ownerPhone || updatedRestaurant.phone || item.ownerPhone,
                zone: updatedRestaurant.location?.area || updatedRestaurant.location?.city || item.zone,
                isActive: updatedRestaurant.isActive !== false,
                approvalStatus: normalizeApprovalStatus(updatedRestaurant),
                logo: getPrimaryRestaurantImage(updatedRestaurant, item.logo),
                originalData: {
                  ...(item.originalData || {}),
                  ...updatedRestaurant,
                },
              }
              : item,
          ),
        )
      }

      setIsEditingDetails(false)
      setProfileImageFile(null)
      alert("Restaurant details updated successfully")
      fetchRestaurants().catch(() => {})
    } catch (err) {
      debugError("Error updating restaurant details:", err)
      alert(err?.response?.data?.message || "Failed to update restaurant details")
    } finally {
      setSavingDetails(false)
    }
  }

  const closeDetailsModal = () => {
    setIsEditingDetails(false)
    setProfileImageFile(null)
    setProfileImagePreview("")
    setIsEditingLocation(false)
    setLocationEditError("")
    setSelectedRestaurant(null)
    setRestaurantDetails(null)
  }


  // Handle ban/unban restaurant
  const handleBanRestaurant = (restaurant) => {
    const isBanned = !restaurant.isActive
    setBanConfirmDialog({
      restaurant,
      action: isBanned ? 'unban' : 'ban'
    })
  }

  const confirmBanRestaurant = async () => {
    if (!banConfirmDialog) return

    const { restaurant, action } = banConfirmDialog
    const isBanning = action === 'ban'
    const newStatus = !isBanning // false for ban, true for unban
    const restaurantId = restaurant._id || restaurant.id

    try {
      setBanning(true)

      // Update restaurant status via API
      try {
        await adminAPI.updateRestaurantStatus(restaurantId, newStatus)

        // Update local state on success
        if (isBanning) {
          setRestaurants(prev => prev.filter(r => r._id !== restaurantId && r.id !== restaurantId))
          const bannedItem = {
            ...restaurant,
            isActive: false,
            approvalStatus: 'rejected',
          }
          setBannedRestaurants(prev => [bannedItem, ...prev])
          setBannedCount(prev => prev + 1)
        } else {
          setBannedRestaurants(prev => prev.filter(r => r._id !== restaurantId && r.id !== restaurantId))
          setBannedCount(prev => Math.max(0, prev - 1))
          const approvedItem = {
            ...restaurant,
            isActive: true,
            approvalStatus: 'approved',
          }
          setRestaurants(prev => [approvedItem, ...prev])
        }

        // Close dialog
        setBanConfirmDialog(null)
        alert(`Restaurant ${isBanning ? 'banned' : 'unbanned'} successfully`)

        // Re-fetch all restaurants & counts dynamically from DB
        await fetchRestaurants()
      } catch (apiErr) {
        debugError("API Error:", apiErr)
        setBanConfirmDialog(null)
        alert(apiErr.response?.data?.message || `Failed to ${action} restaurant.`)
      }

    } catch (err) {
      debugError("Error banning/unbanning restaurant:", err)
      alert(`Failed to ${action} restaurant. Please try again.`)
    } finally {
      setBanning(false)
    }
  }

  const cancelBanRestaurant = () => {
    setBanConfirmDialog(null)
  }

  // Handle export functionality
  const handleExport = () => {
    const dataToExport = filteredRestaurants.length > 0 ? filteredRestaurants : restaurants
    const filename = "restaurants_list"
    exportRestaurantsToPDF(dataToExport, filename)
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-xs shrink-0">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Restaurants List</h1>
                <p className="text-xs text-slate-500 mt-0.5">Manage and monitor all restaurants across zones</p>
              </div>
            </div>

            {/* Zone Filter Dropdown */}
            <div className="flex items-center gap-2">
              <AdminZoneSelect
                value={selectedZoneId}
                onChange={setSelectedZoneId}
                zones={filterZones}
                loading={filterZonesLoading}
              />
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          {/* Total Restaurants */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Total restaurants</p>
                <p className="text-2xl font-bold text-slate-900">
                  {loading ? (
                    <span className="inline-block w-12 h-6 rounded bg-slate-200 animate-pulse" />
                  ) : (
                    totalRestaurants
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          {/* Active Restaurants */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Active restaurants</p>
                <p className="text-2xl font-bold text-slate-900">
                  {loading ? (
                    <span className="inline-block w-12 h-6 rounded bg-slate-200 animate-pulse" />
                  ) : (
                    activeRestaurants
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                <Utensils className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          {/* Inactive Restaurants */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Inactive restaurants</p>
                <p className="text-2xl font-bold text-slate-900">
                  {loading ? (
                    <span className="inline-block w-12 h-6 rounded bg-slate-200 animate-pulse" />
                  ) : (
                    inactiveRestaurants
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                <UtensilsCrossed className="w-6 h-6 text-slate-600" />
              </div>
            </div>
          </div>

          {/* Rejected Restaurants */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Rejected restaurants</p>
                <p className="text-2xl font-bold text-slate-900">
                  {loading ? (
                    <span className="inline-block w-12 h-6 rounded bg-slate-200 animate-pulse" />
                  ) : (
                    displayRejectedCount
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>

          {/* Banned Restaurants */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Banned restaurants</p>
                <p className="text-2xl font-bold text-slate-900">
                  {loading ? (
                    <span className="inline-block w-12 h-6 rounded bg-slate-200 animate-pulse" />
                  ) : (
                    displayBannedCount
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                <ShieldX className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Restaurants List Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            {/* View Mode Tabs */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode("active")}
                className={`px-4 py-2.5 text-sm font-semibold rounded-lg border transition-all outline-none ${
                  viewMode === "active"
                    ? "border-blue-600 bg-blue-50/70 text-blue-600 shadow-xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Restaurants List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("rejected")}
                className={`px-4 py-2.5 text-sm font-semibold rounded-lg border transition-all outline-none ${
                  viewMode === "rejected"
                    ? "border-red-600 bg-red-50/70 text-red-600 shadow-xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Rejected Restaurants
              </button>
              <button
                type="button"
                onClick={() => setViewMode("banned")}
                className={`px-4 py-2.5 text-sm font-semibold rounded-lg border transition-all outline-none ${
                  viewMode === "banned"
                    ? "border-rose-600 bg-rose-50/70 text-rose-600 shadow-xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Banned Restaurants
              </button>
            </div>

            {/* Right Action Tools: Search, Export, Add Restaurant */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Search Bar */}
              <div className="relative min-w-[240px] sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Ex: search by Restaurant name"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 py-2 w-full text-sm rounded-lg border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Export Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="px-3.5 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center gap-2 transition-all shadow-2xs whitespace-nowrap">
                    <Download className="w-4 h-4 text-slate-500" />
                    <span>Export</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                  <DropdownMenuLabel className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Export Format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExport} className="cursor-pointer flex items-center gap-2 text-sm text-slate-700 hover:bg-slate-50 py-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    Export as PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Add Restaurant Button */}
              {viewMode === "active" && (
                <button
                  type="button"
                  onClick={() => navigate("/admin/food/restaurants/add")}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2 shadow-xs transition-all whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Restaurant</span>
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-3 text-slate-600">Loading restaurants...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-20">
                <p className="text-lg font-semibold text-red-600 mb-1">Error Loading Data</p>
                <p className="text-sm text-slate-500 mb-4">{error}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th
                      className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('sl')}
                    >
                      <div className="flex items-center gap-1">
                        <span>SL</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'sl' ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Restaurant Info</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'name' ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('owner')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Owner Info</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'owner' ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('zone')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Zone</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'zone' ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('rating')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Rating</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'rating' ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Status</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'status' ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredRestaurants.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                          <p className="text-sm text-slate-500">No restaurants match your search</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRestaurants.map((restaurant, index) => {
                      return (
                      <tr
                        key={restaurant.id}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-slate-700">{index + 1}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer hover:opacity-80 transition-all border border-slate-100"
                              onClick={() => handleViewDetails(restaurant)}
                            >
                              <img
                                src={restaurant.logo || PLACEHOLDER_40}
                                alt={restaurant.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  if (e.target.src !== PLACEHOLDER_40) {
                                    e.target.src = PLACEHOLDER_40
                                  }
                                }}
                              />
                            </div>
                            <div className="flex flex-col">
                              <span 
                                className="text-sm font-medium text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
                                onClick={() => handleViewDetails(restaurant)}
                              >
                                {restaurant.name}
                              </span>
                              <span className="text-xs text-slate-500">ID #{formatRestaurantId(restaurant.originalData?.restaurantId || restaurant.originalData?._id || restaurant._id || restaurant.id)}</span>
                              <span className="text-xs text-slate-500">{renderStars(restaurant.rating)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-slate-900">{restaurant.ownerName}</span>
                            <span className="text-xs text-slate-500">{formatPhone(restaurant.ownerPhone)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-slate-700">{restaurant.zone}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                            <span className="text-sm font-semibold text-slate-900">
                              {(Number(restaurant.rating) || 0).toFixed(1)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {viewMode === "banned" ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-rose-100 text-rose-700">
                                Banned
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Outlet: Offline
                              </span>
                            </div>
                          ) : viewMode === "rejected" ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-red-100 text-red-700">
                                Rejected
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Outlet: Offline
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold ${approvalStatusBadgeClass(restaurant.approvalStatus)}`}>
                                {approvalStatusLabel(restaurant.approvalStatus)}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Outlet: {restaurant.isActive ? "Active" : "Inactive"}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleViewDetails(restaurant)}
                              className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {viewMode === "banned" && (
                              <button
                                onClick={() => handleBanRestaurant(restaurant)}
                                className="p-1.5 rounded text-green-600 hover:bg-green-50 transition-colors"
                                title="Unban Restaurant"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                            )}
                            {viewMode === "active" && (
                              <button
                                onClick={() => handleBanRestaurant(restaurant)}
                                className={`p-1.5 rounded transition-colors ${!restaurant.isActive
                                  ? "text-green-600 hover:bg-green-50"
                                  : "text-red-600 hover:bg-red-50"
                                  }`}
                                title={!restaurant.isActive ? "Unban Restaurant" : "Ban Restaurant"}
                              >
                                <ShieldX className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )})
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Restaurant Details Modal */}
      {selectedRestaurant && (
        <div
          className="fixed inset-0 bg-slate-900/10 backdrop-blur-md z-100 flex items-center justify-center p-4 lg:p-8 transition-all duration-300"
          onClick={closeDetailsModal}
        >
          <div
            className="bg-white rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] border border-slate-200/60 max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-400"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Restaurant Details</h2>
                <p className="text-sm text-slate-500 mt-1">Detailed overview and information</p>
              </div>
              <div className="flex items-center gap-2">
                {normalizeApprovalStatus(restaurantDetails || selectedRestaurant?.originalData || selectedRestaurant) !== "rejected" && (
                  !isEditingDetails ? (
                    <button
                      onClick={handleStartEditDetails}
                      className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                    >
                      Edit Details
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleCancelEditDetails}
                        disabled={savingDetails}
                        className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveDetails}
                        disabled={savingDetails}
                        className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-60 flex items-center gap-2"
                      >
                        {savingDetails && <Loader2 className="w-4 h-4 animate-spin" />}
                        {savingDetails ? "Saving..." : "Save Changes"}
                      </button>
                    </>
                  )
                )}
                <button
                  onClick={closeDetailsModal}
                  className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all duration-200 bg-slate-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Content - Scrollable area */}
            <div className="p-8 overflow-y-auto">

              {loadingDetails && (
                <div className="flex flex-col items-center justify-center py-24">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full border-4 border-slate-100"></div>
                    <div className="absolute inset-0 w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
                  </div>
                  <span className="mt-4 text-slate-500 font-medium tracking-wide">Fetching restaurant data...</span>
                </div>
              )}
              {!loadingDetails && isEditingDetails && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <p className="text-xs text-slate-500 mb-2">Profile Image</p>
                      <div className="flex items-center gap-4">
                        <div className="w-24 h-24 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                          {profileImagePreview ? (
                            <img src={profileImagePreview} alt="Profile preview" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                              <ImageIcon className="w-6 h-6" />
                            </div>
                          )}
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            setProfileImageFile(file || null)
                            if (file) {
                              const localUrl = URL.createObjectURL(file)
                              setProfileImagePreview(localUrl)
                            }
                          }}
                          className="block w-full text-sm text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Restaurant Name</label>
                      <input type="text" value={detailsForm.name} onChange={(e) => setDetailsForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Diet type</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setDetailsForm((prev) => ({
                              ...prev,
                              foodType: "Veg",
                              pureVegRestaurant: true,
                              pureVeganRestaurant: false,
                            }))
                          }
                          className={`px-3 py-1.5 text-xs rounded-full border ${
                            detailsForm.foodType === "Veg"
                              ? "bg-green-600 text-white border-green-600"
                              : "bg-white text-slate-700 border-slate-300"
                          }`}
                        >
                          Pure Veg
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDetailsForm((prev) => ({
                              ...prev,
                              foodType: "Non-Veg",
                              pureVegRestaurant: false,
                              pureVeganRestaurant: false,
                            }))
                          }
                          className={`px-3 py-1.5 text-xs rounded-full border ${
                            detailsForm.foodType === "Non-Veg"
                              ? "bg-red-600 text-white border-red-600"
                              : "bg-white text-slate-700 border-slate-300"
                          }`}
                        >
                          Non-Veg
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDetailsForm((prev) => ({
                              ...prev,
                              foodType: "Mixed",
                              pureVegRestaurant: false,
                              pureVeganRestaurant: false,
                            }))
                          }
                          className={`px-3 py-1.5 text-xs rounded-full border ${
                            detailsForm.foodType === "Mixed"
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white text-slate-700 border-slate-300"
                          }`}
                        >
                          Mixed
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Restaurant Email</label>
                      <input type="email" value={detailsForm.email} onChange={(e) => setDetailsForm((prev) => ({ ...prev, email: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Owner Name</label>
                      <input type="text" value={detailsForm.ownerName} onChange={(e) => setDetailsForm((prev) => ({ ...prev, ownerName: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Owner Email</label>
                      <input type="email" value={detailsForm.ownerEmail} onChange={(e) => setDetailsForm((prev) => ({ ...prev, ownerEmail: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Owner Phone</label>
                      <input type="text" value={detailsForm.ownerPhone} onChange={(e) => setDetailsForm((prev) => ({ ...prev, ownerPhone: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Primary Contact</label>
                      <input type="text" value={detailsForm.primaryContactNumber} onChange={(e) => setDetailsForm((prev) => ({ ...prev, primaryContactNumber: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Opening Time</label>
                      <input type="text" value={detailsForm.openingTime} onChange={(e) => setDetailsForm((prev) => ({ ...prev, openingTime: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Closing Time</label>
                      <input type="text" value={detailsForm.closingTime} onChange={(e) => setDetailsForm((prev) => ({ ...prev, closingTime: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Estimated Delivery Time</label>
                      <input type="text" value={detailsForm.estimatedDeliveryTime} onChange={(e) => setDetailsForm((prev) => ({ ...prev, estimatedDeliveryTime: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                    </div>
                    <div className="md:col-span-2 flex items-center gap-3">
                      <input
                        id="restaurant-status-active"
                        type="checkbox"
                        checked={detailsForm.isActive}
                        onChange={(e) => setDetailsForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <label htmlFor="restaurant-status-active" className="text-sm text-slate-700">
                        Restaurant is active
                      </label>
                    </div>
                  </div>
                </div>
              )}
              {!loadingDetails && !isEditingDetails && (restaurantDetails || selectedRestaurant) && (() => {
                const r = restaurantDetails || selectedRestaurant?.originalData || selectedRestaurant
                const detailsApprovalStatus = normalizeApprovalStatus(r)
                const profileImgUrl = getPrimaryRestaurantImage(r)
                const coverImages = Array.isArray(r?.coverImages) ? r.coverImages.map(normalizeImageUrl).filter(Boolean) : []
                const displayAddress = getRestaurantDisplayAddress(r)
                const hasFlatAddress = Boolean(displayAddress)
                const menuImages = Array.isArray(r?.menuImages) ? r.menuImages.map(normalizeImageUrl).filter(Boolean) : []
                const cuisinesList =
                  (Array.isArray(r?.cuisines) && r.cuisines.length ? r.cuisines : null) ||
                  (Array.isArray(r?.onboarding?.step2?.cuisines) && r.onboarding.step2.cuisines.length ? r.onboarding.step2.cuisines : null) ||
                  null
                const openingTimeVal = r?.openingTime || r?.deliveryTimings?.openingTime || r?.onboarding?.step2?.deliveryTimings?.openingTime || ""
                const closingTimeVal = r?.closingTime || r?.deliveryTimings?.closingTime || r?.onboarding?.step2?.deliveryTimings?.closingTime || ""
                const openDaysVal =
                  (Array.isArray(r?.openDays) && r.openDays.length ? r.openDays : null) ||
                  (Array.isArray(r?.onboarding?.step2?.openDays) && r.onboarding.step2.openDays.length ? r.onboarding.step2.openDays : null) ||
                  null
                const offerVal = r?.offer || r?.onboarding?.step4?.offer || ""
                const estimatedDeliveryTimeVal = r?.estimatedDeliveryTime || r?.onboarding?.step4?.estimatedDeliveryTime || ""
                const featuredDishVal = r?.featuredDish || r?.onboarding?.step4?.featuredDish || ""
                const featuredPriceVal = r?.featuredPrice ?? r?.onboarding?.step4?.featuredPrice
                const diningSettingsVal = r?.diningSettings || r?.onboarding?.step4?.diningSettings || null
                const panDocumentUrl = typeof r?.panImage === "string" ? r.panImage : (r?.panImage?.url || r?.onboarding?.step3?.pan?.image?.url || "")
                const gstDocumentUrl = typeof r?.gstImage === "string" ? r.gstImage : (r?.gstImage?.url || r?.onboarding?.step3?.gst?.image?.url || "")
                const fssaiDocumentUrl = typeof r?.fssaiImage === "string" ? r.fssaiImage : (r?.fssaiImage?.url || r?.onboarding?.step3?.fssai?.image?.url || "")
                const hasPanSection = Boolean(r?.panNumber || r?.nameOnPan || panDocumentUrl || r?.onboarding?.step3?.pan?.panNumber || r?.onboarding?.step3?.pan?.nameOnPan)
                const hasGstSection = Boolean(
                  r?.gstNumber ||
                  r?.gstLegalName ||
                  r?.gstAddress ||
                  gstDocumentUrl ||
                  r?.onboarding?.step3?.gst?.gstNumber ||
                  r?.onboarding?.step3?.gst?.legalName ||
                  r?.onboarding?.step3?.gst?.address
                )
                const hasFssaiSection = Boolean(
                  r?.fssaiNumber ||
                  r?.fssaiExpiry ||
                  fssaiDocumentUrl ||
                  r?.onboarding?.step3?.fssai?.registrationNumber ||
                  r?.onboarding?.step3?.fssai?.expiryDate
                )
                const hasBankSection = Boolean(
                  r?.accountNumber ||
                  r?.ifscCode ||
                  r?.accountHolderName ||
                  r?.accountType ||
                  r?.onboarding?.step3?.bank?.accountNumber ||
                  r?.onboarding?.step3?.bank?.ifscCode ||
                  r?.onboarding?.step3?.bank?.accountHolderName ||
                  r?.onboarding?.step3?.bank?.accountType
                )
                const hasRegistrationDocuments = hasPanSection || hasGstSection || hasFssaiSection || hasBankSection
                return (
                <div className="space-y-10">
                  {detailsApprovalStatus === "rejected" && r?.rejectionReason && (
                    <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
                      <p className="font-bold mb-1">Rejection Reason:</p>
                      <p className="text-red-700 font-normal">{r.rejectionReason}</p>
                    </div>
                  )}
                  {/* Restaurant Basic Info */}
                  <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
                    <div className="w-32 h-32 rounded-3xl overflow-hidden bg-slate-50 shrink-0 shadow-inner group">
                      <img
                        src={profileImgUrl || PLACEHOLDER_128}
                        alt={r?.restaurantName || r?.name || "Restaurant"}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        onError={(e) => {
                          e.target.src = PLACEHOLDER_128
                        }}
                      />
                    </div>
                    <div className="flex-1 text-center md:text-left pt-2">
                      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
                        <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                          {r?.restaurantName || r?.name || "N/A"}
                        </h3>
                        <div className="flex items-center justify-center md:justify-start gap-2">
                          {detailsApprovalStatus === "banned" ? (
                            <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700">
                              Banned
                            </span>
                          ) : detailsApprovalStatus === "rejected" ? (
                            <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-red-100 text-red-700">
                              Rejected
                            </span>
                          ) : (
                            <span className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${r?.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {r?.isActive !== false ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-center md:justify-start gap-6 flex-wrap">
                        {(r?.ratings?.average != null) && (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 rounded-xl">
                            <Star className="w-4 h-4 fill-yellow-400 text-yellow-500" />
                            <span className="text-sm font-bold text-yellow-700">
                              {(r.ratings?.average ?? 0).toFixed(1)}
                            </span>
                            <span className="text-xs text-yellow-600/70 ml-1 font-medium">
                              ({(r.ratings?.count ?? 0)} reviews)
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                          <Building2 className="w-4 h-4" />
                          <span className="text-xs font-bold tracking-wider">{formatRestaurantId(r?.restaurantId || r?._id)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                    {/* Owner Information */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                        <User className="w-4 h-4 text-blue-600" />
                        <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Owner Information</h4>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-start gap-4 p-4 rounded-2xl bg-blue-50/30 border border-blue-100/30">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                            <User className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-0.5">Full Name</p>
                            <p className="text-base font-bold text-slate-800">
                              {r?.ownerName || "N/A"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-4 p-4 rounded-2xl bg-emerald-50/30 border border-emerald-100/30">
                          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                            <Phone className="w-5 h-5 text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mb-0.5">Contact Number</p>
                            <p className="text-base font-bold text-slate-800">
                              {r?.ownerPhone || r?.phone || "N/A"}
                            </p>
                          </div>
                        </div>
                        {(r?.ownerEmail || r?.email) && (
                          <div className="flex items-start gap-4 p-4 rounded-2xl bg-indigo-50/30 border border-indigo-100/30">
                            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                              <Mail className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider mb-0.5">Email Address</p>
                              <p className="text-base font-bold text-slate-800">{r.ownerEmail || r.email}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Location & Contact */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-slate-900">Location & Contact</h4>
                        {isEditingLocation ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold">
                            <Settings className="w-3.5 h-3.5" />
                            Editable Below
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-3">
                        {!isEditingLocation && hasFlatAddress && (
                          <div className="flex items-start gap-3">
                            <MapPin className="w-5 h-5 text-slate-400 mt-0.5" />
                            <div>
                              <p className="text-xs text-slate-500">Address</p>
                              <p className="text-sm font-medium text-slate-900">
                                {displayAddress}
                              </p>
                            </div>
                          </div>
                        )}
                        {isEditingLocation && (
                          <p className="text-xs text-indigo-700 font-medium bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                            Location editor is shown at the bottom of this details modal.
                          </p>
                        )}
                        {(r?.primaryContactNumber || r?.phone) && (
                          <div className="flex items-center gap-3">
                            <Phone className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500">Primary Contact</p>
                              <p className="text-sm font-medium text-slate-900">{r.primaryContactNumber || r.phone}</p>
                            </div>
                          </div>
                        )}
                        {(r?.email && !r?.ownerEmail) && (
                          <div className="flex items-center gap-3">
                            <Mail className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500">Restaurant Email</p>
                              <p className="text-sm font-medium text-slate-900">{r.email}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Timings */}
                  <div className="grid grid-cols-1 gap-6">

                    <div>
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Timings & Status</h4>
                      <div className="space-y-3">
                        {(openingTimeVal || closingTimeVal) && (
                          <div className="flex items-center gap-3">
                            <Clock className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500">Opening / Closing</p>
                              <p className="text-sm font-medium text-slate-900">
                                {formatTime12Hour(openingTimeVal)} – {formatTime12Hour(closingTimeVal)}
                              </p>
                            </div>
                          </div>
                        )}
                        {estimatedDeliveryTimeVal && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Estimated Delivery Time</p>
                            <p className="text-sm font-medium text-slate-900">{estimatedDeliveryTimeVal}</p>
                          </div>
                        )}
                        {openDaysVal && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Open Days</p>
                            <div className="flex flex-wrap gap-2">
                              {openDaysVal.map((day, idx) => (
                                <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-medium capitalize">{day}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Status</p>
                          {detailsApprovalStatus === "banned" ? (
                            <>
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-rose-100 text-rose-700">
                                Banned
                              </span>
                              <p className="mt-2 text-xs text-slate-500">
                                Outlet: Offline
                              </p>
                            </>
                          ) : (
                            <>
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${approvalStatusBadgeClass(detailsApprovalStatus)}`}>
                                {approvalStatusLabel(detailsApprovalStatus)}
                              </span>
                              <p className="mt-2 text-xs text-slate-500">
                                Outlet: {(r?.isActive !== false) ? "Active" : "Inactive"}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Media */}
                  {(profileImgUrl || coverImages.length > 0 || menuImages.length > 0) && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Media</h4>
                      <div className="space-y-4">
                        {profileImgUrl && (
                          <div>
                            <p className="text-xs text-slate-500 mb-2">Profile Image</p>
                            <a
                              href={profileImgUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
                            >
                              <ImageIcon className="w-4 h-4" />
                              <span>View Profile Image</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                        {coverImages.length > 0 && (
                          <div>
                            <p className="text-xs text-slate-500 mb-2">Restaurant Photos</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                              {coverImages.map((url, idx) => (
                                <a
                                  key={`${url}-${idx}`}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="relative aspect-4/5 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:border-slate-300"
                                  title="Open restaurant photo"
                                >
                                  <img
                                    src={url}
                                    alt={`Restaurant ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.target.style.display = "none"
                                    }}
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        {menuImages.length > 0 && (
                          <div>
                            <p className="text-xs text-slate-500 mb-2">Menu Images</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                              {menuImages.map((url, idx) => (
                                <a
                                  key={`${url}-${idx}`}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="relative aspect-4/5 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:border-slate-300"
                                  title="Open menu image"
                                >
                                  <img
                                    src={url}
                                    alt={`Menu ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.target.style.display = "none"
                                    }}
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Registration Information */}
                  {(r?.createdAt || r?.updatedAt) && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Registration Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {r.createdAt && (
                          <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Registration Date & Time</p>
                              <p className="font-medium text-slate-900">
                                {new Date(r.createdAt).toLocaleString('en-IN', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </div>
                        )}
                        {r.updatedAt && (
                          <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Last Updated</p>
                              <p className="font-medium text-slate-900">
                                {new Date(r.updatedAt).toLocaleString('en-IN', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </div>
                        )}
                        {r.restaurantId && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Restaurant ID</p>
                            <p className="font-medium text-slate-900">{formatRestaurantId(r.restaurantId)}</p>
                          </div>
                        )}
                        {r.slug && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Slug</p>
                            <p className="font-medium text-slate-900">{r.slug}</p>
                          </div>
                        )}
                        {r.phoneVerified !== undefined && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Phone Verified</p>
                            <p className="font-medium text-slate-900">{r.phoneVerified ? "Yes" : "No"}</p>
                          </div>
                        )}
                        {r.signupMethod && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Signup Method</p>
                            <p className="font-medium text-slate-900 capitalize">{r.signupMethod}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Registration Documents - flat (PAN, GST, FSSAI, Bank) or onboarding.step3 */}
                  {hasRegistrationDocuments && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Registration Documents</h4>
                      <div className="space-y-6">
                        {/* PAN – flat or onboarding.step3 */}
                        {hasPanSection && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              PAN Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {(r.panNumber || r?.onboarding?.step3?.pan?.panNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">PAN Number</p>
                                  <p className="font-medium text-slate-900">{r.panNumber || r.onboarding?.step3?.pan?.panNumber}</p>
                                </div>
                              )}
                              {(r.nameOnPan || r?.onboarding?.step3?.pan?.nameOnPan) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Name on PAN</p>
                                  <p className="font-medium text-slate-900">{r.nameOnPan || r.onboarding?.step3?.pan?.nameOnPan}</p>
                                </div>
                              )}
                              {panDocumentUrl && (
                                <div className="md:col-span-2">
                                  <p className="text-xs text-slate-500 mb-2">PAN Document</p>
                                  <a href={panDocumentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700">
                                    <ImageIcon className="w-4 h-4" />
                                    <span>View PAN Document</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* GST – flat or onboarding.step3 */}
                        {hasGstSection && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              GST Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {(r.gstRegistered != null || r?.onboarding?.step3?.gst?.isRegistered != null) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">GST Registered</p>
                                  <p className="font-medium text-slate-900">
                                    {r.gstRegistered != null ? (r.gstRegistered ? "Yes" : "No") : (r?.onboarding?.step3?.gst?.isRegistered ? "Yes" : "No")}
                                  </p>
                                </div>
                              )}
                              {(r.gstNumber || r?.onboarding?.step3?.gst?.gstNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">GST Number</p>
                                  <p className="font-medium text-slate-900">{r.gstNumber || r.onboarding?.step3?.gst?.gstNumber}</p>
                                </div>
                              )}
                              {(r.gstLegalName || r?.onboarding?.step3?.gst?.legalName) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Legal Name</p>
                                  <p className="font-medium text-slate-900">{r.gstLegalName || r.onboarding?.step3?.gst?.legalName}</p>
                                </div>
                              )}
                              {(r.gstAddress || r?.onboarding?.step3?.gst?.address) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">GST Address</p>
                                  <p className="font-medium text-slate-900">{r.gstAddress || r.onboarding?.step3?.gst?.address}</p>
                                </div>
                              )}
                              {gstDocumentUrl && (
                                <div className="md:col-span-2">
                                  <p className="text-xs text-slate-500 mb-2">GST Document</p>
                                  <a href={gstDocumentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700">
                                    <ImageIcon className="w-4 h-4" />
                                    <span>View GST Document</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* FSSAI – flat or onboarding.step3 */}
                        {hasFssaiSection && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              FSSAI Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {(r.fssaiNumber || r?.onboarding?.step3?.fssai?.registrationNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">FSSAI Registration Number</p>
                                  <p className="font-medium text-slate-900">{r.fssaiNumber || r.onboarding?.step3?.fssai?.registrationNumber}</p>
                                </div>
                              )}
                              {(r.fssaiExpiry || r?.onboarding?.step3?.fssai?.expiryDate) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">FSSAI Expiry Date</p>
                                  <p className="font-medium text-slate-900">
                                    {new Date(r.fssaiExpiry || r.onboarding?.step3?.fssai?.expiryDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}
                                  </p>
                                </div>
                              )}
                              {fssaiDocumentUrl && (
                                <div className="md:col-span-2">
                                  <p className="text-xs text-slate-500 mb-2">FSSAI Document</p>
                                  <a href={fssaiDocumentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700">
                                    <ImageIcon className="w-4 h-4" />
                                    <span>View FSSAI Document</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Bank – flat or onboarding.step3 */}
                        {hasBankSection && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <CreditCard className="w-4 h-4" />
                              Bank Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {(r.accountNumber || r?.onboarding?.step3?.bank?.accountNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Account Number</p>
                                  <p className="font-medium text-slate-900">{r.accountNumber || r.onboarding?.step3?.bank?.accountNumber}</p>
                                </div>
                              )}
                              {(r.ifscCode || r?.onboarding?.step3?.bank?.ifscCode) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">IFSC Code</p>
                                  <p className="font-medium text-slate-900">{r.ifscCode || r.onboarding?.step3?.bank?.ifscCode}</p>
                                </div>
                              )}
                              {(r.accountHolderName || r?.onboarding?.step3?.bank?.accountHolderName) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Account Holder Name</p>
                                  <p className="font-medium text-slate-900">{r.accountHolderName || r.onboarding?.step3?.bank?.accountHolderName}</p>
                                </div>
                              )}
                              {(r.accountType || r?.onboarding?.step3?.bank?.accountType) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Account Type</p>
                                  <p className="font-medium text-slate-900 capitalize">{r.accountType || r.onboarding?.step3?.bank?.accountType}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Address at registration (flat) */}
                  {hasFlatAddress && !r?.onboarding?.step1?.location && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Address (at registration)</h4>
                      <p className="text-sm font-medium text-slate-900">{displayAddress}</p>
                    </div>
                  )}

                  {/* Onboarding Step 1 Details */}
                  {r?.onboarding?.step1 && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Registration Step 1 Details</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {r.onboarding.step1.restaurantName && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Restaurant Name (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step1.restaurantName}</p>
                          </div>
                        )}
                        {r.onboarding.step1.ownerName && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Owner Name (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step1.ownerName}</p>
                          </div>
                        )}
                        {r.onboarding.step1.ownerEmail && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Owner Email (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step1.ownerEmail}</p>
                          </div>
                        )}
                        {r.onboarding.step1.ownerPhone && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Owner Phone (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step1.ownerPhone}</p>
                          </div>
                        )}
                        {r.onboarding.step1.primaryContactNumber && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Primary Contact (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step1.primaryContactNumber}</p>
                          </div>
                        )}
                        {r.onboarding.step1.location && (
                          <div className="md:col-span-2">
                            <p className="text-xs text-slate-500 mb-1">Location (at registration)</p>
                            <p className="font-medium text-slate-900">
                              {r.onboarding.step1.location.addressLine1 || ""}
                              {r.onboarding.step1.location.addressLine2 && `, ${r.onboarding.step1.location.addressLine2}`}
                              {r.onboarding.step1.location.area && `, ${r.onboarding.step1.location.area}`}
                              {r.onboarding.step1.location.city && `, ${r.onboarding.step1.location.city}`}
                              {r.onboarding.step1.location.landmark && `, ${r.onboarding.step1.location.landmark}`}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Onboarding Step 2 Details */}
                  {r?.onboarding?.step2 && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Registration Step 2 Details</h4>
                      <div className="space-y-4">
                        {r.onboarding.step2.cuisines && Array.isArray(r.onboarding.step2.cuisines) && r.onboarding.step2.cuisines.length > 0 && (
                          <div>
                            <p className="text-xs text-slate-500 mb-2">Cuisines (at registration)</p>
                            <div className="flex flex-wrap gap-2">
                              {r.onboarding.step2.cuisines.map((cuisine, idx) => (
                                <span key={idx} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                                  {cuisine}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {r.onboarding.step2.deliveryTimings && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Opening Time (at registration)</p>
                              <p className="font-medium text-slate-900">{formatTime12Hour(r.onboarding.step2.deliveryTimings.openingTime)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Closing Time (at registration)</p>
                              <p className="font-medium text-slate-900">{formatTime12Hour(r.onboarding.step2.deliveryTimings.closingTime)}</p>
                            </div>
                          </div>
                        )}
                        {r.onboarding.step2.openDays && Array.isArray(r.onboarding.step2.openDays) && r.onboarding.step2.openDays.length > 0 && (
                          <div>
                            <p className="text-xs text-slate-500 mb-2">Open Days (at registration)</p>
                            <div className="flex flex-wrap gap-2">
                              {r.onboarding.step2.openDays.map((day, idx) => (
                                <span key={idx} className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium capitalize">
                                  {day}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {r.onboarding.step2.profileImageUrl?.url && (
                          <div>
                            <p className="text-xs text-slate-500 mb-2">Profile Image (at registration)</p>
                            <a
                              href={r.onboarding.step2.profileImageUrl.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block"
                            >
                              <img
                                src={r.onboarding.step2.profileImageUrl.url}
                                alt="Profile"
                                className="w-32 h-32 rounded-lg object-cover border border-slate-200 hover:border-blue-500 transition-colors"
                                onError={(e) => {
                                  e.target.src = PLACEHOLDER_128
                                }}
                              />
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Onboarding Step 4 Details */}
                  {r?.onboarding?.step4 && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Registration Step 4 Details</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {r.onboarding.step4.estimatedDeliveryTime && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Estimated Delivery Time (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step4.estimatedDeliveryTime}</p>
                          </div>
                        )}
                        {r.onboarding.step4.distance && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Distance (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step4.distance}</p>
                          </div>
                        )}
                        {r.onboarding.step4.featuredDish && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Featured Dish (at registration)</p>
                            <p className="font-medium text-slate-900">{r.onboarding.step4.featuredDish}</p>
                          </div>
                        )}
                        {r.onboarding.step4.offer && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Offer (at registration)</p>
                            <p className="font-medium text-green-600">{r.onboarding.step4.offer}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Additional Information */}
                  {(r?.slug || r?.restaurantId || r?.phoneVerified !== undefined || r?.signupMethod) && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Additional Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {r?.slug && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Slug</p>
                            <p className="font-medium text-slate-900">{r.slug}</p>
                          </div>
                        )}
                        {r?.restaurantId && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Restaurant ID</p>
                            <p className="font-medium text-slate-900">{formatRestaurantId(r.restaurantId)}</p>
                          </div>
                        )}
                        {r?.phoneVerified !== undefined && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Phone Verified</p>
                            <p className="font-medium text-slate-900">{r.phoneVerified ? "Yes" : "No"}</p>
                          </div>
                        )}
                        {r?.signupMethod && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Signup Method</p>
                            <p className="font-medium text-slate-900 capitalize">{r.signupMethod}</p>
                          </div>
                        )}
                        {r?.onboarding?.completedSteps !== undefined && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Onboarding Steps Completed</p>
                            <p className="font-medium text-slate-900">{r.onboarding.completedSteps} / 4</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {isEditingLocation && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Location Editor</h4>
                      <div className="space-y-3 border border-indigo-100 bg-indigo-50/40 rounded-xl p-4">
                        <p className="text-xs text-indigo-700 font-semibold">
                          Update restaurant location using dropdown (accurate) + select service zone.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="md:col-span-2">
                            <label className="block text-xs text-slate-600 mb-1 font-semibold">Service Zone*</label>
                            <select
                              value={locationForm.zoneId || ""}
                              onChange={(e) => setLocationForm((prev) => ({ ...prev, zoneId: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                              <option value="">{zonesLoading ? "Loading zones..." : "Select a zone"}</option>
                              {zones.map((z) => (
                                <option key={z._id || z.id} value={z._id || z.id}>
                                  {z.name || z.zoneName || z.serviceLocation || "Zone"}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-xs text-slate-600 mb-1 font-semibold">Search location*</label>
                            <input
                              ref={locationSearchInputRef}
                              type="text"
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                              placeholder="Start typing and choose from dropdown..."
                            />
                            <p className="text-[11px] text-slate-500 mt-1">
                              Select from dropdown to auto-fill address and coordinates.
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-xs text-slate-500 mb-1">Formatted Address</label>
                            <input
                              type="text"
                              value={locationForm.formattedAddress}
                              readOnly
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Area</label>
                            <input
                              type="text"
                              value={locationForm.area}
                              readOnly
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">City</label>
                            <input
                              type="text"
                              value={locationForm.city}
                              readOnly
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">State</label>
                            <input
                              type="text"
                              value={locationForm.state}
                              readOnly
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Pincode</label>
                            <input
                              type="text"
                              value={locationForm.pincode}
                              readOnly
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs text-slate-500 mb-1">Landmark (optional)</label>
                            <input
                              type="text"
                              value={locationForm.landmark}
                              onChange={(e) => setLocationForm((prev) => ({ ...prev, landmark: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            />
                          </div>
                        </div>

                        {locationEditError && <p className="text-xs text-red-600">{locationEditError}</p>}
                        <button
                          onClick={handleSaveLocation}
                          disabled={savingLocation}
                          className={`inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-semibold text-white ${savingLocation ? "bg-indigo-300 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"}`}
                        >
                          {savingLocation ? "Saving..." : "Save Location"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                )
              })()}
              {!loadingDetails && !restaurantDetails && !selectedRestaurant && (
                <div className="flex flex-col items-center justify-center py-20">
                  <p className="text-lg font-semibold text-slate-700 mb-2">No Details Available</p>
                  <p className="text-sm text-slate-500">Unable to load restaurant details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ban/Unban Confirmation Dialog */}
      {banConfirmDialog && (
        <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={cancelBanRestaurant}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${banConfirmDialog.action === 'ban' ? 'bg-red-100' : 'bg-green-100'
                  }`}>
                  {banConfirmDialog.action === 'ban' ? (
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                  ) : (
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {banConfirmDialog.action === 'ban' ? 'Ban Restaurant' : 'Unbanned Restaurant'}
                  </h3>
                  <p className="text-sm text-slate-600">
                    {banConfirmDialog.restaurant.name}
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-700 mb-6">
                {banConfirmDialog.action === 'ban'
                  ? 'Are you sure you want to ban this restaurant? They will not be able to receive orders or access their account.'
                  : 'Are you sure you want to unbanned this Restautant?'
                }
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={cancelBanRestaurant}
                  disabled={banning}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmBanRestaurant}
                  disabled={banning}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${banConfirmDialog.action === 'ban'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                    }`}
                >
                  {banning ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {banConfirmDialog.action === 'ban' ? 'Banning...' : 'Unbanning...'}
                    </span>
                  ) : (
                    banConfirmDialog.action === 'ban' ? 'Ban Restaurant' : 'Unbanned Restaurant'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


