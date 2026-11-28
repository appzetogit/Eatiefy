import { useState, useEffect, useRef } from "react"
import { fetchAuthoritativeOnlineStatus } from "@food/utils/restaurantOnlineStatus"
import TimeField from "@food/components/restaurant/TimeField"
import { DAY_NAMES, getTimeRangeError } from "@food/utils/operatingHours"
import { isOvernightRange, formatOpenDuration, normalizeTimeValue } from "@food/utils/outletHours"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import Lenis from "lenis"
import { ArrowLeft, ChevronUp, ChevronDown, Clock, Edit2 } from "lucide-react"
import { Switch } from "@food/components/ui/switch"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { restaurantAPI } from "@food/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// Shape only — real hours always come from the backend, never from hardcoded defaults.
const getEmptyDays = () =>
  Object.fromEntries(DAY_NAMES.map((day) => [day, { isOpen: true, openingTime: "", closingTime: "" }]))

/** Why an open day cannot be saved yet, or "" when it is valid (overnight included). */
const getDayIssue = (dayData) => {
  if (!dayData?.isOpen) return ""
  if (!dayData.openingTime || !dayData.closingTime) return "Select both opening and closing time"
  return getTimeRangeError(dayData.openingTime, dayData.closingTime)
}

export default function OutletTimings() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [expandedDay, setExpandedDay] = useState("Monday")
  const isInternalUpdate = useRef(false)
  const [days, setDays] = useState(getEmptyDays)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // Times a day had before it was switched off, so switching it back on restores them.
  const lastTimesRef = useRef({})
  const saveTimerRef = useRef(null)
  // Latest edits that have not reached the backend yet (flushed on leave).
  const daysRef = useRef(days)
  daysRef.current = days
  const hasPendingSaveRef = useRef(false)
  // Skip the first post-load render so we don't overwrite DB with synthetic defaults.
  const allowAutosaveRef = useRef(false)

  // Load from backend on mount.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        setLoadFailed(false)
        allowAutosaveRef.current = false
        const res = await restaurantAPI.getOutletTimings()
        const outletTimings = res?.data?.data?.outletTimings || res?.data?.outletTimings
        if (!outletTimings || typeof outletTimings !== "object") throw new Error("Missing outlet timings")
        if (mounted) {
          setDays({ ...getEmptyDays(), ...outletTimings })
          // Enable autosave on the next tick after state settles.
          setTimeout(() => {
            allowAutosaveRef.current = true
          }, 0)
        }
      } catch (error) {
        debugError("Error loading outlet timings from backend:", error)
        // Never autosave placeholder rows over the stored schedule.
        if (mounted) setLoadFailed(true)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [reloadKey])

  const persistDays = async (snapshot) => {
    hasPendingSaveRef.current = false
    try {
      await restaurantAPI.saveOutletTimings(snapshot)
      window.dispatchEvent(new Event("outletTimingsUpdated"))
      // Closing (or reopening) a day can flip the outlet online/offline, so
      // re-resolve the authoritative status and broadcast it to Home.
      await fetchAuthoritativeOnlineStatus().catch(() => {})
    } catch (error) {
      hasPendingSaveRef.current = true
      debugError("Error saving outlet timings to backend:", error)
    }
  }

  // Save to backend whenever days change (debounced) — only after user edits.
  useEffect(() => {
    if (loading || loadFailed || !allowAutosaveRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    // Hold the save while any open day is incomplete or invalid (shown inline).
    if (Object.values(days).some((d) => getDayIssue(d))) return
    hasPendingSaveRef.current = true
    saveTimerRef.current = setTimeout(() => {
      void persistDays(days)
    }, 500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [days, loading, loadFailed])

  // Leaving the page inside the 500ms debounce window used to cancel the timer
  // and silently drop the change, so Home kept showing the old status. Flush it.
  useEffect(() => {
    const flushPendingSave = () => {
      if (!hasPendingSaveRef.current || loadFailed) return
      const snapshot = daysRef.current
      if (Object.values(snapshot).some((d) => getDayIssue(d))) return
      void persistDays(snapshot)
    }
    window.addEventListener("pagehide", flushPendingSave)
    return () => {
      window.removeEventListener("pagehide", flushPendingSave)
      flushPendingSave()
    }
  }, [loadFailed])

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

  const toggleDay = (day) => {
    setExpandedDay(expandedDay === day ? null : day)
  }

  const toggleDayOpen = (day) => {
    allowAutosaveRef.current = true
    isInternalUpdate.current = true
    setDays(prev => {
      const current = prev[day]
      const newOpen = !current.isOpen
      if (!newOpen) {
        if (current.openingTime && current.closingTime) {
          lastTimesRef.current[day] = { openingTime: current.openingTime, closingTime: current.closingTime }
        }
        return { ...prev, [day]: { ...current, isOpen: false, openingTime: "", closingTime: "" } }
      }
      // Reopen with this day's previous hours, else another open day's hours,
      // else leave empty for the restaurant to pick.
      const source =
        lastTimesRef.current[day] ||
        DAY_NAMES.map((d) => prev[d]).find((d) => d?.isOpen && d.openingTime && d.closingTime) ||
        {}
      return {
        ...prev,
        [day]: {
          ...current,
          isOpen: true,
          openingTime: source.openingTime || "",
          closingTime: source.closingTime || ""
        }
      }
    })
  }

  const handleTimeChange = (day, timeType, newTime) => {
    if (!newTime) {
      debugWarn('?? No time value received in handleTimeChange')
      return
    }
    
    allowAutosaveRef.current = true
    isInternalUpdate.current = true
    // TimeField emits a canonical "HH:mm" string (the old MUI picker gave a Date).
    const timeString = normalizeTimeValue(newTime)
    
    // Validate time string format
    if (!timeString || !timeString.includes(":")) {
      debugWarn('?? Invalid time string generated:', timeString)
      return
    }
    
    debugLog(`?? Time changed for ${day} - ${timeType}: ${timeString}`)
    
    setDays(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [timeType]: timeString
      }
    }))
  }

  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-600">Loading outlet timings...</div>
      </div>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-white overflow-x-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <button
              onClick={goBack}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-6 h-6 text-gray-900" />
            </button>
            <h1 className="text-lg font-bold text-gray-900">Outlet timings</h1>
          </div>
        </div>

        {/* Main Content */}
        <div className="px-4 py-6">
          {loadFailed ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Could not load your outlet timings. Changes will not be saved until they load.{" "}
              <button type="button" className="font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>
                Retry
              </button>
            </div>
          ) : null}
          {/* Eatiefy delivery Section Header */}
          <div className="mb-6">
            <div className="text-center mb-2">
              <h2 className="text-base font-semibold text-[#2E7D52]">{companyName} delivery</h2>
            </div>
            <div className="h-0.5 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F]"></div>
          </div>

          {/* Day-wise Accordion */}
          <div className="space-y-2">
            {dayNames.map((day, index) => {
              const dayData = days[day] || getEmptyDays()[day]
              const dayIssue = getDayIssue(dayData)
              const isExpanded = expandedDay === day

              return (
                <motion.div
                  key={day}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  className="bg-white border border-gray-200 rounded-sm overflow-hidden"
                >
                  {/* Day Header */}
                  <div
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-color transition-all ${isExpanded ? "bg-gray-100" : ""}`}
                  >
                    <button
                      onClick={() => toggleDay(day)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-700" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-700" />
                      )}
                      <span className="text-base font-medium text-gray-900">{day}</span>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-700">{dayData.isOpen ? "Open" : "Close"}</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={dayData.isOpen}
                          onCheckedChange={() => toggleDayOpen(day)}
                          className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-gray-300"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-4 border-t border-gray-100">
                          {dayData.isOpen ? (
                            <>
                              <TimeField
                                label="Opening time"
                                value={dayData.openingTime}
                                invalid={Boolean(dayIssue && dayData.openingTime && dayData.closingTime)}
                                onChange={(val) => handleTimeChange(day, "openingTime", val)}
                              />

                              <TimeField
                                label="Closing time"
                                value={dayData.closingTime}
                                invalid={Boolean(dayIssue && dayData.openingTime && dayData.closingTime)}
                                hint={isOvernightRange(dayData.openingTime, dayData.closingTime) ? "Closes next day" : undefined}
                                onChange={(val) => handleTimeChange(day, "closingTime", val)}
                              />

                              {dayIssue ? (
                                <p className="text-xs text-red-600">
                                  {dayIssue}. Changes are not saved until fixed.
                                </p>
                              ) : isOvernightRange(dayData.openingTime, dayData.closingTime) ? (
                                <p className="text-xs text-gray-500">
                                  Overnight — open for {formatOpenDuration(dayData.openingTime, dayData.closingTime)}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <p className="text-sm text-gray-500 pl-6">This day is closed</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}








