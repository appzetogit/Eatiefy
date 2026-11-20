import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import Lenis from "lenis"
import { ArrowLeft, Settings, ChevronRight, Clock } from "lucide-react"
import { toast } from "sonner"
import { Switch } from "@food/components/ui/switch"
import { Card, CardContent } from "@food/components/ui/card"
import { restaurantAPI } from "@food/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Button } from "@food/components/ui/button"
import { publishOnlineStatus } from "@food/utils/restaurantOnlineStatus"
import {
  DAY_NAMES,
  getBusinessClock,
  getOperatingStatus,
  timeToMinutes,
  isOvernightWindow,
} from "@food/utils/operatingHours"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const RESTAURANT_ONLINE_STATUS_KEY = "restaurant_online_status"

// Writes the mirror and notifies every mounted listener (Home navbar included).
const persistRestaurantOnlineStatus = (isOnline) => publishOnlineStatus(isOnline)


export default function RestaurantStatus() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useRestaurantBackNavigation()
  const [deliveryStatus, setDeliveryStatus] = useState(false)
  const [takeawayStatus, setTakeawayStatus] = useState(false)
  const [restaurantData, setRestaurantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentDateTime, setCurrentDateTime] = useState(new Date())
  const [isWithinTimings, setIsWithinTimings] = useState(null) // null = not calculated yet
  const [showOutletClosedDialog, setShowOutletClosedDialog] = useState(false)
  const [showOutsideTimingsDialog, setShowOutsideTimingsDialog] = useState(false)
  const [isDayClosed, setIsDayClosed] = useState(false)
  const [outletTimings, setOutletTimings] = useState(null)
  const hasPromptedClosedDialogRef = useRef(false)

  // Update current date/time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentDateTime(new Date())
    }, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [])

  // Fetch restaurant data from backend
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          setRestaurantData(data)
          if (data.takeawaySettings) {
            setTakeawayStatus(data.takeawaySettings.isEnabled)
          }
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
        // Continue with default values if fetch fails
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()
  }, [])

  // Load outlet timings from backend (DB)
  useEffect(() => {
    const loadOutletTimings = () => {
      restaurantAPI
        .getOutletTimings()
        .then((res) => {
          const data = res?.data?.data?.outletTimings || res?.data?.outletTimings
          if (data) setOutletTimings(data)
        })
        .catch((error) => {
          debugError("Error loading outlet timings:", error)
        })
    }

    loadOutletTimings()

    // Listen for outlet timings updates
    window.addEventListener("outletTimingsUpdated", loadOutletTimings)
    
    return () => {
      window.removeEventListener("outletTimingsUpdated", loadOutletTimings)
    }
  }, [])

  // Check if restaurant is currently open based on outlet timings only
  useEffect(() => {
    const checkIfOpen = () => {
      if (!outletTimings) {
        // No outlet timings configured yet
        setIsDayClosed(false)
        setIsWithinTimings(true)
        return
      }

      // Handles overnight shifts carried over from yesterday (e.g. Mon 3 PM -> Tue 3 AM), in IST.
      const status = getOperatingStatus({ timings: outletTimings }, new Date())
      const isClosed = !status.isOpen
      const dayIsClosed = status.reason === "day-closed"

      setIsDayClosed(dayIsClosed)
      setIsWithinTimings(status.isOpen)

      // Issue 32 & 33: If outlet is closed, delivery and takeaway status close automatically
      if (isClosed) {
        if (!hasPromptedClosedDialogRef.current && dayIsClosed) {
          hasPromptedClosedDialogRef.current = true
          setShowOutletClosedDialog(true)
        }

        setDeliveryStatus((prev) => {
          if (prev) {
            restaurantAPI.updateAcceptingOrders(false).catch(() => {})
            persistRestaurantOnlineStatus(false)
          }
          return false
        })

        setTakeawayStatus((prev) => {
          if (prev) {
            restaurantAPI.updateTakeawaySettings({ isEnabled: false }).catch(() => {})
          }
          return false
        })
      }
    }

    checkIfOpen()
    // Recheck every minute
    const interval = setInterval(checkIfOpen, 60000)
    
    // Listen for outlet timings updates
    const handleOutletTimingsUpdate = () => {
      checkIfOpen()
    }
    window.addEventListener("outletTimingsUpdated", handleOutletTimingsUpdate)
    
    return () => {
      clearInterval(interval)
      window.removeEventListener("outletTimingsUpdated", handleOutletTimingsUpdate)
    }
  }, [currentDateTime, outletTimings])

  // Load delivery status from backend
  useEffect(() => {
    const loadDeliveryStatus = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const restaurant = response?.data?.data?.restaurant || response?.data?.restaurant
        if (restaurant) {
          const isClosed = outletTimings
            ? !getOperatingStatus({ timings: outletTimings }, new Date()).isOpen
            : false

          if (isClosed) {
            setDeliveryStatus(false)
            setTakeawayStatus(false)
          } else {
            if (restaurant.isAcceptingOrders !== undefined) {
              setDeliveryStatus(restaurant.isAcceptingOrders)
            } else {
              setDeliveryStatus(false)
            }
            if (restaurant.takeawaySettings) {
              setTakeawayStatus(restaurant.takeawaySettings.isEnabled)
            }
          }
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error loading delivery status:", error)
        }
        setDeliveryStatus(false)
      }
    }

    loadDeliveryStatus()
  }, [outletTimings])

  // Issue 33: Bring restaurant online (open outlet schedule + enable delivery / takeaway)
  const turnRestaurantOnline = async ({ enableDelivery = true, enableTakeaway = null } = {}) => {
    try {
      const { dayIndex, minutes: nowMinutes } = getBusinessClock(new Date())
      const currentDay = DAY_NAMES[dayIndex]
      const currentSchedule = outletTimings?.[currentDay] || {}

      let newOpen = currentSchedule.openingTime || "00:00"
      let newClose = currentSchedule.closingTime || "23:59"

      const openMin = timeToMinutes(newOpen)
      const closeMin = timeToMinutes(newClose)

      if (openMin === null || openMin > nowMinutes) {
        newOpen = "00:00"
      }
      if (closeMin === null || (closeMin <= nowMinutes && !isOvernightWindow(newOpen, newClose))) {
        newClose = "23:59"
      }
      if (newOpen === newClose) {
        newOpen = "00:00"
        newClose = "23:59"
      }

      const updatedTimings = {
        ...(outletTimings || {}),
        [currentDay]: {
          isOpen: true,
          openingTime: newOpen,
          closingTime: newClose,
        },
      }

      // 1. Save outlet timings so the day and hours are open covering now
      await restaurantAPI.saveOutletTimings(updatedTimings)
      setOutletTimings(updatedTimings)
      window.dispatchEvent(new Event("outletTimingsUpdated"))

      // 2. Turn on delivery if requested
      if (enableDelivery) {
        await restaurantAPI.updateAcceptingOrders(true)
        setDeliveryStatus(true)
        persistRestaurantOnlineStatus(true)
      }

      // 3. Turn on takeaway if requested
      if (enableTakeaway !== null) {
        await restaurantAPI.updateTakeawaySettings({ isEnabled: enableTakeaway })
        setTakeawayStatus(enableTakeaway)
      }

      setIsDayClosed(false)
      setIsWithinTimings(true)
      setShowOutletClosedDialog(false)
      setShowOutsideTimingsDialog(false)
      toast.success("Restaurant is now online and receiving orders!")
    } catch (error) {
      debugError("Error turning restaurant online:", error)
      toast.error("Failed to turn restaurant online. Please check outlet timings.")
    }
  }

  // Handle delivery status change
  const handleDeliveryStatusChange = async (checked) => {
    if (!checked) {
      setDeliveryStatus(false)
      try {
        await restaurantAPI.updateAcceptingOrders(false)
        persistRestaurantOnlineStatus(false)
        toast.info("Delivery status turned off")
      } catch (apiError) {
        debugError('Error updating delivery status in backend:', apiError)
        // Revert local toggle if backend fails.
        setDeliveryStatus(true)
        persistRestaurantOnlineStatus(true)
        toast.error("Failed to update delivery status")
      }
      return
    }

    // Checked === true: Turning delivery ON
    // If outlet is closed (e.g. today is off or outside timings), turn restaurant online!
    if (isDayClosed || isWithinTimings === false) {
      await turnRestaurantOnline({ enableDelivery: true })
      return
    }

    setDeliveryStatus(true)
    try {
      await restaurantAPI.updateAcceptingOrders(true)
      persistRestaurantOnlineStatus(true)
      toast.success("Receiving orders enabled")
    } catch (apiError) {
      debugError('Error updating delivery status in backend:', apiError)
      setDeliveryStatus(false)
      persistRestaurantOnlineStatus(false)
      toast.error("Failed to update delivery status")
    }
  }

  // Handle takeaway status change
  const handleTakeawayStatusChange = async (checked) => {
    if (!checked) {
      setTakeawayStatus(false)
      try {
        await restaurantAPI.updateTakeawaySettings({ isEnabled: false })
        toast.info("Takeaway status turned off")
      } catch (error) {
        debugError("Error saving takeaway status:", error)
        setTakeawayStatus(true)
        toast.error("Failed to update takeaway status")
      }
      return
    }

    // Checked === true: Turning takeaway ON
    // If outlet is closed, bring it online and enable takeaway
    if (isDayClosed || isWithinTimings === false) {
      await turnRestaurantOnline({ enableDelivery: deliveryStatus, enableTakeaway: true })
      return
    }

    setTakeawayStatus(true)
    try {
      await restaurantAPI.updateTakeawaySettings({ isEnabled: true })
      toast.success("Pickup orders enabled")
    } catch (error) {
      debugError("Error saving takeaway status:", error)
      setTakeawayStatus(false)
      toast.error("Failed to update takeaway status")
    }
  }

  // Handle dialog close and navigate to outlet timings
  const handleGoToOutletTimings = () => {
    setShowOutletClosedDialog(false)
    navigate("/food/restaurant/outlet-timings", { state: { from: location.pathname } })
  }

  // Format time from 24-hour to 12-hour format
  const formatTime12Hour = (time24) => {
    if (!time24) return ""
    const [hours, minutes] = time24.split(':').map(Number)
    const period = hours >= 12 ? 'pm' : 'am'
    const hours12 = hours % 12 || 12
    const minutesStr = minutes.toString().padStart(2, '0')
    return `${hours12}:${minutesStr} ${period}`
  }

  // Format current date and time
  const formatCurrentDateTime = () => {
    const now = currentDateTime
    const dateStr = now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
    return `${dateStr}, ${timeStr}`
  }

  // Get delivery timings for current day (outlet timings only)
  const getCurrentDayTimings = () => {
    if (!outletTimings) return null

    // Single source of truth: outlet timings. During yesterday's overnight
    // spill-over this is yesterday's shift, since that is the one running.
    const status = getOperatingStatus({ timings: outletTimings }, new Date())
    if (status.reason === "day-closed" || !status.openingTime || !status.closingTime) return null

    return {
      openingTime: formatTime12Hour(status.openingTime),
      closingTime: `${formatTime12Hour(status.closingTime)}${status.overnight ? " (next day)" : ""}`
    }
  }

  // Format address
  const formatAddress = (location) => {
    if (!location) return ""
    const parts = []
    if (location.area) parts.push(location.area.trim())
    if (location.city) parts.push(location.city.trim())
    return parts.join(", ") || ""
  }

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

  return (
    <div className="min-h-screen bg-gray-100 overflow-x-hidden">
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
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">Restaurant status</h1>
            <p className="text-sm text-gray-500 mt-0.5">You are mapped to 1 restaurant</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 py-6">
        {/* Restaurant Information Card */}
        <Card className="bg-gray-50 border-none py-0 shadow-sm rounded-b-none rounded-t-lg">
          <CardContent className="p-4 gap-6 flex flex-col">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-gray-900 mb-1">
                  {loading ? "Loading..." : (restaurantData?.name || "Restaurant")}
                </h2>
                <p className="text-sm text-gray-500">
                  {loading ? "Loading..." : (
                    <>
                      {restaurantData?.id ? `ID: ${String(restaurantData.id).slice(-5)}` : ""}
                      {restaurantData?.location && formatAddress(restaurantData.location) ? (
                        <> | {formatAddress(restaurantData.location)}</>
                      ) : ""}
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => {
                  // Navigate to restaurant settings
                  navigate("/food/restaurant/explore", { state: { from: location.pathname } })
                }}
                className="ml-3 p-2 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors shrink-0"
                aria-label="Explore more"
              >
                <Settings className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-base font-bold text-gray-900 mb-1.5">Delivery status</p>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${deliveryStatus ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                <p className="text-sm text-gray-500">
                  {deliveryStatus ? 'Receiving orders' : 'Not receiving orders'}
                </p>
              </div>
            </div>
            <Switch
              checked={deliveryStatus}
              onCheckedChange={handleDeliveryStatusChange}
              className="ml-4 data-[state=unchecked]:bg-gray-300 data-[state=checked]:bg-green-600"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-base font-bold text-gray-900 mb-1.5">Takeaway status</p>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${takeawayStatus ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                <p className="text-sm text-gray-500">
                  {takeawayStatus ? 'Pickup orders are enabled' : 'Pickup orders are disabled'}
                </p>
              </div>
            </div>
            <Switch
              checked={takeawayStatus}
              onCheckedChange={handleTakeawayStatusChange}
              className="ml-4 data-[state=unchecked]:bg-gray-300 data-[state=checked]:bg-green-600"
            />
          </div>

          <p className="text-sm text-gray-700 mb-2">Current delivery slot</p>
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-gray-900">
              {loading ? "Loading..." : (
                (() => {
                  // If current day is closed, show "Today is Off"
                  if (isDayClosed) {
                    return "Today is Off"
                  }
                  const timings = getCurrentDayTimings()
                  if (timings) {
                    const dateStr = currentDateTime.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
                    return `${dateStr}, ${timings.openingTime} - ${timings.closingTime}`
                  }
                  return "Not configured"
                })()
              )}
            </p>
            {!isDayClosed && (
              <button
                onClick={() => navigate("/food/restaurant/outlet-timings", { state: { from: location.pathname } })}
                className="flex items-center gap-1 text-[#2E7D52] hover:text-blue-700 text-sm font-medium"
              >
                Details
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>

          

          </CardContent>
        </Card>

  {/* Warning Message - Only show if outside timings AND day is not closed */}
  {!isWithinTimings && restaurantData && !isDayClosed && (
        <div className="bg-pink-50 rounded-b-lg rounded-t-none p-4 flex items-start gap-3">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-white text-xs font-bold">!</span>
          </div>
          <p className="text-sm text-gray-700 flex-1">
            You are currently outside your scheduled delivery timings.
          </p>
        </div>
      )}

      {/* Outlet Closed Dialog */}
      <Dialog open={showOutletClosedDialog} onOpenChange={setShowOutletClosedDialog}>
        <DialogContent className="sm:max-w-md p-4 w-[90%] gap-2 flex flex-col">
          <DialogHeader className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
              <Clock className="w-8 h-8 text-amber-600" />
            </div>
            <DialogTitle className="text-lg font-semibold text-gray-900 text-center">
              Outlet Timings Closed
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-gray-600 text-center">
              Your outlet is currently closed according to outlet timings. You can turn online now to start receiving orders, or customize outlet timings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => setShowOutletClosedDialog(false)}
              variant="outline"
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleGoToOutletTimings}
              variant="outline"
              className="w-full sm:w-auto"
            >
              Go to Outlet Timings
            </Button>
            <Button
              onClick={() => turnRestaurantOnline({ enableDelivery: true, enableTakeaway: true })}
              className="w-full sm:w-auto bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] hover:bg-emerald-700 text-white"
            >
              Turn Online
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Outside Timings Dialog */}
      <Dialog open={showOutsideTimingsDialog} onOpenChange={setShowOutsideTimingsDialog}>
        <DialogContent className="sm:max-w-md p-4 w-[90%] gap-2 flex flex-col">
          <DialogHeader className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
              <Clock className="w-8 h-8 text-amber-600" />
            </div>
            <DialogTitle className="text-lg font-semibold text-gray-900 text-center">
              Outside Delivery Timings
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-gray-600 text-center">
              You are currently outside your scheduled delivery timings. Turn online now to start receiving orders, or change outlet timings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => setShowOutsideTimingsDialog(false)}
              variant="outline"
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowOutsideTimingsDialog(false)
                navigate("/food/restaurant/outlet-timings", { state: { from: location.pathname } })
              }}
              variant="outline"
              className="w-full sm:w-auto"
            >
              Change Outlet Timings
            </Button>
            <Button
              onClick={() => turnRestaurantOnline({ enableDelivery: true, enableTakeaway: true })}
              className="w-full sm:w-auto bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] hover:bg-emerald-700 text-white"
            >
              Turn Online
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      </div>
    </div>
  )
}








