import { api, restaurantAPI } from "@food/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export const getOnboardingStorageKey = () => {
    try {
      const userStr = localStorage.getItem("restaurant_user")
      if (userStr) {
        const user = JSON.parse(userStr)
        const userId = user._id || user.id
        if (userId) return `restaurant_onboarding_data_${userId}`
      }
    } catch (e) {}
    return "restaurant_onboarding_data"
}
const ONBOARDING_STORAGE_KEY = getOnboardingStorageKey()

// Helper function to check if a step is complete
const isStepComplete = (stepData, stepNumber) => {
  if (!stepData) return false

  if (stepNumber === 1) {
    return (
      stepData.restaurantName &&
      (Boolean(stepData.foodType) || typeof stepData.pureVegRestaurant === "boolean") &&
      stepData.ownerName &&
      stepData.ownerEmail &&
      stepData.ownerPhone &&
      stepData.primaryContactNumber &&
      stepData.location?.area &&
      stepData.location?.city
    )
  }

  if (stepNumber === 2) {
    return (
      Array.isArray(stepData.cuisines) &&
      stepData.cuisines.length > 0 &&
      stepData.deliveryTimings?.openingTime &&
      stepData.deliveryTimings?.closingTime &&
      Array.isArray(stepData.openDays) &&
      stepData.openDays.length > 0 &&
      // Check for menu images (must have at least one)
      Array.isArray(stepData.menuImageUrls) &&
      stepData.menuImageUrls.length > 0 &&
      // Check for profile image
      stepData.profileImageUrl &&
      (stepData.profileImageUrl.url || typeof stepData.profileImageUrl === 'string')
    )
  }

  if (stepNumber === 3) {
    const hasPanImage = stepData.pan?.image && 
      (stepData.pan.image.url || typeof stepData.pan.image === 'string')
    const hasFssaiImage = stepData.fssai?.image && 
      (stepData.fssai.image.url || typeof stepData.fssai.image === 'string')
    // GST image is required only if GST is registered
    const hasGstImage = !stepData.gst?.isRegistered || 
      (stepData.gst?.image && (stepData.gst.image.url || typeof stepData.gst.image === 'string'))
    
    return (
      stepData.pan?.panNumber &&
      stepData.pan?.nameOnPan &&
      hasPanImage &&
      stepData.fssai?.registrationNumber &&
      hasFssaiImage &&
      hasGstImage &&
      stepData.bank?.accountNumber &&
      stepData.bank?.ifscCode &&
      stepData.bank?.accountHolderName &&
      stepData.bank?.accountType
    )
  }

  return false
}

const buildOnboardingLikeDataFromRestaurant = (restaurant) => {
  const onboarding = restaurant?.onboarding || {}

  const openingTime =
    restaurant?.openingTime ||
    restaurant?.deliveryTimings?.openingTime ||
    onboarding?.step2?.deliveryTimings?.openingTime
  const closingTime =
    restaurant?.closingTime ||
    restaurant?.deliveryTimings?.closingTime ||
    onboarding?.step2?.deliveryTimings?.closingTime

  return {
    completedSteps: onboarding.completedSteps,
    step1: onboarding.step1 || {
      restaurantName: restaurant?.restaurantName || restaurant?.name,
      foodType:
        restaurant?.foodType ||
        (restaurant?.pureVegRestaurant === true ? "Veg" : restaurant?.pureVegRestaurant === false ? "Mixed" : null),
      pureVegRestaurant:
        typeof restaurant?.pureVegRestaurant === "boolean"
          ? restaurant.pureVegRestaurant
          : null,
      ownerName: restaurant?.ownerName,
      ownerEmail: restaurant?.ownerEmail || restaurant?.email,
      ownerPhone: restaurant?.ownerPhone || restaurant?.phone,
      primaryContactNumber: restaurant?.primaryContactNumber,
      location:
        restaurant?.location ||
        (restaurant?.area || restaurant?.city || restaurant?.addressLine1
          ? {
              addressLine1: restaurant?.addressLine1,
              addressLine2: restaurant?.addressLine2,
              area: restaurant?.area,
              city: restaurant?.city,
              landmark: restaurant?.landmark,
            }
          : null),
    },
    step2: onboarding.step2 || {
      cuisines: restaurant?.cuisines,
      deliveryTimings:
        restaurant?.deliveryTimings ||
        (openingTime || closingTime ? { openingTime, closingTime } : null),
      openDays: restaurant?.openDays,
      menuImageUrls: restaurant?.menuImages,
      profileImageUrl: restaurant?.profileImage,
    },
    step3:
      onboarding.step3 ||
      (restaurant?.panNumber ||
      restaurant?.fssaiNumber ||
      restaurant?.accountNumber ||
      restaurant?.ifscCode
        ? {
            pan: {
              panNumber: restaurant?.panNumber,
              nameOnPan: restaurant?.nameOnPan,
              image: restaurant?.panImage,
            },
            gst: {
              isRegistered: Boolean(restaurant?.gstRegistered),
              gstNumber: restaurant?.gstNumber,
              legalName: restaurant?.gstLegalName,
              address: restaurant?.gstAddress,
              image: restaurant?.gstImage,
            },
            fssai: {
              registrationNumber: restaurant?.fssaiNumber,
              expiryDate: restaurant?.fssaiExpiry,
              image: restaurant?.fssaiImage,
            },
            bank: {
              accountNumber: restaurant?.accountNumber,
              ifscCode: restaurant?.ifscCode,
              accountHolderName: restaurant?.accountHolderName,
              accountType: restaurant?.accountType,
            },
          }
        : null),
  }
}

