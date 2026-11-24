import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { VEGAN_OPTION_ENABLED } from "@food/utils/vegMode"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  Trash2,
  Check,
  ChevronDown,
  Edit as EditIcon,
  Plus,
  X,
  Camera,
  ThumbsUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search
} from "lucide-react"
import { Switch } from "@food/components/ui/switch"
// Removed getAllFoods and saveFood - now using menu API
import api from "@food/api"
import { restaurantAPI, uploadAPI } from "@food/api"
import { toast } from "sonner"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable, ensureUploadableImageFile } from "@food/utils/imageUploadUtils"
import { useKeyboardAwareSheet } from "@food/hooks/useIsKeyboardOpen"
import { getFoodVariants } from "@food/utils/foodVariants"
import {
  getVeganFoodTypeBlockReason,
  formatVeganBlockMessage,
} from "@food/utils/veganFoodGuard"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import SafeImage from "@food/components/SafeImage"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const INVENTORY_RECOMMENDED_KEY = "restaurant_inventory_recommended_map"
const MENU_ITEM_IMAGE_FOLDER = "eatiefy/restaurant/menu-items"


const getUploadErrorMessage = (error, fileName = "image") => {
  const message =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Please try again."
  return `Failed to upload ${fileName}: ${message}`
}

const createVariantDraft = (variant = {}) => {
  const restaurantPrice =
    variant?.basePrice != null && Number.isFinite(Number(variant.basePrice))
      ? Number(variant.basePrice)
      : variant?.price;
  return {
    localId: String(variant?.id || variant?._id || `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    persistedId: String(variant?.id || variant?._id || ""),
    name: String(variant?.name || ""),
    price: restaurantPrice != null ? String(restaurantPrice) : "",
  };
}

export default function ItemDetailsPage() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const { id } = useParams()
  const location = useLocation()
  const isNewItem = id === "new"
  const groupId = location.state?.groupId
  const defaultCategory = location.state?.category || "Select category"
  const defaultCategoryId = location.state?.categoryId || ""
  const fileInputRef = useRef(null)

  // Initialize state with empty values - will be populated from API
  const [itemData, setItemData] = useState(null) // Store the full item data for saving
  const [itemName, setItemName] = useState("")
  const [category, setCategory] = useState(defaultCategory)
  const [selectedCategoryId, setSelectedCategoryId] = useState(defaultCategoryId)
  const [subCategory, setSubCategory] = useState("")
  const [servesInfo, setServesInfo] = useState("")
  const [itemSizeQuantity, setItemSizeQuantity] = useState("")
  const [itemSizeUnit, setItemSizeUnit] = useState("piece")
  const [itemDescription, setItemDescription] = useState("")
  const [foodType, setFoodType] = useState("Veg")
  const [restaurantFoodType, setRestaurantFoodType] = useState("Mixed")
  const [basePrice, setBasePrice] = useState("")
  const [variants, setVariants] = useState([])
  const [preparationTime, setPreparationTime] = useState("")
  const [gst, setGst] = useState("5.0")
  const [isRecommended, setIsRecommended] = useState(false)
  const [isInStock, setIsInStock] = useState(true)
  const [weightPerServing, setWeightPerServing] = useState("")
  const [calorieCount, setCalorieCount] = useState("")
  const [proteinCount, setProteinCount] = useState("")
  const [carbohydrates, setCarbohydrates] = useState("")
  const [fatCount, setFatCount] = useState("")
  const [fibreCount, setFibreCount] = useState("")
  const [allergens, setAllergens] = useState("")
  const [showMoreNutrition, setShowMoreNutrition] = useState(false)
  const [selectedTags, setSelectedTags] = useState([])
  const [images, setImages] = useState([])
  const [imageFiles, setImageFiles] = useState(new Map()) // Track File objects by preview URL
  const [uploadingImages, setUploadingImages] = useState(false)
  // Upload of the picked photo, started as soon as it is selected.
  const [imageUpload, setImageUpload] = useState({ status: "idle", progress: 0, error: "" })
  const activeImageUploadRef = useRef(null)
  // True once the user picks/removes a photo, so a late item fetch cannot overwrite it.
  const imageTouchedRef = useRef(false)
  // Files uploaded in this session that the item does not reference yet.
  const unsavedUploadUrlsRef = useRef(new Set())
  const itemSavedRef = useRef(false)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [touchStart, setTouchStart] = useState(null)
  const [touchEnd, setTouchEnd] = useState(null)
  const [direction, setDirection] = useState(0)
  const carouselRef = useRef(null)
  const [isCategoryPopupOpen, setIsCategoryPopupOpen] = useState(false)
  const [categorySearchQuery, setCategorySearchQuery] = useState("")
  const [debouncedCategorySearch, setDebouncedCategorySearch] = useState("")
  const categorySearchInputRef = useRef(null)
  const [isServesPopupOpen, setIsServesPopupOpen] = useState(false)
  const [isItemSizePopupOpen, setIsItemSizePopupOpen] = useState(false)
  const [isGstPopupOpen, setIsGstPopupOpen] = useState(false)
  const [isTagsPopupOpen, setIsTagsPopupOpen] = useState(false)
  const [showRemoveImageConfirm, setShowRemoveImageConfirm] = useState(false)
  const [showDeleteItemConfirm, setShowDeleteItemConfirm] = useState(false)
  const [isDeletingItem, setIsDeletingItem] = useState(false)
  const [categories, setCategories] = useState([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [loadingItem, setLoadingItem] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)
  // Category search sheet stays above the on-screen keyboard.
  const { sheetProps: categorySheetProps } = useKeyboardAwareSheet()

  const handleDeleteItem = async () => {
    if (isNewItem) return
    const itemId = String(itemData?.id || id || "")
    if (!itemId) return
    try {
      setIsDeletingItem(true)
      await restaurantAPI.deleteFood(itemId)
      toast.success("Item deleted from restaurant menu")
      window.dispatchEvent(new CustomEvent("foodsChanged"))
      navigate("/food/restaurant/inventory", { replace: true })
    } catch (error) {
      debugError("Failed to delete food item:", error)
      toast.error(error.response?.data?.message || "Failed to delete item")
    } finally {
      setIsDeletingItem(false)
      setShowDeleteItemConfirm(false)
    }
  }

  const maxNameLength = 70
  const maxDescriptionLength = 1000
  const descriptionLength = itemDescription.length
  const minDescriptionLength = 5
  const nameLength = itemName.length
  const currentApprovalStatus = String(itemData?.approvalStatus || "").toLowerCase()
  const currentRejectionReason = String(itemData?.rejectionReason || "").trim()

  const populateFormFromItem = (item = {}) => {
    setItemData(item)

    setItemName(item.name || "")
    setCategory(item.category || item.categoryName || defaultCategory)
    setSelectedCategoryId(
      item.categoryId?._id || item.categoryId || defaultCategoryId || "",
    )
    setSubCategory(item.subCategory || item.category || item.categoryName || "Starters")
    setServesInfo(item.servesInfo || "")
    setItemSizeQuantity(item.itemSizeQuantity || "")
    setItemSizeUnit(item.itemSizeUnit || "piece")
    setItemDescription(item.description || "")

    const rawFoodType = String(item.foodType || "").trim()
    if (restaurantFoodType === "Veg") {
      setFoodType("Veg")
    } else if (restaurantFoodType === "Non-Veg") {
      setFoodType("Non-Veg")
    } else if (rawFoodType === "Veg" || rawFoodType === "Vegan") {
      setFoodType("Veg")
    } else {
      setFoodType("Non-Veg")
    }

    const rawVariants = Array.isArray(item.variants)
      ? item.variants
      : Array.isArray(item.variations)
        ? item.variations
        : []
    // Restaurant edit must use basePrice (own price), never admin selling price.
    const itemVariants = rawVariants.length
      ? rawVariants
          .map((variant, index) => {
            const name = String(variant?.name || "").trim()
            const base = Number(variant?.basePrice)
            const price = Number.isFinite(base) && base >= 0 ? base : Number(variant?.price)
            if (!name || !Number.isFinite(price) || price <= 0) return null
            return {
              id: String(variant?.id || variant?._id || `variant-${index}`),
              _id: String(variant?.id || variant?._id || `variant-${index}`),
              name,
              price,
              basePrice: price,
            }
          })
          .filter(Boolean)
      : getFoodVariants(item)
    setVariants(itemVariants.map(createVariantDraft))

    const priceCandidates = [item.basePrice, item.price, item.sellingPrice]
    let resolvedBasePrice = ""
    for (const candidate of priceCandidates) {
      if (candidate === "" || candidate == null) continue
      const numeric = Number(candidate)
      if (Number.isFinite(numeric) && numeric >= 0) {
        resolvedBasePrice = String(candidate)
        break
      }
    }
    setBasePrice(resolvedBasePrice)
    setPreparationTime(item.preparationTime || "")
    setGst(item.gst?.toString() || "5.0")
    setIsRecommended(
      item.isRecommended === true ||
        item.recommended === true ||
        item.is_recommended === true,
    )
    setIsInStock(item.isAvailable !== false && item.inStock !== false)
    setSelectedTags(item.tags || [])

    const existingImages = Array.isArray(item.images) && item.images.length > 0
      ? item.images.filter(Boolean)
      : (item.image ? [item.image] : [])
    if (!imageTouchedRef.current) {
      setImages(existingImages)
    }

    setWeightPerServing("")
    setCalorieCount("")
    setProteinCount("")
    setCarbohydrates("")
    setFatCount("")
    setFibreCount("")
    setAllergens("")

    if (item.nutrition && Array.isArray(item.nutrition)) {
      item.nutrition.forEach(nut => {
        if (typeof nut === 'string') {
          if (nut.includes('Weight per serving')) {
            const match = nut.match(/(\d+)\s*grams?/i)
            if (match) setWeightPerServing(match[1])
          } else if (nut.includes('Calorie count')) {
            const match = nut.match(/(\d+)\s*Kcal/i)
            if (match) setCalorieCount(match[1])
          } else if (nut.includes('Protein count')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setProteinCount(match[1])
          } else if (nut.includes('Carbohydrates')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setCarbohydrates(match[1])
          } else if (nut.includes('Fat count')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setFatCount(match[1])
          } else if (nut.includes('Fibre count')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setFibreCount(match[1])
          }
        }
      })
    }

    if (item.allergies && Array.isArray(item.allergies) && item.allergies.length > 0) {
      setAllergens(item.allergies.join(", "))
    }
  }

  // Fetch item data from menu API when editing
  useEffect(() => {
    const fetchRestaurantDietType = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const profile =
          response?.data?.data?.restaurant ||
          response?.data?.restaurant ||
          response?.data?.data ||
          null
        const ft =
          profile?.foodType ||
          (profile?.pureVegRestaurant === true ? "Veg" : "Mixed")
        setRestaurantFoodType(ft)
        if (ft === "Veg") setFoodType("Veg")
        else if (ft === "Non-Veg") setFoodType("Non-Veg")
      } catch (error) {
        debugWarn("Failed to load restaurant diet type:", error)
      }
    }
    fetchRestaurantDietType()
  }, [])

  // Keep diet buttons aligned with restaurant type once profile loads
  useEffect(() => {
    if (restaurantFoodType === "Veg") {
      setFoodType("Veg")
    } else if (restaurantFoodType === "Non-Veg") {
      setFoodType("Non-Veg")
    }
  }, [restaurantFoodType])

  // Fetch item data when editing — prefer food-by-id API for full prefill
  useEffect(() => {
    const fetchItemData = async () => {
      // Instant prefill from navigation state (may be partial)
      if (location.state?.item) {
        populateFormFromItem(location.state.item)
      }

      if (!isNewItem && id) {
        try {
          setLoadingItem(true)

          // 1) Canonical food document (price, recommended, preparationTime, etc.)
          try {
            const foodRes = await restaurantAPI.getFoodById(id)
            const food =
              foodRes?.data?.data?.food ||
              foodRes?.data?.food ||
              null
            if (food) {
              populateFormFromItem({
                ...food,
                id: String(food._id || food.id || id),
                category:
                  food.categoryName ||
                  food.category ||
                  location.state?.item?.category ||
                  location.state?.category ||
                  "",
                categoryId:
                  food.categoryId?._id ||
                  food.categoryId ||
                  location.state?.item?.categoryId ||
                  location.state?.categoryId ||
                  "",
                categoryName: food.categoryName || location.state?.item?.categoryName || "",
                basePrice: food.price,
                price: food.price,
                preparationTime: food.preparationTime || "",
                isRecommended: food.isRecommended === true,
                isAvailable: food.isAvailable !== false,
                foodType: food.foodType || "Non-Veg",
                image: food.image || "",
                images: food.image ? [food.image] : [],
                variants: Array.isArray(food.variants) ? food.variants : [],
              })
              return
            }
          } catch (foodFetchError) {
            debugWarn("getFoodById failed, falling back to menu scan:", foodFetchError)
          }

          // 2) Fallback: scan restaurant menu
          const menuResponse = await restaurantAPI.getMenu()
          const menu = menuResponse.data?.data?.menu
          const sections = menu?.sections || []

          let foundItem = null
          const searchId = String(id).trim()
          for (const section of sections) {
            const item = section.items?.find(i => {
              const itemId = String(i.id || i._id || '').trim()
              return itemId === searchId || itemId === id
            })
            if (item) {
              foundItem = {
                ...item,
                category: item.category || item.categoryName || section.name || "",
                categoryId: item.categoryId || section.categoryId || section.id || "",
              }
              break
            }
            if (section.subsections) {
              for (const subsection of section.subsections) {
                const subItem = subsection.items?.find(i => {
                  const itemId = String(i.id || i._id || '').trim()
                  return itemId === searchId || itemId === id
                })
                if (subItem) {
                  foundItem = {
                    ...subItem,
                    category: subItem.category || subItem.categoryName || section.name || "",
                    categoryId: subItem.categoryId || section.categoryId || section.id || "",
                  }
                  break
                }
              }
              if (foundItem) break
            }
          }

          if (foundItem) {
            populateFormFromItem({
              ...(location.state?.item || {}),
              ...foundItem,
            })
          } else if (!location.state?.item) {
            toast.error("Item not found")
          }
        } catch (error) {
          debugError('Error fetching item data:', error)
          if (!location.state?.item) {
            toast.error("Failed to load item data")
          }
        } finally {
          setLoadingItem(false)
        }
      }
    }

    fetchItemData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNewItem])

  // Fetch categories once on mount
  const fetchCategories = useCallback(async () => {
    try {
      setLoadingCategories(true)
      const response = await restaurantAPI.getCategories()
      if (response.data.success && response.data.data.categories) {
        const isPureVeg = restaurantFoodType === "Veg"
        const formattedCategories = response.data.data.categories
          .filter(cat => {
            if (!cat) return false
            const scope = String(cat.foodTypeScope || "").trim().toLowerCase()
            if (isPureVeg && (scope === "non-veg" || scope === "nonveg" || scope === "non veg")) {
              return false
            }
            if (restaurantFoodType === "Non-Veg" && (scope === "veg" || scope === "pure-veg" || scope === "pure veg")) {
              return false
            }
            return true
          })
          .map(cat => ({
            id: cat._id || cat.id,
            name: cat.name,
            foodTypeScope: cat.foodTypeScope || "Both",
          }))
        setCategories(formattedCategories)
        return formattedCategories
      }
      setCategories([])
      return []
    } catch (error) {
      debugError('Error fetching restaurant categories:', error)
      setCategories([])
      return []
    } finally {
      setLoadingCategories(false)
    }
  }, [])

  // Fetch categories once on mount; auto-match by name if category passed via nav state
  useEffect(() => {
    fetchCategories().then((formattedCategories) => {
      if (!defaultCategoryId && defaultCategory && defaultCategory !== "Select category") {
        const matched = formattedCategories.find((cat) => cat.name === defaultCategory)
        if (matched) {
          setSelectedCategoryId(matched.id)
          setCategory(matched.name)
        }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedCategorySearch(categorySearchQuery.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [categorySearchQuery])

  useEffect(() => {
    if (!isCategoryPopupOpen) {
      setCategorySearchQuery("")
      setDebouncedCategorySearch("")
    }
  }, [isCategoryPopupOpen])

  const filteredCategories = useMemo(() => {
    let list = categories
    if (restaurantFoodType === "Veg") {
      list = list.filter((cat) => cat.foodTypeScope !== "Non-Veg")
    } else if (restaurantFoodType === "Non-Veg") {
      list = list.filter((cat) => cat.foodTypeScope !== "Veg")
    }
    if (!debouncedCategorySearch) return list
    const query = debouncedCategorySearch.toLowerCase()
    return list.filter((cat) => String(cat.name || "").toLowerCase().includes(query))
  }, [categories, debouncedCategorySearch, restaurantFoodType])

  // Keep focused form fields visible above mobile keyboard
  useEffect(() => {
    const ensureFieldVisible = (target) => {
      if (!target) return
      const isFormField = target.matches?.('input, textarea, select, [contenteditable="true"]')
      if (!isFormField) return

      window.setTimeout(() => {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
      }, 120)
    }

    const handleFocusIn = (event) => {
      ensureFieldVisible(event.target)
    }

    document.addEventListener("focusin", handleFocusIn, true)
    return () => {
      document.removeEventListener("focusin", handleFocusIn, true)
    }
  }, [])

  // Track virtual keyboard height and push footer above keyboard
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const updateKeyboardInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setKeyboardInset(inset > 60 ? inset : 0)
    }

    viewport.addEventListener("resize", updateKeyboardInset)
    viewport.addEventListener("scroll", updateKeyboardInset)
    updateKeyboardInset()

    return () => {
      viewport.removeEventListener("resize", updateKeyboardInset)
      viewport.removeEventListener("scroll", updateKeyboardInset)
    }
  }, [])

  // Serves info options
  const servesOptions = [
    "Serves eg. 1-2 people",
    "Serves eg. 2-3 people",
    "Serves eg. 3-4 people",
    "Serves eg. 4-5 people",
    "Serves eg. 5-6 people",
  ]

  // Item size unit options
  const itemSizeUnits = [
    "slices",
    "kg",
    "litre",
    "ml",
    "serves",
    "cms",
    "piece"
  ]

  // Item tags organized by categories
  const itemTagsCategories = [
    {
      category: "Speciality",
      tags: ["Freshly Frosted", "Pre Frosted", "Chef's Special"]
    },
    {
      category: "Spice Level",
      tags: ["Medium Spicy", "Very Spicy"]
    },
    {
      category: "Miscellaneous",
      tags: ["Gluten Free", "Sugar Free", "Jain"]
    },
    {
      category: "Dietary Restrictions",
      tags: ["Vegan"]
    }
  ]

  /** Deletes files uploaded in this session that the saved item does not use. */
  const discardUnsavedUploads = (keepUrl = "") => {
    unsavedUploadUrlsRef.current.forEach((url) => {
      if (url && url !== keepUrl) {
        uploadAPI.deleteMedia(url).catch(() => {})
      }
    })
    unsavedUploadUrlsRef.current = new Set()
  }

  /**
   * Uploads the picked photo right away and swaps the local preview for the
   * stored URL, so the user sees progress and any error before pressing Save.
   * If it fails, the file stays queued and Save retries the upload.
   */
  const uploadPickedImage = async (file, previewUrl) => {
    const uploadId = previewUrl
    activeImageUploadRef.current = uploadId
    setImageUpload({ status: "uploading", progress: 0, error: "" })

    try {
      const response = await uploadAPI.uploadMedia(file, {
        folder: MENU_ITEM_IMAGE_FOLDER,
        onUploadProgress: (event) => {
          if (activeImageUploadRef.current !== uploadId || !event?.total) return
          const progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
          setImageUpload((prev) => (prev.status === "uploading" ? { ...prev, progress } : prev))
        },
      })
      const imageUrl = response?.data?.data?.url || response?.data?.url
      if (!imageUrl) {
        throw new Error("The server did not return the image URL")
      }

      if (activeImageUploadRef.current !== uploadId) {
        // A newer photo was picked (or this one removed) while uploading.
        uploadAPI.deleteMedia(imageUrl).catch(() => {})
        return
      }

      discardUnsavedUploads()
      unsavedUploadUrlsRef.current.add(imageUrl)
      setImages((prev) => (prev[0] === previewUrl ? [imageUrl] : prev))
      setImageFiles((prev) => {
        if (!prev.has(previewUrl)) return prev
        const next = new Map(prev)
        next.delete(previewUrl)
        return next
      })
      setImageUpload({ status: "done", progress: 100, error: "" })
      // Keep the blob preview alive a moment so the swap to the URL does not flash.
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 1500)
    } catch (uploadError) {
      if (activeImageUploadRef.current !== uploadId) return
      debugError("Item image upload failed:", uploadError)
      const message = getUploadErrorMessage(uploadError, "image")
      setImageUpload({ status: "error", progress: 0, error: message })
      toast.error(message)
    }
  }

  const handleImageAdd = (pickedFile) => {
    if (!pickedFile) return

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }

    const { file, error } = ensureUploadableImageFile(pickedFile)
    if (error) {
      toast.error(error)
      return
    }

    imageTouchedRef.current = true

    // Single-image mode: keep only the latest selected file
    const previewUrl = URL.createObjectURL(file)

    images.forEach((img) => {
      if (img && img.startsWith('blob:')) {
        URL.revokeObjectURL(img)
      }
    })

    const newImageFilesMap = new Map()
    newImageFilesMap.set(previewUrl, file)

    setImages([previewUrl])
    setImageFiles(newImageFilesMap)
    setCurrentImageIndex(0)

    void uploadPickedImage(file, previewUrl)
  }

  const handleRetryImageUpload = () => {
    const entry = Array.from(imageFiles.entries())[0]
    if (!entry) return
    const [previewUrl, file] = entry
    void uploadPickedImage(file, previewUrl)
  }

  // Leaving without saving must not strand uploaded files on the server.
  useEffect(() => {
    return () => {
      activeImageUploadRef.current = null
      if (!itemSavedRef.current) {
        discardUnsavedUploads()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCameraClick = () => {
    setIsPhotoPickerOpen(true)
  }

  const handleImageDelete = (index) => {
    if (index < 0 || index >= images.length) return

    // Confirm deletion
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return
    }

    const imageToDelete = images[index]
    const newImages = images.filter((_, i) => i !== index)
    const newImageFilesMap = new Map(imageFiles)

    // Remove the file mapping and revoke the blob URL if it's a preview (new upload)
    if (imageToDelete && imageToDelete.startsWith('blob:')) {
      newImageFilesMap.delete(imageToDelete)
      URL.revokeObjectURL(imageToDelete)
      debugLog('Deleted preview image (blob URL):', imageToDelete)
    } else if (imageToDelete && (imageToDelete.startsWith('http://') || imageToDelete.startsWith('https://'))) {
      // For already uploaded images, we need to remove from imageFiles map if it exists
      // Find and remove the file entry if it exists
      for (const [previewUrl, file] of newImageFilesMap.entries()) {
        // This shouldn't happen for HTTP URLs, but just in case
        if (previewUrl === imageToDelete) {
          newImageFilesMap.delete(previewUrl)
          URL.revokeObjectURL(previewUrl)
        }
      }
      debugLog('Deleted uploaded image (HTTP URL):', imageToDelete)
    }

    setImages(newImages)
    setImageFiles(newImageFilesMap)

    // Adjust current image index after deletion
    if (newImages.length === 0) {
      setCurrentImageIndex(0)
    } else if (currentImageIndex >= newImages.length) {
      setCurrentImageIndex(newImages.length - 1)
    } else if (currentImageIndex > index) {
      // If we deleted an image before the current one, no need to change index
      // If we deleted the current one or after, index stays the same (shows next image)
    }

    toast.success('Image deleted successfully')
    debugLog(`Image deleted. Remaining images: ${newImages.length}`)
  }

  // Swipe handlers
  const minSwipeDistance = 50

  const onTouchStart = (e) => {
    setTouchEnd(null)
    setTouchStart(e.targetTouches[0].clientX)
  }

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX)
  }

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return

    const distance = touchStart - touchEnd
    const isLeftSwipe = distance > minSwipeDistance
    const isRightSwipe = distance < -minSwipeDistance

    if (isLeftSwipe && images.length > 0) {
      setDirection(1)
      setCurrentImageIndex((prev) => (prev + 1) % images.length)
    }
    if (isRightSwipe && images.length > 0) {
      setDirection(-1)
      setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
    }
  }

  const goToNext = () => {
    setDirection(1)
    setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const goToPrevious = () => {
    setDirection(-1)
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
  }

  const handleCategorySelect = (catId, subCat) => {
    const selectedCategory = categories.find(c => c.id === catId)
    setSelectedCategoryId(selectedCategory?.id || "")
    setCategory(selectedCategory?.name || "")
    setSubCategory(subCat)
    setIsCategoryPopupOpen(false)
  }

  const handleServesSelect = (option) => {
    setServesInfo(option)
    setIsServesPopupOpen(false)
  }

  const handleItemSizeUnitSelect = (unit) => {
    setItemSizeUnit(unit)
    setIsItemSizePopupOpen(false)
  }

  const handleGstSelect = (gstValue) => {
    setGst(gstValue)
    setIsGstPopupOpen(false)
  }

  const handleTagToggle = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const handleSave = async () => {
    if (imageUpload.status === "uploading") {
      toast.info("Please wait for the image to finish uploading")
      return
    }

    if (!itemName.trim()) {
      toast.error("Please enter an item name")
      return
    }

    // Resolve category + diet checks BEFORE any image upload (avoid orphan server uploads)
    const matchedCategory = Array.isArray(categories)
      ? categories.find((c) => String(c?.id || "") === String(selectedCategoryId || ""))
      : null
    const categoryId = matchedCategory?.id || matchedCategory?._id || null
    const categoryName = matchedCategory?.name || category || ""

    if (!categoryId) {
      toast.error("Please select an approved category first")
      setIsCategoryPopupOpen(true)
      return
    }

    if (
      matchedCategory?.foodTypeScope &&
      matchedCategory.foodTypeScope !== "Both" &&
      matchedCategory.foodTypeScope !== foodType
    ) {
      toast.error(`This ${matchedCategory.foodTypeScope} category cannot accept ${foodType} food`)
      return
    }

    const effectiveFoodType = restaurantFoodType === "Veg"
      ? "Veg"
      : restaurantFoodType === "Non-Veg"
        ? "Non-Veg"
        : foodType

    const normalizedVariants = variants
      .map((variant) => ({
        persistedId: String(variant.persistedId || "").trim(),
        name: String(variant.name || "").trim(),
        price: Number(variant.price),
      }))
      .filter((variant) => variant.name || variant.persistedId || variant.price)

    if (normalizedVariants.some((variant) => !variant.name)) {
      toast.error("Each variant must have a name")
      return
    }

    if (normalizedVariants.some((variant) => !Number.isFinite(variant.price) || variant.price <= 0)) {
      toast.error("Each variant price must be greater than 0")
      return
    }

    const hasVariants = normalizedVariants.length > 0
    let parsedBasePrice = Number(basePrice)
    if (hasVariants) {
      parsedBasePrice = Math.min(...normalizedVariants.map((v) => v.price))
    } else if (!Number.isFinite(parsedBasePrice) || parsedBasePrice <= 0) {
      toast.error("Please enter a valid item price")
      return
    }

    const variantPayload = normalizedVariants.map((variant) => ({
      ...(variant.persistedId ? { _id: variant.persistedId } : {}),
      name: variant.name,
      price: variant.price,
    }))

    try {
      setUploadingImages(true)

      // Upload new images to the server (only after validation passed)
      const uploadedImageUrls = []

      /*
       * Separate existing URLs (already uploaded) from new files (blob previews).
       *
       * Anything that is not a device-local preview is a stored image. This
       * used to keep only values starting with http(s)://, so an item saved
       * with a relative "/uploads/..." path lost its photo on any unrelated
       * edit (price, name): the save sent image "" and the server then deleted
       * the file. The server normalises whatever is sent to one canonical URL.
       */
      const existingImageUrls = images.filter(img =>
        typeof img === 'string' &&
        img.trim() !== '' &&
        !img.startsWith('blob:') &&
        !img.startsWith('data:')
      )

      debugLog('Images state:', images)
      debugLog('Existing image URLs (already uploaded):', existingImageUrls)
      debugLog('Image files map:', imageFiles)

      // Upload new File objects to the server
      const filesToUpload = Array.from(imageFiles.values())
      debugLog('Files to upload:', filesToUpload.length, filesToUpload)

      if (filesToUpload.length > 0) {
        toast.info(`Uploading ${filesToUpload.length} image(s)...`)
        for (let i = 0; i < filesToUpload.length; i++) {
          const file = filesToUpload[i]
          try {
            debugLog(`Uploading image ${i + 1}/${filesToUpload.length}:`, file.name)
            // Only reached when the upload started at selection time failed.
            setImageUpload({ status: "uploading", progress: 0, error: "" })
            const uploadResponse = await uploadAPI.uploadMedia(file, {
              folder: MENU_ITEM_IMAGE_FOLDER,
            })
            const imageUrl = uploadResponse?.data?.data?.url || uploadResponse?.data?.url
            if (imageUrl) {
              uploadedImageUrls.push(imageUrl)
              unsavedUploadUrlsRef.current.add(imageUrl)
              setImageUpload({ status: "done", progress: 100, error: "" })
              debugLog(`Successfully uploaded image ${i + 1}:`, imageUrl)
            } else {
              debugError('Upload response:', uploadResponse)
              throw new Error("Failed to get uploaded image URL")
            }
          } catch (uploadError) {
            debugError(`Error uploading image ${i + 1} (${file.name}):`, uploadError)
            const message = getUploadErrorMessage(uploadError, file.name || "image")
            setImageUpload({ status: "error", progress: 0, error: message })
            toast.error(message)
            setUploadingImages(false)
            return
          }
        }
      }

      // Single-image mode: keep only one URL
      const allImageUrls = [
        ...existingImageUrls,
        ...uploadedImageUrls
      ].filter((url, index, self) =>
        url &&
        typeof url === 'string' &&
        url.trim() !== '' &&
        self.indexOf(url) === index
      ).slice(0, 1)

      // Debug: Log image URLs
      debugLog('=== IMAGE UPLOAD SUMMARY ===')
      debugLog('Existing image URLs:', existingImageUrls.length, existingImageUrls)
      debugLog('Newly uploaded URLs:', uploadedImageUrls.length, uploadedImageUrls)
      debugLog('Total image URLs to save:', allImageUrls.length, allImageUrls)
      debugLog('==========================')

      // Create/update FoodItem in DB (single call per explicit Save; no autosave spam)
      let itemId
      if (isNewItem) {
        const createRes = await restaurantAPI.createFood({
          name: itemName.trim(),
          description: itemDescription.trim(),
          price: parsedBasePrice,
          variants: variantPayload,
          image: allImageUrls.length > 0 ? allImageUrls[0] : "",
          foodType: effectiveFoodType,
          isAvailable: isInStock,
          isRecommended: isRecommended === true,
          preparationTime: preparationTime || "",
          categoryId: categoryId || undefined,
          categoryName,
        })
        const created = createRes?.data?.data?.food || createRes?.data?.food
        itemId = String(created?._id || created?.id || "")
        if (!itemId) {
          throw new Error("Failed to create item in database")
        }
      } else {
        itemId = String(itemData?.id || id || "")
        if (!itemId) {
          throw new Error("Invalid item id")
        }
        await restaurantAPI.updateFood(itemId, {
          name: itemName.trim(),
          description: itemDescription.trim(),
          price: parsedBasePrice,
          variants: variantPayload,
          image: allImageUrls.length > 0 ? allImageUrls[0] : "",
          foodType: effectiveFoodType,
          isAvailable: isInStock,
          isRecommended: isRecommended === true,
          preparationTime: preparationTime || "",
          categoryId: categoryId || undefined,
          categoryName,
        })
      }

      // The item now references its image; any other upload from this session is unused.
      itemSavedRef.current = true
      discardUnsavedUploads(allImageUrls[0] || "")

      try {
        const nextRecommendedMap = (() => {
          if (typeof window === "undefined") return null
          const raw = window.localStorage.getItem(INVENTORY_RECOMMENDED_KEY)
          const parsed = raw ? JSON.parse(raw) : {}
          const safeMap = parsed && typeof parsed === "object" ? parsed : {}
          return {
            ...safeMap,
            [String(itemId)]: Boolean(isRecommended),
          }
        })()

        if (nextRecommendedMap && typeof window !== "undefined") {
          window.localStorage.setItem(
            INVENTORY_RECOMMENDED_KEY,
            JSON.stringify(nextRecommendedMap),
          )
        }
      } catch (recommendedError) {
        debugWarn("Failed to persist recommended state after save:", recommendedError)
      }

      toast.success(
        isNewItem
          ? "Item created successfully"
          : "Item updated and sent for approval again"
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      navigate("/food/restaurant/inventory", { replace: true })
      window.dispatchEvent(new CustomEvent('foodsChanged'))
    } catch (error) {
      debugError('Error saving menu:', error)
      if (error.code === 'ERR_NETWORK') {
        toast.error('Network error. Please check if backend server is running and try again.')
      } else {
        toast.error(error.response?.data?.message || error.message || "Failed to save item. Please try again.")
      }
    } finally {
      setUploadingImages(false)
    }
  }

  const handleVariantChange = (localId, field, value) => {
    setVariants((prev) =>
      prev.map((variant) =>
        variant.localId === localId ? { ...variant, [field]: value } : variant,
      ),
    )
  }

  const handleAddVariant = () => {
    setVariants((prev) => [...prev, createVariantDraft()])
  }

  const handleRemoveVariant = (localId) => {
    setVariants((prev) => prev.filter((variant) => variant.localId !== localId))
  }

  const handleDelete = () => {
    // Delete logic here
    debugLog("Deleting item:", id)
    goBack()
  }

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      <style>{`
        [data-slot="switch"][data-state="checked"] {
          background-color: #16a34a !important;
        }
        [data-slot="switch-thumb"][data-state="checked"] {
          background-color: #ffffff !important;
        }
      `}</style>
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-1 rounded-full hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Item details</h1>
        </div>
      </div>


      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: `${96 + keyboardInset}px` }}>
        {!isNewItem && currentApprovalStatus === "rejected" && currentRejectionReason ? (
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-700">Approval rejected</p>
              <p className="mt-1 text-sm leading-5 text-[#2E7D52]">Reason: {currentRejectionReason}</p>
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-[#2E7D52]">
                Update the dish and save to send it for approval again
              </p>
            </div>
          </div>
        ) : null}

        {/* Image Carousel */}
        <div className="relative bg-white">
          {images.length > 0 ? (
            <div className="relative w-full h-80 overflow-hidden bg-gray-100">
              {/* Image container with swipe support */}
              <div
                ref={carouselRef}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                className="relative w-full h-full"
              >
                <AnimatePresence mode="wait" custom={direction}>
                  <motion.div
                    key={currentImageIndex}
                    custom={direction}
                    initial={{ opacity: 0, x: direction > 0 ? 300 : -300 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: direction > 0 ? -300 : 300 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="absolute inset-0"
                  >
                    {images[currentImageIndex] ? (
                      // Resolves stored values the same way the customer app does, so
                      // the restaurant previews exactly what customers will see;
                      // blob: previews pass through untouched. Falls back on a
                      // missing file or an undecodable preview (e.g. HEIC).
                      <SafeImage
                        src={images[currentImageIndex]}
                        fallbackSrc={dishFallbackImage}
                        alt={`${itemName} - Image ${currentImageIndex + 1}`}
                        loading="eager"
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </motion.div>
                </AnimatePresence>

                {imageUpload.status === "uploading" && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/40 text-white">
                    <Loader2 className="w-7 h-7 animate-spin" />
                    <span className="text-sm font-semibold">
                      Uploading{imageUpload.progress > 0 ? ` ${imageUpload.progress}%` : "..."}
                    </span>
                  </div>
                )}

                {imageUpload.status === "error" && imageFiles.size > 0 && (
                  <div className="absolute inset-x-3 bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl bg-black/70 px-3 py-2 text-white">
                    <span className="text-xs font-medium line-clamp-2">Image upload failed</span>
                    <button
                      type="button"
                      onClick={handleRetryImageUpload}
                      className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 active:scale-95"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Navigation arrows */}
                {images.length > 1 && (
                  <>
                    <button
                      onClick={goToPrevious}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all z-10"
                    >
                      <ChevronLeft className="w-5 h-5 text-gray-900" />
                    </button>
                    <button
                      onClick={goToNext}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all z-10"
                    >
                      <ChevronRight className="w-5 h-5 text-gray-900" />
                    </button>
                  </>
                )}

                {/* Remove Dish Photo button (Top Right) */}
                {images.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowRemoveImageConfirm(true)}
                    className="absolute top-4 right-4 w-10 h-10 bg-[#2E7D52] hover:bg-[#990831] rounded-full flex items-center justify-center shadow-md transition-all z-20 text-white active:scale-95 border border-white/30"
                    title="Remove Dish Photo"
                  >
                    <Trash2 className="w-5 h-5 text-white stroke-[2.2]" />
                  </button>
                )}

                {/* Image counter */}
                {images.length > 1 && (
                  <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full z-10">
                    <span className="text-white text-xs font-medium">
                      {currentImageIndex + 1} / {images.length}
                    </span>
                  </div>
                )}
              </div>

              {/* Carousel dots */}
              {images.length > 1 && (
                <div className="flex items-center justify-center gap-2 py-4 bg-white">
                  {images.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setDirection(index > currentImageIndex ? 1 : -1)
                        setCurrentImageIndex(index)
                      }}
                      className={`transition-all duration-300 rounded-full ${index === currentImageIndex
                        ? "w-8 h-2 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F]"
                        : "w-2 h-2 bg-gray-300 hover:bg-gray-400"
                        }`}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full h-80 bg-gray-100 overflow-hidden">
              <img
                src={dishFallbackImage}
                alt="Dish Fallback"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center">
                <div className="text-center bg-white/90 dark:bg-gray-900/90 backdrop-blur-md px-6 py-4 rounded-2xl shadow-xl border border-white/20">
                  <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Camera className="w-6 h-6 text-gray-600 dark:text-gray-300" />
                  </div>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">No Image Uploaded</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Optional: Tap button below to add a photo</p>
                </div>
              </div>
            </div>
          )}

          {/* Add image button - redesigned */}
          <div className="px-4 py-4 bg-white border-t border-gray-100">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleImageAdd(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleCameraClick}
              disabled={imageUpload.status === "uploading"}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-xl text-sm font-semibold cursor-pointer hover:from-gray-800 hover:to-gray-700 transition-all shadow-md hover:shadow-lg active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              <span>{images.length > 0 ? "Replace Image" : "Add Image (Optional)"}</span>
            </button>
          </div>
        </div>

        {/* Form Fields */}
        <div className="p-4 space-y-3">
          {/* Category Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Category
            </label>
            <button
              onClick={() => setIsCategoryPopupOpen(true)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-left flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
            >
              <span className={`text-sm ${selectedCategoryId ? "text-gray-900" : "text-gray-400"}`}>
                {selectedCategoryId ? category : "Select category"}
              </span>
              <ChevronDown className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Item Name */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Item name
            </label>
            <div className="relative">
              <input
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                maxLength={maxNameLength}
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#2E7D52] focus:border-transparent"
                placeholder="Enter item name"
              />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100">
                <EditIcon className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="text-right mt-1">
              <span className="text-xs text-gray-500">
                {nameLength} / {maxNameLength}
              </span>
            </div>
          </div>

          {/* Item Description */}
          <div className="-mt-1">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Item description
            </label>
            <div className="relative">
              <textarea
                value={itemDescription}
                onChange={(e) => setItemDescription(e.target.value)}
                maxLength={maxDescriptionLength}
                rows={4}
                placeholder="Eg: Yummy veg paneer burger with a soft patty, veggies, cheese, and special sauce"
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#2E7D52] focus:border-transparent resize-none"
              />
              <button className="absolute right-3 top-3 p-1 rounded-full hover:bg-gray-100">
                <EditIcon className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className={`text-xs ${descriptionLength < minDescriptionLength ? "text-[#2E7D52]" : "text-gray-500"}`}>
                {descriptionLength < minDescriptionLength ? "Min 5 characters required" : ""}
              </span>
              <span className="text-xs text-gray-500">
                {descriptionLength} / {maxDescriptionLength}
              </span>
            </div>
            {/* Dietary Options */}
            <div className="flex flex-wrap gap-2 mt-3">
              {restaurantFoodType !== "Non-Veg" && (
                <button
                  type="button"
                  onClick={() => setFoodType("Veg")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${foodType === "Veg"
                    ? "border-green-600 border-2 text-green-600 font-semibold"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                >
                  {foodType === "Veg" && <Check className="w-4 h-4" />}
                  <div className="w-2.5 h-2.5 rounded-full bg-green-600" />
                  <span>Veg</span>
                </button>
              )}
              {restaurantFoodType !== "Veg" && (
                <button
                  type="button"
                  onClick={() => setFoodType("Non-Veg")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${foodType === "Non-Veg"
                    ? "border-red-600 border-2 text-red-600 font-semibold"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                >
                  {foodType === "Non-Veg" && <Check className="w-4 h-4" />}
                  <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                  <span>Non-Veg</span>
                </button>
              )}
            </div>
            {restaurantFoodType === "Veg" ? (
              <p className="mt-2 text-xs text-green-700">
                Veg restaurant — only vegetarian items can be added.
              </p>
            ) : restaurantFoodType === "Non-Veg" ? (
              <p className="mt-2 text-xs text-red-700">
                Non-Veg restaurant — only non-vegetarian items can be added.
              </p>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                Mixed restaurant — choose Veg or Non-Veg for this item.
              </p>
            )}
          </div>

          {/* Item Price */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Item price
            </label>
            <div className="space-y-3">
              {variants.length > 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-emerald-800">Starting price on menu</p>
                    <p className="text-base sm:text-lg font-bold text-emerald-950">
                      ₹{Math.min(...variants.map(v => Number(v.price)).filter(p => Number.isFinite(p) && p > 0)) || 0}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-white px-2.5 py-1 rounded-full border border-emerald-200 shadow-xs">
                    Auto-set from lowest variant
                  </span>
                </div>
              ) : (
                <div className="relative">
                  <label className="block text-xs text-gray-600 mb-1">Item price</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={basePrice}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[\u20B9\s,]/g, '').replace(/[^0-9.]/g, '')
                        const parts = value.split('.')
                        const cleanedValue = parts.length > 2
                          ? parts[0] + '.' + parts.slice(1).join('')
                          : value
                        setBasePrice(cleanedValue)
                      }}
                      onFocus={(e) => {
                        if (e.target.value.startsWith('\u20B9')) {
                          e.target.value = e.target.value.replace(/[\u20B9\s]+/g, '')
                        }
                      }}
                      placeholder="Enter price"
                      className="w-full pl-8 pr-12 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2E7D52] focus:border-transparent"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-600">{"\u20B9"}</span>
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100">
                      <EditIcon className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Variants</p>
                    <p className="text-xs text-gray-500">Optional. Add multiple names and prices like Half, Full, Small, Large.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddVariant}
                    className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add variant
                  </button>
                </div>

                {variants.length > 0 ? (
                  <div className="space-y-3">
                    {variants.map((variant, index) => (
                      <div key={variant.localId} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Variant name</label>
                            <input
                              type="text"
                              value={variant.name}
                              onChange={(e) => handleVariantChange(variant.localId, "name", e.target.value)}
                              placeholder={index === 0 ? "e.g., Half" : "e.g., Full"}
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#2E7D52] focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Variant price</label>
                            <div className="relative">
                              <input
                                type="text"
                                value={variant.price}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/[\u20B9\s,]/g, '').replace(/[^0-9.]/g, '')
                                  const parts = value.split('.')
                                  const cleanedValue = parts.length > 2
                                    ? parts[0] + '.' + parts.slice(1).join('')
                                    : value
                                  handleVariantChange(variant.localId, "price", cleanedValue)
                                }}
                                placeholder="Enter price"
                                className="w-full pl-8 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#2E7D52] focus:border-transparent"
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-600">{"\u20B9"}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveVariant(variant.localId)}
                          className="h-10 w-10 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No variants added. This item will use the base price only.</p>
                )}
              </div>

              {/* Preparation Time */}
              <div className="relative">
                <label className="block text-xs text-gray-600 mb-1">Preparation Time</label>
                <div className="relative">
                  <select
                    value={preparationTime}
                    onChange={(e) => setPreparationTime(e.target.value)}
                    className="w-full pl-4 pr-10 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2E7D52] focus:border-transparent appearance-none"
                  >
                    <option value="">Select timing</option>
                    <option value="10-20 mins">10-20 mins</option>
                    <option value="20-25 mins">20-25 mins</option>
                    <option value="25-35 mins">25-35 mins</option>
                    <option value="35-45 mins">35-45 mins</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none" />
                </div>
              </div>
              {/* <div>
                <label className="block text-xs text-gray-600 mb-1">GST</label>
                <button
                  onClick={() => setIsGstPopupOpen(true)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-left flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm text-gray-900">GST {gst}%</span>
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                </button>
              </div> */}
            </div>

          </div>

          {/* Recommend and In Stock */}
          <div className="space-y-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Recommended</span>
              <Switch
                checked={isRecommended}
                onCheckedChange={setIsRecommended}
                className="data-[state=checked]:bg-green-600"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">In stock</span>
              <Switch
                checked={isInStock}
                onCheckedChange={setIsInStock}
                className="data-[state=checked]:bg-green-600"
              />
            </div>
          </div>


        </div>
      </div>

      {/* Category Selection Popup */}
      <AnimatePresence>
        {isCategoryPopupOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCategoryPopupOpen(false)}
              className="fixed inset-0 bg-black/50 z-50"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              {...categorySheetProps}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 flex items-center justify-between px-4 py-4 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">Select category</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setIsCategoryPopupOpen(false)
                      navigate('/food/restaurant/menu-categories', {
                        state: { backTo: location.pathname, openCategoryPopup: true }
                      })
                    }}
                    className="p-2 rounded-lg bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white hover:bg-gray-800 transition-colors flex items-center gap-1.5"
                    title="Add Category"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm font-medium">Add</span>
                  </button>
                  <button
                    onClick={() => setIsCategoryPopupOpen(false)}
                    className="p-1 rounded-full hover:bg-gray-100"
                  >
                    <X className="w-5 h-5 text-gray-600" />
                  </button>
                </div>
              </div>
              <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    ref={categorySearchInputRef}
                    type="text"
                    value={categorySearchQuery}
                    onChange={(e) => setCategorySearchQuery(e.target.value)}
                    placeholder="Search categories..."
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E7D52]/25 focus:border-[#2E7D52]/40 focus:bg-white transition-colors"
                  />
                  {categorySearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCategorySearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      aria-label="Clear search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col">
                {loadingCategories ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
                  </div>
                ) : categories.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center space-y-4">
                    <p className="text-sm text-gray-500">No categories available</p>
                    <button
                      onClick={() => {
                        setIsCategoryPopupOpen(false)
                        navigate('/food/restaurant/menu-categories', {
                          state: { backTo: location.pathname, openCategoryPopup: true }
                        })
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-lg font-semibold hover:bg-gray-800 transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                      Add Category
                    </button>
                  </div>
                ) : filteredCategories.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center">
                    <p className="text-sm text-gray-500">No matching categories found.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filteredCategories.map((cat) => {
                      const isSelected = String(selectedCategoryId || "") === String(cat.id)
                      const isVeg = cat.foodTypeScope === "Veg"
                      const isNonVeg = cat.foodTypeScope === "Non-Veg"
                      return (
                        <button
                          key={cat.id}
                          onClick={() => handleCategorySelect(cat.id, cat.name)}
                          className={`w-full rounded-xl px-4 py-3 text-left transition-all ${isSelected
                            ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white shadow-md"
                            : "bg-gray-50 text-gray-900 hover:bg-gray-100"
                            }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{cat.name}</span>
                            {isVeg ? (
                              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${isSelected ? "border-green-400 bg-green-900/40 text-green-300" : "border-green-300 bg-green-50 text-green-700"}`}>
                                <span className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-green-400" : "border-green-600"}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full block ${isSelected ? "bg-green-400" : "bg-green-600"}`} />
                                </span>
                                Veg
                              </div>
                            ) : isNonVeg ? (
                              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${isSelected ? "border-white/40 bg-white/15 text-white" : "border-red-300 bg-red-50 text-red-700"}`}>
                                <span className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-white" : "border-red-600"}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full block ${isSelected ? "bg-white" : "bg-red-600"}`} />
                                </span>
                                Non-Veg
                              </div>
                            ) : (
                              <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${isSelected ? "border-white/40 bg-white/15 text-white" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
                                Both
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>


      {/* GST Popup */}
      {/* <AnimatePresence>
        {isGstPopupOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsGstPopupOpen(false)}
              className="fixed inset-0 bg-black/50 z-50"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 max-h-[60vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">Select GST</h2>
                <button
                  onClick={() => setIsGstPopupOpen(false)}
                  className="p-1 rounded-full hover:bg-gray-100"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-2">
                  {gstOptions.map((gstValue) => (
                    <button
                      key={gstValue}
                      onClick={() => handleGstSelect(gstValue)}
                      className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                        gst === gstValue
                          ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white"
                          : "bg-gray-50 text-gray-900 hover:bg-gray-100"
                      }`}
                    >
                      {gstValue}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence> */}


      {/* Bottom Sticky Buttons */}
      <div
        className="fixed left-0 right-0 bg-white border-t border-gray-200 z-40"
        style={{ bottom: `${keyboardInset}px` }}
      >
        {!isNewItem && (
          <div className="pt-2 pb-0 text-center border-b border-gray-100">
            <button
              type="button"
              onClick={() => setShowDeleteItemConfirm(true)}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline flex items-center justify-center gap-1.5 mx-auto py-1.5 px-3 rounded-lg hover:bg-rose-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Entire Item from Menu</span>
            </button>
          </div>
        )}
        <div className="flex gap-3 px-4 py-3">
          <button
            onClick={goBack}
            className="flex-1 py-3 px-4 border border-gray-300 rounded-lg text-sm font-bold text-gray-900 bg-white hover:bg-gray-50 transition-colors uppercase"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={uploadingImages || imageUpload.status === "uploading"}
            className="flex-1 py-3 px-4 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 uppercase bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white hover:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            {uploadingImages ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>

      {/* Photo Removal Confirmation Modal */}
      <AnimatePresence>
        {showRemoveImageConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-2xl border border-gray-100 dark:border-gray-800 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-100 dark:border-rose-900/50">
                <Trash2 className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Remove Dish Photo?
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                Are you sure you want to remove this dish photo? The photo will be removed once you click <strong>SAVE</strong>.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowRemoveImageConfirm(false)}
                  className="flex-1 py-3 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    imageTouchedRef.current = true;
                    // Ignore the result of an upload still in flight for this photo.
                    activeImageUploadRef.current = null;
                    setImageUpload({ status: "idle", progress: 0, error: "" });
                    setImages([]);
                    setImageFiles(new Map());
                    setCurrentImageIndex(0);
                    setShowRemoveImageConfirm(false);
                    toast.info("Photo removed. Click SAVE to apply changes.");
                  }}
                  className="flex-1 py-3 px-4 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors shadow-md shadow-rose-600/20"
                >
                  Yes, Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Entire Dish Item Deletion Confirmation Modal */}
      <AnimatePresence>
        {showDeleteItemConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-2xl border border-gray-100 dark:border-gray-800 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-100 dark:border-rose-900/50">
                <Trash2 className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Delete Dish Item?
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                Are you sure you want to delete <strong>{itemName || "this item"}</strong> from your restaurant menu? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={isDeletingItem}
                  onClick={() => setShowDeleteItemConfirm(false)}
                  className="flex-1 py-3 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingItem}
                  onClick={handleDeleteItem}
                  className="flex-1 py-3 px-4 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors shadow-md shadow-rose-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeletingItem ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    "Yes, Delete"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Photo Picker */}
      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handleImageAdd}
        title="Item Image"
        description="Choose how to upload your item image"
        fileNamePrefix="item-photo"
        galleryInputRef={fileInputRef}
      />
    </div>
  )
}









