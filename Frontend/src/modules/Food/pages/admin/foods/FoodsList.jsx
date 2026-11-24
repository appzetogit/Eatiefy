import { useState, useMemo, useEffect, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { Search, Trash2, Loader2, Eye, Pencil, Plus, Save, ChevronDown } from "lucide-react"
import { adminAPI, uploadAPI } from "@food/api"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@food/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@food/components/ui/popover"
import { getFoodDisplayPrice, getFoodVariants } from "@food/utils/foodVariants"
import {
  formatVeganBlockMessage,
  getVeganFoodTypeBlockReason,
} from "@food/utils/veganFoodGuard"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const createFoodForm = () => ({
  restaurantId: "",
  zoneId: "",
  categoryId: "",
  categoryName: "",
  name: "",
  price: "",
  // Admin-only override of the price (empty = none). Hidden from the restaurant.
  adminPrice: "",
  variants: [],
  description: "",
  image: "",
  foodType: "Non-Veg",
  isAvailable: true,
  preparationTime: "",
})

const createVariantDraft = (variant = {}) => ({
  id: String(variant?.id || variant?._id || `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  name: String(variant?.name || ""),
  price: variant?.price != null ? String(variant.price) : "",
})

const PLACEHOLDER_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-slate-500",
]

const isRealFoodImage = (url) => {
  if (!url || typeof url !== "string") return false
  const trimmed = url.trim()
  if (!trimmed) return false
  if (trimmed.includes("via.placeholder.com")) return false
  if (trimmed.includes("placehold")) return false
  return /^(https?:\/\/|blob:|data:)/i.test(trimmed)
}

const getFoodInitial = (name) => {
  const letter = String(name || "").trim().charAt(0).toUpperCase()
  return /[A-Z0-9]/.test(letter) ? letter : "?"
}

const getPlaceholderColor = (name) => {
  const key = String(name || "")
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash + key.charCodeAt(i) * (i + 1)) % PLACEHOLDER_COLORS.length
  }
  return PLACEHOLDER_COLORS[hash] || PLACEHOLDER_COLORS[0]
}

function FoodImageThumb({ name, src, size = "md", className = "" }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])
  const hasImage = isRealFoodImage(src) && !failed
  const sizeClass =
    size === "lg" ? "w-20 h-20 rounded-xl text-2xl" : "w-10 h-10 rounded-full text-sm"

  return (
    <div className={`${sizeClass} overflow-hidden bg-slate-100 flex items-center justify-center ${className}`}>
      <img
        src={hasImage ? src : dishFallbackImage}
        alt={name || "Food"}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export default function FoodsList() {
  const { canCreate, canEdit, canDelete } = useAdminPermissions()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedRestaurant, setSelectedRestaurant] = useState("all")
  const [zones, setZones] = useState([])
  const [selectedZone, setSelectedZone] = useState("all")
  const [zonesLoading, setZonesLoading] = useState(false)
  const [foods, setFoods] = useState([])
  const [totalFoods, setTotalFoods] = useState(0)
  const [restaurantsForFilter, setRestaurantsForFilter] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [selectedFood, setSelectedFood] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showFoodFormModal, setShowFoodFormModal] = useState(false)
  const [foodFormMode, setFoodFormMode] = useState("add")
  const [foodForm, setFoodForm] = useState(createFoodForm())
  const [editingFood, setEditingFood] = useState(null)
  const [submittingFood, setSubmittingFood] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [categorySearch, setCategorySearch] = useState("")
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false)
  const [selectedImageFile, setSelectedImageFile] = useState(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('admin_foods_pageSize')) || 20)
  const [imageVersion, setImageVersion] = useState(Date.now())

  const isFormDirty = useMemo(() => {
    if (foodFormMode === "edit") return true;
    const defaultForm = createFoodForm()
    const isBasicDirty = 
      foodForm.restaurantId !== defaultForm.restaurantId ||
      foodForm.zoneId !== defaultForm.zoneId ||
      foodForm.categoryId !== defaultForm.categoryId ||
      foodForm.categoryName !== defaultForm.categoryName ||
      foodForm.name !== defaultForm.name ||
      foodForm.price !== defaultForm.price ||
      foodForm.adminPrice !== defaultForm.adminPrice ||
      foodForm.description !== defaultForm.description ||
      foodForm.foodType !== defaultForm.foodType ||
      foodForm.isAvailable !== defaultForm.isAvailable ||
      foodForm.preparationTime !== defaultForm.preparationTime;
    
    const hasVariants = foodForm.variants && foodForm.variants.length > 0;
    const hasImage = selectedImageFile !== null;
    
    return isBasicDirty || hasVariants || hasImage;
  }, [foodForm, selectedImageFile, foodFormMode]);

  const getItemCreatedMs = (item = {}) => {
    const direct = [item.createdAt, item.addedAt, item.requestedAt, item.updatedAt]
      .map((v) => new Date(v).getTime())
      .find((ms) => Number.isFinite(ms) && ms > 0)
    if (direct) return direct

    const rawId = String(item.id || "")
    const match = rawId.match(/\d{10,}/)
    if (match) {
      const fromId = Number(match[0])
      if (Number.isFinite(fromId) && fromId > 0) return fromId
    }
    return 0
  }

  const toArray = (value) => (Array.isArray(value) ? value : [])
  const withImageVersion = (url) => {
    if (!isRealFoodImage(url)) return ""
    return `${url}${url.includes("?") ? "&" : "?"}v=${imageVersion}`
  }

  const fetchRestaurantsForFilter = useCallback(async () => {
    try {
      const [activeRestaurantsResponse, inactiveRestaurantsResponse] = await Promise.all([
        adminAPI.getRestaurants({ limit: 1000 }),
        adminAPI.getRestaurants({ limit: 1000, status: "inactive" }),
      ])

      const extractRestaurants = (response) => {
        const data = response?.data?.data ?? response?.data
        return Array.isArray(data?.restaurants)
          ? data.restaurants
          : Array.isArray(data)
            ? data
            : []
      }
      const activeRestaurants = extractRestaurants(activeRestaurantsResponse)
      const inactiveRestaurants = extractRestaurants(inactiveRestaurantsResponse)

      const restaurantsMap = new Map()
      ;[...activeRestaurants, ...inactiveRestaurants].forEach((restaurant) => {
        const restaurantId = String(restaurant?._id || restaurant?.id || "")
        if (!restaurantId) return
        if (!restaurantsMap.has(restaurantId)) {
          restaurantsMap.set(restaurantId, restaurant)
        }
      })
      const restaurants = Array.from(restaurantsMap.values())
      setRestaurantsForFilter(
        restaurants
          .map((restaurant) => {
            const foodType = restaurant?.foodType || (restaurant?.pureVegRestaurant ? "Veg" : "Mixed")
            const isPureVeg =
              foodType === "Veg" ||
              restaurant?.pureVegRestaurant === true ||
              restaurant?.pureVeganRestaurant === true
            return {
              id: String(restaurant?._id || restaurant?.id || ""),
              name: restaurant?.name || restaurant?.restaurantName || "Unknown Restaurant",
              zoneId: String(restaurant?.zoneId?._id || restaurant?.zoneId || ""),
              foodType,
              pureVegRestaurant: isPureVeg,
              pureVeganRestaurant: restaurant?.pureVeganRestaurant === true,
            }
          })
          .filter((restaurant) => restaurant.id)
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    } catch (error) {
      debugError("Error fetching restaurants for filter:", error)
    }
  }, [])

  const fetchZones = useCallback(async () => {
    try {
      setZonesLoading(true)
      const res = await adminAPI.getZones({ limit: 1000, isActive: true })
      const data = res?.data?.data ?? res?.data
      const list = Array.isArray(data?.zones)
        ? data.zones
        : Array.isArray(data)
          ? data
          : []
      setZones(list)
    } catch (error) {
      debugError("Error fetching zones:", error)
      setZones([])
    } finally {
      setZonesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchZones()
  }, [fetchZones])

  useEffect(() => {
    fetchRestaurantsForFilter()
  }, [fetchRestaurantsForFilter])

  // Warn user before refreshing if form is open and dirty
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (showFoodFormModal && isFormDirty) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [showFoodFormModal, isFormDirty])

  const fetchAllFoods = useCallback(async () => {
    try {
      setLoading(true)

      const params = {
        page: currentPage,
        limit: pageSize,
        // Ask the server for approved foods only. It used to return every status and the
        // page dropped the non-approved ones afterwards, so the total and the pages
        // counted rows that were never shown.
        approvalStatus: "approved",
        ...(searchQuery.trim() && { search: searchQuery.trim() }),
        ...(selectedRestaurant !== "all" && { restaurantId: selectedRestaurant }),
        ...(selectedZone !== "all" && { zoneId: selectedZone }),
      }

      const foodsRes = await adminAPI.getFoods(params)
      const data = foodsRes?.data?.data ?? foodsRes?.data
      const list = Array.isArray(data?.foods)
        ? data.foods
        : Array.isArray(data)
          ? data
          : []
      const total = data?.total ?? list.length

      const approvedOnly = Array.isArray(list)
        ? list.filter((f) => String(f?.approvalStatus || "").toLowerCase() === "approved")
        : []
      setFoods(
        Array.isArray(approvedOnly)
          ? approvedOnly.map((f) => ({
              id: String(f.id || f._id || ""),
              _id: f._id || f.id,
              name: f.name || "Unnamed Item",
              image: f.image || "",
              status: f.isAvailable !== false && String(f.approvalStatus || "").toLowerCase() !== "rejected",
              restaurantId: String(f.restaurantId || ""),
              restaurantName: f.restaurantName || "Unknown Restaurant",
              zoneId: String(f.zoneId?._id || f.zoneId || ""),
              zoneName: f.zoneName || f.zoneId?.name || "",
              categoryId: String(f.categoryId || ""),
              categoryName: f.categoryName || "",
              price: getFoodDisplayPrice(f),
              adminPrice: f.adminPrice ?? null,
              variants: getFoodVariants(f),
              foodType: f.foodType || "Non-Veg",
              approvalStatus: f.approvalStatus || "approved",
              description: f.description || "",
              preparationTime: f.preparationTime || "",
              isAvailable: f.isAvailable !== false,
              createdAt: f.createdAt,
              updatedAt: f.updatedAt,
            }))
          : []
      )
      setTotalFoods(total)
      setImageVersion(Date.now())
    } catch (error) {
      debugError("Error fetching foods:", error)
      // Say why (network down, 401, server error...) instead of a bare "Failed".
      const reason =
        error?.response?.data?.message ||
        (error?.response?.status ? `Server error ${error.response.status}` : "") ||
        (error?.code === "ERR_NETWORK" ? "Cannot reach the server" : "") ||
        error?.message ||
        ""
      toast.error(reason ? `Failed to load foods: ${reason}` : "Failed to load foods")
      setFoods([])
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, searchQuery, selectedRestaurant, selectedZone])

  useEffect(() => {
    const delay = searchQuery ? 250 : 0
    const t = setTimeout(fetchAllFoods, delay)
    return () => clearTimeout(t)
  }, [fetchAllFoods, searchQuery])

  const [searchParams] = useSearchParams()
  const productIdFromUrl = searchParams.get("productId")

  useEffect(() => {
    if (productIdFromUrl && foods.length > 0) {
      const food = foods.find(f => f.id === productIdFromUrl || f._id === productIdFromUrl)
      if (food) {
        handleViewDetails(food)
      }
    }
  }, [productIdFromUrl, foods])

  // Format ID to FOOD format (e.g., FOOD519399)
  const formatFoodId = (id) => {
    if (!id) return "FOOD000000"
    
    const idString = String(id)
    // Extract last 6 digits from the ID
    // Handle formats like "1768285554154-0.703896654519399" or "item-1768285554154-0.703896654519399"
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
      }
    }
    
    // If no digits found, use a hash of the ID
    if (!lastDigits) {
      const hash = idString.split("").reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0) | 0
      }, 0)
      lastDigits = Math.abs(hash).toString().slice(-6).padStart(6, "0")
    }
    
    return `FOOD${lastDigits}`
  }

  const filteredFoods = useMemo(() => {
    return foods
  }, [foods])

  const totalPages = useMemo(() => {
    if (totalFoods === 0) return 1
    return Math.ceil(totalFoods / pageSize)
  }, [totalFoods, pageSize])

  const paginatedFoods = useMemo(() => {
    return foods
  }, [foods])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedRestaurant, selectedZone, pageSize])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const restaurantOptions = useMemo(() => {
    return restaurantsForFilter
  }, [restaurantsForFilter])

  const selectedFormRestaurant = useMemo(() => {
    return restaurantOptions.find((r) => String(r.id) === String(foodForm.restaurantId || "")) || null
  }, [restaurantOptions, foodForm.restaurantId])

  const isSelectedRestaurantPureVegan = selectedFormRestaurant?.pureVeganRestaurant === true
  const isSelectedRestaurantPureVeg =
    isSelectedRestaurantPureVegan || selectedFormRestaurant?.pureVegRestaurant === true

  const openAddFoodModal = () => {
    setFoodFormMode("add")
    setEditingFood(null)
    const preselectedRestaurantId = selectedRestaurant !== "all" ? selectedRestaurant : ""
    const preselectedRestaurant = restaurantOptions.find(
      (r) => String(r.id) === String(preselectedRestaurantId),
    )
    const preselectedZoneId = selectedZone !== "all" ? selectedZone : (preselectedRestaurant?.zoneId || "")
    const defaultFoodType = preselectedRestaurant?.pureVeganRestaurant === true
      ? "Vegan"
      : preselectedRestaurant?.pureVegRestaurant === true
        ? "Veg"
        : "Non-Veg"
    setFoodForm({
      ...createFoodForm(),
      restaurantId: preselectedRestaurantId,
      zoneId: preselectedZoneId,
      foodType: defaultFoodType,
    })
    setSelectedImageFile(null)
    setImagePreviewUrl("")
    setCategorySearch("")
    setCategoryPopoverOpen(false)
    setShowFoodFormModal(true)
  }

  const openEditFoodModal = (food) => {
    setFoodFormMode("edit")
    setEditingFood(food)
    const restaurant = restaurantOptions.find(
      (r) => String(r.id) === String(food.restaurantId || ""),
    )
    const isRestaurantVeg =
      restaurant?.pureVegRestaurant === true ||
      restaurant?.pureVeganRestaurant === true ||
      restaurant?.foodType === "Veg"
    const rawType = String(food.foodType || "Non-Veg")
    let nextFoodType =
      rawType === "Vegan" ? "Veg" : rawType === "Veg" ? "Veg" : "Non-Veg"
    if (restaurant?.pureVeganRestaurant === true) {
      nextFoodType = "Veg"
    } else if (isRestaurantVeg && nextFoodType === "Non-Veg") {
      nextFoodType = "Veg"
    }
    setFoodForm({
      restaurantId: String(food.restaurantId || ""),
      zoneId: String(food.zoneId || restaurant?.zoneId || ""),
      categoryId: String(food.categoryId || ""),
      categoryName: String(food.categoryName || ""),
      name: String(food.name || ""),
      price: String(food.price || ""),
      adminPrice: food.adminPrice != null ? String(food.adminPrice) : "",
      variants: getFoodVariants(food).map(createVariantDraft),
      description: String(food.description || ""),
      image: String(food.image || ""),
      foodType: nextFoodType,
      isAvailable: food.isAvailable !== false,
      preparationTime: String(food.preparationTime || ""),
    })
    setSelectedImageFile(null)
    setImagePreviewUrl(String(food.image || ""))
    setCategorySearch("")
    setCategoryPopoverOpen(false)
    setShowFoodFormModal(true)
  }

  useEffect(() => {
    if (!showFoodFormModal || (!isSelectedRestaurantPureVeg && !isSelectedRestaurantPureVegan)) return
    setFoodForm((prev) => {
      const next = { ...prev }
      let changed = false
      if (isSelectedRestaurantPureVegan && prev.foodType !== "Vegan") {
        next.foodType = "Vegan"
        changed = true
      } else if (
        isSelectedRestaurantPureVeg &&
        !isSelectedRestaurantPureVegan &&
        prev.foodType === "Non-Veg"
      ) {
        next.foodType = "Veg"
        changed = true
      }
      const selectedStillValid = categoryOptions.some(
        (c) =>
          String(c.id) === String(prev.categoryId || "") ||
          String(c.name) === String(prev.categoryName || ""),
      )
      if ((prev.categoryId || prev.categoryName) && categoryOptions.length > 0 && !selectedStillValid) {
        next.categoryId = ""
        next.categoryName = ""
        changed = true
      }
      return changed ? next : prev
    })
  }, [showFoodFormModal, isSelectedRestaurantPureVeg, isSelectedRestaurantPureVegan, foodForm.foodType, foodForm.categoryId, foodForm.categoryName, categoryOptions])

  useEffect(() => {
    if (!showFoodFormModal) {
      setCategoryOptions([])
      return
    }

    let cancelled = false

    const loadCategoryOptions = async () => {
      try {
        const res = await adminAPI.getCategories({ limit: 1000 })
        const categoryData = res?.data?.data ?? res?.data
        const list = Array.isArray(categoryData?.categories)
          ? categoryData.categories
          : Array.isArray(categoryData)
            ? categoryData
            : []
        let options = Array.isArray(list)
          ? list
              .map((c) => ({
                id: String(c.id || c._id || c.name),
                name: String(c.name || "").trim(),
                foodTypeScope: String(c.foodTypeScope || "Both"),
              }))
              .filter((c) => c.name)
          : []
        if (isSelectedRestaurantPureVeg) {
          options = options.filter((c) => c.foodTypeScope === "Veg")
        }
        if (!cancelled) setCategoryOptions(options)
      } catch (error) {
        if (!cancelled) {
          setCategoryOptions([])
        }
      }
    }

    loadCategoryOptions()

    return () => {
      cancelled = true
    }
  }, [showFoodFormModal, isSelectedRestaurantPureVeg])

  const handleVariantChange = (variantId, field, value) => {
    setFoodForm((prev) => ({
      ...prev,
      variants: (Array.isArray(prev.variants) ? prev.variants : []).map((variant) =>
        variant.id === variantId ? { ...variant, [field]: value } : variant,
      ),
    }))
  }

  const handleAddVariant = () => {
    setFoodForm((prev) => ({
      ...prev,
      variants: [...(Array.isArray(prev.variants) ? prev.variants : []), createVariantDraft()],
    }))
  }

  const handleRemoveVariant = (variantId) => {
    setFoodForm((prev) => ({
      ...prev,
      variants: (Array.isArray(prev.variants) ? prev.variants : []).filter((variant) => variant.id !== variantId),
    }))
  }

  const handleFoodFormSubmit = async () => {
    if (!foodForm.restaurantId) {
      toast.error("Please select a restaurant")
      return
    }
    if (!foodForm.zoneId) {
      toast.error("Please select a zone")
      return
    }
    if (!String(foodForm.categoryName || "").trim()) {
      toast.error("Please select or enter a category")
      return
    }
    if (!foodForm.name.trim()) {
      toast.error("Food name is required")
      return
    }

    const normalizedVariants = (Array.isArray(foodForm.variants) ? foodForm.variants : [])
      .map((variant) => ({
        id: String(variant?.id || variant?._id || "").trim(),
        name: String(variant?.name || "").trim(),
        price: Number(variant?.price),
      }))
      .filter((variant) => variant.id || variant.name || variant.price)

    const hasVariants = normalizedVariants.length > 0
    let parsedPrice = Number(foodForm.price)

    if (normalizedVariants.some((variant) => !variant.name)) {
      toast.error("Each variant must have a name")
      return
    }

    if (normalizedVariants.some((variant) => !Number.isFinite(variant.price) || variant.price <= 0)) {
      toast.error("Each variant price must be greater than 0")
      return
    }

    if (hasVariants) {
      parsedPrice = Math.min(...normalizedVariants.map((v) => v.price))
    } else if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error("Price must be greater than 0")
      return
    }

    // Empty clears the override; variants are priced individually, so none applies there.
    const adminPriceInput = String(foodForm.adminPrice ?? "").trim()
    const parsedAdminPrice = !hasVariants && adminPriceInput ? Number(adminPriceInput) : null
    if (parsedAdminPrice != null && (!Number.isFinite(parsedAdminPrice) || parsedAdminPrice <= 0)) {
      toast.error("Admin price must be greater than 0, or left empty")
      return
    }

    if (!selectedImageFile && !String(foodForm.image || "").trim()) {
      toast.error("Please upload a food image")
      return
    }

    const resolvedFoodType = isSelectedRestaurantPureVegan
      ? "Vegan"
      : foodForm.foodType === "Vegan"
        ? "Vegan"
        : isSelectedRestaurantPureVeg || foodForm.foodType === "Veg"
          ? "Veg"
          : "Non-Veg"

    if (resolvedFoodType === "Vegan") {
      const veganBlock = getVeganFoodTypeBlockReason({
        name: foodForm.name,
        description: foodForm.description,
      })
      if (veganBlock.blocked) {
        toast.error(formatVeganBlockMessage(veganBlock))
        return
      }
    }

    try {
      setSubmittingFood(true)
      let imageUrl = foodForm.image.trim()

      if (selectedImageFile) {
        const uploadResponse = await uploadAPI.uploadMedia(selectedImageFile, {
          folder: "foods",
        })
        imageUrl =
          uploadResponse?.data?.data?.url ||
          uploadResponse?.data?.url ||
          imageUrl
      }

      const payload = {
        restaurantId: foodForm.restaurantId,
        zoneId: foodForm.zoneId,
        categoryId: foodForm.categoryId || undefined,
        categoryName: String(foodForm.categoryName || "").trim(),
        name: foodForm.name.trim(),
        price: parsedPrice,
        adminPrice: parsedAdminPrice,
        variants: normalizedVariants.map((variant) => ({
          ...(variant.id && !variant.id.startsWith("variant-") ? { _id: variant.id } : {}),
          name: variant.name,
          price: variant.price,
        })),
        description: foodForm.description.trim(),
        image: imageUrl,
        foodType: resolvedFoodType,
        isAvailable: foodForm.isAvailable !== false,
        preparationTime: String(foodForm.preparationTime || "").trim(),
      }

      if (foodFormMode === "edit") {
        await adminAPI.updateFood(editingFood?._id || editingFood?.id, payload)
      } else {
        await adminAPI.createFood(payload)
      }
      toast.success(foodFormMode === "edit" ? "Food updated successfully" : "Food added successfully")
      setShowFoodFormModal(false)
      setEditingFood(null)
      setFoodForm(createFoodForm())
      setSelectedImageFile(null)
      setImagePreviewUrl("")
      await fetchAllFoods()
    } catch (error) {
      debugError("Error saving food:", error)
      toast.error(error?.response?.data?.message || "Failed to save food")
    } finally {
      setSubmittingFood(false)
    }
  }

  const handleDelete = async (id) => {
    const food = foods.find(f => f.id === id)
    if (!food) return

    if (!window.confirm(`Are you sure you want to delete "${food.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      setDeleting(true)
      await adminAPI.deleteFood(food?._id || food?.id)
      setFoods((prev) => prev.filter((f) => String(f.id) !== String(id)))
      toast.success("Food item deleted successfully")
    } catch (error) {
      debugError("Error deleting food:", error)
      toast.error(error?.response?.data?.message || "Failed to delete food item")
    } finally {
      setDeleting(false)
    }
  }

  const handleViewDetails = (food) => {
    setSelectedFood(food)
    setShowDetailModal(true)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      {/* Header Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
            <div className="grid grid-cols-2 gap-0.5">
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Food</h1>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Food List</h2>
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700 flex items-center justify-center min-w-[2.5rem] h-7">
              {loading ? (
                <span className="w-5 h-3 rounded bg-slate-300/80 animate-pulse" />
              ) : (
                totalFoods
              )}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {(canCreate || canEdit) && (
              <button
                type="button"
                onClick={openAddFoodModal}
                className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Add Food</span>
              </button>
            )}
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <input
                type="text"
                placeholder="Ex : Foods"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="px-4 py-2.5 min-w-[170px] text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
            >
              <option value="all">All Zones</option>
              {zones.map((zone) => (
                <option key={zone._id || zone.id} value={zone._id || zone.id}>
                  {zone.name || zone.zoneName}
                </option>
              ))}
            </select>
            <select
              value={selectedRestaurant}
              onChange={(e) => setSelectedRestaurant(e.target.value)}
              className="px-4 py-2.5 min-w-[220px] text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
            >
              <option value="all">All Restaurants</option>
              {restaurantOptions.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  SL
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Image
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Restaurant
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Zone
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                      <p className="text-sm text-slate-500">Loading foods...</p>
                    </div>
                  </td>
                </tr>
              ) : foods.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">No food items match your search, zone, or restaurant filter</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedFoods.map((food, index) => (
                  <tr
                    key={food.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-700">{(currentPage - 1) * pageSize + index + 1}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <FoodImageThumb
                        name={food.name}
                        src={withImageVersion(food.image)}
                        size="md"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">{food.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-800">{food.restaurantName || "-"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        {food.zoneName || "—"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-800">{food.categoryName || "-"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleViewDetails(food)}
                          className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => openEditFoodModal(food)}
                            className="p-1.5 rounded text-amber-600 hover:bg-amber-50 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(food.id)}
                            disabled={deleting}
                            className="p-1.5 rounded text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete"
                          >
                            {deleting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && (
          <AdminListPagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalFoods}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_foods_pageSize", String(size))
              } catch {}
              setCurrentPage(1)
            }}
            itemLabel="foods"
            className="mt-4"
          />
        )}
      </div>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">Food Details</DialogTitle>
          </DialogHeader>
          {selectedFood && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-4">
                <FoodImageThumb
                  name={selectedFood.name}
                  src={withImageVersion(selectedFood.image)}
                  size="lg"
                  className="border border-slate-200"
                />
                <div>
                  <p className="text-lg font-semibold text-slate-900">{selectedFood.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5">ID #{formatFoodId(selectedFood.id)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p><span className="font-semibold text-slate-700">Restaurant:</span> <span className="text-slate-900">{selectedFood.restaurantName || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Zone:</span> <span className="text-slate-900">{selectedFood.zoneName || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Price:</span> <span className="text-slate-900">{selectedFood.variants?.length ? `Starting from \u20B9${selectedFood.price}` : `\u20B9${selectedFood.price}`}</span></p>
                {!selectedFood.variants?.length && selectedFood.adminPrice != null && (
                  <p><span className="font-semibold text-slate-700">Admin Price (charged):</span> <span className="text-slate-900">{`\u20B9${selectedFood.adminPrice}`}</span></p>
                )}
                <p><span className="font-semibold text-slate-700">Category:</span> <span className="text-slate-900">{selectedFood.categoryName || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Food Type:</span> <span className="text-slate-900">{selectedFood.foodType || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Approval:</span> <span className="text-slate-900 capitalize">{selectedFood.approvalStatus || "-"}</span></p>
              </div>
              {selectedFood.variants?.length ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Variants</p>
                  <div className="space-y-2">
                    {selectedFood.variants.map((variant) => (
                      <div key={variant.id || variant._id} className="flex items-center justify-between text-sm text-slate-700">
                        <span>{variant.name}</span>
                        <span className="font-semibold text-slate-900">{"\u20B9"}{variant.price}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selectedFood.description && (
                <p className="text-sm text-slate-700 leading-relaxed">
                  <span className="font-semibold text-slate-800">Description:</span> {selectedFood.description}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={showFoodFormModal}
        onOpenChange={(open) => {
          setShowFoodFormModal(open)
          if (!open) {
            setEditingFood(null)
            setFoodForm(createFoodForm())
            setCategoryOptions([])
            setCategorySearch("")
            setCategoryPopoverOpen(false)
            setSelectedImageFile(null)
            setImagePreviewUrl("")
          }
        }}
      >
        <DialogContent 
          className="max-w-2xl p-0 overflow-hidden"
          onInteractOutside={(e) => {
            if (isFormDirty) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (isFormDirty) e.preventDefault()
          }}
        >
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {foodFormMode === "edit" ? "Edit Food" : "Add Food"}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Zone <span className="text-red-500">*</span>
                </label>
                <select
                  value={foodForm.zoneId}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, zoneId: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">Select zone</option>
                  {zones.map((zone) => (
                    <option key={zone._id || zone.id} value={zone._id || zone.id}>
                      {zone.name || zone.zoneName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Restaurant</label>
                <select
                  value={foodForm.restaurantId}
                  onChange={(e) => {
                    const nextRestaurantId = e.target.value
                    const nextRestaurant = restaurantOptions.find(
                      (r) => String(r.id) === String(nextRestaurantId),
                    )
                    const forceVegan = nextRestaurant?.pureVeganRestaurant === true
                    const forceVeg =
                      forceVegan || nextRestaurant?.pureVegRestaurant === true
                    setFoodForm((prev) => ({
                      ...prev,
                      restaurantId: nextRestaurantId,
                      zoneId: nextRestaurant?.zoneId || prev.zoneId,
                      categoryId: "",
                      categoryName: "",
                      foodType: forceVegan
                        ? "Vegan"
                        : forceVeg
                          ? prev.foodType === "Vegan"
                            ? "Vegan"
                            : "Veg"
                          : prev.foodType,
                    }))
                  }}
                  disabled={foodFormMode === "edit"}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100"
                >
                  <option value="">Select restaurant</option>
                  {restaurantOptions.map((restaurant) => (
                    <option key={restaurant.id} value={restaurant.id}>
                      {restaurant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-left flex items-center justify-between"
                    >
                      <span className={foodForm.categoryName ? "text-slate-900" : "text-slate-400"}>
                        {foodForm.categoryName || "Select category"}
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                    <input
                      type="text"
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white mb-2"
                      placeholder="Search category..."
                      autoFocus
                    />
                    <div className="max-h-56 overflow-y-auto">
                      {categoryOptions
                        .filter((c) => {
                          const q = String(categorySearch || "").trim().toLowerCase()
                          if (!q) return true
                          return String(c.name || "").toLowerCase().includes(q)
                        })
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setFoodForm((prev) => ({ ...prev, categoryId: c.id, categoryName: c.name }))
                              setCategoryPopoverOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-slate-100 ${
                              String(foodForm.categoryName || "") === String(c.name) ? "bg-slate-100 font-medium" : ""
                            }`}
                          >
                            {c.name}
                          </button>
                        ))}
                      {categoryOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-slate-500">No categories found</div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Food Name</label>
                <input
                  type="text"
                  value={foodForm.name}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {(foodForm.variants || []).length > 0 ? "Item Price (Auto-set)" : "Item Price"}
                </label>
                {(foodForm.variants || []).length > 0 ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center justify-between">
                    <span>Starting from: <strong>₹{Math.min(...foodForm.variants.map(v => Number(v.price)).filter(p => Number.isFinite(p) && p > 0)) || 0}</strong></span>
                    <span className="text-[10px] bg-white px-2 py-0.5 rounded border border-emerald-300 font-semibold">From lowest variant</span>
                  </div>
                ) : (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={foodForm.price}
                    onChange={(e) => setFoodForm((prev) => ({ ...prev, price: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                    placeholder="Enter price"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Food Type</label>
                <select
                  value={
                    isSelectedRestaurantPureVegan
                      ? "Vegan"
                      : foodForm.foodType
                  }
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, foodType: e.target.value }))}
                  disabled={isSelectedRestaurantPureVegan}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-600"
                >
                  <option value="Veg">Veg</option>
                  {/* DISABLED: Vegan is not selectable — only Veg / Non-Veg / Mixed.
                  <option value="Vegan">Vegan</option>
                  */}
                  {!isSelectedRestaurantPureVeg ? <option value="Non-Veg">Non-Veg</option> : null}
                </select>
                {isSelectedRestaurantPureVegan ? (
                  <p className="mt-1 text-xs text-emerald-600">Pure vegan restaurant — only Vegan items allowed</p>
                ) : isSelectedRestaurantPureVeg ? (
                  <p className="mt-1 text-xs text-emerald-600">Pure veg restaurant — Veg or Vegan items only</p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Upload Image <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setSelectedImageFile(file)
                    if (file) {
                      setImagePreviewUrl(URL.createObjectURL(file))
                    } else {
                      setImagePreviewUrl(foodForm.image.trim())
                    }
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">Optional — food image</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Timing</label>
                <div className="relative">
                  <select
                  value={foodForm.preparationTime}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, preparationTime: e.target.value }))}
                    className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm bg-white appearance-none"
                  >
                    <option value="">Select timing</option>
                    <option value="10-20 mins">10-20 mins</option>
                    <option value="20-25 mins">20-25 mins</option>
                    <option value="25-35 mins">25-35 mins</option>
                    <option value="35-45 mins">35-45 mins</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              </div>
              {imagePreviewUrl ? (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Image Preview</label>
                  <div className="w-28 h-28 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                    <img
                      src={imagePreviewUrl}
                      alt="Food preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              ) : null}
              <div className="flex items-center gap-6 pt-7">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={foodForm.isAvailable}
                    onChange={(e) => setFoodForm((prev) => ({ ...prev, isAvailable: e.target.checked }))}
                  />
                  Available
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                rows={4}
                value={foodForm.description}
                onChange={(e) => setFoodForm((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white resize-none"
              />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Variants</p>
                  <p className="text-xs text-slate-500">Optional. Add multiple names and prices such as Half, Full, Small, or Large.</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddVariant}
                  className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add variant
                </button>
              </div>
              {(foodForm.variants || []).length ? (
                <div className="space-y-3">
                  {(foodForm.variants || []).map((variant, index) => (
                    <div key={variant.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Variant name</label>
                          <input
                            type="text"
                            value={variant.name}
                            onChange={(e) => handleVariantChange(variant.id, "name", e.target.value)}
                            placeholder={index === 0 ? "Full" : "Half"}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Variant price</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={variant.price}
                            onChange={(e) => handleVariantChange(variant.id, "price", e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveVariant(variant.id)}
                        className="self-start rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-500"
                        aria-label="Remove variant"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No variants added. This food will use the single base price.</p>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleFoodFormSubmit}
                disabled={submittingFood}
                className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {submittingFood ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{submittingFood ? "Saving..." : foodFormMode === "edit" ? "Update Food" : "Add Food"}</span>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

