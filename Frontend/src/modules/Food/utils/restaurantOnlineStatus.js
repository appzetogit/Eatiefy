import { restaurantAPI } from "@food/api"
import { DAY_NAMES, getBusinessClock, getOperatingStatus } from "@food/utils/operatingHours"

/**
 * One source of truth for "is this outlet online right now".
 *
 * The status shown on Restaurant Home used to come straight from a localStorage
 * mirror that only the Status toggle ever wrote. Anything else that changed the
 * real state — outlet timings closing the day, another device, an admin change
 * — left Home showing a stale value until a full reload.
 *
 * Effective status = `isAcceptingOrders` (the stored switch) AND the outlet
 * being within today's configured timings. localStorage is kept purely as a
 * first-paint hint; the backend is always re-read and wins.
 */

export const RESTAURANT_ONLINE_STATUS_KEY = "restaurant_online_status"
export const RESTAURANT_STATUS_EVENT = "restaurantStatusChanged"
export const OUTLET_TIMINGS_EVENT = "outletTimingsUpdated"

/** Last-known value, for instant paint before the network answers. */
export const readCachedOnlineStatus = () => {
  try {
    const raw = localStorage.getItem(RESTAURANT_ONLINE_STATUS_KEY)
    if (raw === null) return null
    return Boolean(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeCachedOnlineStatus = (isOnline) => {
  try {
    localStorage.setItem(RESTAURANT_ONLINE_STATUS_KEY, JSON.stringify(Boolean(isOnline)))
  } catch {
    // Private mode / quota — the network value still drives the UI.
  }
}

/**
 * Records the new status and tells every mounted listener about it.
 * Call this from anywhere that changes the outlet's online state.
 */
export const publishOnlineStatus = (isOnline) => {
  const value = Boolean(isOnline)
  writeCachedOnlineStatus(value)
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(RESTAURANT_STATUS_EVENT, { detail: { isOnline: value } })
    )
  }
  return value
}

/**
 * True when `now` falls inside the weekly outlet timings, including an
 * overnight shift that started the previous day (evaluated in IST).
 * No timings at all means hours are not enforced.
 */
export const isWithinOutletTimings = (outletTimings, now = new Date()) => {
  if (!outletTimings) return true
  return getOperatingStatus({ timings: outletTimings }, now).isOpen
}

export const getTodayTimings = (outletTimings, now = new Date()) => {
  if (!outletTimings) return null
  return outletTimings[DAY_NAMES[getBusinessClock(now).dayIndex]] || null
}

/**
 * Effective online state from the stored inputs. `operatingStatus` is the
 * backend-computed state and wins; local evaluation is only the fallback.
 */
export const resolveOnlineStatus = (
  { isAcceptingOrders, outletTimings, operatingStatus } = {},
  now = new Date()
) => {
  if (!isAcceptingOrders) return false
  if (typeof operatingStatus?.isOpen === "boolean") return operatingStatus.isOpen
  return isWithinOutletTimings(outletTimings, now)
}

let lastKnownTransitionAt = null

/**
 * ISO instant when the outlet timings next flip open/closed (e.g. an overnight
 * shift closing at 03:00), from the last authoritative read. Null when unknown
 * or when hours are not enforced.
 */
export const getNextOperatingTransitionAt = () => lastKnownTransitionAt

/**
 * Re-reads the authoritative state and publishes it.
 * `refreshCurrentRestaurant` deliberately bypasses the 15s profile cache, so a
 * status change made moments ago is never masked by a stale cached response.
 */
let statusRequestSeq = 0
let latestStatusRequest = null

/**
 * Concurrent callers (Home mounting while a timings save is still finishing,
 * the status toggle, a tab refocus) each fire a read. Responses can come back
 * out of order, and a slower, older read used to publish its stale value last.
 * Only the newest request may publish; older ones just resolve to its result.
 */
export const fetchAuthoritativeOnlineStatus = () => {
  const seq = ++statusRequestSeq
  const request = readAuthoritativeOnlineStatus(seq)
  latestStatusRequest = request
  return request
}

const readAuthoritativeOnlineStatus = async (seq) => {
  const [profileRes, timingsRes] = await Promise.allSettled([
    restaurantAPI.refreshCurrentRestaurant(),
    restaurantAPI.getOutletTimings(),
  ])

  // A newer read started while this one was in flight: let it decide.
  if (seq !== statusRequestSeq) return latestStatusRequest

  if (profileRes.status !== "fulfilled") {
    // Network trouble: keep showing what we last knew rather than flipping to
    // a value we cannot vouch for.
    return readCachedOnlineStatus()
  }

  const restaurant =
    profileRes.value?.data?.data?.restaurant || profileRes.value?.data?.restaurant || null
  const timingsData =
    timingsRes.status === "fulfilled"
      ? timingsRes.value?.data?.data || timingsRes.value?.data || null
      : null

  const operatingStatus = timingsData?.operatingStatus || null
  lastKnownTransitionAt =
    (operatingStatus?.isOpen ? operatingStatus.closesAt : operatingStatus?.opensAt) || null

  const isOnline = resolveOnlineStatus({
    isAcceptingOrders: restaurant?.isAcceptingOrders !== false && Boolean(restaurant),
    outletTimings: timingsData?.outletTimings || null,
    operatingStatus,
  })

  return publishOnlineStatus(isOnline)
}

/**
 * Subscribes to every way the status can change: an explicit publish, an outlet
 * timings save, and another tab writing the mirror. Returns an unsubscribe fn.
 */
export const subscribeToOnlineStatus = (onChange) => {
  if (typeof window === "undefined") return () => {}

  const handleStatusEvent = (event) => {
    onChange(Boolean(event?.detail?.isOnline), "status")
  }
  // A timings change can flip the effective status, but the event carries no
  // value — re-read the authoritative state instead of guessing.
  const handleTimingsEvent = () => {
    onChange(null, "timings")
  }
  const handleStorage = (event) => {
    if (event.key !== RESTAURANT_ONLINE_STATUS_KEY) return
    onChange(readCachedOnlineStatus(), "storage")
  }

  window.addEventListener(RESTAURANT_STATUS_EVENT, handleStatusEvent)
  window.addEventListener(OUTLET_TIMINGS_EVENT, handleTimingsEvent)
  window.addEventListener("storage", handleStorage)

  return () => {
    window.removeEventListener(RESTAURANT_STATUS_EVENT, handleStatusEvent)
    window.removeEventListener(OUTLET_TIMINGS_EVENT, handleTimingsEvent)
    window.removeEventListener("storage", handleStorage)
  }
}
