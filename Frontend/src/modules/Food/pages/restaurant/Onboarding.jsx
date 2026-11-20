import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import TimeField from "@food/components/restaurant/TimeField"
import { validateOutletHours, formatOpenDuration } from "@food/utils/outletHours"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { Label } from "@food/components/ui/label"
import { Image as ImageIcon, Upload, Clock, Calendar as CalendarIcon, Sparkles, X, LogOut, FileText, ShoppingBag, ArrowLeft, Loader2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@food/components/ui/popover"
import { Calendar } from "@food/components/ui/calendar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { restaurantAPI, zoneAPI, uploadAPI, api } from "@food/api"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns"
import { determineStepToShow, clearOnboardingFromLocalStorage, clearAllFilesFromDB, hasRestaurantStep1Progress, isRestaurantOnboardingComplete } from "@food/utils/onboardingUtils"
import { toast } from "sonner"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { clearModuleAuth, clearAuthData, isModuleAuthenticated, getModuleToken, getRestaurantRegistrationToken, clearRestaurantRegistrationToken, getRestaurantPendingPhone } from "@food/utils/auth"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { prepareUploadFile, prepareUploadFiles } from "@/shared/utils/imageCompressor"
import { EMAIL_REGEX } from "@/shared/utils/emailValidation"
import { OnboardingSkeleton } from "@food/components/ui/loading-skeletons"
import OnboardingExitModal from "@/shared/components/OnboardingExitModal"
import OnboardingHeader from "@food/components/restaurant/OnboardingHeader"
import useOnboardingExitGuard from "@/shared/hooks/useOnboardingExitGuard"
import { collectFcmTokenForSignup, persistModuleFcmToken, syncPendingPartnerFcmQuick, clearOnboardingFcmLocal, prefetchModuleFcmToken } from "@food/utils/firebaseMessaging"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const normalizePhoneDigits = (value) => {
  const digits = String(value || "").replace(/\D/g, "")
  return digits.slice(-10)
}

async function finalizeRestaurantPendingSubmission(navigate, phone, fcmOptions = {}) {
  const { fcmToken, platform } = fcmOptions
  const normalizedPhone = normalizePhoneDigits(phone || "")

  try {
    const userStr = localStorage.getItem("restaurant_user")
    if (userStr) {
      const user = JSON.parse(userStr)
      user.status = "pending"
      localStorage.setItem("restaurant_user", JSON.stringify(user))
    }
  } catch {}

  if (normalizedPhone) {
    localStorage.setItem("restaurant_pendingPhone", normalizedPhone)
  }
  localStorage.setItem("restaurant_pendingStatus", "pending")
  localStorage.removeItem("restaurant_pendingMessage")

  try {
    syncPendingPartnerFcmQuick("restaurant", normalizedPhone, { fcmToken, platform })
  } catch {}

  if (localStorage.getItem("restaurant_accessToken")) {
    try {
      persistModuleFcmToken("restaurant", { fcmToken, platform }).catch(() => {})
    } catch {}
  }

  navigate("/food/restaurant/pending-verification", {
    replace: true,
    state: { phone: normalizedPhone },
  })
}


// Business categories that drive the one-time onboarding fee. Slugs must match
// RESTAURANT_TYPES in the backend; the payable amount is always resolved server-side.
const RESTAURANT_TYPE_OPTIONS = [
  { value: "family_restaurant", label: "Family Restaurant" },
  { value: "cafe", label: "Cafe" },
  { value: "cloud_kitchen", label: "Cloud Kitchen" },
  { value: "street_food", label: "Street Food" },
]

const ONBOARDING_TOKEN_KEY = "restaurant_onboardingToken"
const ONBOARDING_RESTAURANT_ID_KEY = "restaurant_onboardingRestaurantId"

const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const ONBOARDING_STORAGE_KEY = "restaurant_onboarding_data"
const PAN_NUMBER_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GST_NUMBER_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_NUMBER_REGEX = /^\d{14}$/
const BANK_ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/
const IFSC_CODE_REGEX = /^[A-Z0-9]{11}$/
const OWNER_NAME_REGEX = /^[A-Za-z ]+$/
// Full personal/legal names: letters plus the separators that legally appear on
// PAN cards and bank records — spaces between name parts, dots for initials,
// apostrophes and hyphens. Must mirror the backend rule in restaurant.validator.js.
const FULL_NAME_REGEX = /^[A-Za-z][A-Za-z.'\- ]*$/
const FULL_NAME_MAX_LENGTH = 100

const toFiniteCoordinate = (value) => {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""))
  return Number.isFinite(n) ? n : null
}

/** Ray-casting point-in-polygon over a zone's [{latitude, longitude}] ring. */
const isPointInZone = (lat, lng, zone) => {
  let polygon = []
  if (Array.isArray(zone?.coordinates)) {
    polygon = zone.coordinates
  } else if (Array.isArray(zone?.coordinates?.coordinates?.[0])) {
    polygon = zone.coordinates.coordinates[0].map((pt) => ({
      latitude: pt[1],
      longitude: pt[0],
    }))
  }
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const ptI = polygon[i]
    const ptJ = polygon[j]
    const xi = Number(ptI?.longitude ?? ptI?.lng ?? (Array.isArray(ptI) ? ptI[0] : NaN))
    const yi = Number(ptI?.latitude ?? ptI?.lat ?? (Array.isArray(ptI) ? ptI[1] : NaN))
    const xj = Number(ptJ?.longitude ?? ptJ?.lng ?? (Array.isArray(ptJ) ? ptJ[0] : NaN))
    const yj = Number(ptJ?.latitude ?? ptJ?.lat ?? (Array.isArray(ptJ) ? ptJ[1] : NaN))
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue
    if (yj === yi) continue
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const getZoneLabel = (zone) =>
  zone?.name || zone?.zoneName || zone?.serviceLocation || String(zone?._id || zone?.id || "")
const GST_LEGAL_NAME_REGEX = /^[A-Za-z ]+$/
const LOCAL_IMAGE_FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif"
const GALLERY_IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
let onboardingFileCache = {
  step2: {
    menuImages: [],
    profileImage: null,
  },
  step3: {
    panImage: null,
    gstImage: null,
    fssaiImage: null,
  },
}

// IndexedDB helpers for persistent file storage
const ONBOARDING_FILES_DB = "RestaurantOnboardingFiles"
const FILES_STORE = "files"

// One shared connection: the file-sync effect runs on every form change, and
// opening a fresh connection for each read/write leaked handles and could block
// clearAllFilesFromDB (deleteDatabase waits for open connections to close).
let onboardingFilesDBPromise = null

const openOnboardingFilesDB = () => {
  if (!onboardingFilesDBPromise) {
    onboardingFilesDBPromise = openOnboardingFilesDBConnection()
      .then((db) => {
        db.onversionchange = () => {
          db.close()
          onboardingFilesDBPromise = null
        }
        db.onclose = () => {
          onboardingFilesDBPromise = null
        }
        return db
      })
      .catch((err) => {
        onboardingFilesDBPromise = null
        throw err
      })
  }
  return onboardingFilesDBPromise
}

const openOnboardingFilesDBConnection = () => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("IndexedDB connection timeout"))
    }, 2000)

    try {
      if (typeof indexedDB === "undefined") {
        clearTimeout(timeout)
        return reject(new Error("IndexedDB not supported"))
      }
      const request = indexedDB.open(ONBOARDING_FILES_DB, 1)
      request.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          db.createObjectStore(FILES_STORE)
        }
      }
      request.onsuccess = (e) => {
        clearTimeout(timeout)
        resolve(e.target.result)
      }
      request.onerror = (e) => {
        clearTimeout(timeout)
        reject(e.target.error)
      }
      request.onblocked = () => {
        clearTimeout(timeout)
        reject(new Error("IndexedDB blocked"))
      }
    } catch (err) {
      clearTimeout(timeout)
      reject(err)
    }
  })
}

const saveFileToDB = async (key, file) => {
  if (!file || !isUploadableFile(file)) return
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).put(file, key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB save failed:", err)
  }
}

const getFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readonly")
    const request = tx.objectStore(FILES_STORE).get(key)
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  } catch (err) {
    debugError("IndexedDB load failed:", err)
    return null
  }
}

const deleteFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).delete(key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB delete transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB delete failed:", err)
  }
}

const getUploadableMenuFiles = (menuImages = []) =>
  (Array.isArray(menuImages) ? menuImages : [])
    .filter((img) => isUploadableFile(img))
    .slice(0, 10)

const persistMenuImagesToDB = async (menuImages = []) => {
  const uploadableMenuFiles = getUploadableMenuFiles(menuImages)
  for (let i = 0; i < 10; i++) {
    const file = uploadableMenuFiles[i]
    if (file) {
      await saveFileToDB(`menuImage_${i}`, file)
    } else {
      await deleteFileFromDB(`menuImage_${i}`)
    }
  }
}


const isUploadableFile = (value) => {
  if (!value || typeof value !== "object") return false

  if (typeof File !== "undefined" && value instanceof File) return true
  if (typeof Blob !== "undefined" && value instanceof Blob) return true

  return (
    typeof value.size === "number" &&
    (typeof value.slice === "function" || typeof value.arrayBuffer === "function")
  )
}

// Onboarding images that are uploaded to the server as soon as they are picked.
const MAX_MENU_IMAGES = 10
const DOCUMENT_IMAGE_FIELDS = ["panImage", "gstImage", "fssaiImage"]
const IMAGE_FIELD_FOLDERS = {
  menuImages: "food/restaurants/menu",
  profileImage: "food/restaurants/profile",
  panImage: "food/restaurants/pan",
  gstImage: "food/restaurants/gst",
  fssaiImage: "food/restaurants/fssai",
}

const getStoredImageUrl = (value) => {
  if (!value || isUploadableFile(value)) return ""
  if (typeof value === "string") return value.trim()
  return typeof value?.url === "string" ? value.url.trim() : ""
}

const toStoredImageValue = (url) => (url ? { url, publicId: null } : null)

const getUploadErrorText = (err) =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || "Upload failed"

const normalizePincode = (value) => String(value || "").replace(/\D/g, "").slice(0, 6)


const getVerifiedPhoneFromStoredRestaurant = () => {
  try {
    const pending = localStorage.getItem("restaurant_pendingPhone")
    if (pending && pending.trim()) {
      return pending.trim()
    }

    const storedUser = localStorage.getItem("restaurant_user")
    if (!storedUser) return ""
    const user = JSON.parse(storedUser)
    const candidates = [
      user?.ownerPhone,
      user?.primaryContactNumber,
      user?.phone,
      user?.phoneNumber,
      user?.mobile,
      user?.contactNumber,
      user?.contact?.phone,
      user?.owner?.phone,
      user?.restaurant?.phone,
    ]
    const phone = candidates.find((value) => typeof value === "string" && value.trim())
    return phone ? phone.trim() : ""
  } catch {
    return ""
  }
}

const normalizeEmail = (val) => {
  let email = String(val || "").toLowerCase().trim()
  // Auto-correct common Gmail typos
  email = email.replace(/@(gnail|gamil|gimail|gnil)\.com$/i, "@gmail.com")
  return email
}

const normalizeAccountTypeValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "saving" || normalized === "savings") return "Saving"
  if (normalized === "current") return "Current"
  return ""
}

/**
 * Keeps full names typeable: first name, last name and any middle parts stay
 * intact, along with the dots/apostrophes/hyphens that appear on PAN and bank
 * records. Only genuinely invalid characters are stripped, and inner spacing is
 * preserved while typing (runs of spaces are collapsed on validation instead).
 */
