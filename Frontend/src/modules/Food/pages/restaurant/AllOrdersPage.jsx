import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import {
  ArrowLeft,
  Search,
  Filter,
  ChevronDown,
  Calendar,
  Copy,
  ChevronRight,
  HelpCircle,
  X,
} from "lucide-react"
import { DateRangeCalendar } from "@food/components/ui/date-range-calendar"
import { restaurantAPI } from "@food/api"
import { useKeyboardAwareSheet } from "@food/hooks/useIsKeyboardOpen"
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications"
import { resolveMediaUrl } from "@/shared/utils/mediaUrl"
import { formatOrderAddress } from "@food/utils/orderAddress"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const formatMoney = (value) => `₹${Number(value || 0).toFixed(2)}`

// Date Range Helpers
const getToday = () => {
  const today = new Date()
  return { start: today, end: today }
}

const getLast7Days = () => {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 6) // includes today (7 days)
  return { start, end: today }
}

const getLast30Days = () => {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 29)
  return { start, end: today }
}

const getThisMonth = () => {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  return { start, end: today }
}

const dateRangeOptions = [
  { label: "today", getDates: getToday },
  { label: "last 7 days", getDates: getLast7Days },
  { label: "last 30 days", getDates: getLast30Days },
  { label: "this month", getDates: getThisMonth },
  { label: "custom date range", custom: true }
]

// Filter categories and options
const filterCategories = [
  { id: "Order status", label: "Order status" },
  { id: "Ratings", label: "Ratings" },
  { id: "KPT delay", label: "KPT delay" },
  { id: "Complaints", label: "Complaints" },
  { id: "Order type", label: "Order type" }
]

const filterOptions = {
  "Order status": [
    { id: "preparing", label: "Preparing", key: "orderStatus" },
    { id: "ready", label: "Ready", key: "orderStatus" },
    { id: "out-for-delivery", label: "Out for delivery", key: "orderStatus" },
    { id: "delivered", label: "Delivered", key: "orderStatus" },
    { id: "rejected", label: "Rejected", key: "orderStatus" },
    { id: "cancelled", label: "Cancelled", key: "orderStatus" }
  ],
  "Ratings": [
    { id: "5-star", label: "5★ or less", key: "ratings", value: 5 },
    { id: "4-star", label: "4★ or less", key: "ratings", value: 4 },
    { id: "3-star", label: "3★ or less", key: "ratings", value: 3 },
    { id: "2-star", label: "2★ or less", key: "ratings", value: 2 },
    { id: "1-star", label: "1★", key: "ratings", value: 1 }
  ],
  "KPT delay": [
    { id: "0-10", label: "0-10 mins", key: "kptDelay" },
    { id: "10-20", label: "10-20 mins", key: "kptDelay" },
    { id: "20-30", label: "20-30 mins", key: "kptDelay" },
    { id: "30-plus", label: "30+ mins", key: "kptDelay" }
  ],
  "Complaints": [
    { id: "order-delayed", label: "Order delayed", key: "complaints" },
    { id: "wrong-items", label: "Wrong item(s) delivered", key: "complaints" },
    { id: "missing-items", label: "Item(s) missing or not delivered", key: "complaints" },
    { id: "poor-taste", label: "Poor taste or quality", key: "complaints" },
    { id: "poor-packaging", label: "Poor packaging or spillage", key: "complaints" },
    { id: "out-of-stock", label: "Item(s) out of stock", key: "complaints" },
    { id: "not-delivered", label: "Order not delivered", key: "complaints" }
  ],
  "Order type": [
    { id: "takeaway", label: "Takeaway", key: "orderType" },
    // Dining filter hidden while the admin Dining toggle is off
    { id: "home-delivery", label: "Home delivery", key: "orderType" },
    { id: "veg-only", label: "Veg only", key: "orderType" }
  ]
}

