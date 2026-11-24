import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { createAppSocket } from "@food/api/socketClient"
import { FileText, Calendar, Package } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import OrdersTopbar from "@food/components/admin/orders/OrdersTopbar"
import OrdersTable from "@food/components/admin/orders/OrdersTable"
import FilterPanel from "@food/components/admin/orders/FilterPanel"
import ViewOrderDialog from "@food/components/admin/orders/ViewOrderDialog"
import SettingsDialog from "@food/components/admin/orders/SettingsDialog"
import RefundModal from "@food/components/admin/orders/RefundModal"
import { useOrdersManagement } from "@food/components/admin/orders/useOrdersManagement"
import { Loader2 } from "lucide-react"
import { OrdersDashboardSkeleton, TableSkeleton } from "@food/components/ui/loading-skeletons"
import { refreshSidebarBadges } from "@food/components/admin/AdminSidebar"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"
import { useAdminBadgeListRefresh } from "@food/hooks/useAdminBadgeListRefresh"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"
const alertSound = "/assets/media/alert.mp3"
const originalSound = "/assets/media/original.mp3"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }


// Status configuration with titles, colors, and icons
const statusConfig = {
  "all": { title: "All Orders", color: "emerald", icon: FileText },
  "scheduled": { title: "Scheduled Orders", color: "blue", icon: Calendar },
  "pending": { title: "Pending Orders", color: "amber", icon: Package },
  "accepted": { title: "Accepted Orders", color: "green", icon: Package },
  "processing": { title: "Processing Orders", color: "orange", icon: Package },
  "food-on-the-way": { title: "Food On The Way Orders", color: "amber", icon: Package },
  "delivered": { title: "Delivered Orders", color: "emerald", icon: Package },
  "canceled": { title: "Canceled Orders", color: "rose", icon: Package },
  "restaurant-cancelled": { title: "Restaurant Cancelled Orders", color: "red", icon: Package },
  "payment-failed": { title: "Payment Failed Orders", color: "red", icon: Package },
  "refunded": { title: "Refunded Orders", color: "sky", icon: Package },
  "offline-payments": { title: "Offline Payments", color: "slate", icon: Package },
}