const sanitizeFullName = (value) =>
  String(value ?? "")
    .replace(/[^A-Za-z.'\- ]/g, "")
    .replace(/^[.'\- ]+/, "")
    .slice(0, FULL_NAME_MAX_LENGTH)

const normalizeFullName = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

const formatNameToCapital = (str) => {
  if (!str) return ""
  return str.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
}

const normalizeIFSC = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11)
const normalizePAN = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
const normalizeGST = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)
const normalizeBankAcc = (val) => String(val || "").replace(/\D/g, "").slice(0, 18)

const getTodayLocalYMD = () => formatDateToLocalYMD(new Date())

// Helper functions for localStorage
const saveOnboardingToLocalStorage = (step1, step2, step3, currentStep) => {
  try {
    // Persist only stable URL-based values. File/Blob objects are not serializable and
    // restoring metadata-only placeholders breaks preview/upload flows.
    const serializableStep2 = {
      ...step2,
      menuImages: (step2.menuImages || []).filter(
        (img) => !isUploadableFile(img) && (img?.url || (typeof img === "string" && img.trim()))
      ),
      profileImage:
        !isUploadableFile(step2.profileImage) &&
        (step2.profileImage?.url || (typeof step2.profileImage === "string" && step2.profileImage.trim()))
          ? step2.profileImage
          : null,
    }

    const serializableStep3 = {
      ...step3,
      panImage:
        !isUploadableFile(step3.panImage) &&
        (step3.panImage?.url || (typeof step3.panImage === "string" && step3.panImage.trim()))
          ? step3.panImage
          : null,
      gstImage:
        !isUploadableFile(step3.gstImage) &&
        (step3.gstImage?.url || (typeof step3.gstImage === "string" && step3.gstImage.trim()))
          ? step3.gstImage
          : null,
      fssaiImage:
        !isUploadableFile(step3.fssaiImage) &&
        (step3.fssaiImage?.url || (typeof step3.fssaiImage === "string" && step3.fssaiImage.trim()))
          ? step3.fssaiImage
          : null,
    }

    const dataToSave = {
      step1,
      step2: serializableStep2,
      step3: serializableStep3,
      currentStep,
      timestamp: Date.now(),
    }

    const userStr = localStorage.getItem("restaurant_user")
    let key = ONBOARDING_STORAGE_KEY
    if (userStr) {
      const user = JSON.parse(userStr)
      const userId = user._id || user.id
      if (userId) key = `restaurant_onboarding_data_${userId}`
    }
    localStorage.setItem(key, JSON.stringify(dataToSave))
  } catch (error) {
    debugError("Failed to save onboarding data to localStorage:", error)
  }
}

const loadOnboardingFromLocalStorage = () => {
  try {
    const userStr = localStorage.getItem("restaurant_user")
    let key = ONBOARDING_STORAGE_KEY
    if (userStr) {
      const user = JSON.parse(userStr)
      const userId = user._id || user.id
      if (userId) key = `restaurant_onboarding_data_${userId}`
    }
    const stored = localStorage.getItem(key)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    debugError("Failed to load onboarding data from localStorage:", error)
  }
  return null
}


const syncOnboardingFileCache = (step2, step3) => {
  onboardingFileCache = {
    step2: {
      menuImages: (step2?.menuImages || []).filter((img) => isUploadableFile(img)),
      profileImage: isUploadableFile(step2?.profileImage) ? step2.profileImage : null,
    },
    step3: {
      panImage: isUploadableFile(step3?.panImage) ? step3.panImage : null,
      gstImage: isUploadableFile(step3?.gstImage) ? step3.gstImage : null,
      fssaiImage: isUploadableFile(step3?.fssaiImage) ? step3.fssaiImage : null,
    },
  }
}

const clearOnboardingFileCache = () => {
  onboardingFileCache = {
    step2: {
      menuImages: [],
      profileImage: null,
    },
    step3: {
      panImage: null,
      gstImage: null,
      fssaiImage: null,
    },
  }
}

// Helper function to convert Date object to "HH:mm" string
const timeToString = (date) => {
  if (!date) return ""
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

const normalizeTimeValue = (value) => {
  if (!value) return ""

  const raw = String(value).trim()
  if (!raw) return ""

  const to24Hour = (h, m, period) => {
    let hours = Number(h)
    const minutes = Number(m)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ""
    if (minutes < 0 || minutes > 59) return ""
    const p = String(period || "").toUpperCase()
    if (p === "AM") {
      if (hours === 12) hours = 0
    } else if (p === "PM") {
      if (hours !== 12) hours += 12
    }
    if (hours < 0 || hours > 23) return ""
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  }

  // Already in HH:mm format
  if (/^\d{2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":").map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      return ""
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  // Handle H:mm by zero-padding hour
  if (/^\d{1}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":")
    return to24Hour(h, m, "")
  }

  // Handle 12-hour format (e.g. "10:00 AM", "9:30pm")
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (ampm) {
    return to24Hour(ampm[1], ampm[2], ampm[3])
  }

  // Fallback for ISO / Date-like strings
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return timeToString(parsed)
  }

  return ""
}

const timeStringToMinutes = (value) => {
  const normalized = normalizeTimeValue(value)
  if (!normalized || !/^\d{2}:\d{2}$/.test(normalized)) return null
  const [hours, minutes] = normalized.split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

const formatTime12Hour = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string" || !timeStr.includes(":")) return "--:-- --"
  const [h, m] = timeStr.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, "0")} ${period}`
}

const formatDateToLocalYMD = (date) => {
  if (!date || Number.isNaN(date.getTime?.())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const parseLocalYMDDate = (value) => {
  if (!value || typeof value !== "string") return undefined
  const parts = value.split("-").map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined
  const [year, month, day] = parts
  return new Date(year, month - 1, day)
}

export default function RestaurantOnboarding() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    prefetchModuleFcmToken("restaurant")
  }, [])

  const handleExitAnyway = useCallback(() => {
    navigate("/food/restaurant/login", { replace: true })

    void (async () => {
      try {
        clearOnboardingFcmLocal("restaurant")
        const regToken = getRestaurantRegistrationToken()
        if (regToken) {
          await restaurantAPI.clearAllOnboardingUploads?.(regToken).catch(() => {})
        }
        clearRestaurantRegistrationToken()
        clearOnboardingFromLocalStorage()
        clearOnboardingFileCache()
        if (onboardingFilesDBPromise) {
          try {
            const db = await onboardingFilesDBPromise
            db.close()
          } catch {}
          onboardingFilesDBPromise = null
        }
        await clearAllFilesFromDB()

        const hasSession = Boolean(localStorage.getItem("restaurant_refreshToken"))
        if (hasSession) {
          await restaurantAPI.logout().catch(() => {})
        }
        clearModuleAuth("restaurant")
        clearAuthData()
        window.dispatchEvent(new Event("restaurantAuthChanged"))
      } catch (e) {
        debugError("Error clearing onboarding data on exit:", e)
      }
    })()
  }, [navigate])

  const goToPreviousOnboardingStep = useCallback(() => {
    setStep((currentStep) => Math.max(1, currentStep - 1))
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [])

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      const regToken = getRestaurantRegistrationToken()
      if (regToken) {
        await restaurantAPI.clearAllOnboardingUploads?.(regToken).catch(() => {})
      }
      clearRestaurantRegistrationToken()
      clearOnboardingFromLocalStorage()
      clearOnboardingFileCache()
      if (onboardingFilesDBPromise) {
        try {
          const db = await onboardingFilesDBPromise
          db.close()
        } catch {}
        onboardingFilesDBPromise = null
      }
      await clearAllFilesFromDB()

      await restaurantAPI.logout().catch(() => {})
      clearModuleAuth("restaurant")
      clearAuthData()
      
      window.dispatchEvent(new Event("restaurantAuthChanged"))
      navigate("/food/restaurant/login", { replace: true })
    } catch (error) {
      debugError("Logout failed:", error)
      clearModuleAuth("restaurant")
      navigate("/food/restaurant/login", { replace: true })
    } finally {
      setIsLoggingOut(false)
    }
  }

  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState(() => getVerifiedPhoneFromStoredRestaurant())
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [isEditing, setIsEditing] = useState(true)
  const [hasExistingRestaurantProfile, setHasExistingRestaurantProfile] = useState(false)
  const [isFssaiCalendarOpen, setIsFssaiCalendarOpen] = useState(false)
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [isOnboardingHydrated, setIsOnboardingHydrated] = useState(false)
  // Set once the IndexedDB image restore has actually run. Guards the delete
  // branch in the save effect below.
  const imagesRestoredRef = useRef(false)
  const isHydratingRef = useRef(false)

  const [step1, setStep1] = useState({
    restaurantName: "",
    foodType: null,
    pureVegRestaurant: null,
    pureVeganRestaurant: false,
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    primaryContactNumber: "",
    restaurantType: "",
    zoneId: "",
    location: {
      formattedAddress: "",
      addressLine1: "",
      addressLine2: "",
      area: "",
      city: "",
      state: "",
      pincode: "",
      landmark: "",
      latitude: "",
      longitude: "",
    },
  })

  // Coordinates of the location the owner picked (empty until a suggestion is chosen).
  const selectedLat = toFiniteCoordinate(step1.location?.latitude)
  const selectedLng = toFiniteCoordinate(step1.location?.longitude)
  const hasSelectedLocation = selectedLat !== null && selectedLng !== null

  /**
   * Once a location is picked, only zones whose polygon actually covers it may be
   * chosen. Before that, every active zone stays selectable so the owner can pick
   * a zone first and have the address search biased to it.
   */
  const selectableZones = useMemo(() => {
    if (!hasSelectedLocation) return zones
    return zones.filter((zone) => isPointInZone(selectedLat, selectedLng, zone))
  }, [zones, hasSelectedLocation, selectedLat, selectedLng])

  const displayZones = useMemo(() => {
    if (selectableZones.length > 0) return selectableZones
    return zones
  }, [selectableZones, zones])

  const isSelectedZoneValid = useMemo(() => {
    const zoneId = String(step1.zoneId || "").trim()
    if (!zoneId) return true
    if (selectableZones.length === 0) {
      const z = zones.find((item) => String(item?._id || item?.id) === zoneId)
      if (z) {
        const zoneName = String(z.name || z.zoneName || z.serviceLocation || "").trim().toLowerCase()
        const locCity = String(step1.location?.city || "").trim().toLowerCase()
        if (!locCity || zoneName.includes(locCity) || locCity.includes(zoneName)) return true
      }
    }
    return selectableZones.some((zone) => String(zone?._id || zone?.id) === zoneId)
  }, [selectableZones, step1.zoneId, zones, step1.location?.city])

  // When location matches a single zone and no zone selected yet, auto-select it!
  useEffect(() => {
    if (hasSelectedLocation && selectableZones.length === 1 && !step1.zoneId) {
      const autoZone = selectableZones[0]
      const autoZoneId = String(autoZone?._id || autoZone?.id || "")
      const autoCity = String(autoZone?.name || autoZone?.zoneName || autoZone?.serviceLocation || "").trim()
      setStep1((prev) => ({
        ...prev,
        zoneId: autoZoneId,
        location: {
          ...prev.location,
          city: autoCity || prev.location?.city || "",
        },
      }))
    }
  }, [hasSelectedLocation, selectableZones, step1.zoneId])

  // Dynamic city list derived from active service zones and live database
  const availableCities = useMemo(() => {
    const citySet = new Set()

    // 1. Live zones created in admin (e.g. Ratlam, Indore, Ujjain)
    ;(zones || []).forEach((z) => {
      const zName = String(z?.name || z?.zoneName || "").trim()
      if (zName) citySet.add(zName)
      const sLoc = String(z?.serviceLocation || "").trim()
      if (sLoc && !["main point", "point", "default"].includes(sLoc.toLowerCase())) {
        citySet.add(sLoc)
      }
    })

    // 2. Currently selected zone's city
    if (step1.zoneId) {
      const currentZone = (zones || []).find((z) => String(z?._id || z?.id) === String(step1.zoneId))
      if (currentZone) {
        const name = String(currentZone.name || currentZone.zoneName || currentZone.serviceLocation || "").trim()
        if (name) citySet.add(name)
      }
    }

    // 3. User's currently set location city (from geocode or previous edit)
    if (step1.location?.city && step1.location.city.trim()) {
      citySet.add(step1.location.city.trim())
    }

    // 4. Fallback major cities
    const fallbackCities = [
      "Indore",
      "Ratlam",
      "Ujjain",
      "Bhopal",
      "Gwalior",
      "Jabalpur",
      "Mumbai",
      "Pune",
      "Delhi",
      "Bangalore",
      "Ahmedabad",
      "Hyderabad",
      "Chennai",
      "Kolkata",
    ]
    fallbackCities.forEach((c) => citySet.add(c))

    return Array.from(citySet).filter(Boolean)
  }, [zones, step1.zoneId, step1.location?.city])

  // Picking a location outside the chosen zone clears the now-invalid location so
  // an out-of-zone pairing can never reach the submit payload.
  useEffect(() => {
    if (step !== 1) return
    if (!step1.zoneId || zonesLoading || zones.length === 0) return
    if (isSelectedZoneValid) return
    setStep1((prev) => ({
      ...prev,
      location: {
        ...prev.location,
        formattedAddress: "",
        addressLine1: "",
        latitude: "",
        longitude: "",
      },
    }))
    setLocationSearchValue("")
    toast.error("The selected location is outside your chosen service zone. Please search for a location within your zone.")
  }, [step, step1.zoneId, zones.length, zonesLoading, isSelectedZoneValid])

  const [step2, setStep2] = useState({
    menuImages: [],
    profileImage: null,
    cuisines: [],
    estimatedDeliveryTime: "",
    openingTime: "",
    closingTime: "",
    openDays: [],
    isTakeawayEnabled: false,
    isTakeawayCodEnabled: false,
  })

  /** Derived from the two times — never blocks entry, only reports the result. */
  const outletHours = useMemo(
    () => validateOutletHours(step2.openingTime, step2.closingTime),
    [step2.openingTime, step2.closingTime],
  )

  const [step3, setStep3] = useState({
    panNumber: "",
    nameOnPan: "",
    panImage: null,
    gstRegistered: false,
    gstNumber: "",
    gstLegalName: "",
    gstAddress: "",
    gstImage: null,
    fssaiNumber: "",
    fssaiExpiry: "",
    fssaiImage: null,
    accountNumber: "",
    confirmAccountNumber: "",
    ifscCode: "",
    accountHolderName: "",
    accountType: "",
  })

  const hasStep1UnsavedProgress = useCallback(
    () => hasRestaurantStep1Progress(step1),
    [step1],
  )

  const {
    showExitModal,
    handleBack,
    handleStay,
    handleExit,
    requestExit,
  } = useOnboardingExitGuard({
    isFirstStep: step === 1,
    onPreviousStep: goToPreviousOnboardingStep,
    onExit: handleExitAnyway,
    hasUnsavedProgress: hasStep1UnsavedProgress,
  })

  const previewUrlCacheRef = useRef(new Map())
  const locationSearchInputRef = useRef(null)
  const locationSearchContainerRef = useRef(null)
  const placesAutocompleteRef = useRef(null)
  const mapsScriptLoadedRef = useRef(false)
  const menuImagesInputRef = useRef(null)
  const profileImageInputRef = useRef(null)
  const panImageInputRef = useRef(null)
  const gstImageInputRef = useRef(null)
  const fssaiImageInputRef = useRef(null)
  const [sourcePicker, setSourcePicker] = useState({
    isOpen: false,
    title: "",
    onSelectFile: null,
    fileNamePrefix: "camera-image",
    fallbackInputRef: null,
  })

  // Manual search states for fallback
  const [locationSearchValue, setLocationSearchValue] = useState("")
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const [isLocationSearchFocused, setIsLocationSearchFocused] = useState(false)

  const getPreviewImageUrl = (value) => {
    if (!value) return null
    if (typeof value === "string") return value
    if (value?.url && typeof value.url === "string") return value.url

    if (isUploadableFile(value)) {
      const cache = previewUrlCacheRef.current
      const cached = cache.get(value)
      if (cached) return cached
      try {
        const objectUrl = URL.createObjectURL(value)
        cache.set(value, objectUrl)
        return objectUrl
      } catch {
        return null
      }
    }

    return null
  }

  const openImageSourcePicker = ({ title, onSelectFile, fileNamePrefix, fallbackInputRef }) => {
    setSourcePicker({
      isOpen: true,
      title: title || "Select image source",
      onSelectFile,
      fileNamePrefix: fileNamePrefix || "camera-image",
      fallbackInputRef: fallbackInputRef || null,
    })
  }

  const closeImageSourcePicker = () => {
    setSourcePicker((prev) => ({ ...prev, isOpen: false }))
  }

  /*
   * Images are uploaded the moment they are picked, so they survive a refresh.
   * New registrants (no restaurant yet) upload into a server-side draft using the
   * registration token from OTP verification; an existing restaurant session
   * uploads through the normal media endpoint. The picked File stays in state
   * (and IndexedDB) only until the upload succeeds, and is still submitted as a
   * multipart file if uploading is not possible.
   */
  // File -> field for every upload in flight.
  const [pendingUploads, setPendingUploads] = useState(() => new Map())
  const step2Ref = useRef(null)
  const step3Ref = useRef(null)
  step2Ref.current = step2
  step3Ref.current = step3

  const isUploadPending = (value) => Boolean(value) && pendingUploads.has(value)
  const isFieldUploading = (field) => [...pendingUploads.values()].includes(field)

  const getDraftUploadToken = () =>
    hasExistingRestaurantProfile ? null : getRestaurantRegistrationToken()

  const uploadImageForField = async (field, file) => {
    const draftToken = getDraftUploadToken()
    if (draftToken) {
      try {
        const response = await restaurantAPI.uploadOnboardingFile(draftToken, field, file)
        const uploaded = response?.data?.data
        if (!uploaded?.url) throw new Error("Uploaded image URL was not returned")
        return { url: uploaded.url, publicId: uploaded.publicId || null }
      } catch (err) {
        // An expired registration session cannot be refreshed here; fall back to
        // submitting the file with the form instead of retrying forever.
        if (err?.response?.status === 401) clearRestaurantRegistrationToken()
        throw err
      }
    }
    if (hasExistingRestaurantProfile && getModuleToken("restaurant")) {
      const uploaded = await handleUpload(file, IMAGE_FIELD_FOLDERS[field])
      return { url: uploaded.url, publicId: uploaded.publicId || uploaded.public_id || null }
    }
    return null
  }

  const isFileStillSelected = (field, file) => {
    if (field === "menuImages") return (step2Ref.current?.menuImages || []).includes(file)
    if (field === "profileImage") return step2Ref.current?.profileImage === file
    return step3Ref.current?.[field] === file
  }

  const startImageUpload = async (field, file, { silent = false } = {}) => {
    if (!isUploadableFile(file)) return
    setPendingUploads((prev) => new Map(prev).set(file, field))
    try {
      const uploaded = await uploadImageForField(field, file)
      if (!uploaded) return

      if (!isFileStillSelected(field, file)) {
        // Removed while uploading: do not leave an orphan in the draft. The server
        // only removes it if it is still the recorded value for this field.
        const draftToken = getDraftUploadToken()
        if (draftToken) {
          restaurantAPI.removeOnboardingUpload(draftToken, field, uploaded.url).catch(() => {})
        }
        return
      }

      if (field === "menuImages") {
        setStep2((prev) => ({
          ...prev,
          menuImages: (prev.menuImages || []).map((img) => (img === file ? uploaded : img)),
        }))
      } else if (field === "profileImage") {
        setStep2((prev) => (prev.profileImage === file ? { ...prev, profileImage: uploaded } : prev))
        void deleteFileFromDB("profileImage")
      } else {
        setStep3((prev) => (prev[field] === file ? { ...prev, [field]: uploaded } : prev))
        void deleteFileFromDB(field)
      }
    } catch (err) {
      debugError(`Onboarding ${field} upload failed:`, err)
      if (!silent) {
        toast.error(`Image upload failed: ${getUploadErrorText(err)}. It will be sent when you submit.`)
      }
    } finally {
      setPendingUploads((prev) => {
        const next = new Map(prev)
        next.delete(file)
        return next
      })
    }
  }

  const handleMenuImagesSelected = (files = []) => {
    if (!files.length) return
    const current = step2Ref.current?.menuImages || []
    const room = Math.max(0, MAX_MENU_IMAGES - current.length)
    if (room === 0) {
      toast.error(`You can upload up to ${MAX_MENU_IMAGES} menu images`)
      return
    }
    const accepted = files.slice(0, room)
    if (accepted.length < files.length) {
      toast.error(`Only ${MAX_MENU_IMAGES} menu images are allowed; extra images were skipped`)
    }
    const nextMenuImages = [...current, ...accepted]
    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    void persistMenuImagesToDB(nextMenuImages)
    accepted.forEach((file) => void startImageUpload("menuImages", file))
  }

  const handleProfileImageSelected = (file) => {
    if (!file) return
    if (isFieldUploading("profileImage")) {
      toast.info("Please wait for the current image to finish uploading")
      return
    }
    setStep2((prev) => ({
      ...prev,
      profileImage: file,
    }))
    void saveFileToDB("profileImage", file)
    void startImageUpload("profileImage", file)
  }

  const handleDocumentImageSelected = (field, file) => {
    if (!file) return
    if (isFieldUploading(field)) {
      toast.info("Please wait for the current image to finish uploading")
      return
    }
    setStep3((prev) => ({ ...prev, [field]: file }))
    void saveFileToDB(field, file)
    void startImageUpload(field, file)
  }

  const handlePanImageSelected = (file) => handleDocumentImageSelected("panImage", file)

  const handleGstImageSelected = (file) => handleDocumentImageSelected("gstImage", file)

  const handleFssaiImageSelected = (file) => handleDocumentImageSelected("fssaiImage", file)

  const handleRemoveDocumentImage = async (field) => {
    const currentImage = step3Ref.current?.[field]
    setStep3((prev) => ({ ...prev, [field]: null }))
    void deleteFileFromDB(field)

    const url = getStoredImageUrl(currentImage)
    const draftToken = getDraftUploadToken()
    if (!url || !draftToken) return

    try {
      await restaurantAPI.removeOnboardingUpload(draftToken, field, url)
    } catch (error) {
      setStep3((prev) => (prev[field] ? prev : { ...prev, [field]: currentImage }))
      toast.error(getUploadErrorText(error) || "Failed to remove image")
    }
  }

  const isPersistedImageValue = (value) =>
    !isUploadableFile(value) &&
    ((typeof value === "string" && value.trim()) ||
      (value?.url && typeof value.url === "string"))

  const getPersistedImagePayload = (value) => {
    if (typeof value === "string" && value.trim()) {
      return { url: value.trim(), publicId: null }
    }

    if (value?.url && typeof value.url === "string" && value.url.trim()) {
      return {
        url: value.url.trim(),
        publicId: value.publicId || null,
      }
    }

    return null
  }

  const toPersistedMenuImagesPayload = (menuImages = []) =>
    (Array.isArray(menuImages) ? menuImages : [])
      .filter((img) => isPersistedImageValue(img))
      .map((img) =>
        typeof img === "string"
          ? img
          : {
              url: img.url,
              publicId: img.publicId || null,
            },
      )

  const handleRemoveMenuImage = async (indexToRemove) => {
    const currentMenuImages = step2.menuImages || []
    const imageToRemove = currentMenuImages[indexToRemove]
    const nextMenuImages = currentMenuImages.filter((_, i) => i !== indexToRemove)

    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    await persistMenuImagesToDB(nextMenuImages)

    if (!isPersistedImageValue(imageToRemove)) {
      return
    }

    try {
      if (hasExistingRestaurantProfile) {
        await restaurantAPI.updateProfile({
          menuImages: toPersistedMenuImagesPayload(nextMenuImages),
        })
      } else {
        // A new registrant has no profile to update; the image lives in the draft.
        const draftToken = getDraftUploadToken()
        if (draftToken) {
          await restaurantAPI.removeOnboardingUpload(
            draftToken,
            "menuImages",
            getStoredImageUrl(imageToRemove),
          )
        }
      }
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        menuImages: currentMenuImages,
      }))
      await persistMenuImagesToDB(currentMenuImages)
      setError(error?.response?.data?.message || "Failed to remove menu image")
    }
  }

  const handleRemoveProfileImage = async () => {
    const currentProfileImage = step2.profileImage
    setStep2((prev) => ({
      ...prev,
      profileImage: null,
    }))

    if (!isPersistedImageValue(currentProfileImage)) {
      return
    }

    try {
      if (hasExistingRestaurantProfile) {
        await restaurantAPI.updateProfile({ profileImage: "" })
      } else {
        const draftToken = getDraftUploadToken()
        if (draftToken) {
          await restaurantAPI.removeOnboardingUpload(
            draftToken,
            "profileImage",
            getStoredImageUrl(currentProfileImage),
          )
        }
      }
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        profileImage: currentProfileImage,
      }))
      setError(error?.response?.data?.message || "Failed to remove profile image")
    }
  }

  const resolveImageForProfileUpdate = async (value, folder) => {
    if (!value) return null

    if (isUploadableFile(value)) {
      const uploaded = await handleUpload(value, folder)
      return uploaded || null
    }

    return getPersistedImagePayload(value)
  }


  const resolveMenuImagesForProfileUpdate = async (menuImages = []) => {
    const items = Array.isArray(menuImages) ? menuImages : []
    const resolved = await Promise.all(
      items.map(async (image) => {
        if (isUploadableFile(image)) {
          return handleUpload(image, "food/restaurants/menu")
        }

        return getPersistedImagePayload(image)
      }),
    )

    return resolved.filter((image) => image?.url)
  }


  // Load from localStorage on mount and check URL parameter
  useEffect(() => {
    if (isOnboardingHydrated || isHydratingRef.current) return;
    isHydratingRef.current = true;
    
    // Check if step is specified in URL (from OTP login redirect)
    const stepParam = new URLSearchParams(window.location.search).get("step")

    const loadData = async () => {
      try {
        setLoading(true);
        // Fail-safe: Force loading off after 7 seconds if something hangs on mobile
        const failSafeTimer = setTimeout(() => {
          if (!isOnboardingHydrated) {
            debugWarn("Hydration fail-safe triggered")
            setIsOnboardingHydrated(true)
            setLoading(false)
          }
        }, 7000)

        const currentPhone = getVerifiedPhoneFromStoredRestaurant()
        const photosWereCleared = localStorage.getItem("restaurant_onboarding_photos_cleared") === "true"
        if (photosWereCleared) {
          localStorage.removeItem("restaurant_onboarding_photos_cleared")
        }
        let localData = loadOnboardingFromLocalStorage()
        const pendingStatus = localStorage.getItem("restaurant_pendingStatus")

        // If registration was already submitted and in pending state, do not allow re-entering Step 1
        if (pendingStatus === "pending" && !localData) {
          clearTimeout(failSafeTimer)
          navigate("/food/restaurant/pending-verification", {
            replace: true,
            state: { phone: currentPhone || getRestaurantPendingPhone() || "" },
          })
          return
        }

        // Kick the stored-file reads off now; they are local and do not need to
        // queue behind the network request below.
        const storedFilesPromise = Promise.all([
          getFileFromDB("profileImage"),
          getFileFromDB("panImage"),
          getFileFromDB("gstImage"),
          getFileFromDB("fssaiImage"),
          Promise.all(Array.from({ length: 10 }, (_, i) => getFileFromDB(`menuImage_${i}`))),
        ]).catch(() => [null, null, null, null, []])

        // Images a new registrant already uploaded are stored server-side; fetch
        // them in parallel so a refresh restores them from the backend.
        const registrationToken = getRestaurantRegistrationToken()
        const draftUploadsPromise = registrationToken
          ? restaurantAPI
              .getOnboardingUploads(registrationToken)
              .then((res) => res?.data?.data?.uploads || null)
              .catch((err) => {
                if (err?.response?.status === 401) clearRestaurantRegistrationToken()
                debugError("Onboarding draft fetch failed:", err)
                return null
              })
          : Promise.resolve(null)

        // 1. First fetch API data to have the latest backend state
        let apiData = null;
        try {
          // Only fetch if we have a token (existing user session)
          if (getModuleToken("restaurant")) {
            const res = await restaurantAPI.getCurrentRestaurant()
            apiData = res?.data?.data?.restaurant || res?.data?.restaurant
          }
        } catch (err) {
          debugError("API fetch skipped/failed:", err)
        }

        // 2. Hydrate from API if exists
        if (apiData) {
          const status = String(apiData.status || "").toLowerCase()
          if (status === "approved") {
            clearTimeout(failSafeTimer)
            navigate("/food/restaurant", { replace: true })
            return
          }
          if (status === "pending" || status === "banned") {
            clearTimeout(failSafeTimer)
            navigate("/food/restaurant/pending-verification", {
              replace: true,
              state: {
                phone: apiData.ownerPhone || apiData.phone || getRestaurantPendingPhone() || "",
                isRejected: false,
                isDisabled: status === "banned",
              },
            })
            return
          }
          if (status === "payment_pending" || apiData.onboarding?.paymentRequired) {
            clearTimeout(failSafeTimer)
            if (apiData.onboarding?.onboardingToken) {
              try {
                localStorage.setItem(ONBOARDING_TOKEN_KEY, apiData.onboarding.onboardingToken)
              } catch {}
            }
            navigate("/food/restaurant/onboarding/payment", { replace: true })
            return
          }
          if (isRestaurantOnboardingComplete(apiData)) {
            clearTimeout(failSafeTimer)
            navigate("/food/restaurant", { replace: true })
            return
          }

          setHasExistingRestaurantProfile(true)
          const onboarding = apiData.onboarding || {}
          const s1 = onboarding.step1 || {}
          const s2 = onboarding.step2 || {}
          const s3 = onboarding.step3 || {}
          const loc = s1.location || apiData.location || {}
          const pay = s3.bank || apiData.bankAccount || {}

          const rawFoodType = s1.foodType || apiData.foodType || (typeof s1.pureVegRestaurant === 'boolean' ? (s1.pureVegRestaurant ? 'Veg' : 'Mixed') : (typeof apiData.pureVegRestaurant === 'boolean' ? (apiData.pureVegRestaurant ? 'Veg' : 'Mixed') : null))
          setStep1(prev => ({
            ...prev,
            restaurantName: s1.restaurantName || apiData.name || apiData.restaurantName || "",
            foodType: rawFoodType,
            pureVegRestaurant: rawFoodType === 'Veg' ? true : (rawFoodType ? false : null),
            pureVeganRestaurant: false,
            ownerName: s1.ownerName || apiData.ownerName || "",
            ownerEmail: s1.ownerEmail || apiData.ownerEmail || apiData.email || "",
            ownerPhone: s1.ownerPhone || apiData.ownerPhone || apiData.phone || "",
            primaryContactNumber: s1.primaryContactNumber || apiData.primaryContactNumber || "",
            restaurantType: s1.restaurantType || apiData.restaurantType || "",
            zoneId: s1.zoneId || apiData.zoneId || "",
            location: {
              ...prev.location,
              formattedAddress: loc.formattedAddress || loc.address || apiData.address || "",
              addressLine1: loc.addressLine1 || "",
              addressLine2: loc.addressLine2 || "",
              area: loc.area || apiData.area || "",
              city: loc.city || apiData.city || "",
              state: loc.state || apiData.state || "",
              pincode: loc.pincode || apiData.pincode || "",
              landmark: loc.landmark || "",
              latitude: loc.latitude || "",
              longitude: loc.longitude || "",
            }
          }))

          setStep2(prev => ({
            ...prev,
            menuImages: photosWereCleared ? [] : (s2.menuImageUrls || apiData.menuImages || []),
            profileImage: photosWereCleared ? null : (s2.profileImageUrl || apiData.profileImage || null),
            cuisines: s2.cuisines || apiData.cuisines || [],
            estimatedDeliveryTime: s2.estimatedDeliveryTime || apiData.estimatedDeliveryTime || "",
            openingTime: normalizeTimeValue(s2.openingTime || apiData.openingTime),
            closingTime: normalizeTimeValue(s2.closingTime || apiData.closingTime),
            openDays: s2.openDays || apiData.openDays || [],
            isTakeawayEnabled: s2.isTakeawayEnabled || apiData.takeawaySettings?.isEnabled || false,
          }))

          setStep3(prev => ({
            ...prev,
            panNumber: s3.pan?.panNumber || apiData.panNumber || "",
            nameOnPan: s3.pan?.nameOnPan || apiData.nameOnPan || "",
            panImage: photosWereCleared ? null : (s3.pan?.image || apiData.panImage || null),
            gstRegistered: s3.gst?.isRegistered ?? apiData.gstRegistered ?? false,
            gstNumber: s3.gst?.gstNumber || apiData.gstNumber || "",
            gstLegalName: s3.gst?.legalName || apiData.gstLegalName || "",
            gstAddress: s3.gst?.address || apiData.gstAddress || "",
            gstImage: photosWereCleared ? null : (s3.gst?.image || apiData.gstImage || null),
            fssaiNumber: s3.fssai?.registrationNumber || apiData.fssaiNumber || "",
            fssaiExpiry: s3.fssai?.expiryDate ? String(s3.fssai.expiryDate).split('T')[0] : (apiData.fssaiExpiry ? String(apiData.fssaiExpiry).split('T')[0] : ""),
            fssaiImage: photosWereCleared ? null : (s3.fssai?.image || apiData.fssaiImage || null),
            accountNumber: pay.accountNumber || apiData.accountNumber || "",
            confirmAccountNumber: pay.accountNumber || apiData.accountNumber || "",
            ifscCode: normalizeIFSC(pay.ifscCode || apiData.ifscCode),
            accountHolderName: pay.accountHolderName || apiData.accountHolderName || "",
            accountType: normalizeAccountTypeValue(pay.accountType || apiData.accountType),
          }))
        }

        // 3. APPLY LOCAL OVERRIDES (The "Persistence" fix)
        // If localStorage has unsaved changes for this user, apply them over the API/Initial state.
        if (localData) {
          const savedPhone = normalizePhoneDigits(localData.step1?.ownerPhone || "")
          const normalizedCurrent = normalizePhoneDigits(currentPhone)
          
          // Only use local data if it belongs to the same user
          if (savedPhone && normalizedCurrent && savedPhone === normalizedCurrent) {
            debugLog("? Matching local session found. Resuming with unsaved changes.")
            
            if (localData.step1) {
              setStep1(prev => ({ ...prev, ...localData.step1, location: { ...prev.location, ...localData.step1.location } }));
            }
            if (localData.step2) {
              const { menuImages: localMenuImages, profileImage: localProfileImage, ...localStep2Rest } = localData.step2
              setStep2(prev => ({
                ...prev,
                ...localStep2Rest,
                menuImages: photosWereCleared ? [] : (localMenuImages?.length ? localMenuImages : prev.menuImages),
                profileImage: photosWereCleared ? null : (localProfileImage || prev.profileImage),
                openingTime: normalizeTimeValue(localData.step2.openingTime),
                closingTime: normalizeTimeValue(localData.step2.closingTime),
              }));
            }
            if (localData.step3) {
              const { panImage, gstImage, fssaiImage, ...localStep3Rest } = localData.step3
              setStep3(prev => ({
                ...prev,
                ...localStep3Rest,
                panImage: photosWereCleared ? null : (panImage || prev.panImage),
                gstImage: photosWereCleared ? null : (gstImage || prev.gstImage),
                fssaiImage: photosWereCleared ? null : (fssaiImage || prev.fssaiImage),
              }));
            }

            // Restore Step
            if (localData.currentStep && !stepParam) {
              setStep(Math.min(3, Math.max(1, Number(localData.currentStep))))
            }
          } else if (savedPhone && normalizedCurrent && savedPhone !== normalizedCurrent) {
             debugLog("? Phone mismatch, data belongs to different user. Clearing local cache.")
             localData = null; // Bypass IndexedDB check for mismatched user
             clearOnboardingFromLocalStorage()
             clearAllFilesFromDB().catch(e => debugError("Cleanup failed:", e))
          }
        }

        /*
         * 3b. Server draft: images this registrant already uploaded.
         *
         * For a new registrant the draft is the source of truth (it also
         * reflects removals made before the refresh), so it replaces what is on
         * screen. When the restaurant already exists in the API, the draft is
         * used only to fill fields the API had nothing for - it must not undo a
         * saved image, but it must still rescue one the API did not return.
         */
        const preferExisting = Boolean(apiData)
        void draftUploadsPromise.then((draftUploads) => {
          if (!draftUploads || photosWereCleared) return
          const draftMenuImages = (draftUploads.menuImages || []).map(toStoredImageValue).filter(Boolean)
          const draftProfileImage = toStoredImageValue(draftUploads.profileImage)

          setStep2((prev) => ({
            ...prev,
            menuImages: preferExisting && prev.menuImages?.length ? prev.menuImages : draftMenuImages,
            profileImage: preferExisting && prev.profileImage ? prev.profileImage : draftProfileImage,
          }))
          setStep3((prev) => ({
            ...prev,
            panImage: preferExisting && prev.panImage ? prev.panImage : toStoredImageValue(draftUploads.panImage),
            gstImage: preferExisting && prev.gstImage ? prev.gstImage : toStoredImageValue(draftUploads.gstImage),
            fssaiImage: preferExisting && prev.fssaiImage ? prev.fssaiImage : toStoredImageValue(draftUploads.fssaiImage),
          }))
        })

        // 4. Finally re-hydrate heavy files from IndexedDB if they exist
        // (files still in IndexedDB are picks whose upload had not completed)
        // (IndexedDB is reliable for large files which don't fit in localStorage)
        // Optimization: Only attempt this if we have existing local or API data to restore.
        {
          debugLog("? Restoring saved files...")
          const [prof, pan, gst, fs, menuFiles] = await storedFilesPromise

          if (photosWereCleared) {
            void clearAllFilesFromDB()
          } else {
            if (prof) setStep2(p => ({ ...p, profileImage: prof }));
            if (pan) setStep3(p => ({ ...p, panImage: pan }));
            if (gst) setStep3(p => ({ ...p, gstImage: gst }));
            if (fs) setStep3(p => ({ ...p, fssaiImage: fs }));

            const restoredMenuImages = (menuFiles || []).filter(Boolean)
            if (restoredMenuImages.length) {
              setStep2(p => ({ ...p, menuImages: [...p.menuImages.filter(im => !isUploadableFile(im)), ...restoredMenuImages] }));
            }
          }

          // Only now is an empty image field a real "no image", so the save
          // effect is allowed to delete.
          imagesRestoredRef.current = true
        }

        // If step is explicitly in URL, use it
        if (stepParam) {
          const s = parseInt(stepParam, 10);
          if (s >= 1 && s <= 3) setStep(s);
        }

        clearTimeout(failSafeTimer)
      } catch (err) {
        debugError("Onboarding hydration failed:", err)
      } finally {
        setIsOnboardingHydrated(true)
        setLoading(false)
        isHydratingRef.current = false
      }
    }

    loadData()
  }, [])

  useEffect(() => {
    if (!verifiedPhoneNumber) return
    setStep1((prev) => ({
      ...prev,
      ownerPhone: verifiedPhoneNumber,
    }))
  }, [verifiedPhoneNumber])

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined

    const updateInset = () => {
      const vv = window.visualViewport
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height))
      setKeyboardInset(inset > 120 ? inset : 0)
    }

    updateInset()
    window.visualViewport.addEventListener("resize", updateInset)
    window.visualViewport.addEventListener("scroll", updateInset)
    return () => {
      window.visualViewport.removeEventListener("resize", updateInset)
      window.visualViewport.removeEventListener("scroll", updateInset)
    }
  }, [])

  // Save to localStorage whenever step data changes
  useEffect(() => {
    if (!isOnboardingHydrated) return
    saveOnboardingToLocalStorage(step1, step2, step3, step)
    
    // Save images to IndexedDB
    // IndexedDB only holds picks that are not stored on the server yet. Once a
    // field is empty or holds an uploaded URL its cached file is dropped, otherwise
    // a removed or already-uploaded image came back on the next refresh.
    const syncSingleFile = async (key, value) => {
      if (isUploadableFile(value)) {
        await saveFileToDB(key, value)
      } else if (imagesRestoredRef.current) {
        await deleteFileFromDB(key)
      }
    }

    const saveFiles = async () => {
      await syncSingleFile("profileImage", step2.profileImage)
      await syncSingleFile("panImage", step3.panImage)
      await syncSingleFile("gstImage", step3.gstImage)
      await syncSingleFile("fssaiImage", step3.fssaiImage)

      if (imagesRestoredRef.current) {
        await persistMenuImagesToDB(step2.menuImages || [])
      }
    }
    saveFiles()
  }, [isOnboardingHydrated, step1, step2, step3, step])

  useEffect(() => {
    syncOnboardingFileCache(step2, step3)
  }, [step2, step3])

  // Picks restored from IndexedDB never reached the server (offline, app closed
  // mid-upload). Retry them once after hydration so they get persisted too.
  const pendingUploadRetryDoneRef = useRef(false)
  useEffect(() => {
    if (!isOnboardingHydrated || pendingUploadRetryDoneRef.current) return
    pendingUploadRetryDoneRef.current = true
    if (!getDraftUploadToken()) return

    const current2 = step2Ref.current || {}
    const current3 = step3Ref.current || {}
    ;(current2.menuImages || [])
      .filter((img) => isUploadableFile(img))
      .forEach((file) => void startImageUpload("menuImages", file, { silent: true }))
    if (isUploadableFile(current2.profileImage)) {
      void startImageUpload("profileImage", current2.profileImage, { silent: true })
    }
    DOCUMENT_IMAGE_FIELDS.forEach((field) => {
      if (isUploadableFile(current3[field])) {
        void startImageUpload(field, current3[field], { silent: true })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnboardingHydrated])

  useEffect(() => {
    return () => {
      previewUrlCacheRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // Ignore revoke errors
        }
      })
      previewUrlCacheRef.current.clear()
    }
  }, [])

  // REMOVED redundancy: The hydration is now handled in a single loadData effect above 
  // to avoid race conditions between localStorage and API data.

  const handleUpload = async (file, folder) => {
    try {
      if (!isUploadableFile(file)) {
        throw new Error("Invalid image file")
      }

      const response = await uploadAPI.uploadMedia(file, { folder })
      const uploadedImage = response?.data?.data

      if (!uploadedImage?.url) {
        throw new Error("Uploaded image URL was not returned")
      }

      return uploadedImage
    } catch (err) {
      // Provide more informative error message for upload failures
      const errorMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Failed to upload image"
      debugError("Upload error:", errorMsg, err)
      throw new Error(`Image upload failed: ${errorMsg}`)
    }
  }


  // Validation functions for each step
  const validateStep1 = () => {
    const errors = []

    if (!step1.restaurantName?.trim()) {
      errors.push("Restaurant name is required")
    } else if (/[\/-]/.test(step1.restaurantName)) {
      errors.push("Restaurant name cannot contain slashes (/) or hyphens (-)")
    }
    if (!step1.foodType && typeof step1.pureVegRestaurant !== "boolean") {
      errors.push("Please select your restaurant diet type (Veg, Non-Veg, or Mixed)")
    }
    if (!step1.ownerName?.trim()) {
      errors.push("Owner name is required")
    } else if (!OWNER_NAME_REGEX.test(step1.ownerName.trim())) {
      errors.push("Owner name must contain only letters")
    }
    if (!step1.ownerEmail?.trim()) {
      errors.push("Owner email is required")
    } else if (!EMAIL_REGEX.test(step1.ownerEmail.trim())) {
      errors.push("Please enter a valid email address")
    } else if (step1.ownerEmail.toLowerCase().includes("@gnail.com") || step1.ownerEmail.toLowerCase().includes("@gnil.com")) {
      errors.push("Invalid email domain. Did you mean '@gmail.com'?")
    }
    if (!step1.ownerPhone?.trim()) {
      errors.push("Owner phone number is required")
    } else if (!/^\d{10}$/.test(normalizePhoneDigits(step1.ownerPhone))) {
      errors.push("Owner phone number must be exactly 10 digits")
    }
    if (!step1.primaryContactNumber?.trim()) {
      errors.push("Primary contact number is required")
    } else if (!/^\d{10}$/.test(normalizePhoneDigits(step1.primaryContactNumber))) {
       errors.push("Primary contact number must be exactly 10 digits")
    }
    if (!step1.restaurantType?.trim()) {
      errors.push("Restaurant type is required")
    } else if (!RESTAURANT_TYPE_OPTIONS.some((t) => t.value === step1.restaurantType)) {
      errors.push("Please choose a valid restaurant type")
    }
    if (!step1.zoneId?.trim()) {
      errors.push("Service zone is required")
    } else if (zones.length > 0 && !isSelectedZoneValid) {
      errors.push("The selected service zone does not cover your restaurant location")
    }
    if (!step1.location?.area?.trim()) {
      errors.push("Area/Sector/Locality is required")
    }
    if (!step1.location?.city?.trim()) {
      errors.push("City is required")
    }
    if (!step1.location?.pincode?.trim()) {
      errors.push("Pincode is required")
    } else if (!/^\d{6}$/.test(normalizePincode(step1.location.pincode))) {
      errors.push("Pincode must be exactly 6 digits")
    }

    return errors
  }

  const validateStep2 = () => {
    const errors = []

    // Check menu images - must have at least one File or existing URL
    const hasMenuImages = step2.menuImages && step2.menuImages.length > 0
    if (!hasMenuImages) {
      errors.push("At least one menu image is required")
    } else {
      // Verify that menu images are either File objects or have valid URLs
      const validMenuImages = step2.menuImages.filter(img => {
        if (isUploadableFile(img)) return true
        if (img?.url && typeof img.url === 'string') return true
        if (typeof img === 'string' && img.trim()) return true
        return false
      })
      if (validMenuImages.length === 0) {
        errors.push("Please upload at least one valid menu image")
      }
    }

    // Check profile image - must be a File or existing URL
    if (!step2.profileImage) {
      errors.push("Restaurant profile image is required")
    } else {
      // Verify profile image is either a File or has a valid URL
      const isValidProfileImage =
        isUploadableFile(step2.profileImage) ||
        (step2.profileImage?.url && typeof step2.profileImage.url === 'string') ||
        (typeof step2.profileImage === 'string' && step2.profileImage.trim())
      if (!isValidProfileImage) {
        errors.push("Please upload a valid restaurant profile image")
      }
    }

    if (!step2.openingTime?.trim()) {
      errors.push("Opening time is required")
    }
    if (!step2.closingTime?.trim()) {
      errors.push("Closing time is required")
    }
    // Overnight trading (10:00 -> 02:00) is valid, so only identical times fail.
    const hours = validateOutletHours(step2.openingTime, step2.closingTime)
    if (hours.error) {
      errors.push(hours.error)
    }
    if (!step2.openDays || step2.openDays.length === 0) {
      errors.push("Please select at least one open day")
    }
    if (!step2.estimatedDeliveryTime?.trim()) {
      errors.push("Estimated delivery time is required")
    }

    return errors
  }

  const validateStep3 = () => {
    const errors = []

    if (!step3.panNumber?.trim()) {
      errors.push("PAN number is required")
    } else if (!PAN_NUMBER_REGEX.test(step3.panNumber.trim().toUpperCase())) {
      errors.push("PAN number must be valid (e.g., ABCDE1234F)")
    }
    const normalizedNameOnPan = normalizeFullName(step3.nameOnPan)
    if (!normalizedNameOnPan) {
      errors.push("PAN holder name is required")
    } else if (normalizedNameOnPan.length < 2) {
      errors.push("PAN holder name must be at least 2 characters")
    } else if (!FULL_NAME_REGEX.test(normalizedNameOnPan)) {
      errors.push("PAN holder name can only contain letters, spaces, dots, apostrophes and hyphens")
    }
    // Validate PAN image - must be a File or existing URL
    if (!step3.panImage) {
      errors.push("PAN image is required")
    } else {
      const isValidPanImage =
        isUploadableFile(step3.panImage) ||
        (step3.panImage?.url && typeof step3.panImage.url === 'string') ||
        (typeof step3.panImage === 'string' && step3.panImage.trim())
      if (!isValidPanImage) {
        errors.push("Please upload a valid PAN image")
      }
    }

    if (!step3.fssaiNumber?.trim()) {
      errors.push("FSSAI number is required")
    } else if (!FSSAI_NUMBER_REGEX.test(step3.fssaiNumber.trim())) {
      errors.push("FSSAI number must contain exactly 14 digits")
    }
    if (!step3.fssaiExpiry?.trim()) {
      errors.push("FSSAI expiry date is required")
    } else if (step3.fssaiExpiry < getTodayLocalYMD()) {
      errors.push("FSSAI expiry date cannot be in the past")
    }
    // Validate FSSAI image - must be a File or existing URL
    if (!step3.fssaiImage) {
      errors.push("FSSAI image is required")
    } else {
      const isValidFssaiImage =
        isUploadableFile(step3.fssaiImage) ||
        (step3.fssaiImage?.url && typeof step3.fssaiImage.url === 'string') ||
        (typeof step3.fssaiImage === 'string' && step3.fssaiImage.trim())
      if (!isValidFssaiImage) {
        errors.push("Please upload a valid FSSAI image")
      }
    }

    // Validate GST details if GST registered
    if (step3.gstRegistered) {
      if (!step3.gstNumber?.trim()) {
        errors.push("GST number is required when GST registered")
      } else if (!GST_NUMBER_REGEX.test(step3.gstNumber.trim().toUpperCase())) {
        errors.push("GST number must be a valid 15-character GSTIN")
      }
      if (!step3.gstLegalName?.trim()) {
        errors.push("GST legal name is required when GST registered")
      } else if (!GST_LEGAL_NAME_REGEX.test(step3.gstLegalName.trim())) {
        errors.push("GST legal name must contain only letters")
      }
      if (!step3.gstAddress?.trim()) {
        errors.push("GST registered address is required when GST registered")
      }
      // Validate GST image if GST registered
      if (!step3.gstImage) {
        errors.push("GST image is required when GST registered")
      } else {
        const isValidGstImage =
          isUploadableFile(step3.gstImage) ||
          (step3.gstImage?.url && typeof step3.gstImage.url === 'string') ||
          (typeof step3.gstImage === 'string' && step3.gstImage.trim())
        if (!isValidGstImage) {
          errors.push("Please upload a valid GST image")
        }
      }
    }

    if (!step3.accountNumber?.trim()) {
      errors.push("Account number is required")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.accountNumber.trim())) {
      errors.push("Account number must contain 9 to 18 digits only")
    }
    if (!step3.confirmAccountNumber?.trim()) {
      errors.push("Please confirm your account number")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.confirmAccountNumber.trim())) {
      errors.push("Confirm account number must contain 9 to 18 digits only")
    }
    if (step3.accountNumber && step3.confirmAccountNumber && step3.accountNumber !== step3.confirmAccountNumber) {
      errors.push("Account number and confirmation do not match")
    }
    if (!step3.ifscCode?.trim()) {
      errors.push("IFSC code is required")
    } else if (!IFSC_CODE_REGEX.test(step3.ifscCode.trim().toUpperCase())) {
      errors.push("IFSC code must contain exactly 11 alphanumeric characters")
    }
    const normalizedAccountHolderName = normalizeFullName(step3.accountHolderName)
    if (!normalizedAccountHolderName) {
      errors.push("Account holder name is required")
    } else if (normalizedAccountHolderName.length < 2) {
      errors.push("Account holder name must be at least 2 characters")
    } else if (!FULL_NAME_REGEX.test(normalizedAccountHolderName)) {
      errors.push("Account holder name can only contain letters, spaces, dots, apostrophes and hyphens")
    }
    if (!step3.accountType?.trim()) {
      errors.push("Account type is required")
    } else if (!["Saving", "Current"].includes(step3.accountType.trim())) {
      errors.push("Account type must be either Saving or Current")
    }

    return errors
  }

  const handleNext = async () => {
    setError("")

    if (pendingUploads.size > 0) {
      toast.info("Please wait for your images to finish uploading")
      return
    }

    // Validate current step before proceeding
    let validationErrors = []
    if (step === 1) {
      validationErrors = validateStep1()
    } else if (step === 2) {
      validationErrors = validateStep2()
    } else if (step === 3) {
      validationErrors = validateStep3()
    }

    if (validationErrors.length > 0) {
      setError(validationErrors[0])
      toast.error(validationErrors[0])
      debugLog('? Validation failed:', validationErrors)
      return
    }

    setSaving(true)
    try {
      if (step === 1) {
        setStep(2)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 2) {
        setStep(3)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 3) {
        const { fcmToken, platform } = await collectFcmTokenForSignup("restaurant")

        if (hasExistingRestaurantProfile) {
          const [
            menuImagesPayload,
            profileImagePayload,
            panImagePayload,
            gstImagePayload,
            fssaiImagePayload,
          ] = await Promise.all([
            resolveMenuImagesForProfileUpdate(step2.menuImages || []),
            resolveImageForProfileUpdate(step2.profileImage, "food/restaurants/profile"),
            resolveImageForProfileUpdate(step3.panImage, "food/restaurants/pan"),
            step3.gstRegistered
              ? resolveImageForProfileUpdate(step3.gstImage, "food/restaurants/gst")
              : Promise.resolve(null),
            resolveImageForProfileUpdate(step3.fssaiImage, "food/restaurants/fssai"),
          ])

          const effectiveFoodType = step1.foodType || (step1.pureVegRestaurant === true ? "Veg" : "Mixed")
          const updatePayload = {
            restaurantName: step1.restaurantName || "",
            foodType: effectiveFoodType,
            pureVegRestaurant: effectiveFoodType === "Veg",
            pureVeganRestaurant: false,
            ownerName: step1.ownerName || "",
            ownerEmail: (step1.ownerEmail || "").trim(),
            ownerPhone: normalizePhoneDigits(step1.ownerPhone),
            primaryContactNumber: normalizePhoneDigits(step1.primaryContactNumber),
            restaurantType: step1.restaurantType || "",
            zoneId: step1.zoneId || "",
            location: {
              formattedAddress: step1.location?.formattedAddress || "",
              addressLine1: step1.location?.addressLine1 || "",
              addressLine2: step1.location?.addressLine2 || "",
              area: step1.location?.area || "",
              city: step1.location?.city || "",
              state: step1.location?.state || "",
              pincode: step1.location?.pincode || "",
              landmark: step1.location?.landmark || "",
              latitude: step1.location?.latitude || "",
              longitude: step1.location?.longitude || "",
            },
            cuisines: Array.isArray(step2.cuisines) ? step2.cuisines : [],
            estimatedDeliveryTime: (step2.estimatedDeliveryTime || "").trim(),
            openingTime: normalizeTimeValue(step2.openingTime) || "",
            closingTime: normalizeTimeValue(step2.closingTime) || "",
            openDays: Array.isArray(step2.openDays) ? step2.openDays : [],
            menuImages: menuImagesPayload,
            profileImage: profileImagePayload || "",
            panNumber: step3.panNumber || "",
            nameOnPan: normalizeFullName(step3.nameOnPan),
            panImage: panImagePayload || "",
            gstRegistered: Boolean(step3.gstRegistered),
            gstNumber: step3.gstRegistered ? step3.gstNumber || "" : "",
            gstLegalName: step3.gstRegistered ? step3.gstLegalName || "" : "",
            gstAddress: step3.gstRegistered ? step3.gstAddress || "" : "",
            gstImage: step3.gstRegistered ? (gstImagePayload || "") : "",
            fssaiNumber: step3.fssaiNumber || "",
            fssaiExpiry: step3.fssaiExpiry || "",
            fssaiImage: fssaiImagePayload || "",
            accountNumber: step3.accountNumber || "",
            ifscCode: (step3.ifscCode || "").toUpperCase(),
            accountHolderName: normalizeFullName(step3.accountHolderName),
            accountType: step3.accountType || "",
            isTakeawayEnabled: step2.isTakeawayEnabled === true,
            isTakeawayCodEnabled: step2.isTakeawayCodEnabled === true,
          }

          if (fcmToken) {
            updatePayload.fcmToken = fcmToken
            updatePayload.platform = platform
          }

          await restaurantAPI.updateProfile(updatePayload)

          clearOnboardingFromLocalStorage()
          clearOnboardingFileCache()
          await clearAllFilesFromDB()

          toast.success("Registration submitted. Awaiting admin approval.", { duration: 4000 })
          await finalizeRestaurantPendingSubmission(navigate, step1.ownerPhone, { fcmToken, platform })
          return
        }

        // Final submit: create restaurant in DB using backend multipart endpoint.
        const formData = new FormData()

        // Step 1
        const effectiveFoodType = step1.foodType || (step1.pureVegRestaurant === true ? "Veg" : "Mixed")
        formData.append("restaurantName", step1.restaurantName || "")
        formData.append("foodType", effectiveFoodType)
        formData.append("pureVegRestaurant", effectiveFoodType === "Veg" ? "true" : "false")
        formData.append("pureVeganRestaurant", "false")
        formData.append("ownerName", step1.ownerName || "")
        formData.append("ownerEmail", (step1.ownerEmail || "").trim())
        formData.append("ownerPhone", normalizePhoneDigits(step1.ownerPhone))
        formData.append("primaryContactNumber", normalizePhoneDigits(step1.primaryContactNumber))
        formData.append("restaurantType", step1.restaurantType || "")
        formData.append("zoneId", step1.zoneId || "")
        formData.append("addressLine1", step1.location?.addressLine1 || "")
        formData.append("addressLine2", step1.location?.addressLine2 || "")
        formData.append("area", step1.location?.area || "")
        formData.append("city", step1.location?.city || "")
        formData.append("state", step1.location?.state || "")
        formData.append("pincode", step1.location?.pincode || "")
        formData.append("landmark", step1.location?.landmark || "")
        formData.append("formattedAddress", step1.location?.formattedAddress || "")
        formData.append("latitude", String(step1.location?.latitude || ""))
        formData.append("longitude", String(step1.location?.longitude || ""))

        // Step 2
        formData.append("cuisines", (step2.cuisines || []).join(","))
        formData.append("estimatedDeliveryTime", (step2.estimatedDeliveryTime || "").trim())
        formData.append("openingTime", normalizeTimeValue(step2.openingTime) || "")
        formData.append("closingTime", normalizeTimeValue(step2.closingTime) || "")
        formData.append("openDays", (step2.openDays || []).join(","))
        formData.append("isTakeawayEnabled", step2.isTakeawayEnabled ? "true" : "false")
        formData.append("isTakeawayCodEnabled", step2.isTakeawayCodEnabled ? "true" : "false")

        // Images already uploaded to the onboarding draft are sent by URL; picks
        // that could not be uploaded yet still go as multipart files.
        const appendSingleImage = async (fieldName, value, missingMessage, prepareOptions) => {
          if (isUploadableFile(value)) {
            formData.append(fieldName, await prepareUploadFile(value, prepareOptions))
            return
          }
          const storedUrl = getStoredImageUrl(value)
          if (!storedUrl) {
            throw new Error(missingMessage)
          }
          formData.append(`${fieldName}Url`, storedUrl)
        }

        const menuItems = step2.menuImages || []
        const menuFiles = menuItems.filter((f) => isUploadableFile(f))
        const menuUrls = menuItems.map(getStoredImageUrl).filter(Boolean)
        if (menuFiles.length === 0 && menuUrls.length === 0) {
          throw new Error("At least one menu image must be uploaded")
        }
        if (menuFiles.length) {
          const preparedMenuFiles = await prepareUploadFiles(menuFiles)
          preparedMenuFiles.forEach((file) => formData.append("menuImages", file))
        }
        if (menuUrls.length) {
          formData.append("menuImageUrls", JSON.stringify(menuUrls))
        }

        await appendSingleImage(
          "profileImage",
          step2.profileImage,
          "Restaurant profile image is required",
          { preset: "profile" },
        )

        // Step 3
        formData.append("panNumber", step3.panNumber || "")
        formData.append("nameOnPan", normalizeFullName(step3.nameOnPan))
        await appendSingleImage("panImage", step3.panImage, "PAN image is required")

        formData.append("gstRegistered", step3.gstRegistered ? "true" : "false")
        if (step3.gstRegistered) {
          formData.append("gstNumber", step3.gstNumber || "")
          formData.append("gstLegalName", step3.gstLegalName || "")
          formData.append("gstAddress", step3.gstAddress || "")
          await appendSingleImage("gstImage", step3.gstImage, "GST image is required when GST registered")
        }

        formData.append("fssaiNumber", step3.fssaiNumber || "")
        formData.append("fssaiExpiry", step3.fssaiExpiry || "")
        await appendSingleImage("fssaiImage", step3.fssaiImage, "FSSAI image is required")

        formData.append("accountNumber", step3.accountNumber || "")
        formData.append("ifscCode", (step3.ifscCode || "").toUpperCase())
        formData.append("accountHolderName", normalizeFullName(step3.accountHolderName))
        formData.append("accountType", step3.accountType || "")

        if (fcmToken) {
          formData.append("fcmToken", fcmToken)
          formData.append("platform", platform)
        }

        const registerResponse = await restaurantAPI.register(formData, {
          registrationToken: getRestaurantRegistrationToken(),
        })
        const registered =
          registerResponse?.data?.data || registerResponse?.data || {}
        const onboarding = registered?.onboarding || {}

        // Clear localStorage when onboarding is complete
        clearOnboardingFromLocalStorage()
        clearRestaurantRegistrationToken()
        clearOnboardingFileCache()
        try {
          await clearAllFilesFromDB()
        } catch {}

        // A one-time fee applies: the restaurant is saved but NOT submitted to admin
        // until the backend verifies the payment.
        if (onboarding.paymentRequired && onboarding.onboardingToken) {
          try {
            localStorage.setItem(ONBOARDING_TOKEN_KEY, onboarding.onboardingToken)
            localStorage.setItem(
              ONBOARDING_RESTAURANT_ID_KEY,
              String(registered?._id || registered?.id || ""),
            )
            if (normalizePhoneDigits(step1.ownerPhone)) {
              localStorage.setItem(
                "restaurant_pendingPhone",
                normalizePhoneDigits(step1.ownerPhone),
              )
            }
          } catch {}
          navigate("/food/restaurant/onboarding/payment", { replace: true })
          return
        }

        toast.success("Registration submitted. Awaiting admin approval.", { duration: 4000 })
        await finalizeRestaurantPendingSubmission(navigate, step1.ownerPhone, { fcmToken, platform })
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save onboarding data"
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }



  const toggleDay = (day) => {
    setStep2((prev) => {
      const exists = prev.openDays.includes(day)
      if (exists) {
        return { ...prev, openDays: prev.openDays.filter((d) => d !== day) }
      }
      return { ...prev, openDays: [...prev.openDays, day] }
    })
  }
  
  const renderStep1 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Restaurant information</h2>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-gray-700">Restaurant name*</Label>
            <Input
              value={step1.restaurantName || ""}
              onChange={(e) => {
                const sanitizedVal = e.target.value.replace(/[\/-]/g, "");
                setStep1({ ...step1, restaurantName: formatNameToCapital(sanitizedVal) });
              }}
              className="mt-1 bg-white text-sm"
              placeholder="Customers will see this name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Restaurant diet type?*</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  isEditing &&
                  setStep1({
                    ...step1,
                    foodType: "Veg",
                    pureVegRestaurant: true,
                    pureVeganRestaurant: false,
                  })
                }
                className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                  (step1.foodType === "Veg" || (step1.foodType == null && step1.pureVegRestaurant === true))
                    ? "bg-[#16A34A] text-white border-[#16A34A] shadow-sm"
                    : "bg-white text-gray-700 border-gray-200 hover:border-green-400"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 border border-white" />
                Veg
              </button>
              <button
                type="button"
                onClick={() =>
                  isEditing &&
                  setStep1({
                    ...step1,
                    foodType: "Non-Veg",
                    pureVegRestaurant: false,
                    pureVeganRestaurant: false,
                  })
                }
                className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                  step1.foodType === "Non-Veg"
                    ? "bg-red-600 text-white border-red-600 shadow-sm"
                    : "bg-white text-gray-700 border-gray-200 hover:border-red-400"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 border border-white" />
                Non-Veg
              </button>
              <button
                type="button"
                onClick={() =>
                  isEditing &&
                  setStep1({
                    ...step1,
                    foodType: "Mixed",
                    pureVegRestaurant: false,
                    pureVeganRestaurant: false,
                  })
                }
                className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                  (step1.foodType === "Mixed" || (step1.foodType == null && step1.pureVegRestaurant === false))
                    ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                    : "bg-white text-gray-700 border-gray-200 hover:border-amber-400"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-white" />
                Mixed (Both)
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">
              {step1.foodType === "Veg"
                ? "Veg: Serves only vegetarian dishes."
                : step1.foodType === "Non-Veg"
                  ? "Non-Veg: Serves only non-vegetarian dishes."
                  : "Mixed: Serves both vegetarian and non-vegetarian dishes."}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Owner details</h2>
        <p className="text-sm text-gray-600 mb-4">
          These details will be used for all business communications and updates.
        </p>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-700">Full name*</Label>
            <Input
              value={step1.ownerName || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  ownerName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="mt-1 bg-white text-sm"
              placeholder="Owner full name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Email address*</Label>
            <Input
              type="email"
              value={step1.ownerEmail || ""}
              onChange={(e) => setStep1({ ...step1, ownerEmail: normalizeEmail(e.target.value) })}
              className="mt-1 bg-white text-sm"
              placeholder="ritu@gmail.com"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Phone number*</Label>
            <Input
              value={step1.ownerPhone || ""}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 10)
                setStep1({ ...step1, ownerPhone: val })
              }}
              readOnly={Boolean(verifiedPhoneNumber)}
              className="mt-1 bg-white text-sm"
              placeholder="10 digit mobile number"
              disabled={!isEditing}
            />
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Restaurant contact & location</h2>
        <div>
          <Label className="text-xs text-gray-700">Primary contact number*</Label>
          <Input
            value={step1.primaryContactNumber || ""}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 10)
              setStep1({ ...step1, primaryContactNumber: val })
            }}
            onKeyDown={(e) => {
              const allowed = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab", "Enter"]
              if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault()
              if (/^\d$/.test(e.key) && (step1.primaryContactNumber || "").length >= 10) e.preventDefault()
            }}
            onPaste={(e) => {
              e.preventDefault()
              const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 10)
              setStep1({ ...step1, primaryContactNumber: pasted })
            }}
            inputMode="numeric"
            className="mt-1 bg-white text-sm"
            placeholder="Restaurant's primary contact number"
            disabled={!isEditing}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Customers, delivery partners and {companyName} may call on this number for order
            support.
          </p>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Add your restaurant's location for order pick-up.
          </p>
          <div>
            <Label className="text-xs text-gray-700">Restaurant type*</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {RESTAURANT_TYPE_OPTIONS.map((option) => {
                const selected = step1.restaurantType === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={!isEditing}
                    onClick={() => setStep1({ ...step1, restaurantType: option.value })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      selected
                        ? "border-[#2E7D52] bg-[#2E7D52] text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:border-[#2E7D52]/40"
                    } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Your one-time onboarding fee depends on this category and your service zone.
            </p>
          </div>
          <div>
            <Label className="text-xs text-gray-700">Service zone*</Label>
            <select
              value={step1.zoneId || ""}
              onChange={(e) => {
                const selectedZId = e.target.value
                const matchedZone = (zones || []).find((z) => String(z?._id || z?.id) === String(selectedZId))
                const zoneCity = matchedZone
                  ? String(matchedZone.name || matchedZone.zoneName || matchedZone.serviceLocation || "").trim()
                  : ""
                setStep1((prev) => {
                  const hasLocation = prev.location?.latitude && prev.location?.longitude
                  const isLocInside = matchedZone && hasLocation ? isPointInZone(Number(prev.location.latitude), Number(prev.location.longitude), matchedZone) : true
                  return {
                    ...prev,
                    zoneId: selectedZId,
                    location: {
                      ...prev.location,
                      city: zoneCity || (isLocInside ? prev.location?.city : "") || "",
                      formattedAddress: isLocInside ? prev.location?.formattedAddress : "",
                      addressLine1: isLocInside ? prev.location?.addressLine1 : "",
                      latitude: isLocInside ? prev.location?.latitude : "",
                      longitude: isLocInside ? prev.location?.longitude : "",
                      pincode: isLocInside ? prev.location?.pincode : "",
                    },
                  }
                })
                if (selectedZId !== step1.zoneId) {
                  setLocationSearchValue("")
                  setLocationSuggestions([])
                }
              }}
              className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
              disabled={zonesLoading || !isEditing}
            >
              <option value="">{zonesLoading ? "Loading zones..." : "Select a zone"}</option>
              {zones.map((z) => {
                const id = String(z?._id || z?.id || "")
                return (
                  <option key={id} value={id}>
                    {getZoneLabel(z)}
                  </option>
                )
              })}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              {step1.zoneId
                ? "Service zone selected. You can now search for a location within this zone."
                : "Choose your service zone first to activate location search."}
            </p>
          </div>
          <div ref={locationSearchContainerRef} className="relative">
            <Label className="text-xs text-gray-700">Search location*</Label>
            <div className="relative">
              <Input
                ref={locationSearchInputRef}
                value={locationSearchValue}
                onChange={(e) => setLocationSearchValue(e.target.value)}
                onFocus={() => setIsLocationSearchFocused(true)}
                onBlur={() => setIsLocationSearchFocused(false)}
                disabled={!step1.zoneId || zonesLoading || !isEditing}
                className="mt-1 bg-white text-sm text-black! dark:text-white! placeholder:text-slate-400/70 dark:placeholder:text-slate-500/70 caret-black dark:caret-white disabled:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                style={locationSearchValue ? { color: "#000", WebkitTextFillColor: "#000" } : {}}
                placeholder={
                  !step1.zoneId
                    ? "Please select a service zone first"
                    : isLocationSearchFocused
                    ? ""
                    : "Start typing your restaurant address..."
                }
              />
              {isSearchingLocation && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                   <div className="animate-spin rounded-full h-4 w-4 border-2 border-orange-500 border-t-transparent" />
                </div>
              )}
            </div>

            {/* Fallback suggestions dropdown */}
            {locationSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] z-[999999] max-h-60 overflow-y-auto p-1 font-['Poppins'] custom-scrollbar">
                {locationSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      const { lat, lng, display, addr } = s
                      const selectedZone = zones.find((z) => String(z?._id || z?.id) === String(step1.zoneId))
                      if (selectedZone && Number.isFinite(lat) && Number.isFinite(lng) && !isPointInZone(lat, lng, selectedZone)) {
                        const zName = getZoneLabel(selectedZone)
                        toast.error(`The selected location is outside your chosen service zone (${zName}). Please pick a location within this zone.`)
                        setLocationSearchValue("")
                        setLocationSuggestions([])
                        return
                      }

                      const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.locality || ""
                      const city = addr.city || addr.town || addr.village || ""
                      const state = addr.state || ""
                      let pincode = addr.postcode || ""
                      if (!pincode || !/^\d{6}$/.test(pincode)) {
                        const pinMatch = display.match(/\b([1-9][0-9]{5})\b/)
                        if (pinMatch) pincode = pinMatch[1]
                      }

                      setStep1((prev) => ({
                        ...prev,
                        zoneId: prev.zoneId,
                        location: {
                          ...prev.location,
                          formattedAddress: display,
                          addressLine1: display,
                          area: area || prev.location.area,
                          city: city || prev.location.city,
                          state: state || prev.location.state,
                          pincode: pincode || prev.location.pincode,
                          latitude: lat,
                          longitude: lng,
                        },
                      }))
                      setLocationSearchValue(display)
                      setLocationSuggestions([])

                      if (!pincode && Number.isFinite(lat) && Number.isFinite(lng)) {
                        geocodeAPI.reverse(lat, lng)
                          .then((res) => {
                            const rList = res?.data?.data?.results || []
                            const foundPin = rList.flatMap((r) => r.address_components || [])
                              .find((c) => c.types?.includes("postal_code"))?.long_name
                            if (foundPin && /^\d{6}$/.test(foundPin)) {
                              setStep1((prev) => ({
                                ...prev,
                                location: { ...prev.location, pincode: foundPin },
                              }))
                            }
                          })
                          .catch(() => {
                            fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`)
                              .then((r) => r.json())
                              .then((data) => {
                                const pin = data?.address?.postcode || data?.display_name?.match(/\b([1-9][0-9]{5})\b/)?.[1]
                                if (pin && /^\d{6}$/.test(pin)) {
                                  setStep1((prev) => ({
                                    ...prev,
                                    location: { ...prev.location, pincode: pin },
                                  }))
                                }
                              })
                              .catch(() => {})
                          })
                      }
                    }}
                    className="w-full pl-1.5 pr-3 py-2.5 text-left text-sm hover:bg-[#FEF2F2] border-b border-gray-100 last:border-none font-medium text-gray-700 flex items-center gap-2 transition-colors rounded-xl"
                  >
                    {/* Premium red map pin icon */}
                    <svg className="w-5 h-5 text-[#DC2626] shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="truncate text-gray-800 font-semibold">{s.display}</span>
                  </button>
                ))}
              </div>
            )}
            
            {!step1.zoneId ? (
              <p className="text-[11px] text-amber-600 mt-1">
                Please select your service zone above to activate location search.
              </p>
            ) : (
              <p className="text-[11px] text-gray-500 mt-1">
                Select a suggestion to auto-fill area, city, state, pincode, and coordinates.
              </p>
            )}
          </div>
          <Input
            value={step1.location?.addressLine1 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine1: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Shop no. / building no. (optional)"
          />
          <Input
            value={step1.location?.addressLine2 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine2: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Floor / tower (optional)"
          />
          <Input
            value={step1.location?.landmark || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, landmark: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Nearby landmark (optional)"
          />
          <Input
            value={step1.location?.area || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, area: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Area / Sector / Locality*"
          />
          <Select
            value={step1.location?.city || ""}
            disabled={!isEditing}
            onValueChange={(value) => {
              const matchedZone = (zones || []).find((z) => {
                const zName = String(z?.name || z?.zoneName || z?.serviceLocation || "").trim().toLowerCase()
                return zName === String(value || "").trim().toLowerCase()
              })
              setStep1((prev) => ({
                ...prev,
                zoneId: matchedZone ? String(matchedZone._id || matchedZone.id) : prev.zoneId,
                location: { ...prev.location, city: value },
              }))
            }}
          >
            <SelectTrigger className="bg-white text-sm text-gray-700">
              <SelectValue placeholder="Select City*" />
            </SelectTrigger>
            <SelectContent className="max-h-60 overflow-y-auto z-[999999]">
              {availableCities.map((cityName) => (
                <SelectItem key={cityName} value={cityName}>
                  {cityName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              value={step1.location?.state || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, state: e.target.value },
                })
              }
              className="bg-white text-sm"
              placeholder="State"
            />
            <Input
              value={step1.location?.pincode || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, pincode: normalizePincode(e.target.value) },
                })
              }
              className="bg-white text-sm"
              placeholder="Pincode"
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Please ensure that this address is the same as mentioned on your FSSAI license.
          </p>
        </div>
      </section>
    </div>
  )


  // Initialize Google Places Autocomplete for Step 1 location search.
  useEffect(() => {
    if (step !== 1) return

    let cancelled = false
    let autocomplete = null

    const init = async () => {
      // Wait for the input ref to be attached
      let inputElement = null
      for (let i = 0; i < 50; i++) {
        if (locationSearchInputRef.current) {
          inputElement = locationSearchInputRef.current
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      if (!inputElement || cancelled) return

      const loadMaps = async () => {
        // 1. If already available with places, return true
        if (window.google?.maps?.places?.Autocomplete) {
          mapsScriptLoadedRef.current = true
          return true
        }

        // 2. Load API Key
        const apiKey = await getGoogleMapsApiKey()
        if (!apiKey) {
          debugError("Google Maps API Key missing or invalid")
          return false
        }

        // 3. Handle Auth Failure
        window.gm_authFailure = () => {
          debugError("Google Maps authentication failed.")
          // Don't show toast here as we have Nominatim fallback
        }

        // 4. Check for existing script and force libraries=places if needed
        const scripts = Array.from(document.getElementsByTagName("script"))
        const mapsScript = scripts.find(s => s.src?.includes("maps.googleapis.com/maps/api/js"))
        
        if (mapsScript && !mapsScript.src.includes("libraries=places")) {
          debugLog("Found maps script without places, removing to reload properly.")
          mapsScript.remove()
        } else if (mapsScript && mapsScript.src.includes("libraries=places")) {
           // Wait if it's still loading
           for (let i = 0; i < 60; i++) {
             if (window.google?.maps?.places?.Autocomplete) return true
             if (cancelled) return false
             await new Promise(r => setTimeout(r, 100))
           }
        }

        // 5. Create and append new script
        return new Promise((resolve) => {
          const script = document.createElement("script")
          script.id = "google-maps-sdk"
          script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`
          script.async = true
          script.defer = true
          script.onload = () => {
            setTimeout(() => {
              const ok = !!window.google?.maps?.places?.Autocomplete
              mapsScriptLoadedRef.current = ok
              resolve(ok)
            }, 200)
          }
          script.onerror = () => resolve(false)
          document.head.appendChild(script)
        })
      }

      const parsePlace = (place) => {
        const formattedAddress = place?.formatted_address || ""
        const comps = Array.isArray(place?.address_components) ? place.address_components : []
        const get = (types) => comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""

        const area = get(["sublocality_level_1", "sublocality", "neighborhood"]) || get(["locality"])
        const city = get(["locality"]) || get(["administrative_area_level_2"])
        const state = get(["administrative_area_level_1"]) || get(["administrative_area_level_2"])
        let pincode = get(["postal_code"])
        if (!pincode || !/^\d{6}$/.test(pincode)) {
          const pinMatch = formattedAddress.match(/\b([1-9][0-9]{5})\b/)
          if (pinMatch) pincode = pinMatch[1]
        }
        const lat = place?.geometry?.location?.lat?.()
        const lng = place?.geometry?.location?.lng?.()

        return {
          formattedAddress,
          area,
          city,
          state,
          pincode: pincode || "",
          latitude: typeof lat === "number" ? Number(lat.toFixed(6)) : "",
          longitude: typeof lng === "number" ? Number(lng.toFixed(6)) : "",
        }
      }

      if (!step1.zoneId) {
        if (locationSearchInputRef.current) {
          locationSearchInputRef.current.removeAttribute("data-google-places-initialized")
        }
        return
      }

      const ok = await loadMaps()
      if (!ok || cancelled || !inputElement) return

      if (inputElement.hasAttribute("data-google-places-initialized")) return

      try {
        const autocompleteOptions = {
          fields: ["formatted_address", "address_components", "geometry"],
          componentRestrictions: { country: "in" },
          types: ["geocode", "establishment"]
        }

        // Apply strict bounds filtering if zone is selected
        const selectedZone = zones.find(z => String(z?._id || z?.id) === String(step1.zoneId))
        if (selectedZone && Array.isArray(selectedZone.coordinates) && selectedZone.coordinates.length > 0) {
          const bounds = new window.google.maps.LatLngBounds()
          selectedZone.coordinates.forEach(coord => {
            const lat = parseFloat(coord.latitude || coord.lat)
            const lng = parseFloat(coord.longitude || coord.lng)
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              bounds.extend({ lat, lng })
            }
          })
          autocompleteOptions.bounds = bounds
          autocompleteOptions.strictBounds = true
        }

        autocomplete = new window.google.maps.places.Autocomplete(inputElement, autocompleteOptions)

        inputElement.setAttribute("data-google-places-initialized", "true")
        placesAutocompleteRef.current = autocomplete

        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace()
          if (!place?.geometry) return

          const currentZone = zones.find(z => String(z?._id || z?.id) === String(step1.zoneId))
          const lat = typeof place.geometry.location?.lat === "function" ? place.geometry.location.lat() : place.geometry.location?.lat
          const lng = typeof place.geometry.location?.lng === "function" ? place.geometry.location.lng() : place.geometry.location?.lng

          if (currentZone && Number.isFinite(lat) && Number.isFinite(lng) && !isPointInZone(lat, lng, currentZone)) {
            const zName = getZoneLabel(currentZone)
            toast.error(`The selected location is outside your chosen service zone (${zName}). Please search for a location within this zone.`)
            setLocationSearchValue("")
            return
          }

          const parsed = parsePlace(place)
          let resolvedPincode = parsed.pincode
          if (!resolvedPincode) {
            const pinMatch = (parsed.formattedAddress || "").match(/\b([1-9][0-9]{5})\b/)
            if (pinMatch) resolvedPincode = pinMatch[1]
          }

          setStep1((prev) => ({
            ...prev,
            zoneId: prev.zoneId,
            location: {
              ...prev.location,
              formattedAddress: parsed.formattedAddress || prev.location.formattedAddress,
              addressLine1: parsed.formattedAddress || prev.location.addressLine1 || "",
              area: parsed.area || prev.location.area,
              city: parsed.city || prev.location.city,
              state: parsed.state || prev.location.state,
              pincode: resolvedPincode || prev.location.pincode,
              latitude: parsed.latitude !== "" ? parsed.latitude : prev.location.latitude,
              longitude: parsed.longitude !== "" ? parsed.longitude : prev.location.longitude,
            },
          }))
          
          setLocationSearchValue(parsed.formattedAddress)
          inputElement.blur()

          // If pincode is not yet resolved, use geocoding to resolve the full address hierarchy
          if (!resolvedPincode && Number.isFinite(lat) && Number.isFinite(lng)) {
            if (window.google?.maps?.Geocoder) {
              try {
                const geocoder = new window.google.maps.Geocoder()
                const req = place.place_id ? { placeId: place.place_id } : { location: { lat, lng } }
                geocoder.geocode(req, (results, status) => {
                  if (status === "OK" && Array.isArray(results)) {
                    for (const res of results) {
                      const pc = res.address_components?.find((c) => c.types?.includes("postal_code"))?.long_name
                      if (pc && /^\d{6}$/.test(pc)) {
                        setStep1((prev) => ({
                          ...prev,
                          location: { ...prev.location, pincode: pc },
                        }))
                        return
                      }
                    }
                  }
                  // Fallback: reverse geocode by coordinates
                  geocodeAPI.reverse(lat, lng)
                    .then((res) => {
                      const rList = res?.data?.data?.results || []
                      const foundPin = rList.flatMap((r) => r.address_components || [])
                        .find((c) => c.types?.includes("postal_code"))?.long_name
                      if (foundPin && /^\d{6}$/.test(foundPin)) {
                        setStep1((prev) => ({
                          ...prev,
                          location: { ...prev.location, pincode: foundPin },
                        }))
                      }
                    })
                    .catch(() => {})
                })
              } catch {}
            } else {
              geocodeAPI.reverse(lat, lng)
                .then((res) => {
                  const rList = res?.data?.data?.results || []
                  const foundPin = rList.flatMap((r) => r.address_components || [])
                    .find((c) => c.types?.includes("postal_code"))?.long_name
                  if (foundPin && /^\d{6}$/.test(foundPin)) {
                    setStep1((prev) => ({
                      ...prev,
                      location: { ...prev.location, pincode: foundPin },
                    }))
                  }
                })
                .catch(() => {})
            }
          }
        })

        const pacContainerFix = () => {
          const applyFix = () => {
            const containers = document.querySelectorAll(".pac-container")
            if (containers.length > 0) {
              containers.forEach((container) => {
                container.style.zIndex = "999999"
                container.style.pointerEvents = "auto"
                if (!inputElement.value?.trim()) {
                  container.style.display = "none"
                  container.style.visibility = "hidden"
                } else {
                  container.style.visibility = "visible"
                  container.style.display = "block"
                }
              })
            }
          }
          applyFix()
          setTimeout(applyFix, 100)
          setTimeout(applyFix, 300)
        }

        inputElement.addEventListener("focus", pacContainerFix)
        inputElement.addEventListener("input", pacContainerFix)
      } catch (e) {
        debugError("Autocomplete error:", e)
      }
    }

    init().catch(() => {})

    return () => {
      cancelled = true
      if (autocomplete) {
        try { window.google?.maps?.event?.clearInstanceListeners(autocomplete) } catch {}
      }
      if (locationSearchInputRef.current) {
        locationSearchInputRef.current.removeAttribute("data-google-places-initialized")
      }
      placesAutocompleteRef.current = null
    }
  }, [step, step1.zoneId, zones])

  // Hybrid Search Fallback (Nominatim)
  useEffect(() => {
    if (step !== 1 || !step1.zoneId) {
      setLocationSuggestions([])
      setIsSearchingLocation(false)
      return
    }
    const q = String(locationSearchValue || "").trim()

    // Hide Google Places Autocomplete dropdown if query is cleared
    if (!q) {
      const containers = document.querySelectorAll(".pac-container")
      containers.forEach((container) => {
        container.style.display = "none"
        container.style.visibility = "hidden"
      })
    }

    if (q.length < 3) {
      setLocationSuggestions([])
      setIsSearchingLocation(false)
      return
    }

    const selectedZone = zones.find(z => String(z?._id || z?.id) === String(step1.zoneId))
    const zoneName = selectedZone?.name || selectedZone?.zoneName || selectedZone?.serviceLocation || ""

    const t = setTimeout(async () => {
      try {
        setIsSearchingLocation(true)
        const queryWithZone = zoneName ? `${q}, ${zoneName}` : q
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=${encodeURIComponent(queryWithZone)}&countrycodes=in`
        const res = await fetch(url, { headers: { Accept: "application/json" } })
        const json = await res.json()
        const mapped = (Array.isArray(json) ? json : []).map(r => ({
          id: r.place_id,
          display: r.display_name || "",
          lat: Number(r.lat),
          lng: Number(r.lon),
          addr: r.address || {},
        }))
        setLocationSuggestions(mapped)
      } catch (e) {
        debugError("Nominatim search failed:", e)
      } finally {
        setIsSearchingLocation(false)
      }
    }, 400)

    return () => clearTimeout(t)
  }, [locationSearchValue, step, step1.zoneId, zones])

  // Click outside to close location search suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      const isPacContainerClick = event.target.closest(".pac-container")
      if (
        locationSearchContainerRef.current &&
        !locationSearchContainerRef.current.contains(event.target) &&
        !isPacContainerClick
      ) {
        setLocationSuggestions([])
        const containers = document.querySelectorAll(".pac-container")
        containers.forEach((container) => {
          container.style.display = "none"
          container.style.visibility = "hidden"
        })
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  // Load zones for onboarding dropdown (public endpoint).
  useEffect(() => {
    if (step !== 1) return
    let cancelled = false
    setZonesLoading(true)
    zoneAPI.getPublicZones()
      .then((res) => {
        const list = res?.data?.data?.zones || res?.data?.zones || []
        if (!cancelled) setZones(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false)
      })
    return () => { cancelled = true }
  }, [step])


  const renderStep2 = () => (
    <div className="space-y-6">
      {/* Images section */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        <h2 className="text-lg font-semibold text-black">Menu & photos</h2>
        <p className="text-xs text-gray-500">
          Add clear photos of your printed menu and a primary profile image. This helps customers
          understand what you serve.
        </p>

        {/* Menu images */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-700">Menu images</Label>
          <div className="mt-1 border border-dashed border-gray-300 rounded-md bg-gray-50/70 px-4 py-3 flex items-center justify-between flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-white flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-gray-700" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-900">Upload menu images</span>
                <span className="text-[11px] text-gray-500">
                  JPG, PNG, WebP ? You can select multiple files
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={() =>
                openImageSourcePicker({
                  title: "Add menu image",
                  fileNamePrefix: "menu-image",
                  fallbackInputRef: menuImagesInputRef,
                  onSelectFile: (file) => handleMenuImagesSelected(file ? [file] : []),
                })
              }
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
            <input
              id="menuImagesInput"
              type="file"
              multiple
              accept={LOCAL_IMAGE_FILE_ACCEPT}
              className="hidden"
              ref={menuImagesInputRef}
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                if (!files.length) return
                debugLog('?? Menu images selected:', files.length, 'files')
                handleMenuImagesSelected(files)
                // Reset input to allow selecting same file again
                e.target.value = ''
              }}
            />
          </div>

          {/* Menu image previews */}
          {!!step2.menuImages.length && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {step2.menuImages.map((file, idx) => {
                // Handle both File objects and URL objects
                let imageUrl = null
                let imageName = `Image ${idx + 1}`

                if (isUploadableFile(file)) {
                  imageUrl = getPreviewImageUrl(file)
                  imageName = file.name || imageName
                } else if (file?.url) {
                  // If it's an object with url property (from backend)
                  imageUrl = file.url
                  imageName = file.name || `Image ${idx + 1}`
                } else if (typeof file === 'string') {
                  // If it's a direct URL string
                  imageUrl = file
                }

                return (
                  <div
                    key={idx}
                    className="relative aspect-4/5 rounded-md overflow-hidden bg-gray-100"
                  >
                    <div className="absolute top-1 right-1 z-30">
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          await handleRemoveMenuImage(idx)
                        }}
                        className="bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`Menu ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-gray-500 px-2 text-center">
                        Preview unavailable
                      </div>
                    )}
                    {isUploadPending(file) && (
                      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-black/40 text-white">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-[10px] font-medium">Uploading...</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1">
                      <p className="text-[10px] text-white truncate">
                        {imageName}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>


        {/* Profile image */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-700">Restaurant profile image</Label>
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-200">
                {step2.profileImage ? (
                  (() => {
                    const imageSrc = getPreviewImageUrl(step2.profileImage)

                    return imageSrc ? (
                      <img
                        src={imageSrc}
                        alt="Restaurant profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-500" />
                    );
                  })()
                ) : (
                  <ImageIcon className="w-6 h-6 text-gray-500" />
                )}
                {isUploadPending(step2.profileImage) && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  </div>
                )}
              </div>
              {step2.profileImage && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await handleRemoveProfileImage()
                  }}
                  className="absolute -top-1 -right-1 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] transition-colors z-10"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex-1 flex-col flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-900">Upload profile image</span>
                <span className="text-[11px] text-gray-500">
                  This will be shown on your listing card and restaurant page.
                </span>
              </div>

            </div>

          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full text-xs"
            disabled={isFieldUploading("profileImage")}
            onClick={() =>
              openImageSourcePicker({
                title: "Upload profile image",
                fileNamePrefix: "profile-image",
                fallbackInputRef: profileImageInputRef,
                onSelectFile: handleProfileImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            id="profileImageInput"
            type="file"
            accept={LOCAL_IMAGE_FILE_ACCEPT}
            className="hidden"
            ref={profileImageInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              if (file) {
                debugLog('?? Profile image selected:', file.name)
                handleProfileImageSelected(file)
              }
              // Reset input to allow selecting same file again
              e.target.value = ''
            }}
          />
        </div>
      </section>

      {/* Operational details */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        {/* Timings with popover time selectors */}
        <div className="space-y-3">
          <Label className="text-xs text-gray-700">Outlet timings</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/*
              The value is always stored. The old handlers returned early when
              validation failed, which threw the user's selection away and made
              the picker look broken. Validation is derived below instead.
            */}
            <TimeField
              label="Opening time"
              value={step2.openingTime || ""}
              invalid={Boolean(outletHours.error)}
              onChange={(val) =>
                setStep2((prev) => ({ ...prev, openingTime: val }))
              }
            />
            <TimeField
              label="Closing time"
              value={step2.closingTime || ""}
              invalid={Boolean(outletHours.error)}
              hint={outletHours.overnight ? "Closes next day" : undefined}
              onChange={(val) =>
                setStep2((prev) => ({ ...prev, closingTime: val }))
              }
            />
          </div>

          {outletHours.error ? (
            <p className="text-xs font-medium text-red-600">{outletHours.error}</p>
          ) : outletHours.valid ? (
            <p className="text-xs text-gray-500">
              {outletHours.overnight ? "Overnight hours — " : ""}
              Open for {formatOpenDuration(step2.openingTime, step2.closingTime)}
            </p>
          ) : null}
          <div>
            <Label className="text-xs text-gray-700">Estimated delivery time*</Label>
            <Input
              value={step2.estimatedDeliveryTime || ""}
              onChange={(e) =>
                setStep2((prev) => ({ ...prev, estimatedDeliveryTime: e.target.value }))
              }
              className="mt-1 bg-white text-sm"
              placeholder="e.g., 25-30 mins"
            />
          </div>
        </div>

        {/* Open days in a calendar-like grid */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-gray-800" />
            <span>Open days</span>
          </Label>
          <p className="text-[11px] text-gray-500">
            Select the days your restaurant accepts delivery orders.
          </p>
          <div className="mt-1 grid grid-cols-7 gap-1.5 sm:gap-2">
            {daysOfWeek.map((day) => {
              const active = step2.openDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`aspect-square flex items-center justify-center rounded-md text-[11px] font-medium ${active ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white" : "bg-gray-100 text-gray-800"
                    }`}
                >
                  {day.charAt(0)}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Takeaway Service Toggle */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4 text-[#2E7D52]" />
              <span>Takeaway (Pickup) order</span>
            </Label>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Enable this to allow customers to pick up orders themselves from your restaurant.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep2(prev => ({ ...prev, isTakeawayEnabled: !prev.isTakeawayEnabled }))}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              step2.isTakeawayEnabled ? "bg-[#2E7D52]" : "bg-gray-200"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                step2.isTakeawayEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

      </section>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">PAN details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-gray-700">PAN number</Label>
            <Input
              value={step3.panNumber || ""}
              onChange={(e) => setStep3({ ...step3, panNumber: normalizePAN(e.target.value) })}
              className="mt-1 bg-white text-sm"
              placeholder="ABCDE1234F"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">PAN Card Holder Name</Label>
            <Input
              value={step3.nameOnPan || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  nameOnPan: sanitizeFullName(e.target.value),
                })
              }
              className="mt-1 bg-white text-sm"
              placeholder="Full name as printed on PAN card"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs text-gray-700">PAN image</Label>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full text-xs"
            disabled={isFieldUploading("panImage")}
            onClick={() =>
              openImageSourcePicker({
                title: "Upload PAN image",
                fileNamePrefix: "pan-image",
                fallbackInputRef: panImageInputRef,
                onSelectFile: handlePanImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            type="file"
            accept={GALLERY_IMAGE_ACCEPT}
            className="hidden"
            ref={panImageInputRef}
            onChange={(e) => {
              handlePanImageSelected(e.target.files?.[0] || null)
              e.target.value = ""
            }}
          />
          {step3.panImage && (
            <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
              {getPreviewImageUrl(step3.panImage) ? (
                <img
                  src={getPreviewImageUrl(step3.panImage)}
                  alt="PAN document"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                  Preview unavailable
                </div>
              )}
              {isUploadPending(step3.panImage) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs font-medium">Uploading...</span>
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void handleRemoveDocumentImage("panImage")
                }}
                className="absolute top-2 right-2 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">GST details</h2>
        <div className="flex gap-4 items-center text-sm">
          <span className="text-gray-700">GST registered?</span>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: true })}
            className={`px-3 py-1.5 text-xs rounded-full ${step3.gstRegistered ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: false })}
            className={`px-3 py-1.5 text-xs rounded-full ${!step3.gstRegistered ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            No
          </button>
        </div>
        {step3.gstRegistered && (
          <div className="space-y-3">
            <Input
              value={step3.gstNumber || ""}
              onChange={(e) => setStep3({ ...step3, gstNumber: normalizeGST(e.target.value) })}
              className="bg-white text-sm"
              placeholder="GST number (15 characters)"
            />
            <Input
              value={step3.gstLegalName || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  gstLegalName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="bg-white text-sm"
              placeholder="Legal name"
            />
            <Input
              value={step3.gstAddress || ""}
              onChange={(e) => setStep3({ ...step3, gstAddress: e.target.value })}
              className="bg-white text-sm"
              placeholder="Registered address"
            />
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              disabled={isFieldUploading("gstImage")}
              onClick={() =>
                openImageSourcePicker({
                  title: "Upload GST image",
                  fileNamePrefix: "gst-image",
                  fallbackInputRef: gstImageInputRef,
                  onSelectFile: handleGstImageSelected,
                })
              }
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
            <input
              type="file"
              accept={GALLERY_IMAGE_ACCEPT}
              className="hidden"
              ref={gstImageInputRef}
              onChange={(e) => {
                handleGstImageSelected(e.target.files?.[0] || null)
                e.target.value = ""
              }}
            />
            {step3.gstImage && (
              <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
                {getPreviewImageUrl(step3.gstImage) ? (
                  <img
                    src={getPreviewImageUrl(step3.gstImage)}
                    alt="GST document"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                    Preview unavailable
                  </div>
                )}
                {isUploadPending(step3.gstImage) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-xs font-medium">Uploading...</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void handleRemoveDocumentImage("gstImage")
                  }}
                  className="absolute top-2 right-2 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">FSSAI details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.fssaiNumber || ""}
            onChange={(e) =>
              setStep3({ ...step3, fssaiNumber: e.target.value.replace(/\D/g, "").slice(0, 14) })
            }
            className="bg-white text-sm"
            placeholder="FSSAI number (14 digits)"
          />
          <div>
            <Label className="text-xs text-gray-700 mb-1 block">FSSAI expiry date</Label>
            <Popover open={isFssaiCalendarOpen} onOpenChange={setIsFssaiCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsFssaiCalendarOpen(true)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md bg-white text-sm text-left flex items-center justify-between hover:bg-gray-50"
                >
                  <span className={step3.fssaiExpiry ? "text-gray-900" : "text-gray-500"}>
                    {step3.fssaiExpiry
                      ? parseLocalYMDDate(step3.fssaiExpiry)?.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                      : "Select expiry date"}
                  </span>
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-100" align="start">
                <div className="bg-white rounded-md shadow-lg border border-gray-200">
                  <Calendar
                    mode="single"
                    selected={parseLocalYMDDate(step3.fssaiExpiry)}
                    disabled={(date) => formatDateToLocalYMD(date) < getTodayLocalYMD()}
                    onSelect={(date) => {
                      if (date && formatDateToLocalYMD(date) >= getTodayLocalYMD()) {
                        const formattedDate = formatDateToLocalYMD(date)
                        setStep3({ ...step3, fssaiExpiry: formattedDate })
                        setIsFssaiCalendarOpen(false)
                      }
                    }}
                    initialFocus
                    classNames={{
                      today: "bg-transparent text-foreground border-none", // Remove today highlight
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full text-xs"
          disabled={isFieldUploading("fssaiImage")}
          onClick={() =>
            openImageSourcePicker({
              title: "Upload FSSAI image",
              fileNamePrefix: "fssai-image",
              fallbackInputRef: fssaiImageInputRef,
              onSelectFile: handleFssaiImageSelected,
            })
          }
        >
          <Upload className="w-4 h-4 mr-1.5" />
          Upload
        </Button>
        <input
          type="file"
          accept={GALLERY_IMAGE_ACCEPT}
          className="hidden"
          ref={fssaiImageInputRef}
          onChange={(e) => {
            handleFssaiImageSelected(e.target.files?.[0] || null)
            e.target.value = ""
          }}
        />
        {step3.fssaiImage && (
          <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
            {getPreviewImageUrl(step3.fssaiImage) ? (
              <img
                src={getPreviewImageUrl(step3.fssaiImage)}
                alt="FSSAI document"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                Preview unavailable
              </div>
            )}
            {isUploadPending(step3.fssaiImage) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs font-medium">Uploading...</span>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void handleRemoveDocumentImage("fssaiImage")
              }}
              className="absolute top-2 right-2 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Bank account details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.accountNumber || ""}
            onChange={(e) => setStep3({ ...step3, accountNumber: normalizeBankAcc(e.target.value) })}
            className="bg-white text-sm"
            placeholder="Account number"
          />
          <Input
            value={step3.confirmAccountNumber || ""}
            onChange={(e) => setStep3({ ...step3, confirmAccountNumber: normalizeBankAcc(e.target.value) })}
            className="bg-white text-sm"
            placeholder="Re-enter account number"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.ifscCode || ""}
            onChange={(e) => setStep3({ ...step3, ifscCode: normalizeIFSC(e.target.value) })}
            className="bg-white text-sm"
            placeholder="IFSC code"
          />
          <Select
            value={step3.accountType || ""}
            onValueChange={(value) => setStep3({ ...step3, accountType: value })}
          >
            <SelectTrigger className="bg-white text-sm">
              <SelectValue placeholder="Select account type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Saving">Saving</SelectItem>
              <SelectItem value="Current">Current</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          value={step3.accountHolderName || ""}
          onChange={(e) =>
            setStep3({
              ...step3,
              accountHolderName: sanitizeFullName(e.target.value),
            })
          }
          className="bg-white text-sm"
          placeholder="Account holder name"
        />
      </section>
    </div>
  )

  const renderStep = () => {
    if (step === 1) return renderStep1()
    if (step === 2) return renderStep2()
    return renderStep3()
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <style dangerouslySetInnerHTML={{ __html: `
        .pac-container {
          background-color: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          border-radius: 16px !important;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08) !important;
          font-family: 'Poppins', sans-serif !important;
          padding: 4px !important;
          margin-top: 6px !important;
          z-index: 999999 !important;
          border-top: 1px solid #e5e7eb !important;
          max-height: 280px !important;
          overflow-y: auto !important;
        }
        /* Customize scrollbar inside pac-container and custom-scrollbar for premium styling */
        .pac-container::-webkit-scrollbar,
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px !important;
        }
        .pac-container::-webkit-scrollbar-track,
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent !important;
        }
        .pac-container::-webkit-scrollbar-thumb,
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #d1d5db !important;
          border-radius: 20px !important;
        }
        .pac-container::-webkit-scrollbar-thumb:hover,
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #9ca3af !important;
        }
        .pac-item {
          padding: 10px 6px !important;
          font-size: 14px !important;
          color: #4b5563 !important;
          border-bottom: 1px solid #f3f4f6 !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          transition: all 0.2s ease !important;
          border-radius: 12px !important;
          margin-bottom: 2px !important;
        }
        .pac-item:last-child {
          border-bottom: none !important;
          margin-bottom: 0 !important;
        }
        .pac-item:hover {
          background-color: #fef2f2 !important;
          color: #dc2626 !important;
        }
        .pac-item-query {
          font-size: 14px !important;
          color: #111827 !important;
          font-weight: 600 !important;
          padding-right: 4px !important;
        }
        .pac-item:hover .pac-item-query {
          color: #dc2626 !important;
        }
        .pac-icon {
          background-image: none !important;
          width: 20px !important;
          height: 20px !important;
          margin-right: 6px !important;
          margin-left: -2px !important;
          margin-top: 0 !important;
          display: inline-block !important;
          position: relative !important;
          flex-shrink: 0 !important;
          background-repeat: no-repeat !important;
        }
        .pac-icon::before {
          content: "" !important;
          position: absolute !important;
          inset: 0 !important;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23DC2626' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E") !important;
          background-size: contain !important;
          background-repeat: no-repeat !important;
        }
        .pac-logo::after {
          margin-right: 12px !important;
          margin-bottom: 6px !important;
          opacity: 0.5 !important;
        }
        .pac-matched {
          color: #dc2626 !important;
          font-weight: 700 !important;
        }
      ` }} />
      {loading ? (
        <OnboardingSkeleton />
      ) : (
        <div className="min-h-screen bg-gray-100 flex flex-col">
          <OnboardingHeader
            title="Restaurant onboarding"
            onBack={step === 1 ? requestExit : handleBack}
            variant={step === 1 ? "close" : "back"}
            actions={(
              <>
              {!isEditing && (
                <Button
                  onClick={() => setIsEditing(true)}
                  variant="outline"
                  size="sm"
                  className="text-xs bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 flex items-center gap-1.5"
                  title="Edit Details"
                >
                  <Sparkles className="w-3 h-3" />
                  Edit Details
                </Button>
              )}
              <div className="flex items-center gap-3">
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider text-right">
                  Step {step} of 3
                </div>
                <Button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-[#2E7D52] hover:text-red-700 hover:bg-red-50"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
              </>
            )}
          />

          <main
            className="flex-1 px-4 sm:px-6 py-4 space-y-4"
            style={{ paddingBottom: keyboardInset ? `${keyboardInset + 20}px` : undefined }}
            onFocusCapture={(e) => {
              const target = e.target
              if (!(target instanceof HTMLElement)) return
              if (!target.matches("input, textarea, select")) return
              window.setTimeout(() => {
                target.scrollIntoView({ behavior: "smooth", block: "center" })
              }, 250)
            }}
          >
            <div className={!isEditing ? "pointer-events-none select-none" : ""}>
              {renderStep()}
            </div>
          </main>

        <ImageSourcePicker
          isOpen={sourcePicker.isOpen}
          onClose={closeImageSourcePicker}
          onFileSelect={sourcePicker.onSelectFile}
          title={sourcePicker.title}
          fileNamePrefix={sourcePicker.fileNamePrefix}
          galleryInputRef={sourcePicker.fallbackInputRef}
        />

        <OnboardingExitModal
          open={showExitModal}
          onStay={handleStay}
          onExit={handleExit}
          theme="restaurant"
        />

        {error && (
          <div className="px-4 sm:px-6 pb-2 text-xs text-[#2E7D52]">
            {error}
          </div>
        )}

        <footer className={`px-4 sm:px-6 py-3 bg-white border-t border-slate-100 ${keyboardInset ? "hidden" : ""}`}>
          <div className={`flex items-center w-full ${step > 1 ? "gap-3" : ""}`}>
            {step > 1 && (
              <Button
                type="button"
                onClick={handleBack}
                disabled={saving}
                className="flex-1 text-base font-bold h-11 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] hover:from-[#c90f49] hover:to-[#7a0024] text-white border-0 shadow-md shadow-[#2E7D52]/20 transition-all active:scale-[0.98]"
              >
                Back
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={saving || (step === 3 && !isEditing)}
              className={`text-base font-bold h-11 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] hover:from-[#c90f49] hover:to-[#7a0024] text-white px-6 shadow-md shadow-[#2E7D52]/20 transition-all active:scale-[0.98] ${step === 1 ? "w-full" : "flex-1"} ${(step === 3 && !isEditing) ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {step === 3 ? (saving ? "Saving..." : "Finish") : saving ? "Saving..." : "Continue"}
            </Button>
          </div>
        </footer>
      </div>
      )}
    </LocalizationProvider>
  )
}










