/**
 * Single normalizer for the restaurant/outlet profile returned by
 * `restaurantAPI.refreshCurrentRestaurant()` (`data.data.restaurant`).
 *
 * Outlet Info (view) and Edit Owner (edit) both read that one endpoint, so they
 * both map it through here. Previously only Edit mode mapped the full payload,
 * which is why saved values existed but were invisible until you opened Edit.
 */

export const ALL_CUISINES = [
  "Burger",
  "Chinese",
  "Momos",
  "North Indian",
  "Pizza",
  "Rolls",
  "Sandwich",
  "Shawarma",
  "South Indian",
  "Biryani",
  "Desserts",
  "Ice Cream",
  "Fast Food",
  "Cafe",
  "Italian",
  "Mexican",
  "Thai",
  "Seafood",
  "Salad",
  "Healthy Food",
  "Juices",
  "Beverages",
  "Punjabi",
  "Gujarati",
  "Rajasthani",
  "Mughlai",
  "Street Food",
  "Bakery",
]

export const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Image fields arrive as a URL string or an `{ url, publicId }` object. */
export const toImageUrl = (field) => {
  if (!field) return null
  if (typeof field === "string") return field
  if (field.url) return field.url
  return null
}

const toDigits10 = (value) => String(value || "").replace(/\D/g, "").slice(-10)

/**
 * Values may arrive as a real array, or as a single comma-joined string, and
 * with inconsistent casing. Split, trim, and snap back to the canonical label.
 */
const normalizeTagList = (value, canonical) => {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",").map((s) => s.trim()) : entry))
    .filter(Boolean)
    .map((entry) => canonical.find((c) => c.toLowerCase() === String(entry).toLowerCase()) || entry)
}

const normalizeLocation = (loc = {}) => ({
  formattedAddress: loc.formattedAddress || loc.address || "",
  addressLine1: loc.addressLine1 || "",
  addressLine2: loc.addressLine2 || "",
  area: loc.area || "",
  city: loc.city || "Indore",
  state: loc.state || "Madhya Pradesh",
  pincode: loc.pincode || "",
  landmark: loc.landmark || "",
  latitude:
    loc.latitude != null && loc.latitude !== ""
      ? String(loc.latitude)
      : Array.isArray(loc.coordinates)
        ? String(loc.coordinates[1] ?? "")
        : "",
  longitude:
    loc.longitude != null && loc.longitude !== ""
      ? String(loc.longitude)
      : Array.isArray(loc.coordinates)
        ? String(loc.coordinates[0] ?? "")
        : "",
})

/**
 * Normalizes the API payload into the flat shape both screens use.
 * Returns null for a missing payload so callers can keep their loading state.
 */
export function normalizeRestaurantProfile(apiData) {
  if (!apiData || typeof apiData !== "object") return null

  const menuImages = Array.isArray(apiData.menuImages)
    ? apiData.menuImages.map((m) => (typeof m === "string" ? m : m?.url || "")).filter(Boolean)
    : []

  return {
    ownerName: apiData.ownerName || "",
    ownerEmail: apiData.ownerEmail || "",
    ownerPhone: toDigits10(apiData.ownerPhone),
    profileImage: toImageUrl(apiData.profileImage),

    restaurantName: apiData.restaurantName || apiData.name || "",
    foodType: apiData.pureVegRestaurant ? "Veg" : (apiData.foodType || "Mixed"),
    pureVegRestaurant: apiData.foodType === "Veg" || Boolean(apiData.pureVegRestaurant),
    pureVeganRestaurant: false,
    primaryContactNumber: toDigits10(apiData.primaryContactNumber),
    zoneId: apiData.zoneId ? String(apiData.zoneId) : "",
    location: normalizeLocation(apiData.location || {}),
    cuisines: normalizeTagList(apiData.cuisines, ALL_CUISINES),
    openingTime: apiData.openingTime || "",
    closingTime: apiData.closingTime || "",
    openDays: normalizeTagList(apiData.openDays, DAYS_OF_WEEK),
    estimatedDeliveryTime: apiData.estimatedDeliveryTime || "",
    takeawaySettings: {
      isEnabled: apiData.takeawaySettings?.isEnabled === true || apiData.isTakeawayEnabled === true,
      payAtPickupEnabled: apiData.takeawaySettings?.payAtPickupEnabled === true,
    },
    isTakeawayEnabled: apiData.takeawaySettings?.isEnabled === true || apiData.isTakeawayEnabled === true,

    panNumber: apiData.panNumber || "",
    nameOnPan: apiData.nameOnPan || "",
    panImage: toImageUrl(apiData.panImage),
    accountNumber: apiData.accountNumber || "",
    ifscCode: apiData.ifscCode || "",
    accountHolderName: apiData.accountHolderName || "",
    accountType: apiData.accountType || "Saving",
    gstRegistered: Boolean(apiData.gstRegistered),
    gstNumber: apiData.gstNumber || "",
    gstLegalName: apiData.gstLegalName || "",
    gstAddress: apiData.gstAddress || "",
    gstImage: toImageUrl(apiData.gstImage),

    fssaiNumber: apiData.fssaiNumber || "",
    fssaiExpiry: apiData.fssaiExpiry ? String(apiData.fssaiExpiry).split("T")[0] : "",
    fssaiImage: toImageUrl(apiData.fssaiImage),
    menuImages,
  }
}

/** Masks all but the last 4 digits of an account number for read-only display. */
export const maskAccountNumber = (value) => {
  const digits = String(value || "").trim()
  if (!digits) return ""
  if (digits.length <= 4) return digits
  return `${"•".repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`
}
