import { useState, useEffect, useRef } from "react"
import {
  ALL_CUISINES as SHARED_ALL_CUISINES,
  DAYS_OF_WEEK,
  normalizeRestaurantProfile,
} from "@food/utils/restaurantProfile"
import { useNavigate, useLocation } from "react-router-dom"
import Lenis from "lenis"
import {
  ArrowLeft,
  User,
  Edit,
  Building,
  CreditCard,
  FileText,
  Upload,
  X,
  ImageIcon,
  Check,
  Calendar as CalendarIcon,
  Sparkles,
  MapPin,
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { restaurantAPI, zoneAPI, uploadAPI } from "@food/api"
import OptimizedImage from "@food/components/OptimizedImage"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { toast } from "sonner"
import LocationSearchInput from "@food/components/restaurant/LocationSearchInput"
import { dispatchRestaurantLocationUpdated, buildRestaurantLocationUpdatePayload } from "@food/utils/restaurantLocation"

const PAN_NUMBER_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GST_NUMBER_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_NUMBER_REGEX = /^\d{14}$/
const BANK_ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/
const IFSC_CODE_REGEX = /^[A-Z0-9]{11}$/
const OWNER_NAME_REGEX = /^[A-Za-z ]+$/
const ACCOUNT_HOLDER_NAME_REGEX = /^[A-Za-z ]+$/
const GST_LEGAL_NAME_REGEX = /^[A-Za-z ]+$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EDIT_OWNER_DRAFT_KEY = "restaurant_edit_owner_draft"
const EDIT_OWNER_ACTIVE_TAB_KEY = "restaurant_edit_owner_active_tab"

const createDefaultFormData = () => ({
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  profileImage: null,
  restaurantName: "",
  foodType: "Mixed",
  pureVegRestaurant: false,
  pureVeganRestaurant: false,
  primaryContactNumber: "",
  zoneId: "",
  location: {
    formattedAddress: "",
    addressLine1: "",
    addressLine2: "",
    area: "",
    city: "Indore",
    state: "Madhya Pradesh",
    pincode: "",
    landmark: "",
    latitude: "",
    longitude: "",
  },
  cuisines: [],
  openingTime: "",
  closingTime: "",
  openDays: [],
  estimatedDeliveryTime: "",
  panNumber: "",
  nameOnPan: "",
  panImage: null,
  accountNumber: "",
  confirmAccountNumber: "",
  ifscCode: "",
  accountHolderName: "",
  accountType: "Saving",
  gstRegistered: false,
  gstNumber: "",
  gstLegalName: "",
  gstAddress: "",
  gstImage: null,
  fssaiNumber: "",
  fssaiExpiry: "",
  fssaiImage: null,
  menuImages: [],
})

const daysOfWeek = DAYS_OF_WEEK

const ALL_CUISINES = SHARED_ALL_CUISINES

const formatNameToCapital = (str) => {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

const mergePendingLocation = (baseLocation, pendingLocation) => {
  if (!pendingLocation || typeof pendingLocation !== "object") return baseLocation

  return {
    ...baseLocation,
    formattedAddress: pendingLocation.formattedAddress || baseLocation.formattedAddress || "",
    addressLine1:
      pendingLocation.addressLine1 ||
      pendingLocation.placeName ||
      baseLocation.addressLine1 ||
      "",
    addressLine2: pendingLocation.addressLine2 || baseLocation.addressLine2 || "",
    area: pendingLocation.area || baseLocation.area || "",
    city: pendingLocation.city || baseLocation.city || "",
    state: pendingLocation.state || baseLocation.state || "",
    pincode: pendingLocation.pincode || baseLocation.pincode || "",
    landmark:
      pendingLocation.landmark ||
      pendingLocation.placeName ||
      pendingLocation.addressLine1 ||
      baseLocation.landmark ||
      "",
    latitude:
      pendingLocation.latitude != null && pendingLocation.latitude !== ""
        ? String(pendingLocation.latitude)
        : baseLocation.latitude,
    longitude:
      pendingLocation.longitude != null && pendingLocation.longitude !== ""
        ? String(pendingLocation.longitude)
        : baseLocation.longitude,
  }
}

const readStoredDraft = (pendingLocation = null) => {
  try {
    const draftRaw = sessionStorage.getItem(EDIT_OWNER_DRAFT_KEY)
    if (!draftRaw) return null
    const draft = JSON.parse(draftRaw)
    if (!draft || typeof draft !== "object") return null
    if (pendingLocation) {
      return {
        ...draft,
        location: mergePendingLocation(draft.location, pendingLocation),
      }
    }
    return draft
  } catch {
    return null
  }
}

export default function EditOwner() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const outletInfoPath = "/food/restaurant/outlet-info"
  const backTarget = routerLocation.state?.from || outletInfoPath
  const restoredDraftOnMount = readStoredDraft(routerLocation.state?.updatedLocation)

  const handleBack = () => {
    try {
      sessionStorage.removeItem(EDIT_OWNER_DRAFT_KEY)
    } catch {
      // ignore storage errors
    }
    if (initialData) {
      setFormData(JSON.parse(JSON.stringify(initialData)))
    }
    navigate(backTarget)
  }

  // Tabs structure
  const TABS = [
    { id: "owner", label: "Owner Details", icon: User },
    { id: "restaurant", label: "Restaurant Info", icon: Building },
    { id: "kyc", label: "Bank & KYC", icon: CreditCard },
    { id: "docs", label: "FSSAI & Docs", icon: FileText },
  ]
  const [activeTab, setActiveTab] = useState(() => {
    const fromState = routerLocation.state?.activeTab
    if (fromState && ["owner", "restaurant", "kyc", "docs"].includes(fromState)) {
      return fromState
    }
    try {
      const saved = sessionStorage.getItem(EDIT_OWNER_ACTIVE_TAB_KEY)
      if (saved && ["owner", "restaurant", "kyc", "docs"].includes(saved)) {
        return saved
      }
    } catch {
      // ignore storage errors
    }
    return "owner"
  })

  // Master Form Data
  const [formData, setFormData] = useState(() => restoredDraftOnMount || createDefaultFormData())

  const [initialData, setInitialData] = useState(null)
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(() => !restoredDraftOnMount)
  const [saving, setSaving] = useState(false)

  // Photo Picker helpers
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const [activeImageField, setActiveImageField] = useState(null)
  const fileInputRef = useRef(null)

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)
    return () => {
      lenis.destroy()
    }
  }, [])

  // Load Zones on Mount
  useEffect(() => {
    let cancelled = false
    zoneAPI
      .getPublicZones()
      .then((res) => {
        const list = res?.data?.data?.zones || res?.data?.zones || []
        if (!cancelled) setZones(Array.isArray(list) ? list : [])
      })
      .catch((err) => {
        console.error("Failed to load zones:", err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(EDIT_OWNER_ACTIVE_TAB_KEY, activeTab)
    } catch {
      // ignore storage errors
    }
  }, [activeTab])

  // Fetch restaurant details
  useEffect(() => {
    const pendingLocation = routerLocation.state?.updatedLocation
    const returnTab = routerLocation.state?.activeTab

    if (returnTab && ["owner", "restaurant", "kyc", "docs"].includes(returnTab)) {
      setActiveTab(returnTab)
    }

    let draftData = restoredDraftOnMount
    if (!draftData) {
      try {
        const draftRaw = sessionStorage.getItem(EDIT_OWNER_DRAFT_KEY)
        if (draftRaw) {
          draftData = JSON.parse(draftRaw)
        }
      } catch {
        draftData = null
      }
    }

    const fetchRestaurantData = async () => {
      try {
        if (!draftData) {
          setLoading(true)
        }

        const response = await restaurantAPI.refreshCurrentRestaurant()
        const apiData = response?.data?.data?.restaurant || response?.data?.restaurant

        if (apiData) {
          // One normalizer feeds both Outlet Info (view) and this form, so the
          // two screens can never show different values for the same field.
          const normalized = normalizeRestaurantProfile(apiData)

          const mappedData = {
            ...normalized,
            // Form-only mirror used by the confirm-account-number field.
            confirmAccountNumber: normalized.accountNumber,
          }

          const savedInitial = JSON.parse(JSON.stringify(mappedData))

          let cachedDraft = draftData
          if (!cachedDraft) {
            try {
              const draftRaw = sessionStorage.getItem(EDIT_OWNER_DRAFT_KEY)
              if (draftRaw) {
                cachedDraft = JSON.parse(draftRaw)
              }
            } catch {
              cachedDraft = null
            }
          }

          let nextFormData = cachedDraft || mappedData
          if (pendingLocation) {
            nextFormData = {
              ...nextFormData,
              location: mergePendingLocation(nextFormData.location, pendingLocation),
            }
          }

          setInitialData(savedInitial)
          setFormData(nextFormData)

          if (pendingLocation) {
            navigate(routerLocation.pathname, {
              replace: true,
              state: {
                from: routerLocation.state?.from || outletInfoPath,
                activeTab: returnTab || activeTab || "restaurant",
              },
            })
          }
        }
      } catch (err) {
        console.error("Error loading restaurant data:", err)
        if (!draftData) {
          toast.error("Failed to load restaurant profile details")
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()
  }, [])

  // Check for unsaved changes
  const hasChanges = initialData ? JSON.stringify(formData) !== JSON.stringify(initialData) : false

  // Field change helpers
  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleLocationChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      location: {
        ...prev.location,
        [field]: value,
      },
    }))
  }

  const handleLocationSearchSelect = (location) => {
    if (!location) return

    setFormData((prev) => {
      const next = {
        ...prev,
        location: {
          ...prev.location,
          formattedAddress: location.formattedAddress || prev.location.formattedAddress || "",
          addressLine1: location.addressLine1 || location.placeName || "",
          addressLine2: location.addressLine2 || "",
          area: location.area || "",
          city: location.city || prev.location.city || "Indore",
          state: location.state || prev.location.state || "Madhya Pradesh",
          pincode: location.pincode || "",
          landmark: location.landmark || location.placeName || "",
          latitude:
            location.latitude != null && location.latitude !== ""
              ? String(location.latitude)
              : prev.location.latitude,
          longitude:
            location.longitude != null && location.longitude !== ""
              ? String(location.longitude)
              : prev.location.longitude,
        },
      }

      try {
        sessionStorage.setItem(EDIT_OWNER_DRAFT_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors
      }

      return next
    })
  }

  // Cuisines helper
  const handleCuisineToggle = (cuisine) => {
    setFormData((prev) => {
      const isSelected = prev.cuisines.includes(cuisine)
      if (isSelected) {
        return {
          ...prev,
          cuisines: prev.cuisines.filter((c) => c !== cuisine),
        }
      } else {
        if (prev.cuisines.length >= 8) {
          toast.error("You can select up to 8 cuisines only")
          return prev
        }
        return {
          ...prev,
          cuisines: [...prev.cuisines, cuisine],
        }
      }
    })
  }

  // Open Days helper
  const handleDayToggle = (day) => {
    setFormData((prev) => {
      const isSelected = prev.openDays.includes(day)
      if (isSelected) {
        return {
          ...prev,
          openDays: prev.openDays.filter((d) => d !== day),
        }
      } else {
        return {
          ...prev,
          openDays: [...prev.openDays, day],
        }
      }
    })
  }

  // File picker handler
  const handlePhotoClick = (field) => {
    setActiveImageField(field)
    setIsPhotoPickerOpen(true)
  }

  const handlePhotoSelect = (file) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size too large. Max 5MB allowed.")
      return
    }

    if (activeImageField === "menuImages") {
      setFormData((prev) => ({
        ...prev,
        menuImages: [...prev.menuImages, file],
      }))
    } else {
      setFormData((prev) => ({
        ...prev,
        [activeImageField]: file,
      }))
    }
    setIsPhotoPickerOpen(false)
  }

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      handlePhotoSelect(file)
    }
    event.target.value = "" // reset
  }

  const handleRemoveImage = (field, index = null) => {
    if (field === "menuImages" && index !== null) {
      setFormData((prev) => ({
        ...prev,
        menuImages: prev.menuImages.filter((_, idx) => idx !== index),
      }))
    } else {
      setFormData((prev) => ({
        ...prev,
        [field]: null,
      }))
    }
  }

  // Get image preview URL
  const getPreviewUrl = (value) => {
    if (!value) return ""
    if (typeof value === "string") return value
    if (value instanceof File || value instanceof Blob) {
      try {
        return URL.createObjectURL(value)
      } catch {
        return ""
      }
    }
    return value.url || ""
  }

  // Validation function
  const validateForm = () => {
    const errors = []

    // 1. Owner Details validation
    if (!formData.ownerName?.trim()) {
      errors.push({ tab: "owner", field: "ownerName", message: "Owner name is required" })
    } else if (!OWNER_NAME_REGEX.test(formData.ownerName.trim())) {
      errors.push({ tab: "owner", field: "ownerName", message: "Owner name must contain only letters" })
    }

    if (!formData.ownerEmail?.trim()) {
      errors.push({ tab: "owner", field: "ownerEmail", message: "Owner email is required" })
    } else if (!EMAIL_REGEX.test(formData.ownerEmail.trim())) {
      errors.push({ tab: "owner", field: "ownerEmail", message: "Please enter a valid email address" })
    }

    if (!formData.ownerPhone?.trim()) {
      errors.push({ tab: "owner", field: "ownerPhone", message: "Mobile phone number is required" })
    } else if (!/^\d{10}$/.test(formData.ownerPhone.replace(/\D/g, ""))) {
      errors.push({ tab: "owner", field: "ownerPhone", message: "Mobile number must be exactly 10 digits" })
    }

    if (!formData.profileImage) {
      errors.push({ tab: "owner", field: "profileImage", message: "Profile photo is required" })
    }

    // 2. Restaurant details validation
    if (!formData.restaurantName?.trim()) {
      errors.push({ tab: "restaurant", field: "restaurantName", message: "Restaurant name is required" })
    } else if (/[\/-]/.test(formData.restaurantName)) {
      errors.push({ tab: "restaurant", field: "restaurantName", message: "Restaurant name cannot contain slashes (/) or hyphens (-)" })
    }

    if (!formData.primaryContactNumber?.trim()) {
      errors.push({ tab: "restaurant", field: "primaryContactNumber", message: "Primary contact number is required" })
    } else if (!/^\d{10}$/.test(formData.primaryContactNumber.replace(/\D/g, ""))) {
      errors.push({ tab: "restaurant", field: "primaryContactNumber", message: "Primary contact must be exactly 10 digits" })
    }

    if (!formData.zoneId) {
      errors.push({ tab: "restaurant", field: "zoneId", message: "Service zone selection is required" })
    }

    if (!formData.location?.addressLine1?.trim()) {
      errors.push({ tab: "restaurant", field: "addressLine1", message: "Address details are required" })
    }

    if (!formData.location?.area?.trim()) {
      errors.push({ tab: "restaurant", field: "area", message: "Area/Locality is required" })
    }

    if (!formData.location?.pincode?.trim()) {
      errors.push({ tab: "restaurant", field: "pincode", message: "Pincode is required" })
    } else if (!/^\d{6}$/.test(formData.location.pincode.replace(/\D/g, ""))) {
      errors.push({ tab: "restaurant", field: "pincode", message: "Pincode must be exactly 6 digits" })
    }

    if (!formData.openingTime || !formData.closingTime) {
      errors.push({ tab: "restaurant", field: "timings", message: "Opening & closing timings are required" })
    }

    if (!formData.openDays || formData.openDays.length === 0) {
      errors.push({ tab: "restaurant", field: "openDays", message: "Select at least one open day" })
    }

    if (!formData.estimatedDeliveryTime?.trim()) {
      errors.push({ tab: "restaurant", field: "estimatedDeliveryTime", message: "Estimated delivery time is required" })
    }

    // 3. Bank & KYC validation
    if (!formData.panNumber?.trim()) {
      errors.push({ tab: "kyc", field: "panNumber", message: "PAN card number is required" })
    } else if (!PAN_NUMBER_REGEX.test(formData.panNumber.trim().toUpperCase())) {
      errors.push({ tab: "kyc", field: "panNumber", message: "Invalid PAN card format (e.g. ABCDE1234F)" })
    }

    if (!formData.nameOnPan?.trim()) {
      errors.push({ tab: "kyc", field: "nameOnPan", message: "Name on PAN card is required" })
    }

    if (!formData.panImage) {
      errors.push({ tab: "kyc", field: "panImage", message: "PAN card copy upload is required" })
    }

    if (!formData.accountNumber?.trim()) {
      errors.push({ tab: "kyc", field: "accountNumber", message: "Bank account number is required" })
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(formData.accountNumber.trim())) {
      errors.push({ tab: "kyc", field: "accountNumber", message: "Bank account number must be 9 to 18 digits" })
    }

    if (formData.accountNumber !== formData.confirmAccountNumber) {
      errors.push({ tab: "kyc", field: "confirmAccountNumber", message: "Bank account confirmation does not match" })
    }

    if (!formData.ifscCode?.trim()) {
      errors.push({ tab: "kyc", field: "ifscCode", message: "IFSC code is required" })
    } else if (!IFSC_CODE_REGEX.test(formData.ifscCode.trim().toUpperCase())) {
      errors.push({ tab: "kyc", field: "ifscCode", message: "Invalid IFSC code format (11 digits alphanumeric)" })
    }

    if (!formData.accountHolderName?.trim()) {
      errors.push({ tab: "kyc", field: "accountHolderName", message: "Account holder name is required" })
    } else if (!ACCOUNT_HOLDER_NAME_REGEX.test(formData.accountHolderName.trim())) {
      errors.push({ tab: "kyc", field: "accountHolderName", message: "Account holder name must contain only letters" })
    }

    if (formData.gstRegistered) {
      if (!formData.gstNumber?.trim()) {
        errors.push({ tab: "kyc", field: "gstNumber", message: "GSTIN is required when registered" })
      } else if (!GST_NUMBER_REGEX.test(formData.gstNumber.trim().toUpperCase())) {
        errors.push({ tab: "kyc", field: "gstNumber", message: "Invalid GSTIN format (15 characters)" })
      }
      if (!formData.gstLegalName?.trim()) {
        errors.push({ tab: "kyc", field: "gstLegalName", message: "GST Legal name is required" })
      } else if (!GST_LEGAL_NAME_REGEX.test(formData.gstLegalName.trim())) {
        errors.push({ tab: "kyc", field: "gstLegalName", message: "GST Legal name must contain only letters" })
      }
      if (!formData.gstAddress?.trim()) {
        errors.push({ tab: "kyc", field: "gstAddress", message: "GST Registered address is required" })
      }
      if (!formData.gstImage) {
        errors.push({ tab: "kyc", field: "gstImage", message: "GST certificate upload is required" })
      }
    }

    // 4. Documents & FSSAI validation
    if (!formData.fssaiNumber?.trim()) {
      errors.push({ tab: "docs", field: "fssaiNumber", message: "FSSAI number is required" })
    } else if (!FSSAI_NUMBER_REGEX.test(formData.fssaiNumber.trim())) {
      errors.push({ tab: "docs", field: "fssaiNumber", message: "FSSAI number must be exactly 14 digits" })
    }

    if (!formData.fssaiExpiry) {
      errors.push({ tab: "docs", field: "fssaiExpiry", message: "FSSAI expiry date is required" })
    } else {
      const today = new Date().toISOString().split("T")[0]
      if (formData.fssaiExpiry < today) {
        errors.push({ tab: "docs", field: "fssaiExpiry", message: "FSSAI expiry date cannot be in the past" })
      }
    }

    if (!formData.fssaiImage) {
      errors.push({ tab: "docs", field: "fssaiImage", message: "FSSAI copy upload is required" })
    }

    if (!formData.menuImages || formData.menuImages.length === 0) {
      errors.push({ tab: "docs", field: "menuImages", message: "At least one menu image is required" })
    }

    return errors
  }

  // Upload handler wrapper
  const uploadSingleFile = async (file, folder) => {
    if (!file) return null
    if (typeof file === "string") return { url: file } // already uploaded
    try {
      const res = await uploadAPI.uploadMedia(file, { folder })
      return res?.data?.data || res?.data || null
    } catch (err) {
      const errorMsg = err?.response?.data?.message || err?.message || "Upload failed"
      throw new Error(errorMsg)
    }
  }

  // Save changes handler
  const handleSave = async () => {
    const validationErrors = validateForm()
    if (validationErrors.length > 0) {
      // Surface first error, shift to its corresponding tab
      const firstError = validationErrors[0]
      setActiveTab(firstError.tab)
      toast.error(firstError.message)
      return
    }

    try {
      setSaving(true)

      // 1. Upload images in parallel
      const [profRes, panRes, gstRes, fssaiRes] = await Promise.all([
        uploadSingleFile(formData.profileImage, "food/restaurants/profile"),
        uploadSingleFile(formData.panImage, "food/restaurants/pan"),
        formData.gstRegistered
          ? uploadSingleFile(formData.gstImage, "food/restaurants/gst")
          : Promise.resolve(null),
        uploadSingleFile(formData.fssaiImage, "food/restaurants/fssai"),
      ])

      // 2. Upload menu images
      const menuImagesPayload = await Promise.all(
        formData.menuImages.map(async (img) => {
          if (img instanceof File || img instanceof Blob) {
            const res = await uploadSingleFile(img, "food/restaurants/menu")
            return res?.url || ""
          }
          return typeof img === "string" ? img : img?.url || ""
        })
      )

      // 3. Construct update payload
      const updatePayload = {
        ownerName: formData.ownerName.trim(),
        ownerEmail: formData.ownerEmail.trim(),
        ownerPhone: formData.ownerPhone.trim(),
        profileImage: profRes?.url || "",

        restaurantName: formData.restaurantName.trim(),
        foodType: formData.foodType,
        pureVegRestaurant: formData.foodType === "Veg",
        pureVeganRestaurant: false,
        primaryContactNumber: formData.primaryContactNumber.trim(),
        zoneId: formData.zoneId,
        location: buildRestaurantLocationUpdatePayload(formData.location),
        cuisines: formData.cuisines,
        openingTime: formData.openingTime,
        closingTime: formData.closingTime,
        openDays: formData.openDays,
        estimatedDeliveryTime: formData.estimatedDeliveryTime.trim(),

        panNumber: formData.panNumber.trim().toUpperCase(),
        nameOnPan: formData.nameOnPan.trim(),
        panImage: panRes?.url || "",
        accountNumber: formData.accountNumber.trim(),
        ifscCode: formData.ifscCode.trim().toUpperCase(),
        accountHolderName: formData.accountHolderName.trim(),
        accountType: formData.accountType,
        gstRegistered: formData.gstRegistered,
        gstNumber: formData.gstRegistered ? formData.gstNumber.trim().toUpperCase() : "",
        gstLegalName: formData.gstRegistered ? formData.gstLegalName.trim() : "",
        gstAddress: formData.gstRegistered ? formData.gstAddress.trim() : "",
        gstImage: formData.gstRegistered ? gstRes?.url || "" : "",

        fssaiNumber: formData.fssaiNumber.trim(),
        fssaiExpiry: formData.fssaiExpiry,
        fssaiImage: fssaiRes?.url || "",
        menuImages: menuImagesPayload.filter(Boolean),
      }

      const response = await restaurantAPI.updateProfile(updatePayload)

      if (response?.data?.success || response?.data?.data) {
        toast.success("Profile details updated and submitted for approval")
        try {
          sessionStorage.removeItem(EDIT_OWNER_DRAFT_KEY)
        } catch {
          // ignore storage errors
        }
        setInitialData(JSON.parse(JSON.stringify(formData)))
        navigate(backTarget, {
          state: {
            savedLocation: buildRestaurantLocationUpdatePayload(formData.location),
          },
        })
        window.setTimeout(() => {
          dispatchRestaurantLocationUpdated()
        }, 0)
      } else {
        throw new Error(response?.data?.message || "Failed to save profile changes")
      }
    } catch (error) {
      console.error("Error saving profile details:", error)
      toast.error(error.message || "Failed to update profile. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-t-[#2E7D52] border-gray-200 rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-gray-500">Loading profile details...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-gray-50 overflow-x-hidden pb-28">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3.5 sticky top-0 z-50 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6 text-gray-900" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-gray-900">Edit Profile & Contact Details</h1>
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
              Restaurant Control Panel
            </span>
          </div>
        </div>

        {/* Tab Switcher - Horizontal scroll on mobile */}
        <div className="bg-white border-b border-gray-100 sticky top-[53px] z-40">
          <div className="flex overflow-x-auto scrollbar-none px-4 gap-5">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 py-3 px-1 border-b-2 text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                    isActive
                      ? "border-[#2E7D52] text-[#2E7D52] scale-105"
                      : "border-transparent text-gray-500 hover:text-gray-900"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-[#2E7D52]" : "text-gray-400"}`} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content Container */}
        <div className="px-4 py-6 max-w-xl mx-auto space-y-6">
          {/* TAB 1: OWNER DETAILS */}
          {activeTab === "owner" && (
            <div className="space-y-6">
              {/* Profile Photo */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center gap-3">
                <Label className="text-xs font-bold text-gray-800 uppercase tracking-wide self-start">
                  Owner Profile Photo
                </Label>
                <div className="relative mt-2">
                  <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden border border-gray-200">
                    {formData.profileImage ? (
                      <OptimizedImage
                        src={getPreviewUrl(formData.profileImage)}
                        alt="Owner Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-10 h-10 text-gray-400" />
                    )}
                  </div>
                  {formData.profileImage && (
                    <button
                      onClick={() => handleRemoveImage("profileImage")}
                      className="absolute -top-1 -right-1 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePhotoClick("profileImage")}
                  className="mt-1 border-[#2E7D52] text-[#2E7D52] hover:bg-red-50 text-xs font-semibold px-4"
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Choose Photo
                </Button>
              </div>

              {/* Name & Email Fields */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Full Name
                  </label>
                  <div className="relative">
                    <Input
                      type="text"
                      value={formData.ownerName}
                      onChange={(e) =>
                        handleInputChange(
                          "ownerName",
                          formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, ""))
                        )
                      }
                      placeholder="Enter owner full name"
                      className="w-full text-sm h-11 focus-visible:border-black focus-visible:ring-0"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Owner Email Address
                  </label>
                  <div className="relative">
                    <Input
                      type="email"
                      value={formData.ownerEmail}
                      onChange={(e) => handleInputChange("ownerEmail", e.target.value)}
                      placeholder="Enter owner email"
                      className="w-full text-sm h-11 focus-visible:border-black focus-visible:ring-0"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Mobile Phone Number
                  </label>
                  <div className="relative">
                    <Input
                      type="tel"
                      value={formData.ownerPhone}
                      onChange={(e) =>
                        handleInputChange(
                          "ownerPhone",
                          e.target.value.replace(/\D/g, "").slice(0, 10)
                        )
                      }
                      placeholder="Enter 10-digit mobile number"
                      inputMode="numeric"
                      disabled={true}
                      className="w-full text-sm h-11 focus-visible:border-black focus-visible:ring-0 bg-gray-50 text-gray-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RESTAURANT INFO */}
          {activeTab === "restaurant" && (
            <div className="space-y-6">
              {/* General details */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b pb-2">General Details</h3>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Restaurant Name
                  </label>
                  <Input
                    type="text"
                    value={formData.restaurantName}
                    onChange={(e) => handleInputChange("restaurantName", e.target.value.replace(/[\/-]/g, ""))}
                    placeholder="Enter restaurant name"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Primary Contact Number
                  </label>
                  <Input
                    type="tel"
                    value={formData.primaryContactNumber}
                    onChange={(e) => handleInputChange("primaryContactNumber", e.target.value)}
                    placeholder="Enter primary contact number"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <label className="text-xs font-bold text-gray-700 block mb-2 uppercase tracking-wide">
                    Restaurant diet type?
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleInputChange("foodType", "Veg")
                        handleInputChange("pureVegRestaurant", true)
                        handleInputChange("pureVeganRestaurant", false)
                      }}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                        formData.foodType === "Veg"
                          ? "bg-[#16A34A] text-white border-[#16A34A] shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:border-green-400"
                      }`}
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500 border border-white" />
                      Veg
                    </button>
                    {/* DISABLED: "Pure Vegan" is not a selectable restaurant menu type —
                        only Veg, Non-Veg and Mixed are active. Kept, not deleted.
                    <button
                      type="button"
                      onClick={() => {
                        handleInputChange("pureVegRestaurant", true)
                        handleInputChange("pureVeganRestaurant", true)
                      }}
                      className={`flex-1 min-w-[120px] px-3 py-2.5 text-xs font-semibold rounded-full border transition-all ${
                        formData.pureVeganRestaurant === true
                          ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:border-emerald-400"
                      }`}
                    >
                      Yes, Pure Vegan
                    </button>
                    */}
                    <button
                      type="button"
                      onClick={() => {
                        handleInputChange("foodType", "Non-Veg")
                        handleInputChange("pureVegRestaurant", false)
                        handleInputChange("pureVeganRestaurant", false)
                      }}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                        formData.foodType === "Non-Veg"
                          ? "bg-red-600 text-white border-red-600 shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:border-red-400"
                      }`}
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 border border-white" />
                      Non-Veg
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleInputChange("foodType", "Mixed")
                        handleInputChange("pureVegRestaurant", false)
                        handleInputChange("pureVeganRestaurant", false)
                      }}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                        formData.foodType === "Mixed"
                          ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:border-amber-400"
                      }`}
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-white" />
                      Mixed (Both)
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    {formData.foodType === "Veg"
                      ? "Veg: Serves only vegetarian dishes."
                      : formData.foodType === "Non-Veg"
                        ? "Non-Veg: Serves only non-vegetarian dishes."
                        : "Mixed: Serves both vegetarian and non-vegetarian dishes."}
                  </p>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Service Zone
                  </label>
                  <Select
                    value={formData.zoneId}
                    onValueChange={(val) => handleInputChange("zoneId", val)}
                  >
                    <SelectTrigger className="w-full text-sm h-11 bg-white">
                      <SelectValue placeholder="Select service zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((z) => (
                        <SelectItem key={z._id || z.id} value={z._id || z.id}>
                          {z.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Address details */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Address & Location</h3>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        sessionStorage.setItem(EDIT_OWNER_DRAFT_KEY, JSON.stringify(formData))
                        sessionStorage.setItem(EDIT_OWNER_ACTIVE_TAB_KEY, activeTab)
                      } catch {
                        // ignore storage errors
                      }
                      navigate("/food/restaurant/edit-address", {
                        state: {
                          from: routerLocation.pathname,
                          outletFrom: backTarget,
                          currentLocation: formData.location,
                          returnTab: activeTab,
                        },
                      })
                    }}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#2E7D52] hover:bg-red-50 px-2 py-1 rounded-md transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Select from map
                  </button>
                </div>

                <LocationSearchInput
                  label="Search your outlet location"
                  placeholder="Search area, street, landmark..."
                  biasLocation={
                    Number.isFinite(Number(formData.location?.latitude)) &&
                    Number.isFinite(Number(formData.location?.longitude))
                      ? {
                          latitude: Number(formData.location.latitude),
                          longitude: Number(formData.location.longitude),
                        }
                      : null
                  }
                  onLocationSelect={handleLocationSearchSelect}
                  className="relative z-20"
                />

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Full Address (line 1)*
                  </label>
                  <Input
                    type="text"
                    value={formData.location?.addressLine1 || ""}
                    onChange={(e) => handleLocationChange("addressLine1", e.target.value)}
                    placeholder="Building / Shop / Street number"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Address Line 2 (optional)
                  </label>
                  <Input
                    type="text"
                    value={formData.location?.addressLine2 || ""}
                    onChange={(e) => handleLocationChange("addressLine2", e.target.value)}
                    placeholder="Floor, wing, suite info"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Area / Locality*
                  </label>
                  <Input
                    type="text"
                    value={formData.location?.area || ""}
                    onChange={(e) => handleLocationChange("area", e.target.value)}
                    placeholder="Area / Sector / Colony"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Landmark (optional)
                  </label>
                  <Input
                    type="text"
                    value={formData.location?.landmark || ""}
                    onChange={(e) => handleLocationChange("landmark", e.target.value)}
                    placeholder="Nearby landmark"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                      City
                    </label>
                    <Input
                      type="text"
                      value={formData.location?.city || "Indore"}
                      onChange={(e) => handleLocationChange("city", e.target.value)}
                      placeholder="City"
                      className="w-full text-sm h-11"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                      Pincode
                    </label>
                    <Input
                      type="text"
                      value={formData.location?.pincode || ""}
                      onChange={(e) =>
                        handleLocationChange("pincode", e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="6-digit PIN"
                      className="w-full text-sm h-11"
                    />
                  </div>
                </div>

              </div>

              {/* Operational details */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Operation & Timings</h3>
                <p className="text-xs text-gray-500 -mt-2">
                  Opening and closing time can be changed from Outlet timings.
                </p>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-2 uppercase tracking-wide flex items-center gap-1">
                    <CalendarIcon className="w-3.5 h-3.5 text-[#2E7D52]" />
                    Operational Days
                  </label>
                  <div className="grid grid-cols-7 gap-1.5">
                    {daysOfWeek.map((day) => {
                      const isActive = formData.openDays.includes(day)
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => handleDayToggle(day)}
                          className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center transition-all ${
                            isActive
                              ? "bg-[#2E7D52] text-white shadow-sm"
                              : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                          }`}
                        >
                          {day.slice(0, 1)}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Estimated Delivery Time
                  </label>
                  <Input
                    type="text"
                    value={formData.estimatedDeliveryTime}
                    onChange={(e) => handleInputChange("estimatedDeliveryTime", e.target.value)}
                    placeholder="e.g., 30-40 mins"
                    className="w-full text-sm h-11"
                  />
                </div>
              </div>

              {/* Cuisines Grid */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Cuisines Served</h3>
                  <span className="text-[10px] bg-[#2E7D52]/10 text-[#2E7D52] font-bold px-2 py-0.5 rounded">
                    MAX 8 SELECTED
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                  {ALL_CUISINES.map((cuisine) => {
                    const isSelected = formData.cuisines.includes(cuisine)
                    return (
                      <button
                        key={cuisine}
                        type="button"
                        onClick={() => handleCuisineToggle(cuisine)}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-between border text-left transition-all ${
                          isSelected
                            ? "border-[#2E7D52] bg-red-50/50 text-[#2E7D52]"
                            : "border-gray-200 hover:bg-gray-50 text-gray-700"
                        }`}
                      >
                        <span>{cuisine}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#2E7D52]" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: BANK & KYC */}
          {activeTab === "kyc" && (
            <div className="space-y-6">
              {/* PAN details */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b pb-2">PAN Card Information</h3>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    PAN Card Number
                  </label>
                  <Input
                    type="text"
                    value={formData.panNumber}
                    onChange={(e) => handleInputChange("panNumber", e.target.value.toUpperCase())}
                    placeholder="Enter 10-digit PAN (e.g. ABCDE1234F)"
                    maxLength={10}
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Name on PAN Card
                  </label>
                  <Input
                    type="text"
                    value={formData.nameOnPan}
                    onChange={(e) => handleInputChange("nameOnPan", e.target.value)}
                    placeholder="Enter exact name on PAN card"
                    className="w-full text-sm h-11"
                  />
                </div>

                {/* PAN Image */}
                <div className="border border-dashed border-gray-200 rounded-xl p-4 bg-gray-50/50 flex flex-col items-center gap-3">
                  <Label className="text-xs font-semibold text-gray-600 self-start">
                    PAN Card Upload
                  </Label>
                  {formData.panImage ? (
                    <div className="relative w-full max-w-[200px] aspect-[4/3] rounded-lg overflow-hidden border border-gray-200">
                      <OptimizedImage
                        src={getPreviewUrl(formData.panImage)}
                        alt="PAN Copy"
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => handleRemoveImage("panImage")}
                        className="absolute top-1.5 right-1.5 bg-[#2E7D52] text-white rounded-full p-1 shadow-md"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-4">
                      <ImageIcon className="w-10 h-10 text-gray-400 mb-1" />
                      <span className="text-[11px] text-gray-500">No document uploaded</span>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePhotoClick("panImage")}
                    className="w-full border-gray-300 text-gray-700 bg-white"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload PAN
                  </Button>
                </div>
              </div>

              {/* Bank Account */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Bank Account Info</h3>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Account Holder Name
                  </label>
                  <Input
                    type="text"
                    value={formData.accountHolderName}
                    onChange={(e) =>
                      handleInputChange(
                        "accountHolderName",
                        formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, ""))
                      )
                    }
                    placeholder="Name as in bank records"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Bank Account Number
                  </label>
                  <Input
                    type="password"
                    value={formData.accountNumber}
                    onChange={(e) =>
                      handleInputChange("accountNumber", e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="Enter account number"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    Confirm Account Number
                  </label>
                  <Input
                    type="text"
                    value={formData.confirmAccountNumber}
                    onChange={(e) =>
                      handleInputChange("confirmAccountNumber", e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="Re-enter account number"
                    className="w-full text-sm h-11"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                      IFSC Code
                    </label>
                    <Input
                      type="text"
                      value={formData.ifscCode}
                      onChange={(e) => handleInputChange("ifscCode", e.target.value.toUpperCase())}
                      placeholder="11-digit IFSC"
                      maxLength={11}
                      className="w-full text-sm h-11"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                      Account Type
                    </label>
                    <Select
                      value={formData.accountType}
                      onValueChange={(val) => handleInputChange("accountType", val)}
                    >
                      <SelectTrigger className="w-full text-sm h-11 bg-white">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Saving">Saving</SelectItem>
                        <SelectItem value="Current">Current</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* GST details */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">GST Registration</h3>
                  <button
                    type="button"
                    onClick={() => handleInputChange("gstRegistered", !formData.gstRegistered)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      formData.gstRegistered ? "bg-[#2E7D52]" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        formData.gstRegistered ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {formData.gstRegistered && (
                  <div className="space-y-4 pt-2">
                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                        GSTIN (GST Number)
                      </label>
                      <Input
                        type="text"
                        value={formData.gstNumber}
                        onChange={(e) =>
                          handleInputChange("gstNumber", e.target.value.toUpperCase())
                        }
                        placeholder="e.g. 22AAAAA1111A1Z1"
                        maxLength={15}
                        className="w-full text-sm h-11"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                        GST Legal Business Name
                      </label>
                      <Input
                        type="text"
                        value={formData.gstLegalName}
                        onChange={(e) => handleInputChange("gstLegalName", e.target.value)}
                        placeholder="Legal firm / business name"
                        className="w-full text-sm h-11"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                        GST Registered Address
                      </label>
                      <Input
                        type="text"
                        value={formData.gstAddress}
                        onChange={(e) => handleInputChange("gstAddress", e.target.value)}
                        placeholder="Registered business address"
                        className="w-full text-sm h-11"
                      />
                    </div>

                    {/* GST Image */}
                    <div className="border border-dashed border-gray-200 rounded-xl p-4 bg-gray-50/50 flex flex-col items-center gap-3">
                      <Label className="text-xs font-semibold text-gray-600 self-start">
                        GST Registration Copy
                      </Label>
                      {formData.gstImage ? (
                        <div className="relative w-full max-w-[200px] aspect-[4/3] rounded-lg overflow-hidden border border-gray-200">
                          <OptimizedImage
                            src={getPreviewUrl(formData.gstImage)}
                            alt="GST Copy"
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => handleRemoveImage("gstImage")}
                            className="absolute top-1.5 right-1.5 bg-[#2E7D52] text-white rounded-full p-1 shadow-md"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center py-4">
                          <ImageIcon className="w-10 h-10 text-gray-400 mb-1" />
                          <span className="text-[11px] text-gray-500">No document uploaded</span>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePhotoClick("gstImage")}
                        className="w-full border-gray-300 text-gray-700 bg-white"
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        Upload GST Certificate
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DOCUMENTS & FSSAI */}
          {activeTab === "docs" && (
            <div className="space-y-6">
              {/* FSSAI license details */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b pb-2">
                  FSSAI License details
                </h3>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    FSSAI License Number
                  </label>
                  <Input
                    type="text"
                    value={formData.fssaiNumber}
                    onChange={(e) =>
                      handleInputChange("fssaiNumber", e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="Enter 14-digit license number"
                    maxLength={14}
                    className="w-full text-sm h-11"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
                    License Expiry Date
                  </label>
                  <input
                    type="date"
                    value={formData.fssaiExpiry}
                    onChange={(e) => handleInputChange("fssaiExpiry", e.target.value)}
                    className="w-full text-sm h-11 bg-white border border-gray-200 rounded-lg px-3 focus-visible:outline-none focus-visible:border-black"
                  />
                </div>

                {/* FSSAI Image */}
                <div className="border border-dashed border-gray-200 rounded-xl p-4 bg-gray-50/50 flex flex-col items-center gap-3">
                  <Label className="text-xs font-semibold text-gray-600 self-start">
                    FSSAI Copy Upload
                  </Label>
                  {formData.fssaiImage ? (
                    <div className="relative w-full max-w-[200px] aspect-[4/3] rounded-lg overflow-hidden border border-gray-200">
                      <OptimizedImage
                        src={getPreviewUrl(formData.fssaiImage)}
                        alt="FSSAI Copy"
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => handleRemoveImage("fssaiImage")}
                        className="absolute top-1.5 right-1.5 bg-[#2E7D52] text-white rounded-full p-1 shadow-md"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-4">
                      <ImageIcon className="w-10 h-10 text-gray-400 mb-1" />
                      <span className="text-[11px] text-gray-500">No document uploaded</span>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePhotoClick("fssaiImage")}
                    className="w-full border-gray-300 text-gray-700 bg-white"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload FSSAI License
                  </Button>
                </div>
              </div>

              {/* Menu Images Grid */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Menu & Photos</h3>
                  <span className="text-[10px] bg-blue-50 text-[#2E7D52] font-bold px-2 py-0.5 rounded">
                    {formData.menuImages.length} / 10 PHOTOS
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {formData.menuImages.map((img, idx) => (
                    <div
                      key={idx}
                      className="relative aspect-[4/3] rounded-xl overflow-hidden border border-gray-200 shadow-sm"
                    >
                      <OptimizedImage
                        src={getPreviewUrl(img)}
                        alt={`Menu photo ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => handleRemoveImage("menuImages", idx)}
                        className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-md text-white rounded-full p-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {formData.menuImages.length < 10 && (
                    <button
                      type="button"
                      onClick={() => handlePhotoClick("menuImages")}
                      className="aspect-[4/3] rounded-xl border border-dashed border-gray-300 hover:border-[#2E7D52] bg-gray-50/70 hover:bg-red-50/10 flex flex-col items-center justify-center gap-1.5 transition-all"
                    >
                      <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center border border-gray-200">
                        <ImageIcon className="w-4.5 h-4.5 text-gray-600" />
                      </div>
                      <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">
                        Add Menu Photo
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Save/Update Button fixed bottom */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 z-40">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || loading || saving}
            className="w-full py-3 h-12 text-sm font-bold tracking-wide rounded-xl shadow-lg transition-all bg-gradient-to-r from-[#2E7D52] to-[#1B5E3F] text-white shadow-[0_8px_20px_rgba(184,11,61,0.3)] disabled:opacity-50 disabled:shadow-none hover:from-[#A10935] hover:to-[#4F0016] active:scale-[0.98]"
          >
            {saving ? "Uploading & Saving details..." : "Save Profile Details"}
          </Button>
        </div>
      </div>

      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handlePhotoSelect}
        title={`Upload ${
          activeImageField === "profileImage"
            ? "Owner photo"
            : activeImageField === "panImage"
            ? "PAN copy"
            : activeImageField === "gstImage"
            ? "GST copy"
            : activeImageField === "fssaiImage"
            ? "FSSAI copy"
            : "Menu photo"
        }`}
        description="Choose file from gallery or snap with camera"
        fileNamePrefix={`${activeImageField || "photo"}`}
        galleryInputRef={fileInputRef}
      />
    </>
  )
}