const normalizeComplaintType = (typeStr) => {
  if (!typeStr) return null
  const s = String(typeStr).toLowerCase().replace(/[-_]/g, " ")
  if (s.includes("delay") || s.includes("late")) return "order-delayed"
  if (s.includes("wrong")) return "wrong-items"
  if (s.includes("missing")) return "missing-items"
  if (s.includes("taste") || s.includes("quality") || s.includes("food")) return "poor-taste"
  if (s.includes("packaging") || s.includes("spill")) return "poor-packaging"
  if (s.includes("stock")) return "out-of-stock"
  if (s.includes("not delivered") || s.includes("undelivered")) return "not-delivered"
  return null
}

const computeKptDelayMinutes = (order) => {
  if (Number.isFinite(Number(order.kptDelayMinutes))) {
    return Number(order.kptDelayMinutes)
  }
  if (Number.isFinite(Number(order.kptDelay))) {
    return Number(order.kptDelay)
  }
  const expectedPrep = Number(order.preparationTime) || 0
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : []

  // Find when preparation started
  const prepEntry = history.find((h) => String(h?.to || "").toLowerCase() === "preparing")
  const prepStartTime = prepEntry?.at
    ? new Date(prepEntry.at).getTime()
    : order.acceptedAt
    ? new Date(order.acceptedAt).getTime()
    : null

  // Find when preparation ended
  const readyEntry = history.find((h) =>
    ["ready", "ready_for_pickup", "picked_up", "out_for_delivery", "delivered"].includes(
      String(h?.to || "").toLowerCase()
    )
  )
  const readyTime = readyEntry?.at ? new Date(readyEntry.at).getTime() : null

  if (prepStartTime) {
    const isCurrentlyPreparing = ["preparing", "accepted"].includes(
      String(order.orderStatus || order.status || "").toLowerCase()
    )
    const endTime = readyTime || (isCurrentlyPreparing ? Date.now() : null)
    if (endTime && endTime >= prepStartTime) {
      const actualPrepMinutes = Math.round((endTime - prepStartTime) / 60000)
      const delay = actualPrepMinutes - expectedPrep
      return Math.max(0, delay)
    }
  }
  return 0
}