export const isRestaurantOnboardingComplete = (restaurant) => {
  if (!restaurant) return false

  // Approved or Pending restaurants should never be forced into onboarding again.
  // 'pending' means they have completed the registration but are waiting for admin approval.
  if (restaurant?.status === "approved" || restaurant?.status === "pending") {
    return true
  }

  // If they have a restaurant ID, they are definitely past the initial onboarding steps.
  if (restaurant?.restaurantId || restaurant?._id) {
    // If they have a restaurantId, they must have completed step 1 (Basic Details) 
    // and likely the rest. We use this as a defensive check to prevent loops.
    return true
  }

  if (restaurant?.isActive === true) {
    return true
  }

  const onboardingLikeData = buildOnboardingLikeDataFromRestaurant(restaurant)
  if (onboardingLikeData.completedSteps === 4) {
    return true
  }

  const step1Complete = isStepComplete(onboardingLikeData.step1, 1)
  const step2Complete = isStepComplete(onboardingLikeData.step2, 2)
  const step3Complete = isStepComplete(onboardingLikeData.step3, 3)

  if (step1Complete && step2Complete && step3Complete) {
    return true
  }

  // Some older or migrated restaurant accounts have complete live profile data
  // without a reliable onboarding.completedSteps value.
  const hasOperationalProfile =
    Boolean(String(restaurant?.name || "").trim()) &&
    Boolean(String(restaurant?.restaurantId || "").trim()) &&
    Boolean(String(restaurant?.slug || "").trim()) &&
    step1Complete &&
    step2Complete &&
    (restaurant?.approvedAt || restaurant?.rejectedAt || restaurant?.rejectionReason || restaurant?.isActive === false)

  if (hasOperationalProfile) {
    return true
  }

  return false
}

// Determine which step to show based on completeness
export const determineStepToShow = (data) => {
  if (!data) return 1

  // If completedSteps is 4, onboarding is complete (admin-created restaurants)
  if (data.completedSteps === 4) {
    return null
  }

  // Check step 1
  if (!isStepComplete(data.step1, 1)) {
    return 1
  }

  // Check step 2
  if (!isStepComplete(data.step2, 2)) {
    return 2
  }

  // Check step 3
  if (!isStepComplete(data.step3, 3)) {
    return 3
  }

  // All steps complete
  return null
}

// Check onboarding status from API and return the step to navigate to
export const checkOnboardingStatus = async () => {
  try {
    const restaurantResponse = await restaurantAPI.getMe()
    const restaurant =
      restaurantResponse?.data?.data?.user ||
      restaurantResponse?.data?.data?.restaurant ||
      restaurantResponse?.data?.restaurant ||
      restaurantResponse?.data?.user ||
      null

    if (restaurant && isRestaurantOnboardingComplete(restaurant)) {
      return null
    }

    const res = await api.get("/restaurant/onboarding")
    const data = res?.data?.data?.onboarding
    if (data) {
      const stepToShow = determineStepToShow(data)
      return stepToShow
    }
    // No onboarding data, start from step 1
    return 1
  } catch (err) {
    debugError("❌ checkOnboardingStatus error:", err)
    // If API call fails, check localStorage as a fallback
    try {
      const localData = localStorage.getItem(getOnboardingStorageKey())
      if (localData) {
        const parsed = JSON.parse(localData)
        return parsed.currentStep || 1
      }
    } catch (e) {
      debugError("❌ checkOnboardingStatus localStorage error:", e)
    }
    
    // Default to null on failure to prevent accidental redirection loops
    // when the network is unstable or API is down.
    return null
  }
}



export const clearOnboardingFromLocalStorage = () => {
  try {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (
        k &&
        (k.startsWith("restaurant_onboarding_data") ||
          k.startsWith("restaurant_pending") ||
          k === "restaurant_registrationToken" ||
          k === ONBOARDING_STORAGE_KEY)
      ) {
        keysToRemove.push(k)
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))
  } catch (e) {
    debugError("Failed to clear onboarding localStorage:", e)
  }
  try {
    localStorage.setItem("restaurant_onboarding_photos_cleared", "true")
  } catch (e) {}
}

export const hasRestaurantStep1Progress = (step1 = {}) => {
  const location = step1.location || {}
  const scalarFields = [
    step1.restaurantName,
    step1.ownerName,
    step1.ownerEmail,
    step1.primaryContactNumber,
    step1.zoneId,
    location.formattedAddress,
    location.addressLine1,
    location.addressLine2,
    location.area,
    location.city,
    location.state,
    location.pincode,
    location.landmark,
    location.latitude,
    location.longitude,
  ]

  if (scalarFields.some((value) => String(value || "").trim())) {
    return true
  }

  return Boolean(step1.foodType) || typeof step1.pureVegRestaurant === "boolean"
}

export const clearAllFilesFromDB = async () => {
  try {
    if (typeof indexedDB === "undefined") return Promise.resolve(true)
    const ONBOARDING_FILES_DB = "RestaurantOnboardingFiles"
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(ONBOARDING_FILES_DB)
      request.onsuccess = () => resolve(true)
      request.onerror = (e) => {
        console.error("Database deletion error", e)
        resolve(false)
      }
      request.onblocked = () => {
        resolve(false)
      }
    })
  } catch (err) {
    console.error("Failed to delete IndexedDB database", err)
    return Promise.resolve(false)
  }
}