export default function OrdersPage({ statusKey = "all" }) {
  const { canEdit } = useAdminPermissions()
  const config = statusConfig[statusKey] || statusConfig["all"]
  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_orders_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalOrders, setTotalOrders] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [processingRefund, setProcessingRefund] = useState(null)
  const [processingActionOrderId, setProcessingActionOrderId] = useState(null)
  const [actionLoadingType, setActionLoadingType] = useState(null) // 'accept' | 'reject'
  const [deletingOrderId, setDeletingOrderId] = useState(null)
  const [refundModalOpen, setRefundModalOpen] = useState(false)
  const [selectedOrderForRefund, setSelectedOrderForRefund] = useState(null)
  const seenOrderIdsRef = useRef(new Set())
  const isFirstLoadRef = useRef(true)
  const fallbackAudioRef = useRef(null)
  const notificationAudioRef = useRef(null)
  const audioContextRef = useRef(null)
  const audioUnlockedRef = useRef(false)
  const socketRef = useRef(null)
  const recentRealtimeOrderRef = useRef(new Map())
  const activeOrderAlertRef = useRef(null)
  const alertLoopTimerRef = useRef(null)
  const alertLoopStartedAtRef = useRef(0)
  const lastSidebarBadgeRefreshAtRef = useRef(0)
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()
  // Query of the newest fetch; a response for any other query (e.g. the zone the
  // admin just switched away from) is dropped instead of overwriting the list.
  const latestQueryKeyRef = useRef("")
  const ALERT_LOOP_INTERVAL_MS = 4500
  const ALERT_LOOP_MAX_MS = 120000

  const resolveAudioSource = useCallback((source, cacheKey = "admin-alert") => {
    if (!source) return source
    if (!import.meta.env.DEV) return source
    const separator = source.includes("?") ? "&" : "?"
    return `${source}${separator}devcache=${cacheKey}`
  }, [])

  const playDeliveryStyleBuzz = useCallback(async () => {
    const selectedSound = localStorage.getItem("delivery_alert_sound") || "zomato_tone"
    const soundFile = selectedSound === "original"
      ? resolveAudioSource(originalSound, "admin-original")
      : resolveAudioSource(alertSound, "admin-alert")

    try {
      if (!notificationAudioRef.current) {
        notificationAudioRef.current = new Audio(soundFile)
        notificationAudioRef.current.preload = "auto"
        notificationAudioRef.current.volume = 1
      } else if (!notificationAudioRef.current.src.includes(soundFile.split("/").pop())) {
        notificationAudioRef.current.pause()
        notificationAudioRef.current.src = soundFile
        notificationAudioRef.current.load()
      }

      if (typeof window !== "undefined" && window.__userHasInteracted && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate([200, 100, 200, 100, 300])
        } catch (_) { }
      }

      notificationAudioRef.current.muted = false
      notificationAudioRef.current.volume = 1
      notificationAudioRef.current.currentTime = 0
      await notificationAudioRef.current.play()
      return true
    } catch (_) {
      return false
    }
  }, [resolveAudioSource])

  const playDefaultRing = useCallback(() => {
    playDeliveryStyleBuzz().then((played) => {
      if (played) return

      try {
        if (!fallbackAudioRef.current) {
          fallbackAudioRef.current = new Audio(alertSound)
          fallbackAudioRef.current.preload = "auto"
          fallbackAudioRef.current.volume = 1
        }

        fallbackAudioRef.current.muted = false
        fallbackAudioRef.current.volume = 1
        fallbackAudioRef.current.currentTime = 0
        fallbackAudioRef.current.play().catch(() => { })
      } catch (_) { }

      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioCtx()
        }
        const ctx = audioContextRef.current
        const playWithContext = async () => {
          if (ctx.state === "suspended") {
            await ctx.resume()
          }

          const beep = (startAt, frequency = 880, duration = 0.2) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "sine"
            osc.frequency.value = frequency
            gain.gain.value = 0.0001
            osc.connect(gain)
            gain.connect(ctx.destination)

            const start = ctx.currentTime + startAt
            osc.start(start)
            gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
            osc.stop(start + duration + 0.02)
          }

          beep(0, 880, 0.2)
          beep(0.26, 880, 0.2)
          beep(0.52, 988, 0.26)

          setTimeout(() => {
            if (ctx.state === "running") {
              ctx.suspend().catch(() => { })
            }
          }, 1200)
        }
        playWithContext().catch(async () => {
          if (fallbackAudioRef.current) {
            fallbackAudioRef.current.currentTime = 0
            await fallbackAudioRef.current.play()
          }
        })
        return
      }
    }).catch((error) => {
      debugWarn("Ring sound could not be played:", error)
    })
  }, [playDeliveryStyleBuzz])

  const stopAlertLoop = useCallback(() => {
    if (alertLoopTimerRef.current) {
      clearInterval(alertLoopTimerRef.current)
      alertLoopTimerRef.current = null
    }
    alertLoopStartedAtRef.current = 0
  }, [])

  // Fully stop the new-order alert (sound + loop). Called when an order is
  // accepted/rejected by admin, or accepted by the restaurant.
  const stopOrderAlert = useCallback(() => {
    activeOrderAlertRef.current = null
    stopAlertLoop()
  }, [stopAlertLoop])

  const startAlertLoop = useCallback(() => {
    stopAlertLoop()
    alertLoopStartedAtRef.current = Date.now()

    alertLoopTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - alertLoopStartedAtRef.current
      if (elapsed >= ALERT_LOOP_MAX_MS || !activeOrderAlertRef.current) {
        stopAlertLoop()
        return
      }

      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        playDefaultRing()
      }
    }, ALERT_LOOP_INTERVAL_MS)
  }, [playDefaultRing, stopAlertLoop])

  const showBrowserNotification = useCallback(async (title, body, tag) => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return
    if (Notification.permission !== "granted") return

    try {
      const options = {
        body,
        tag: tag || undefined,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [200, 100, 200, 100, 300],
        icon: "/assets/images/favicon.png",
        data: { targetUrl: "/admin/orders/all" },
      }

      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()
        if (registration) {
          await registration.showNotification(title, options)
          return
        }
      }

      const notification = new Notification(title, options)
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    } catch (_) { }
  }, [])

  // Unlock audio on first user gesture so rings can play reliably later
  useEffect(() => {
    const unlockAudio = async () => {
      if (audioUnlockedRef.current) return

      try {
        if (!fallbackAudioRef.current) {
          fallbackAudioRef.current = new Audio(alertSound)
          fallbackAudioRef.current.preload = "auto"
          fallbackAudioRef.current.volume = 1
        }

        if (!notificationAudioRef.current) {
          const selectedSound = localStorage.getItem("delivery_alert_sound") || "zomato_tone"
          const soundFile = selectedSound === "original"
            ? resolveAudioSource(originalSound, "admin-original")
            : resolveAudioSource(alertSound, "admin-alert")
          notificationAudioRef.current = new Audio(soundFile)
          notificationAudioRef.current.preload = "auto"
          notificationAudioRef.current.volume = 1
        }

        // Play 100% silent 1-sample dummy audio to unlock HTMLAudioElement media pipeline
        try {
          const silentAudio = new Audio(
            "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA"
          )
          await silentAudio.play()
          silentAudio.pause()
        } catch (_) { }

        // Prime WebAudio permission
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if (AudioCtx && !audioContextRef.current) {
          audioContextRef.current = new AudioCtx()
        }
        if (audioContextRef.current?.state === "suspended") {
          await audioContextRef.current.resume()
        }
        if (audioContextRef.current?.state === "running") {
          await audioContextRef.current.suspend()
        }

        audioUnlockedRef.current = true
      } catch {
        // Ignore unlock errors; we'll retry on next gesture implicitly
      }
    }

    window.addEventListener("pointerdown", unlockAudio, { passive: true })
    window.addEventListener("keydown", unlockAudio)
    window.addEventListener("touchstart", unlockAudio, { passive: true })
    document.addEventListener("click", unlockAudio, { passive: true })
    document.addEventListener("touchstart", unlockAudio, { passive: true })

    return () => {
      window.removeEventListener("pointerdown", unlockAudio)
      window.removeEventListener("keydown", unlockAudio)
      window.removeEventListener("touchstart", unlockAudio)
      document.removeEventListener("click", unlockAudio)
      document.removeEventListener("touchstart", unlockAudio)
    }
  }, [])

  useEffect(() => {
    return () => {
      stopAlertLoop()
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => { })
      }
      if (notificationAudioRef.current) {
        notificationAudioRef.current.pause()
        notificationAudioRef.current = null
      }
    }
  }, [stopAlertLoop])

  useEffect(() => {
    if (statusKey !== "all") return
    if (typeof window === "undefined" || typeof Notification === "undefined") return
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => { })
    }
  }, [statusKey])

  const normalizedOrders = useMemo(() => {
    const safeOrders = Array.isArray(orders) ? orders : []

    return safeOrders.filter(Boolean).map((order) => {
      const createdAtRaw = order.createdAt || order.created_at || order.orderDate || null
      const createdAtCandidate = createdAtRaw ? new Date(createdAtRaw) : null
      const createdAt =
        createdAtCandidate && !Number.isNaN(createdAtCandidate.getTime())
          ? createdAtCandidate
          : null
      const date = createdAt
        ? createdAt.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        }).toUpperCase()
        : ""
      const time = createdAt
        ? createdAt.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: "Asia/Kolkata",
        }).toUpperCase()
        : ""

      const pricing = order.pricing || {}
      const subtotal = Number(pricing.subtotal || 0)
      let baseSubtotal = Number(
        pricing.baseSubtotal != null ? pricing.baseSubtotal : NaN,
      )
      let markupTotal = Math.max(0, Number(pricing.markupTotal || 0))
      const deliveryFee = Number(pricing.deliveryFee || 0)
      const platformFee = Number(pricing.platformFee || 0)
      const taxAmount = Number(pricing.tax || 0)
      const discountAmount = Number(pricing.discount || 0)
      const computedTotal = subtotal + deliveryFee + platformFee + taxAmount - discountAmount
      const totalAmount = Number(
        pricing.total != null ? pricing.total : computedTotal
      )

      const paymentMethod = order.payment?.method || order.paymentMethod || order.payment?.paymentMethod || ""
      let paymentType = order.paymentType
      if (!paymentType) {
        if (paymentMethod === "cash" || paymentMethod === "cod" || paymentMethod === "cash on delivery") paymentType = "Cash on Delivery"
        else if (paymentMethod === "wallet") paymentType = "Wallet"
        else if (paymentMethod) paymentType = "Online"
        else paymentType = "N/A"
      }

      const backendStatus = String(order.orderStatus || "").toLowerCase()
      const method = String(paymentMethod).toLowerCase();
      const hasRazorpayId = !!(order.payment?.razorpay_payment_id || order.payment?.razorpayPaymentId);
      const isQrPayment = method === "razorpay_qr" || method === "qr" || (method === "cod" && hasRazorpayId) || (method === "cash" && hasRazorpayId);

      let paymentStatus = order.paymentStatus
      if (paymentStatus === "Collected") paymentStatus = "Paid"
      if (paymentStatus === "Not Collected") paymentStatus = "COD Pending"
      const paymentStatusRaw = order.payment?.status || ""
      const s = String(paymentStatusRaw || "").toLowerCase()
      if (s === "refunded") paymentStatus = "Refunded"
      else if (s === "paid" || s === "authorized" || s === "captured" || s === "settled") paymentStatus = "Paid"
      else if (s === "failed") paymentStatus = "Failed"
      else if (s === "cod_pending") paymentStatus = "COD Pending"
      else if (s === "awaiting_pickup_payment") paymentStatus = "Awaiting Pickup Payment"
      else if (isQrPayment && s !== "cod_pending" && s !== "pending") paymentStatus = "Paid"
      else if (!paymentStatus) paymentStatus = "Pending"

      // Method detail for COD orders as requested by user
      let paymentMethodDetail = "COD"
      if (isQrPayment) {
        paymentMethodDetail = "COD/QR"
      } else if (method === "wallet") {
        paymentMethodDetail = "Wallet"
      } else if (method !== "cash" && method !== "cod" && method !== "cash on delivery" && method !== "") {
        paymentMethodDetail = "Online"
      }


      let displayStatus = order.orderStatus
      if (!backendStatus || backendStatus === "created") {
        displayStatus = "Pending"
      } else if (backendStatus === "confirmed") {
        displayStatus = "Accepted"
      } else if (backendStatus === "preparing") {
        displayStatus = "Processing"
      } else if (backendStatus === "ready_for_pickup" || backendStatus === "reached_pickup") {
        displayStatus = "Ready for Pickup"
      } else if (backendStatus === "picked_up" || backendStatus === "reached_drop") {
        displayStatus = "Food On The Way"
      } else if (backendStatus === "delivered") {
        displayStatus = "Delivered"
      } else if (backendStatus === "cancelled_by_restaurant") {
        displayStatus = "Cancelled by Restaurant"
      } else if (backendStatus === "cancelled_by_user") {
        displayStatus = "Cancelled by User"
      } else if (backendStatus === "cancelled_by_admin") {
        displayStatus = "Canceled"
      }

      const dp = order.dispatch?.deliveryPartnerId
      const deliveryPartnerName =
        order.deliveryPartnerName ||
        dp?.name ||
        ""
      const deliveryPartnerPhone =
        order.deliveryPartnerPhone ||
        dp?.phone ||
        ""

      const items = Array.isArray(order.items)
        ? order.items.map((item) => {
          const selling = Number(item.price || item.variantPrice || 0) || 0
          let base =
            item.basePrice != null && Number.isFinite(Number(item.basePrice))
              ? Number(item.basePrice)
              : null
          let markup =
            item.markupAmount != null && Number.isFinite(Number(item.markupAmount))
              ? Math.max(0, Number(item.markupAmount))
              : 0

          if (!(markup > 0) && base != null && selling > base + 0.01) {
            markup = Math.round((selling - base) * 100) / 100
          }

          // Recover base when older orders stored selling price in both fields
          if (
            (base == null || Math.abs(base - selling) < 0.01) &&
            markup <= 0
          ) {
            const type = String(item.appliedPricingType || "").toUpperCase()
            const value = Number(item.appliedPricingValue)
            if (type === "FIXED" && value > 0 && selling > value) {
              base = Math.round((selling - value) * 100) / 100
              markup = value
            } else if (type === "PERCENTAGE" && value > 0) {
              base = Math.round((selling / (1 + value / 100)) * 100) / 100
              markup = Math.round((selling - base) * 100) / 100
            }
          }

          if (base == null) base = selling

          return {
            quantity: item.quantity || 1,
            name: item.name || item.foodName || item.title || "Item",
            price: selling,
            basePrice: base,
            markupAmount: markup,
            otherPrice: item.otherPrice != null ? item.otherPrice : selling,
            pricingScope: item.pricingScope || item.pricingRule?.scope || null,
            appliedPricingType: item.appliedPricingType || null,
            appliedPricingValue: item.appliedPricingValue ?? null,
            variantName: item.variantName || item.variant || item.selectedVariant?.name || "",
            variantId: item.variantId || item.selectedVariant?.id || "",
            isVeg: item.isVeg,
            description: item.description || "",
            addons: item.addons || item.addOns || [],
          }
        })
        : []

      if (!Number.isFinite(baseSubtotal) || baseSubtotal < 0) {
        baseSubtotal = items.reduce((sum, item) => {
          const qty = Number(item.quantity || 1) || 1
          return sum + Number(item.basePrice || 0) * qty
        }, 0)
      }
      if (!(markupTotal > 0)) {
        markupTotal = items.reduce((sum, item) => {
          const qty = Number(item.quantity || 1) || 1
          return sum + Number(item.markupAmount || 0) * qty
        }, 0)
      }
      if (!(markupTotal > 0) && subtotal > baseSubtotal + 0.01) {
        markupTotal = Math.round((subtotal - baseSubtotal) * 100) / 100
      }

      const customerName = order.customerName || order.userId?.name || "N/A"
      const customerPhone = order.customerPhone || order.userId?.phone || "N/A"
      const customerId =
        order.customerId ||
        order.userId?._id ||
        order.userId?.id ||
        (typeof order.userId === "string" ? order.userId : null)
      const restaurant =
        order.restaurant ||
        order.restaurantName ||
        order.restaurantId?.restaurantName ||
        ""

      return {
        ...order,
        id: order._id || order.id,
        orderId: order.orderId || order.id,
        date,
        time,
        customerName,
        customerPhone,
        customerId,
        restaurant,
        items,
        subtotal,
        baseSubtotal,
        markupTotal,
        totalItemAmount: subtotal,
        couponDiscount: discountAmount,
        itemDiscount: 0,
        deliveryCharge: deliveryFee,
        vatTax: taxAmount,
        platformFee,
        totalAmount,
        paymentType,
        paymentStatus,
        paymentMethodDetail,
        orderStatus: displayStatus,
        deliveryPartnerName,
        deliveryPartnerPhone,
        deliveryType:
          order.orderType === "takeaway"
            ? "Take Away"
            : order.orderType === "dining"
              ? "Dining"
              : order.deliveryType || "Home Delivery",
        orderOtp: order.deliveryOtp,
        address: order.address || order.customerAddress || order.deliveryAddress,
        refundStatus: order.payment?.refund?.status || (order.payment?.status === 'refunded' ? 'processed' : null)
      }
    })
  }, [orders])

  const {
    searchQuery: _ignoredSearchQuery,
    setSearchQuery: _ignoredSetSearchQuery,
    isFilterOpen,
    setIsFilterOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isViewOrderOpen,
    setIsViewOrderOpen,
    selectedOrder,
    setSelectedOrder,
    filters,
    setFilters,
    visibleColumns,
    filteredOrders,
    count,
    activeFiltersCount,
    restaurants,
    handleApplyFilters,
    handleResetFilters,
    handleExport,
    handleViewOrder,
    handlePrintOrder,
    toggleColumn,
    resetColumns,
  } = useOrdersManagement(normalizedOrders, statusKey, config.title, {
    serverSideSearch: true,
    searchQuery,
    setSearchQuery,
  })

  const fetchOrders = useCallback(async (options = {}) => {
    const { silent = false, withRingCheck = false } = options
    const params = {
      page: currentPage,
      limit: pageSize,
      status:
        statusKey === "all"
          ? undefined
          : statusKey === "restaurant-cancelled"
            ? "cancelled"
            : statusKey,
      cancelledBy: statusKey === "restaurant-cancelled" ? "restaurant" : undefined,
      zoneId: zoneId || undefined,
      search: debouncedSearch || undefined,
      restaurantId: filters.restaurant || undefined,
      startDate: filters.fromDate || undefined,
      endDate: filters.toDate || undefined,
      minAmount: filters.minAmount || undefined,
      maxAmount: filters.maxAmount || undefined,
    }
    const queryKey = JSON.stringify(params)
    latestQueryKeyRef.current = queryKey
    const isCurrentQuery = () => latestQueryKeyRef.current === queryKey

    try {
      if (!silent) setIsLoading(true)

      const response = await adminAPI.getOrders(params)
      if (!isCurrentQuery()) return

      const payload = response?.data?.data || response?.data || {}
      const rawOrders =
        payload?.orders ??
        payload?.docs ??
        payload?.data ??
        (Array.isArray(payload) ? payload : [])
      const nextOrders = Array.isArray(rawOrders) ? rawOrders : []
      const meta = payload?.meta || payload?.pagination || {}
      const nextTotal = Number(meta.total ?? payload?.total ?? nextOrders.length) || 0

      if (response.data?.success) {
        const nextOrderIds = new Set(
          nextOrders
            .map((order) => order.id || order._id || order.orderId)
            .filter(Boolean),
        )

        // A zone-filtered list does not show other zones' orders, so it cannot tell
        // whether the alert (which rings for every zone) is still needed.
        if (statusKey === "all" && !zoneId) {
          // If no order is still pending (created), there is nothing to alert about —
          // stop any ongoing alert (e.g. after restaurant/admin accepted the order).
          const hasPendingOrder = nextOrders.some((order) => {
            const status = String(order.orderStatus || order.status || "").toLowerCase()
            return !status || status === "created" || status === "pending"
          })
          if (!hasPendingOrder) {
            stopOrderAlert()
          }
        }

        let detectedNewOrder = false
        if (withRingCheck && !isFirstLoadRef.current && statusKey === "all" && currentPage === 1) {
          detectedNewOrder = [...nextOrderIds].some(
            (id) => !seenOrderIdsRef.current.has(id),
          )
          if (detectedNewOrder) {
            activeOrderAlertRef.current = { orderId: "polling-new-order" }
            playDefaultRing()
            startAlertLoop()
            if (typeof document !== "undefined" && document.visibilityState === "hidden") {
              showBrowserNotification(
                "New order received",
                "A new order arrived",
                `admin-order-poll-${Date.now()}`,
              )
            }
            toast.info("New order received")
          }
        }

        seenOrderIdsRef.current = nextOrderIds
        isFirstLoadRef.current = false
        setOrders(nextOrders)
        setTotalOrders(nextTotal)

        if (detectedNewOrder) {
          const now = Date.now()
          if (now - lastSidebarBadgeRefreshAtRef.current >= 20000) {
            lastSidebarBadgeRefreshAtRef.current = now
            refreshSidebarBadges(undefined, { reloadNotifications: false })
          }
        }
      } else {
        debugError("Failed to fetch orders:", response.data)
        if (!silent) toast.error("Failed to fetch orders")
        setOrders([])
        setTotalOrders(0)
      }
    } catch (error) {
      debugError("Error fetching orders:", error)
      if (!isCurrentQuery()) return
      const status = Number(error?.response?.status || 0)
      if (!silent && status !== 429) {
        toast.error(error.response?.data?.message || "Failed to fetch orders")
      }
      if (!silent && status !== 429) {
        setOrders([])
        setTotalOrders(0)
      }
    } finally {
      if (!silent && isCurrentQuery()) setIsLoading(false)
    }
  }, [statusKey, currentPage, pageSize, zoneId, debouncedSearch, filters, playDefaultRing, showBrowserNotification, startAlertLoop, stopOrderAlert])

  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchQuery.trim()
      setDebouncedSearch((prev) => {
        if (prev !== next) {
          // Reset to first page when the effective search term changes
          setTimeout(() => setCurrentPage(1), 0)
        }
        return next
      })
    }, 350)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
    setSearchQuery("")
    setDebouncedSearch("")
    isFirstLoadRef.current = true
    seenOrderIdsRef.current = new Set()
  }, [statusKey])

  // A new zone is a different list: start from page 1, and forget the order ids
  // seen in the previous zone so they are not mistaken for new orders.
  useEffect(() => {
    setCurrentPage(1)
    isFirstLoadRef.current = true
    seenOrderIdsRef.current = new Set()
  }, [zoneId])

  useEffect(() => {
    fetchOrders({ silent: false, withRingCheck: false })
  }, [fetchOrders])


  useEffect(() => {
    const handleScroll = () => {
      if (typeof document !== "undefined") {
        const mainElement = document.querySelector("main")
        if (mainElement) {
          mainElement.scrollTop = 0
        }
      }
    }
    handleScroll()
    const timer = setTimeout(handleScroll, 100)
    return () => clearTimeout(timer)
  }, [statusKey])

  useEffect(() => {
    const pollId = setInterval(() => {
      fetchOrders({ silent: true, withRingCheck: true })
    }, 10000)

    return () => clearInterval(pollId)
  }, [fetchOrders])

  // Auto-refresh orders list when sidebar badge count changes
  useAdminBadgeListRefresh("orders", () => fetchOrders({ silent: true, withRingCheck: false }), [fetchOrders])

  useEffect(() => {
    const socket = createAppSocket({
      role: "admin",
      label: "AdminOrdersPage",
    })
    if (!socket) return undefined
    socketRef.current = socket

    const handleIncomingRealtimeOrder = (payload = {}) => {
      const orderId = payload?.orderId || payload?.orderMongoId || ""
      if (!orderId) {
        activeOrderAlertRef.current = payload || { orderId: "socket-new-order" }
        playDefaultRing()
        startAlertLoop()
        toast.info("New order received")
        showBrowserNotification(
          "New order received",
          "A new order arrived",
          `admin-order-socket-${Date.now()}`,
        )
        fetchOrders({ silent: true, withRingCheck: false })
        return
      }

      const now = Date.now()
      const lastHandledAt = recentRealtimeOrderRef.current.get(orderId) || 0
      if (now - lastHandledAt < 8000) return
      recentRealtimeOrderRef.current.set(orderId, now)

      const title = "New order received"
      const body = payload?.restaurantName
        ? `${payload.restaurantName} • ${orderId}`
        : `Order ${orderId}`

      activeOrderAlertRef.current = payload || { orderId }
      playDefaultRing()
      startAlertLoop()
      toast.info(title, { description: body })
      showBrowserNotification(title, body, `admin-order-${orderId}`)
      fetchOrders({ silent: true, withRingCheck: false })
    }

    // When an order leaves the pending state (restaurant/admin accepted, or it
    // was cancelled), stop the admin-side new-order alert and update the list.
    const handleOrderStatusUpdate = (payload = {}) => {
      const status = String(payload?.orderStatus || payload?.status || "").toLowerCase()
      if (status && status !== "created" && status !== "pending") {
        stopOrderAlert()
      }
      fetchOrders({ silent: true, withRingCheck: false })
    }

    socket.on("connect", () => {
      socket.emit("join-admin-orders")
    })
    socket.on("admin_new_order", handleIncomingRealtimeOrder)
    socket.on("new_order", handleIncomingRealtimeOrder)
    socket.on("play_notification_sound", handleIncomingRealtimeOrder)
    socket.on("order_status_update", handleOrderStatusUpdate)

    return () => {
      socket.off("admin_new_order", handleIncomingRealtimeOrder)
      socket.off("new_order", handleIncomingRealtimeOrder)
      socket.off("play_notification_sound", handleIncomingRealtimeOrder)
      socket.off("order_status_update", handleOrderStatusUpdate)
      socket.disconnect()
      socketRef.current = null
    }
  }, [fetchOrders, playDefaultRing, showBrowserNotification, startAlertLoop, stopOrderAlert])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === "undefined") return
      if (document.visibilityState !== "hidden") return
      if (!activeOrderAlertRef.current) return

      playDefaultRing()
      showBrowserNotification(
        "New order received",
        "A new order arrived",
        `admin-order-hidden-${Date.now()}`,
      )
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [playDefaultRing, showBrowserNotification])

  const [searchParams] = useSearchParams()
  const orderIdFromUrl = searchParams.get("orderId")

  useEffect(() => {
    if (orderIdFromUrl && normalizedOrders.length > 0) {
      const order = normalizedOrders.find(o => o.id === orderIdFromUrl || o._id === orderIdFromUrl || o.orderId === orderIdFromUrl)
      if (order) {
        handleViewOrder(order)
      }
    }
  }, [orderIdFromUrl, normalizedOrders, handleViewOrder])

  const handleAcceptOrder = async (order) => {
    const orderIdToUse = order.id || order._id || order.orderId
    if (!orderIdToUse) {
      toast.error("Order ID not found")
      return
    }

    try {
      setProcessingActionOrderId(order.id || order.orderId)
      setActionLoadingType('accept')
      // Admin acted on the order — stop the new-order alert immediately.
      stopOrderAlert()
      const response = await adminAPI.acceptOrder(orderIdToUse)
      if (response.data?.success) {
        refreshSidebarBadges("orders")
        toast.success(response.data?.message || `Order ${order.orderId} accepted`)
        await fetchOrders({ silent: true, withRingCheck: false })
      } else {
        toast.error(response.data?.message || "Failed to accept order")
      }
    } catch (error) {
      debugError("Error accepting order:", error)
      toast.error(error.response?.data?.message || "Failed to accept order")
    } finally {
      setProcessingActionOrderId(null)
      setActionLoadingType(null)
    }
  }

  const handleRejectOrder = async (order) => {
    const orderIdToUse = order.id || order._id || order.orderId
    if (!orderIdToUse) {
      toast.error("Order ID not found")
      return
    }

    const reason = prompt(
      `Enter rejection reason for order ${order.orderId}:`,
      "Order rejected by admin",
    )

    if (reason === null) return

    try {
      setProcessingActionOrderId(order.id || order.orderId)
      setActionLoadingType('reject')
      // Admin acted on the order — stop the new-order alert immediately.
      stopOrderAlert()
      const response = await adminAPI.rejectOrder(orderIdToUse, reason)
      if (response.data?.success) {
        refreshSidebarBadges("orders")
        toast.success(response.data?.message || `Order ${order.orderId} rejected`)
        await fetchOrders({ silent: true, withRingCheck: false })
      } else {
        toast.error(response.data?.message || "Failed to reject order")
      }
    } catch (error) {
      debugError("Error rejecting order:", error)
      toast.error(error.response?.data?.message || "Failed to reject order")
    } finally {
      setProcessingActionOrderId(null)
      setActionLoadingType(null)
    }
  }

  const handleDeleteOrder = async (order) => {
    const orderIdToUse = order.id || order._id || order.orderId
    if (!orderIdToUse) {
      toast.error("Order ID not found")
      return
    }

    const shouldDelete = confirm(
      `Delete order ${order.orderId} permanently?\n\nThis will remove it from customer and delivery apps as well.`,
    )

    if (!shouldDelete) return

    try {
      setDeletingOrderId(order.id || order.orderId)
      const response = await adminAPI.deleteOrder(orderIdToUse)
      if (response.data?.success) {
        toast.success(response.data?.message || `Order ${order.orderId} deleted`)
        await fetchOrders({ silent: true, withRingCheck: false })
      } else {
        toast.error(response.data?.message || "Failed to delete order")
      }
    } catch (error) {
      debugError("Error deleting order:", error)
      toast.error(error.response?.data?.message || "Failed to delete order")
    } finally {
      setDeletingOrderId(null)
    }
  }

  // Handle refund button click - show modal for wallet payments, confirm dialog for others
  const handleRefund = (order) => {
    const isWalletPayment = order.paymentType === "Wallet" || order.payment?.method === "wallet";

    if (isWalletPayment) {
      // Show modal for wallet refunds
      setSelectedOrderForRefund(order)
      setRefundModalOpen(true)
    } else {
      // For non-wallet payments, use the old confirm dialog flow
      const confirmMessage = `Are you sure you want to process refund for order ${order.orderId}?\n\nThis will initiate a Razorpay refund to the customer's original payment method.`;

      if (!confirm(confirmMessage)) {
        return
      }

      processRefund(order, null) // null amount means use default
    }
  }

  // Process refund with amount
  const processRefund = async (order, refundAmount = null) => {
    // Try using MongoDB _id first (more reliable for route matching), then fallback to orderId string
    // Backend accepts either MongoDB ObjectId (24 chars) or orderId string
    // Using MongoDB _id is more reliable for route matching (no dashes/special chars)
    const orderIdToUse = order.id || order._id || order.orderId

    if (!orderIdToUse) {
      debugError('? No orderId found in order object:', order)
      toast.error('Order ID not found. Please refresh the page and try again.')
      return
    }

    debugLog('?? Order details for refund:', {
      orderIdString: order.orderId,
      mongoId: order.id,
      orderIdToUse,
      willUse: order.orderId ? 'orderId string' : 'MongoDB _id',
      refundAmount
    })

    try {
      setProcessingRefund(orderIdToUse)

      debugLog('?? Processing refund for order:', {
        orderId: order.orderId,
        id: order.id,
        _id: order._id,
        orderIdToUse,
        refundAmount,
        url: `/api/admin/orders/${orderIdToUse}/refund`
      })

      // Include refundAmount in request body if provided (ensure it's a number)
      const requestData = refundAmount !== null ? { refundAmount: parseFloat(refundAmount) } : {}
      debugLog('?? Request data being sent:', requestData)
      const response = await adminAPI.processRefund(orderIdToUse, requestData)

      if (response.data?.success) {
        const isWalletPayment = order.paymentType === "Wallet" || order.payment?.method === "wallet";
        toast.success(response.data?.message || (isWalletPayment
          ? `Wallet refund of \u20B9${refundAmount || order.totalAmount} processed successfully for order ${order.orderId}`
          : `Refund initiated successfully for order ${order.orderId}`))
        // Update the order in the local state immediately to show "Refunded" status
        setOrders(prevOrders =>
          prevOrders.map(o =>
            (o.id === order.id || o.orderId === order.orderId)
              ? { ...o, refundStatus: 'processed' } // Wallet refunds are instant, so mark as processed
              : o
          )
        )
        // Refresh the orders list to get updated data
        await fetchOrders({ silent: true, withRingCheck: false })
      } else {
        toast.error(response.data?.message || "Failed to process refund")
      }
    } catch (error) {
      debugError("? Error processing refund:", error)

      // Log full error details for debugging
      const errorDetails = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        fullURL: error.config?.baseURL + error.config?.url,
        orderId: orderIdToUse,
        refundAmount: refundAmount,
        order: {
          id: order.id,
          orderId: order.orderId,
          _id: order._id
        },
        stack: error.stack
      }
      debugError("? Error details:", JSON.stringify(errorDetails, null, 2))

      // Show more specific error message
      let errorMessage = "Failed to process refund"

      if (error.response) {
        // Server responded with error
        if (error.response.status === 404) {
          errorMessage = `Order not found (ID: ${orderIdToUse}). Please check if the order exists.`
        } else if (error.response.status === 400) {
          errorMessage = error.response.data?.message || "Invalid request. Please check the refund amount."
        } else if (error.response.status === 500) {
          errorMessage = error.response.data?.message || "Server error. Please try again later."
        } else if (error.response.data?.message) {
          errorMessage = error.response.data.message
        } else {
          errorMessage = `Error ${error.response.status}: ${error.response.statusText || "Unknown error"}`
        }
      } else if (error.request) {
        // Request was made but no response received
        errorMessage = "Network error. Please check your internet connection and try again."
      } else {
        // Error in setting up the request
        errorMessage = error.message || "Failed to process refund"
      }

      debugError("? Final error message:", errorMessage)
      toast.error(errorMessage)
    } finally {
      setProcessingRefund(null)
      setRefundModalOpen(false)
      setSelectedOrderForRefund(null)
    }
  }

  // Handle refund confirmation from modal
  const handleRefundConfirm = (amount) => {
    if (selectedOrderForRefund) {
      processRefund(selectedOrderForRefund, amount)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen w-full max-w-full overflow-x-hidden">
      <OrdersTopbar
        title={config.title}
        count={totalOrders !== null && totalOrders !== undefined ? totalOrders : count}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onFilterClick={() => setIsFilterOpen(true)}
        activeFiltersCount={activeFiltersCount}
        onExport={handleExport}
        onSettingsClick={() => setIsSettingsOpen(true)}
        isLoading={isLoading}
        extraControls={
          <AdminZoneSelect
            value={zoneId}
            onChange={setZoneId}
            zones={zones}
            loading={zonesLoading}
          />
        }
      />
      {isLoading ? (
        <TableSkeleton rows={8} columns={7} />
      ) : (
        <>
          <FilterPanel
            isOpen={isFilterOpen}
            onClose={() => setIsFilterOpen(false)}
            filters={filters}
            setFilters={setFilters}
            onApply={() => {
              setCurrentPage(1);
              handleApplyFilters();
            }}
            onReset={() => {
              setCurrentPage(1);
              handleResetFilters();
            }}
            restaurants={restaurants}
          />
          <SettingsDialog
            isOpen={isSettingsOpen}
            onOpenChange={setIsSettingsOpen}
            visibleColumns={visibleColumns}
            toggleColumn={toggleColumn}
            resetColumns={resetColumns}
          />
          <ViewOrderDialog
            isOpen={isViewOrderOpen}
            onOpenChange={setIsViewOrderOpen}
            order={selectedOrder}
            onOrderUpdated={(updatedOrder) => {
              if (!updatedOrder) return
              setSelectedOrder(updatedOrder)
              setOrders((prev) => {
                if (!Array.isArray(prev)) return prev
                const key = String(
                  updatedOrder.id || updatedOrder._id || updatedOrder.orderId || "",
                )
                if (!key) return prev
                return prev.map((item) => {
                  const itemKey = String(item.id || item._id || item.orderId || "")
                  if (itemKey !== key) return item
                  return {
                    ...item,
                    ...updatedOrder,
                    orderStatus: updatedOrder.orderStatus || item.orderStatus,
                    paymentStatus: updatedOrder.paymentStatus || item.paymentStatus,
                    payment: updatedOrder.payment || item.payment,
                  }
                })
              })
              fetchOrders({ silent: true, withRingCheck: false })
            }}
          />
          <RefundModal
            isOpen={refundModalOpen}
            onOpenChange={setRefundModalOpen}
            order={selectedOrderForRefund}
            onConfirm={handleRefundConfirm}
            isProcessing={processingRefund !== null}
          />
          <OrdersTable
            orders={filteredOrders}
            visibleColumns={visibleColumns}
            onViewOrder={handleViewOrder}
            onPrintOrder={handlePrintOrder}
            onRefund={canEdit ? handleRefund : undefined}
            onAcceptOrder={(canEdit && (statusKey === "all" || statusKey === "pending")) ? handleAcceptOrder : undefined}
            onRejectOrder={(canEdit && (statusKey === "all" || statusKey === "pending")) ? handleRejectOrder : undefined}
            actionLoadingOrderId={processingActionOrderId}
            actionLoadingType={actionLoadingType}
            deletingOrderId={deletingOrderId}
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalOrders}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_orders_pageSize", String(size))
              } catch { }
              setCurrentPage(1)
            }}
          />
        </>
      )}
    </div>
  )
}