export default function AllOrdersPage() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [searchQuery, setSearchQuery] = useState("")
  const [showCalendar, setShowCalendar] = useState(false)
  const [showDateRangePopup, setShowDateRangePopup] = useState(false)
  const [selectedDateRange, setSelectedDateRange] = useState(dateRangeOptions[1]) // Default to "last 7 days"
  const [startDate, setStartDate] = useState(() => dateRangeOptions[1].getDates().start)
  const [endDate, setEndDate] = useState(() => dateRangeOptions[1].getDates().end)
  const calendarRef = useRef(null)
  
  // Filter states
  const [showFilterPopup, setShowFilterPopup] = useState(false)
  // Filter sheet (with its search field) stays above the on-screen keyboard.
  const { sheetProps: filterSheetProps } = useKeyboardAwareSheet()
  const [activeFilterCategory, setActiveFilterCategory] = useState("Order status")
  const [filterSearch, setFilterSearch] = useState("")
  const [isApplyingFilters, setIsApplyingFilters] = useState(false)
  const [filters, setFilters] = useState({
    orderStatus: [],
    ratings: [],
    kptDelay: [],
    complaints: [],
    orderType: []
  })
  
  // Toast state
  const [showToast, setShowToast] = useState(false)
  
  // Real data states
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [restaurantData, setRestaurantData] = useState(null)
  const { newOrder } = useRestaurantNotifications()

  // Fetch restaurant data
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          setRestaurantData(data)
        }
      } catch (err) {
        // Suppress 401 errors as they're handled by axios interceptor
        if (err.response?.status !== 401) {
          debugError('Error fetching restaurant data:', err)
        }
      }
    }
    fetchRestaurantData()
  }, [])

  // Store complaints map in ref so transformOrder can enrich orders
  const complaintsMapRef = useRef(new Map())

  // Transform API order to component format
  const transformOrder = useCallback((order) => {
    const createdAt = new Date(order.createdAt)
    const date = createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const time = createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    
    // Format address (backend: deliveryAddress)
    const addr = order.deliveryAddress || order.address || null
    const address = order.orderType === "takeaway"
      ? "Self-Pickup Order"
      : (addr?.formattedAddress ||
         addr?.address ||
         formatOrderAddress(addr) ||
         "Address not available")
    
    // Get restaurant name
    const restaurantName = restaurantData?.name || order.restaurantId?.name || 'Restaurant'
    
    // Get customer name
    const customerName = order.userId?.name || order.customerName || 'Customer'
    
    // Format items
    const items = (order.items || []).map(item => ({
      name: item.name || 'Item',
      quantity: item.quantity || 1,
      price: item.price || 0,
      image: resolveMediaUrl(item.image || item.imageUrl || item.foodItem?.image || item.itemImage || item.foodImage || item.photo) || item.image || null,
    }))
    
    // Determine status (backend: orderStatus)
    let status = (order.orderStatus || order.status || "created").toUpperCase()
    if (status === 'CANCELLED') status = 'CANCELLED'
    else if (status === 'REJECTED') status = 'REJECTED'
    else if (status === 'DELIVERED') status = 'DELIVERED'
    else if (status === 'PREPARING') status = 'PREPARING'
    else if (status === 'READY') status = 'READY'
    else if (status === 'OUT_FOR_DELIVERY' || status === 'OUT FOR DELIVERY') status = 'OUT FOR DELIVERY'
    
    // Get rejection/cancellation reason
    let reason = null
    if (status === 'REJECTED' && order.rejectionReason) {
      reason = `Rejected by Restaurant: ${order.rejectionReason}`
    } else if (status === 'CANCELLED' && order.cancellationReason) {
      reason = `Cancelled by ${order.cancelledBy === 'customer' ? 'customer' : 'restaurant'}: ${order.cancellationReason}`
    } else if (status === 'REJECTED') {
      reason = 'Rejected by Restaurant'
    } else if (status === 'CANCELLED') {
      reason = 'Cancelled by customer'
    }

    // Resolve rating
    const rawRating = order.ratings?.restaurant?.rating ?? order.rating ?? order.restaurantRating ?? null
    const rating = Number.isFinite(Number(rawRating)) && Number(rawRating) > 0 ? Number(rawRating) : null

    // Resolve KPT delay
    const kptDelayMinutes = computeKptDelayMinutes(order)

    // Resolve complaints
    const complaintsMap = complaintsMapRef.current
    const orderMongoId = String(order._id || '')
    const orderReadableId = String(order.orderId || '')
    const complaintsSet = new Set()
    if (complaintsMap) {
      if (complaintsMap.has(orderMongoId)) {
        complaintsMap.get(orderMongoId).forEach(c => complaintsSet.add(c))
      }
      if (complaintsMap.has(orderReadableId)) {
        complaintsMap.get(orderReadableId).forEach(c => complaintsSet.add(c))
      }
    }
    if (Array.isArray(order.complaints)) {
      order.complaints.forEach(c => {
        const norm = normalizeComplaintType(typeof c === 'string' ? c : (c.issueType || c.type || c.reason))
        if (norm) complaintsSet.add(norm)
      })
    }
    const reasonText = String(order.cancellationReason || order.rejectionReason || '')
    const reasonComplaint = normalizeComplaintType(reasonText)
    if (reasonComplaint) {
      complaintsSet.add(reasonComplaint)
    }
    const complaints = Array.from(complaintsSet)
    
    // Determine tags based on order properties
    const tags = []
    if (order.scheduledAt) tags.push('SCHEDULED')
    if (order.orderType === 'takeaway') {
      tags.push('TAKEAWAY')
    } else if (order.orderType === 'dining') {
      tags.push('DINING')
    } else {
      tags.push('HOME DELIVERY')
    }
    // Check if all items are veg
    const allVeg = items.every(item => item.isVeg !== false)
    if (allVeg && items.length > 0) tags.push('VEG ONLY')

    if (rating != null) {
      tags.push(`★ ${rating}`)
    }
    if (kptDelayMinutes > 0) {
      tags.push(`DELAY ${kptDelayMinutes}m`)
    }
    if (complaints.length > 0) {
      tags.push('COMPLAINT')
    }
    
    return {
      id: order.orderId || order._id?.toString() || '',
      status,
      date,
      time,
      restaurant: restaurantName,
      address,
      customer: customerName,
      items,
      totalPrice: order.pricing?.total || 0,
      reason,
      rating,
      kptDelayMinutes,
      complaints,
      tags: tags.length > 0 ? tags : undefined,
      createdAt: order.createdAt,
      mongoId: order._id?.toString(),
      orderType: order.orderType || 'delivery'
    }
  }, [restaurantData])

  // Fetch orders from backend
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setLoading(true)
        setError(null)
        
        // Build query params
        const params = {
          page: 1,
          limit: 1000 // Get all orders, we'll filter by date on frontend
        }
        
        // Fetch all orders & complaints in parallel
        const [ordersRes, complaintsRes] = await Promise.allSettled([
          restaurantAPI.getOrders(params),
          typeof restaurantAPI.getComplaints === 'function' ? restaurantAPI.getComplaints({ limit: 1000 }) : Promise.resolve(null)
        ])

        const map = new Map()
        if (complaintsRes.status === 'fulfilled' && complaintsRes.value?.data?.success) {
          const rawComplaints = complaintsRes.value.data.data?.complaints || complaintsRes.value.data.complaints || []
          rawComplaints.forEach(c => {
            const cOrderId = String(c.orderId?._id || c.orderId?.orderId || c.orderId || c.orderRef || '').trim()
            const norm = normalizeComplaintType(c.issueType || c.type || c.subject || c.description)
            if (norm && cOrderId) {
              if (!map.has(cOrderId)) map.set(cOrderId, new Set())
              map.get(cOrderId).add(norm)
            }
          })
        }
        complaintsMapRef.current = map

        if (ordersRes.status === 'fulfilled' && ordersRes.value?.data?.success && ordersRes.value.data.data?.orders) {
          // Transform orders
          const transformedOrders = ordersRes.value.data.data.orders.map(transformOrder)
          
          // Filter by date range
          const filteredByDate = transformedOrders.filter(order => {
            if (!order.createdAt) return false
            const orderDate = new Date(order.createdAt)
            const start = new Date(startDate)
            start.setHours(0, 0, 0, 0)
            const end = new Date(endDate)
            end.setHours(23, 59, 59, 999)
            return orderDate >= start && orderDate <= end
          })
          
          setOrders(filteredByDate)
        } else {
          setOrders([])
        }
      } catch (err) {
        // Suppress 401 errors as they're handled by axios interceptor
        if (err.response?.status !== 401) {
          debugError('Error fetching orders:', err)
          setError(err.message || 'Failed to fetch orders')
        }
        setOrders([])
      } finally {
        setLoading(false)
      }
    }
    
    fetchOrders()
  }, [startDate, endDate, transformOrder])

  // Realtime: instantly prepend new orders (no refresh)
  useEffect(() => {
    if (!newOrder) return
    // Transform & prepend if not already present.
    setOrders((prev) => {
      const id = String(newOrder?.orderId || newOrder?._id || "")
      if (!id) return prev
      if (prev.some((o) => String(o.id) === id || String(o.mongoId) === String(newOrder?._id))) {
        return prev
      }
      const transformed = transformOrder(newOrder)
      return [transformed, ...prev]
    })
  }, [newOrder, transformOrder])

  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target)) {
        setShowCalendar(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Prevent body scroll when popup is open
  useEffect(() => {
    if (showDateRangePopup || showCalendar || showFilterPopup) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [showDateRangePopup, showCalendar, showFilterPopup])

  const handleDateRangeChange = (start, end) => {
    setStartDate(start)
    setEndDate(end)
    
    if (start && end) {
      setSelectedDateRange({ label: "custom date range", start, end, custom: true })
      setShowCalendar(false)
    }
  }

  const handleDateRangeSelect = (option) => {
    if (option.custom) {
      setShowDateRangePopup(false)
      setShowCalendar(true)
    } else {
      const dates = option.getDates()
      setSelectedDateRange(option)
      setStartDate(dates.start)
      setEndDate(dates.end)
      setShowDateRangePopup(false)
    }
  }

  const formatDateRange = () => {
    if (!startDate || !endDate) return "Select date range"
    const startDay = startDate.getDate()
    const endDay = endDate.getDate()
    const month = startDate.toLocaleString('en-US', { month: 'short' })
    const year = startDate.getFullYear().toString().slice(-2)
    return `${startDay} - ${endDay} ${month}'${year}`
  }

  const handleCopyOrderId = (orderId, e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(orderId)
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const handleFilterToggle = (option) => {
    const key = option.key
    const value = option.id
    
    // For ratings, only allow one selection (radio button behavior)
    if (key === "ratings") {
      setFilters(prev => ({
        ...prev,
        [key]: prev[key].includes(value) ? [] : [value]
      }))
    } else {
      // For other filters, allow multiple selections (checkbox behavior)
      setFilters(prev => ({
        ...prev,
        [key]: prev[key].includes(value)
          ? prev[key].filter(v => v !== value)
          : [...prev[key], value]
      }))
    }
  }

  const handleClearFilters = () => {
    setFilters({
      orderStatus: [],
      ratings: [],
      kptDelay: [],
      complaints: [],
      orderType: []
    })
    setFilterSearch("")
  }

  const handleApplyFilters = async () => {
    setIsApplyingFilters(true)
    await new Promise(resolve => setTimeout(resolve, 150))
    setIsApplyingFilters(false)
    setShowFilterPopup(false)
  }

  const isFilterChecked = (option) => {
    return filters[option.key]?.includes(option.id) || false
  }

  const hasActiveFilters = () => {
    return Object.values(filters).some(arr => arr.length > 0)
  }

  const getStatusColor = (status) => {
    switch (status) {
      case "REJECTED":
      case "CANCELLED":
        return "bg-red-50 text-red-700 border border-red-200"
      case "DELIVERED":
        return "bg-emerald-50 text-emerald-700 border border-emerald-200"
      case "PREPARING":
        return "bg-amber-50 text-amber-700 border border-amber-200"
      case "READY":
        return "bg-green-50 text-green-700 border border-green-200"
      case "OUT FOR DELIVERY":
        return "bg-purple-50 text-purple-700 border border-purple-200"
      default:
        return "bg-slate-50 text-slate-700 border border-slate-200"
    }
  }

  const filteredOrders = orders.filter(order => {
    // Search filter - search in order ID (both full ID and numeric part)
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase().trim()
      const orderIdLower = order.id.toLowerCase()
      // Extract numeric part from order ID (e.g., "ORD-1768751659979-588" -> "1768751659979588")
      const numericPart = order.id.replace(/\D/g, '')
      if (!orderIdLower.includes(searchLower) && !numericPart.includes(searchLower)) {
        return false
      }
    }

    // Order status filter
    if (filters.orderStatus.length > 0) {
      const statusMap = {
        'preparing': 'PREPARING',
        'ready': 'READY',
        'out-for-delivery': 'OUT FOR DELIVERY',
        'delivered': 'DELIVERED',
        'rejected': 'REJECTED',
        'cancelled': 'CANCELLED'
      }
      const matchesStatus = filters.orderStatus.some(
        statusId => statusMap[statusId] === order.status
      )
      if (!matchesStatus) return false
    }

    // Order type filter
    if (filters.orderType.length > 0) {
      const hasMatchingTag = order.tags?.some(tag => {
        const tagLower = tag.toLowerCase().replace(/\s+/g, '-')
        return filters.orderType.includes(tagLower)
      })
      if (!hasMatchingTag) return false
    }

    // Ratings filter (e.g., "5-star", "4-star", "3-star", "2-star", "1-star")
    if (filters.ratings.length > 0) {
      const selectedRatingId = filters.ratings[0]
      const ratingOption = filterOptions["Ratings"]?.find(o => o.id === selectedRatingId)
      if (ratingOption) {
        if (order.rating == null) return false
        const maxRating = ratingOption.value
        if (selectedRatingId === "1-star") {
          if (Math.round(order.rating) !== 1) return false
        } else {
          if (order.rating > maxRating) return false
        }
      }
    }

    // KPT delay filter ("0-10", "10-20", "20-30", "30-plus")
    if (filters.kptDelay.length > 0) {
      const delay = Number(order.kptDelayMinutes) || 0
      const matchesKpt = filters.kptDelay.some(delayId => {
        switch (delayId) {
          case "0-10":
            return delay >= 0 && delay <= 10
          case "10-20":
            return delay > 10 && delay <= 20
          case "20-30":
            return delay > 20 && delay <= 30
          case "30-plus":
            return delay > 30
          default:
            return false
        }
      })
      if (!matchesKpt) return false
    }

    // Complaints filter
    if (filters.complaints.length > 0) {
      const orderComplaints = Array.isArray(order.complaints) ? order.complaints : []
      const matchesComplaint = filters.complaints.some(cId => orderComplaints.includes(cId))
      if (!matchesComplaint) return false
    }

    return true
  })

  return (
    <div className="min-h-screen bg-gray-100">
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
            <h1 className="text-lg font-bold text-gray-900">
              Order History
            </h1>
            <p className="text-xs text-gray-500">
              {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'} found
            </p>
          </div>
          <button
            onClick={() => navigate('/food/restaurant/help-centre/support', { state: { from: '/food/restaurant/orders/all' } })}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Help"
          >
            <HelpCircle className="w-5 h-5 text-gray-900" />
          </button>
        </div>
      </div>

      {/* Search and Filter Section */}
      <div className="px-4 py-4 space-y-3">
        {/* Search Bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by order ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilterPopup(true)}
            className={`p-2.5 border rounded-lg transition-colors relative ${
              hasActiveFilters() 
                ? 'bg-blue-50 border-blue-500 hover:bg-blue-100' 
                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
            }`}
            aria-label="Filter"
          >
            <Filter className={`w-5 h-5 ${hasActiveFilters() ? 'text-[#2E7D52]' : 'text-gray-900'}`} />
            {hasActiveFilters() && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-full text-white text-xs flex items-center justify-center font-bold">
                {Object.values(filters).flat().length}
              </span>
            )}
          </button>
        </div>

        {/* Date Range Selector */}
        <button
          onClick={() => setShowDateRangePopup(true)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="text-left">
            <p className="text-sm font-medium text-gray-900 capitalize">{selectedDateRange.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{formatDateRange()}</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </div>
        </button>
      </div>

      {/* Active Filters Summary */}
      {hasActiveFilters() && (
        <div className="px-4 pb-2">
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#2E7D52]" />
              <span className="text-sm text-blue-900">
                <span className="font-semibold">{Object.values(filters).flat().length}</span> filter{Object.values(filters).flat().length !== 1 ? 's' : ''} applied
              </span>
            </div>
            <button
              onClick={handleClearFilters}
              className="text-xs text-[#2E7D52] hover:text-blue-800 font-medium hover:underline"
            >
              Clear all
            </button>
          </motion.div>
        </div>
      )}

      {/* Orders List */}
      <div className="px-4 pb-24 space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 lg:items-start">
        {loading && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200 lg:col-span-2">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-[#2E7D52] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-600 text-sm">Loading orders...</p>
            </div>
          </div>
        )}
        
        {!loading && error && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200 lg:col-span-2">
            <div className="flex flex-col items-center gap-3">
              <p className="text-[#2E7D52] font-medium text-sm">Error loading orders</p>
              <p className="text-gray-500 text-xs">{error}</p>
            </div>
          </div>
        )}
        
        {!loading && !error && (
          <AnimatePresence mode="popLayout">
            {filteredOrders.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-lg border border-gray-200 lg:col-span-2">
                <div className="flex flex-col items-center gap-3">
                  <p className="text-gray-900 font-medium text-sm">No orders found</p>
                  <p className="text-gray-500 text-xs">
                    Try changing the date range or search filters.
                  </p>
                </div>
              </div>
            ) : filteredOrders.map((order, index) => (
            <motion.div
              key={order.id}
              layout
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ 
                duration: 0.3, 
                delay: Math.min(index * 0.05, 0.3),
                layout: { duration: 0.3 }
              }}
              onClick={() => navigate(`/food/restaurant/orders/${order.id}`, { state: { mongoId: order.mongoId } })}
              className="bg-white border border-gray-200 rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
            >
            {/* Status and Order ID Row */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold leading-snug whitespace-nowrap ${getStatusColor(order.status)}`}>
                  {order.status}
                </span>
                {order.tags && order.tags.map((tag, idx) => {
                  let badgeColor = "bg-slate-50 text-slate-600 border border-slate-200";
                  if (tag === "TAKEAWAY") badgeColor = "bg-orange-50 text-orange-700 border border-orange-200";
                  else if (tag === "DINING") badgeColor = "bg-blue-50 text-blue-700 border border-blue-200";
                  else if (tag === "HOME DELIVERY") badgeColor = "bg-slate-100 text-slate-700 border border-slate-200";
                  else if (tag === "VEG ONLY") badgeColor = "bg-green-50 text-green-700 border border-green-200";
                  else if (tag === "SCHEDULED") badgeColor = "bg-indigo-50 text-indigo-700 border border-indigo-200";
                  else if (tag.startsWith("★")) badgeColor = "bg-amber-50 text-amber-700 border border-amber-200";
                  else if (tag.startsWith("DELAY")) badgeColor = "bg-rose-50 text-rose-700 border border-rose-200";
                  else if (tag === "COMPLAINT") badgeColor = "bg-red-50 text-red-700 border border-red-200";

                  return (
                    <span key={idx} className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold leading-snug whitespace-nowrap ${badgeColor}`}>
                      {tag}
                    </span>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{order.date}, {order.time}</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </div>

            {/* Order ID */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base font-bold text-gray-900">ID: {order.id}</span>
              <button
                onClick={(e) => handleCopyOrderId(order.id, e)}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                aria-label="Copy order ID"
              >
                <Copy className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Restaurant Info */}
            <p className="text-sm text-gray-900 mb-1">
              {order.restaurant}, {order.address}
            </p>

            {/* Customer Info */}
            <p className="text-sm text-gray-600 mb-3 break-words [overflow-wrap:anywhere]">
              Ordered by {order.customer}
            </p>

            {/* Divider */}
            <div className="border-t border-dashed border-gray-300 my-3"></div>

            {/* Order Items */}
            <div className="space-y-2">
              {order.items.slice(0, 2).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {item.image && (
                      <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                        <img src={item.image} alt={item.name} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} />
                      </div>
                    )}
                    <span className="text-sm text-gray-900 truncate">
                      {item.quantity} x {item.name}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500 shrink-0">{formatMoney(item.price)}</span>
                </div>
              ))}
              {order.items.length > 2 && (
                <p className="text-xs text-[#2E7D52] font-medium">+{order.items.length - 2} more items</p>
              )}
            </div>

            {/* Price Footer */}
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Amount</span>
              <span className="text-base font-bold text-gray-900">{formatMoney(order.totalPrice)}</span>
            </div>

            {/* Reason/Status Message */}
            {order.reason && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-sm text-[#2E7D52]">{order.reason}</p>
              </div>
            )}
            </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Date Range Popup */}
      <AnimatePresence>
        {showDateRangePopup && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowDateRangePopup(false)}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={() => setShowDateRangePopup(false)}
            >
              <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-sm max-h-[80vh] flex flex-col">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                  <h2 className="text-lg font-bold text-gray-900">Select date range</h2>
                <button
                  onClick={() => setShowDateRangePopup(false)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-gray-900" />
                </button>
              </div>

              <div className="p-2 overflow-y-auto custom-scrollbar">
                <div className="space-y-1">
                  {dateRangeOptions.map((option) => {
                    const isSelected =
                      selectedDateRange?.label?.toLowerCase() === option.label.toLowerCase()

                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => handleDateRangeSelect(option)}
                        className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div>
                          <p className="text-sm font-semibold text-gray-900 capitalize">{option.label}</p>
                          {!option.custom && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {(() => {
                                const dates = option.getDates()
                                const start = dates.start.toLocaleDateString("en-US", { day: "numeric", month: "short" })
                                const end = dates.end.toLocaleDateString("en-US", { day: "numeric", month: "short" })
                                return `${start} - ${end}`
                              })()}
                            </p>
                          )}
                        </div>
                        {isSelected && <span className="text-xs font-semibold text-[#2E7D52]">Selected</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Calendar Popup */}
      <AnimatePresence>
        {showCalendar && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-[60]"
              onClick={() => setShowCalendar(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              onClick={() => setShowCalendar(false)}
            >
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
                <DateRangeCalendar
                  startDate={startDate}
                  endDate={endDate}
                  onDateRangeChange={handleDateRangeChange}
                  onClose={() => setShowCalendar(false)}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Filter Popup */}
      <AnimatePresence>
        {showFilterPopup && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowFilterPopup(false)}
            />
            
            {/* Filter Sheet */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ 
                type: "spring",
                damping: 30,
                stiffness: 300
              }}
              ref={filterSheetProps.ref}
              onFocusCapture={filterSheetProps.onFocusCapture}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 flex flex-col"
              style={{ height: '65vh', ...filterSheetProps.style }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag Handle */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 bg-gray-300 rounded-full"></div>
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">Filters</h2>
                <button
                  onClick={() => setShowFilterPopup(false)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-gray-900" />
                </button>
              </div>

              {/* Main Content */}
              <div className="flex flex-1 overflow-hidden">
                {/* Sidebar Categories */}
                <div className="w-28 bg-gray-50 border-r border-gray-200 overflow-y-auto">
                  {filterCategories.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => {
                        setActiveFilterCategory(category.id)
                        setFilterSearch("")
                      }}
                      className={`w-full px-2 py-3 text-left text-xs transition-colors border-b border-gray-200 ${
                        activeFilterCategory === category.id
                          ? 'bg-white text-gray-900 font-semibold border-2 border-l-black'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>

                {/* Filter Options */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Search Bar */}
                  <div className="p-3 border-b border-gray-200">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search"
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* Options List */}
                  <div className="flex-1 overflow-y-auto px-3 py-2">
                    {filterOptions[activeFilterCategory]
                      ?.filter(option => 
                        option.label.toLowerCase().includes(filterSearch.toLowerCase())
                      )
                      .map((option) => {
                        const isChecked = isFilterChecked(option)
                        const isRadio = activeFilterCategory === "Ratings"
                        
                        return (
                          <label
                            key={option.id}
                            className="flex items-center py-2.5 cursor-pointer hover:bg-gray-50 rounded-lg px-2 transition-colors"
                          >
                            <div className="relative flex items-center justify-center">
                              {isRadio ? (
                                <div
                                  onClick={() => handleFilterToggle(option)}
                                  className={`w-5 h-5 rounded-full border-2 cursor-pointer transition-all ${
                                    isChecked 
                                      ? 'border-[#2E7D52] bg-white' 
                                      : 'border-gray-300 bg-white'
                                  }`}
                                >
                                  {isChecked && (
                                    <div className="w-full h-full rounded-full flex items-center justify-center">
                                      <div className="w-3 h-3 rounded-full bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F]"></div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleFilterToggle(option)}
                                  className="w-5 h-5 border-2 border-gray-300 rounded cursor-pointer transition-all appearance-none checked:bg-green-600 checked:border-green-600 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 relative"
                                  style={{
                                    backgroundImage: isChecked ? `url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e")` : 'none',
                                    backgroundSize: '100% 100%',
                                    backgroundPosition: '50%',
                                    backgroundRepeat: 'no-repeat'
                                  }}
                                />
                              )}
                            </div>
                            <span className="ml-3 text-sm text-gray-900">{option.label}</span>
                          </label>
                        )
                      })}
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-200 bg-white">
                <button
                  onClick={handleClearFilters}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                >
                  Clear all
                </button>
                <button
                  onClick={handleApplyFilters}
                  disabled={isApplyingFilters}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-lg text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isApplyingFilters ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Applying...
                    </>
                  ) : (
                    'Apply'
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isApplyingFilters && !showFilterPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-3">
              <svg className="animate-spin h-10 w-10 text-[#2E7D52]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-sm font-medium text-gray-900">Applying filters...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-60 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2"
          >
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium">Order ID copied to clipboard</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}







