import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { ArrowLeft, Search, MoreVertical, ChevronRight, Star, RotateCcw, AlertCircle, Loader2, Clock, X, Share2, MessageCircle, Send, Copy, Mail, MessagesSquare, Link2 } from "lucide-react"
import { orderAPI } from "@food/api"
import { useCart } from "@food/context/CartContext"
import { toast } from "sonner"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { isVegMenuItem } from "@food/utils/vegMode"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import SafeImage from "@food/components/SafeImage"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

/*
 * Badge for an order still in progress, from the backend status. The badge
 * used to say "Confirmed" for anything it did not recognise - including a
 * just-placed order the restaurant had not accepted yet - so an order it then
 * rejected went from "Confirmed" to "Cancelled".
 */
const ACTIVE_ORDER_STATUS_LABELS = {
  created: "Order Placed",
  pending: "Order Placed",
  placed: "Order Placed",
  confirmed: "Confirmed",
  accepted: "Confirmed",
  preparing: "Preparing",
  ready: "Food Ready",
  ready_for_pickup: "Food Ready",
  reached_pickup: "Rider at Restaurant",
  picked_up: "Out for Delivery",
  out_for_delivery: "Out for Delivery",
  outForDelivery: "Out for Delivery",
  reached_drop: "Arriving",
}

const getActiveOrderStatusLabel = (order) =>
  ACTIVE_ORDER_STATUS_LABELS[order?.originalStatus] ||
  ACTIVE_ORDER_STATUS_LABELS[order?.status] ||
  "In Progress"

export default function Orders() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { replaceCart } = useCart()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [ratingModal, setRatingModal] = useState({ open: false, order: null })
  const [activeMenuOrderId, setActiveMenuOrderId] = useState(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [selectedRestaurantRating, setSelectedRestaurantRating] = useState(null)
  const [selectedDeliveryRating, setSelectedDeliveryRating] = useState(null)
  const [restaurantFeedbackText, setRestaurantFeedbackText] = useState("")
  const [deliveryFeedbackText, setDeliveryFeedbackText] = useState("")
  const [submittingRating, setSubmittingRating] = useState(false)
  const [countdowns, setCountdowns] = useState({})
  // Track orders that have shown rating popup - persist in localStorage
  const [shownRatingForOrders, setShownRatingForOrders] = useState(() => {
    try {
      const stored = localStorage.getItem('shownRatingForOrders')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })

  // Save to localStorage whenever shownRatingForOrders changes
  useEffect(() => {
    try {
      localStorage.setItem('shownRatingForOrders', JSON.stringify(Array.from(shownRatingForOrders)))
    } catch (error) {
      debugError('Error saving shownRatingForOrders to localStorage:', error)
    }
  }, [shownRatingForOrders])

  // Prevent background scrolling when rating modal is open
  useEffect(() => {
    if (ratingModal.open) {
      const scrollY = window.scrollY
      const prevOverflow = document.body.style.overflow
      const prevPosition = document.body.style.position
      const prevTop = document.body.style.top
      const prevWidth = document.body.style.width

      document.body.style.overflow = "hidden"
      document.body.style.position = "fixed"
      document.body.style.top = `-${scrollY}px`
      document.body.style.width = "100%"

      return () => {
        document.body.style.overflow = prevOverflow
        document.body.style.position = prevPosition
        document.body.style.top = prevTop
        document.body.style.width = prevWidth
        window.scrollTo(0, scrollY)
      }
    }
  }, [ratingModal.open])

  // Calculate countdown for an order
  const calculateCountdown = (order) => {
    if (!order || 
        order.status === 'delivered' || 
        String(order.status).toLowerCase().includes('cancel')) {
      return null
    }

    if (order.preparationTime && order.acceptedAt) {
      const acceptedAt = new Date(order.acceptedAt)
      const now = new Date()
      const elapsedMinutes = Math.floor((now - acceptedAt) / (1000 * 60))
      const remainingMinutes = Math.max(0, order.preparationTime - elapsedMinutes)
      return remainingMinutes > 0 ? remainingMinutes : null
    }

    const createdAt = new Date(order.createdAt)
    const now = new Date()
    const elapsedMinutes = Math.floor((now - createdAt) / (1000 * 60))

    // Get max ETA (use eta.max if available, otherwise estimatedDeliveryTime)
    const maxETA = order.eta?.max || order.estimatedDeliveryTime || 30
    const remainingMinutes = Math.max(0, maxETA - elapsedMinutes)

    return remainingMinutes > 0 ? remainingMinutes : null
  }

  // Update countdowns for all active orders
  useEffect(() => {
    const updateCountdowns = () => {
      const newCountdowns = {}
      orders.forEach(order => {
        const remaining = calculateCountdown(order)
        if (remaining !== null) {
          newCountdowns[order.id] = remaining
        }
      })
      setCountdowns(newCountdowns)
    }

    updateCountdowns()
    const interval = setInterval(updateCountdowns, 10000) // Update every 10 seconds for better UX

    return () => clearInterval(interval)
  }, [orders])

  // Get order status text
  const getOrderStatus = (order) => {
    const status = order.status
    if (status === 'delivered' || status === 'completed') return 'delivered'
    if (status === 'out_for_delivery' || status === 'outForDelivery') return 'outForDelivery'
    if (status === 'ready' || status === 'preparing') return 'preparing'
    if (String(status).toLowerCase().includes('cancel')) return 'cancelled'
    return status || 'confirmed'
  }

  // NOTE: The rating popup is intentionally NOT auto-triggered here.
  // The post-delivery rating flow lives in OrderTracking.jsx (shown when the user
  // taps back after a delivered order). On the Orders list, ratings are only opened
  // via the explicit "Rate Restaurant" button so the popup never pops up on its own
  // when the user simply visits Profile → Orders.

  // Fetch orders from backend API
  useEffect(() => {
    const FETCH_LIMIT = 100

    const fetchAllOrders = async () => {
      const firstResponse = await orderAPI.getOrders({
        limit: FETCH_LIMIT,
        page: 1,
      })

      // Check multiple possible response structures
      let firstPageOrders = []
      let totalPages = 1

      if (firstResponse?.data?.success && firstResponse?.data?.data?.orders) {
        firstPageOrders = firstResponse.data.data.orders || []
        totalPages = firstResponse.data.data?.pagination?.pages || 1
      } else if (firstResponse?.data?.orders) {
        firstPageOrders = firstResponse.data.orders || []
        totalPages = firstResponse.data?.pagination?.pages || 1
      } else if (
        firstResponse?.data?.data &&
        Array.isArray(firstResponse.data.data)
      ) {
        firstPageOrders = firstResponse.data.data || []
      }

      if (totalPages <= 1) {
        return firstPageOrders
      }

      const pagePromises = []
      for (let p = 2; p <= totalPages; p += 1) {
        pagePromises.push(orderAPI.getOrders({ limit: FETCH_LIMIT, page: p }))
      }

      const pageResponses = await Promise.all(pagePromises)
      const remainingOrders = pageResponses.flatMap((resp) => {
        if (resp?.data?.success && resp?.data?.data?.orders) {
          return resp.data.data.orders || []
        }
        if (resp?.data?.orders) {
          return resp.data.orders || []
        }
        if (resp?.data?.data && Array.isArray(resp.data.data)) {
          return resp.data.data || []
        }
        return []
      })

      return [...firstPageOrders, ...remainingOrders]
    }

    let isMounted = true

    const fetchOrders = async (isBackground = false) => {
      try {
        if (!isBackground) {
          setLoading(true)
        }
        const ordersData = await fetchAllOrders()

        if (!isMounted) return

        if (ordersData.length > 0) {
          debugLog('?? Raw orders from API:', ordersData.slice(0, 3).map(o => ({
            id: o.orderId || o._id,
            status: o.orderStatus || o.status,
            restaurantRating: o.ratings?.restaurant?.rating || null,
            deliveryPartnerRating: o.ratings?.deliveryPartner?.rating || null,
            deliveredAt: o.deliveredAt,
            restaurant: o.restaurantId?.restaurantName || o.restaurantId?.name || o.restaurantName
          })))

          // Transform API orders to match UI structure
          const transformedOrders = ordersData.map(order => {
            const createdAt = order.createdAt ? new Date(order.createdAt) : new Date()

            // Check if cancelled by restaurant or user
            const backendStatus = order.orderStatus || order.status
            const isCancelled =
              backendStatus === 'cancelled' ||
              backendStatus === 'cancelled_by_user' ||
              backendStatus === 'cancelled_by_restaurant' ||
              backendStatus === 'cancelled_by_admin'
            // Never the order note: that is the customer's own cooking instruction.
            const cancellationReason = order.cancellationReason || ''
            // Check cancelledBy field, backend status, or reason pattern
            const isRestaurantCancelled = isCancelled && (
              order.cancelledBy === 'restaurant' ||
              backendStatus === 'cancelled_by_restaurant' ||
              order.status === 'cancelled_by_restaurant' ||
              /rejected by restaurant|restaurant rejected|restaurant cancelled|restaurant is too busy|item not available|outside delivery area|kitchen closing|technical issue|order not accepted within time limit|restaurant did not respond/i.test(cancellationReason)
            )
            const isUserCancelled = isCancelled && (order.cancelledBy === 'user' || order.cancelledBy === 'customer' || backendStatus === 'cancelled_by_user')

            // Get original status from backend before transformation
            const originalStatus = backendStatus
            const restaurantRating = order.ratings?.restaurant?.rating || null
            const deliveryPartnerRating = order.ratings?.deliveryPartner?.rating || null

            return {
              id: order._id?.toString() || order.orderId || `ORD-${order._id}`,
              mongoId: order._id,
              orderId: order.orderId || order._id?.toString(), // Keep orderId for display
              status: isRestaurantCancelled ? 'restaurant_cancelled' : getOrderStatus({ ...order, status: backendStatus }),
              originalStatus: originalStatus, // Keep original status for reference
              createdAt: createdAt.toISOString(),
              address: order.address || order.deliveryAddress || {},
              items: (order.items || []).map(item => ({
                itemId: item.itemId || item._id || item.id,
                name: item.name || item.foodName || 'Item',
                variantName: item.variantName || '',
                quantity: item.quantity || 1,
                price: item.price || 0,
                image: item.image || null,
                description: item.description || null,
                isVeg: isVegMenuItem(item, order.restaurantId),
                _id: item._id || item.id,
                id: item.id || item._id
              })),
              total: order.pricing?.total || order.total || 0,
              subtotal: order.pricing?.subtotal || 0,
              deliveryFee: order.pricing?.deliveryFee || 0,
              tax: order.pricing?.tax || 0,
              pricing: order.pricing || {}, // Keep full pricing object for discounts, coupons
              payment: order.payment || {},
              paymentMethod: order.payment?.method || order.paymentMethod,
              restaurant: order.restaurantId?.restaurantName || order.restaurantId?.name || order.restaurantName || 'Restaurant',
              restaurantId: order.restaurantId?._id || order.restaurantId,
              restaurantSlug: order.restaurantId?.slug || null,
              restaurantImage: order.restaurantId?.profileImage?.url || order.restaurantId?.profileImage || null,
              restaurantLocation: order.restaurantId?.location?.area || order.restaurantId?.location?.city || order.address?.city || order.deliveryAddress?.city || '',
              restaurantRating,
              deliveryPartnerRating,
              ratings: order.ratings || {},
              rating: restaurantRating || null,
              review: order.review || null,
              tracking: order.tracking || {},
              cancellationReason: cancellationReason,
              isRestaurantCancelled: isRestaurantCancelled,
              isUserCancelled: isUserCancelled,
              cancelledBy: order.cancelledBy,
              eta: order.eta || { min: order.estimatedDeliveryTime || 30, max: order.estimatedDeliveryTime || 30 },
              estimatedDeliveryTime: order.estimatedDeliveryTime || 30,
              preparationTime: order.preparationTime || 0,
              acceptedAt: order.acceptedAt || null,
              deliveredAt: order.deliveredAt || null,
              deliveryPartnerId: order.deliveryPartnerId?._id || order.deliveryPartnerId || null,
              deliveryPartnerName: order.deliveryPartnerId?.name || order.deliveryPartnerName || null,
              deliveryPartnerPhone: order.deliveryPartnerId?.phone || order.deliveryPartnerPhone || null,
              note: order.note || null,
              orderType: order.orderType || 'delivery'
            }
          })

          // Sort by date (newest first)
          transformedOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

          debugLog('? Orders fetched and transformed:', {
            total: transformedOrders.length,
            delivered: transformedOrders.filter(o => o.status === 'delivered' || o.originalStatus === 'delivered').length,
            withRating: transformedOrders.filter(o => o.restaurantRating && (!o.deliveryPartnerId || o.deliveryPartnerRating)).length,
            sample: transformedOrders.slice(0, 2).map(o => ({
              id: o.id,
              status: o.status,
              originalStatus: o.originalStatus,
              restaurantRating: o.restaurantRating,
              deliveryPartnerRating: o.deliveryPartnerRating,
              deliveredAt: o.deliveredAt
            }))
          })

          setOrders(transformedOrders)
        } else if (!isBackground) {
          debugLog('?? No orders data in response')
          setOrders([])
        }
      } catch (error) {
        debugError('Error fetching user orders:', error)
        if (!isBackground && isMounted) {
          let errorMessage = 'Failed to load orders'
          if (error?.response?.status === 401) {
            errorMessage = 'Please login to view your orders'
          } else if (error?.response?.data?.message) {
            errorMessage = error.response.data.message
          }
          toast.error(errorMessage)
          setOrders([])
        }
      } finally {
        if (!isBackground && isMounted) {
          setLoading(false)
        }
      }
    }

    fetchOrders(false)

    // Poll for order updates in background without reloading or flashing the page
    const pollInterval = setInterval(() => {
      fetchOrders(true)
    }, 20000)

    return () => {
      isMounted = false
      clearInterval(pollInterval)
    }
  }, [])

  // Format date helper
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const day = date.getDate().toString().padStart(2, '0')
    const month = date.toLocaleDateString('en-US', { month: 'short' })
    const hours = date.getHours()
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 || 12

    return `${day} ${month}, ${displayHours}:${minutes}${ampm}`
  }

  // Filter orders based on search query
  const filteredOrders = orders.filter(order => {
    if (!searchQuery.trim()) return true

    const query = searchQuery.toLowerCase()
    const restaurantMatch = order.restaurant?.toLowerCase().includes(query)
    const itemsMatch = order.items.some(item =>
      (item.name || item.foodName || '').toLowerCase().includes(query)
    )

    return restaurantMatch || itemsMatch
  })

  const ratingModalHasDeliveryPartner = !!(ratingModal.order?.deliveryPartnerId || ratingModal.order?.deliveryPartnerName)
  const ratingSubmitDisabled = submittingRating ||
    selectedRestaurantRating === null ||
    (ratingModalHasDeliveryPartner && selectedDeliveryRating === null)

  // Handle reorder
  const handleReorder = (order) => {
    const restaurantTarget = order.restaurantSlug || order.restaurantId

    if (!restaurantTarget || !order.items?.length) {
      toast.info('Order items or restaurant information not available')
      return
    }

    const reorderItems = order.items
      .map((item, index) => {
        const itemId = item.id || item.itemId || item._id
        if (!itemId) return null

        return {
          id: itemId,
          name: item.name || item.foodName || "Item",
          price: Number(item.price) || 0,
          image: item.image || "",
          restaurant: order.restaurant || "Restaurant",
          restaurantId: order.restaurantId,
          description: item.description || "",
          isVeg: isVegMenuItem(item, order.restaurantId),
          quantity: Math.max(1, Number(item.quantity) || 1),
          reorderIndex: index,
        }
      })
      .filter(Boolean)

    if (!reorderItems.length) {
      toast.error("No reorderable items found in this order")
      return
    }

    replaceCart(reorderItems)
    toast.success("Items added to cart")
    navigate(`/food/user/restaurants/${restaurantTarget}`)
  }

  // Three-dots menu handlers
  const toggleMenuForOrder = (orderId) => {
    setActiveMenuOrderId((current) => (current === orderId ? null : orderId))
  }

  const openShareModal = (payload) => {
    setSharePayload(payload)
    setShowShareModal(true)
  }

  const tryNativeShare = async (payload) => {
    if (typeof navigator === "undefined" || !navigator.share) return false
    try {
      await navigator.share(payload)
      return true
    } catch (error) {
      if (error?.name === "AbortError") return true
      return false
    }
  }

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Link copied to clipboard!")
    } catch (error) {
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand("copy")
        toast.success("Link copied to clipboard!")
      } catch (err) {
        toast.error("Failed to copy link")
      }
      if (document.body.contains(textArea)) {
        document.body.removeChild(textArea)
      }
    }
  }

  const openShareTarget = (target) => {
    if (!sharePayload?.url) return

    const text = sharePayload.text || ""
    const url = sharePayload.url
    const encodedText = encodeURIComponent(text)
    const encodedUrl = encodeURIComponent(url)

    let shareLink = ""

    if (target === "whatsapp") {
      shareLink = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "telegram") {
      shareLink = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    } else if (target === "email") {
      shareLink = `mailto:?subject=${encodeURIComponent(sharePayload.title || "Check this out")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    } else if (target === "sms") {
      shareLink = `sms:?body=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "facebook") {
      shareLink = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
    } else if (target === "x") {
      shareLink = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "linkedin") {
      shareLink = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`
    }

    if (shareLink) {
      window.open(shareLink, "_blank", "noopener,noreferrer")
      setShowShareModal(false)
    }
  }

  const copyShareLink = async () => {
    if (!sharePayload?.url) return
    await copyToClipboard(sharePayload.url)
    setShowShareModal(false)
  }

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  const handleShareRestaurant = async (order) => {
    const companyName = await getCompanyNameAsync()
    const location =
      order.restaurantLocation ||
      `${order.address?.city || ""}, ${order.address?.state || ""}`.trim()
    const restaurantPath = order.restaurantSlug || order.restaurantId
    const shareUrl = restaurantPath
      ? `${window.location.origin}/food/user/restaurants/${restaurantPath}`
      : `${window.location.origin}/food/user/orders/${order.id}`

    const shareText = `Check out ${order.restaurant} on ${companyName}.
Location: ${location || "Location not available"}
Order again from this restaurant in the ${companyName} app.`

    const payload = {
      title: order.restaurant,
      text: shareText,
      url: shareUrl,
    }

    try {
      const shared = await tryNativeShare(payload)
      if (shared) {
        toast.success("Restaurant shared successfully")
        return
      }

      openShareModal(payload)
    } catch (error) {
      if (error?.name !== "AbortError") {
        debugError("Error sharing restaurant:", error)
        toast.error("Failed to share restaurant")
      }
    } finally {
      setActiveMenuOrderId(null)
    }
  }

  const handleViewOrderDetails = (order) => {
    setActiveMenuOrderId(null)
    const status = String(order.status || '').toLowerCase()
    const isTerminal = ['delivered', 'cancelled', 'completed', 'failed'].includes(status) || status.includes('cancelled')
    
    if (isTerminal) {
      navigate(toFoodUserPath(`/user/orders/${order.id}/details`), { state: { from: '/food/user/orders', order } })
    } else {
      navigate(toFoodUserPath(`/user/orders/${order.id}`), { state: { from: '/food/user/orders', order } })
    }
  }

  // Open rating modal for an order
  const handleOpenRating = (order) => {
    setRatingModal({ open: true, order })
    setSelectedRestaurantRating(order.restaurantRating || null)
    setSelectedDeliveryRating(order.deliveryPartnerRating || null)
    setRestaurantFeedbackText(order.ratings?.restaurant?.comment || "")
    setDeliveryFeedbackText(order.ratings?.deliveryPartner?.comment || "")
  }

  const handleCloseRating = () => {
    setRatingModal({ open: false, order: null })
    setSelectedRestaurantRating(null)
    setSelectedDeliveryRating(null)
    setRestaurantFeedbackText("")
    setDeliveryFeedbackText("")
  }

  // Submit rating & feedback to backend
  const handleSubmitRating = async () => {
    const hasDeliveryPartner = !!(ratingModal.order?.deliveryPartnerId || ratingModal.order?.deliveryPartnerName)
    const isMissingDeliveryRating = hasDeliveryPartner && selectedDeliveryRating === null
    if (!ratingModal.order || selectedRestaurantRating === null || isMissingDeliveryRating) {
      toast.error("Please select all required ratings first")
      return
    }

    try {
      setSubmittingRating(true)

      const order = ratingModal.order

      const response = await orderAPI.submitOrderRatings(order.id, {
        restaurantRating: selectedRestaurantRating,
        deliveryPartnerRating: hasDeliveryPartner ? selectedDeliveryRating : undefined,
        restaurantComment: restaurantFeedbackText || undefined,
        deliveryPartnerComment: hasDeliveryPartner ? (deliveryFeedbackText || undefined) : undefined,
      })
      const updatedOrder = response?.data?.data?.order || response?.data?.order || null

      // Update local state so UI shows "You rated"
      setOrders(prev =>
        prev.map(o =>
          o.id === order.id ? {
            ...o,
            restaurantRating: updatedOrder?.ratings?.restaurant?.rating ?? selectedRestaurantRating,
            deliveryPartnerRating: updatedOrder?.ratings?.deliveryPartner?.rating ?? (hasDeliveryPartner ? selectedDeliveryRating : null),
            ratings: updatedOrder?.ratings || {
              restaurant: { rating: selectedRestaurantRating, comment: restaurantFeedbackText || "" },
              deliveryPartner: hasDeliveryPartner ? { rating: selectedDeliveryRating, comment: deliveryFeedbackText || "" } : undefined
            },
            rating: updatedOrder?.ratings?.restaurant?.rating ?? selectedRestaurantRating
          } : o
        )
      )

      toast.success("Thanks for rating your order!")

      // Mark this order as rated so popup doesn't show again (before closing modal)
      const orderId = order.id || order._id || order.mongoId
      setShownRatingForOrders(prev => new Set([...prev, orderId]))

      handleCloseRating()
    } catch (error) {
      debugError("Error submitting order ratings:", error)
      toast.error(
        error?.response?.data?.message ||
        "Failed to submit ratings. Please try again."
      )
    } finally {
      setSubmittingRating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#141414] pb-10">
        <div className="bg-white dark:bg-[#121212] p-4 flex items-center shadow-sm sticky top-0 z-10 border-b dark:border-gray-800">
          <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-300 cursor-pointer" onClick={goBack} />
          <h1 className="ml-4 text-xl font-semibold text-gray-800 dark:text-gray-100">Your Orders</h1>
        </div>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#1F6B45] animate-spin" />
        </div>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#141414] pb-10">
        <div className="bg-white dark:bg-[#121212] p-4 flex items-center shadow-sm sticky top-0 z-10 border-b dark:border-gray-800">
          <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-300 cursor-pointer" onClick={goBack} />
          <h1 className="ml-4 text-xl font-semibold text-gray-800 dark:text-gray-100">Your Orders</h1>
        </div>
        <div className="px-4 py-8 text-center text-gray-600 dark:text-gray-400">
          <p>You haven't placed any orders yet</p>
          <Link to={toFoodUserPath("/user")}>
            <button className="mt-4 text-[#1F6B45] font-medium">Start Ordering</button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#141414] pb-10 font-sans">
      {/* Header */}
      <div className="bg-white dark:bg-[#121212] p-4 flex items-center shadow-sm sticky top-0 z-10 border-b dark:border-gray-800">
        <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-300 cursor-pointer" onClick={goBack} />
        <h1 className="ml-4 text-xl font-semibold text-gray-800 dark:text-gray-100">Your Orders</h1>
      </div>

      {/* Search Bar */}
      <div className="p-4 bg-white dark:bg-[#121212] mt-1 border-b dark:border-gray-800">
        <div className="flex items-center bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 shadow-sm">
          <Search className="w-5 h-5 text-[#1F6B45]" />
          <input
            type="text"
            placeholder="Search by restaurant or dish"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 ml-3 bg-transparent outline-none text-gray-600 dark:text-gray-300 placeholder-gray-400"
          />
        </div>
      </div>

      {/* Orders List */}
      <div className="px-4 py-2 space-y-4">
        {filteredOrders.length === 0 ? (
          <div className="bg-white dark:bg-[#121212] rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400">No orders found matching your search</p>
          </div>
        ) : (
          filteredOrders.map((order) => {
            // Check payment method - COD/wallet orders have 'pending' status which is normal
            const isCodOrWallet = order.payment?.method === 'cash' ||
              order.payment?.method === 'cod' ||
              order.payment?.method === 'wallet' ||
              order.paymentMethod === 'cash' ||
              order.paymentMethod === 'cod' ||
              order.paymentMethod === 'wallet'

            // Payment failed only for online payments (razorpay) that actually failed
            // Don't show payment failed for COD/wallet or cancelled orders
            const isCancelled = order.status === 'cancelled' || order.status === 'restaurant_cancelled'
            const paymentFailed = !isCodOrWallet &&
              !isCancelled &&
              (order.payment?.status === 'failed')

            const isDelivered = order.status === 'delivered'
            // Takeaway "Pay at Pickup" order that is placed but not yet paid.
            const isAwaitingPickupPayment =
              String(order.payment?.status || '').toLowerCase() === 'awaiting_pickup_payment'
            const isRestaurantCancelled = order.isRestaurantCancelled || order.status === 'restaurant_cancelled'
            const isUserCancelled = order.isUserCancelled || (isCancelled && order.cancelledBy === 'user')
            // Prefer restaurant image; fallback to food image from first item, then generic food photo
            const firstItemImage = order.items?.[0]?.image
            const restaurantImage = order.restaurantImage
              || firstItemImage
              || "https://images.unsplash.com/photo-1604908176997-125188eb3c52?auto=format&fit=crop&w=200&q=80"
            const location = order.restaurantLocation || `${order.address?.city || ''}, ${order.address?.state || ''}`.trim() || 'Location not available'

            return (
              <div key={order.id} className="relative bg-white dark:bg-[#121212] rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
                {/* Card Header: Restaurant Info */}
                <div className="flex items-start justify-between p-4 pb-2">
                  <div className="flex gap-3">
                    {/* Restaurant Image */}
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-gray-200 overflow-hidden flex-shrink-0">
                      <img
                        src={restaurantImage}
                        alt={order.restaurant}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.src = "https://images.unsplash.com/photo-1555949258-eb67b1ef0ceb?auto=format&fit=crop&w=100&q=80"
                        }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-base sm:text-lg leading-tight truncate flex items-center gap-2 flex-wrap">
                        {order.restaurant}
                        {order.orderType === 'takeaway' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[9px] font-extrabold text-[#D97706] bg-[#FEF3C7] border border-[#F59E0B]/30 rounded-full uppercase tracking-wider shadow-sm">
                            🥡 Takeaway (Self-Pick)
                          </span>
                        ) : order.orderType === 'dining' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[9px] font-extrabold text-[#2563EB] bg-[#DBEAFE] border border-[#3B82F6]/30 rounded-full uppercase tracking-wider shadow-sm">
                            🍽️ Dining In
                          </span>
                        ) : null}
                      </h3>
                      <p className="text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        Order ID: <span className="font-semibold text-gray-700 dark:text-gray-300">{order.orderId || order.id}</span>
                      </p>
                      <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{location}</p>
                      {order.deliveryPartnerName && (
                        <p className="text-xs text-gray-600 mt-1">
                          <span className="font-medium">Delivery:</span> {order.deliveryPartnerName}
                          {order.deliveryPartnerPhone && ` | ${order.deliveryPartnerPhone}`}
                        </p>
                      )}
                      {order.restaurantId && (
                        <Link to={toFoodUserPath(`/user/restaurants/${order.restaurantId}`)}>
                          <button className="text-xs text-[#1F6B45] font-medium flex items-center mt-1 hover:text-[#14512F]">
                            View menu <span className="ml-0.5">&gt;</span>
                          </button>
                        </Link>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleMenuForOrder(order.id)}
                    className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                  >
                    <MoreVertical className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                {/* Three-dots dropdown menu */}
                {activeMenuOrderId === order.id && (
                  <div className="absolute right-3 top-10 z-20 w-40 rounded-xl bg-white dark:bg-[#242424] shadow-lg border border-gray-100 dark:border-gray-800 py-1 text-xs">
                    <button
                      type="button"
                      onClick={() => handleShareRestaurant(order)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200"
                    >
                      Share restaurant
                    </button>
                    <button
                      type="button"
                      onClick={() => handleViewOrderDetails(order)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200"
                    >
                      Order details
                    </button>
                  </div>
                )}

                {/* Separator */}
                <div className="border-t border-dashed border-gray-200 dark:border-gray-800 mx-4 my-1"></div>

                {/* Items List */}
                <div className="px-4 py-2 space-y-2">
                  {order.items && order.items.length > 0 ? (
                    order.items.map((item, idx) => {
                      const isVeg = isVegMenuItem(item, order.restaurantId)
                      const itemName = item.name || item.foodName || 'Item'
                      const itemQuantity = item.quantity || 1
                      const itemPrice = item.price || 0
                      const itemTotal = itemQuantity * itemPrice
                      const itemImage = item.image || null

                      return (
                        <div key={item._id || item.id || item.itemId || idx} className="flex items-start gap-3">
                          {/* Item Image */}
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0 border border-gray-100 dark:border-gray-800 shadow-xs">
                            <SafeImage
                              src={itemImage}
                              fallbackSrc={dishFallbackImage}
                              alt={itemName}
                              className="w-full h-full object-cover"
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start gap-2">
                              {/* Veg/Non-Veg Icon */}
                              <div className={`w-4 h-4 border ${isVeg ? 'border-green-600' : 'border-red-600'} flex items-center justify-center p-[2px] flex-shrink-0 mt-0.5`}>
                                <div className={`w-full h-full rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`}></div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm text-gray-800 dark:text-gray-200 font-medium block">
                                  {itemQuantity} x {itemName}
                                </span>
                                {item.variantName ? (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.variantName}</p>
                                ) : null}
                                {item.description && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>
                                )}
                              </div>
                              <div className="text-right flex-shrink-0">
                                <span className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-100">{"\u20B9"}{itemTotal.toFixed(2)}</span>
                                {itemQuantity > 1 && (
                                  <p className="hidden sm:block text-[10px] text-gray-500 dark:text-gray-400">{"\u20B9"}{itemPrice.toFixed(2)} each</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <p className="text-sm text-gray-500">No items found</p>
                  )}
                </div>

                {/* Order Summary Section */}
                <div className="px-3 sm:px-4 py-2 sm:py-3 bg-gray-50 dark:bg-[#242424] rounded-lg mx-3 sm:mx-4 mb-2">
                  <div className="space-y-1">
                    {order.subtotal > 0 && (
                      <div className="hidden sm:flex justify-between text-xs">
                        <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium">{"\u20B9"}{order.subtotal.toFixed(2)}</span>
                      </div>
                    )}
                    {order.deliveryFee > 0 && (
                      <div className="hidden sm:flex justify-between text-xs">
                        <span className="text-gray-600 dark:text-gray-400">Delivery Fee</span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium">{"\u20B9"}{order.deliveryFee.toFixed(2)}</span>
                      </div>
                    )}
                    {order.tax > 0 && (
                      <div className="hidden sm:flex justify-between text-xs">
                        <span className="text-gray-600 dark:text-gray-400">Tax</span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium">{"\u20B9"}{order.tax.toFixed(2)}</span>
                      </div>
                    )}
                    {order.pricing?.discount > 0 && (
                      <div className="flex justify-between text-[11px] sm:text-xs">
                        <span className="text-green-600">Discount Applied</span>
                        <span className="text-green-600 font-medium">-{"\u20B9"}{order.pricing.discount.toFixed(2)}</span>
                      </div>
                    )}
                    {order.pricing?.couponCode && (
                      <div className="hidden sm:flex justify-between text-xs">
                        <span className="text-gray-600">Coupon</span>
                        <span className="text-gray-800 font-medium">{order.pricing.couponCode}</span>
                      </div>
                    )}
                    <div className="sm:border-t border-gray-200 dark:border-gray-700 sm:pt-1.5 sm:mt-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200">Total Bill</span>
                        <span className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">{"\u20B9"}{order.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-gray-100 dark:border-gray-800 mx-4 my-2"></div>

                {/* Footer Section */}
                <div className="px-4 pb-4 pt-1 space-y-3">
                  {/* Row 1: Date, Payment Info, and Status Badge */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 flex-wrap text-gray-500 dark:text-gray-400">
                      <span className="font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800/80 px-2.5 py-1 rounded-lg border border-gray-200/50 dark:border-gray-700/50">
                        Placed: {formatDate(order.createdAt)}
                      </span>
                      <span className="hidden sm:inline text-gray-300 dark:text-gray-700">•</span>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        {order.payment?.method === 'cash' || order.payment?.method === 'cod' ? 'Cash on Delivery' :
                          order.payment?.method === 'wallet' ? 'Wallet' : 'Online'}
                      </span>
                      {order.payment?.status && (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                          (order.payment.status === 'completed' || (isDelivered && isCodOrWallet)) 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50' 
                            : order.payment.status === 'failed' 
                              ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50' 
                              : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50'
                        }`}>
                          {(isDelivered && isCodOrWallet)
                            ? 'Paid'
                            : isAwaitingPickupPayment
                              ? 'Payment Pending'
                              : order.payment.status}
                        </span>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center">
                      {isRestaurantCancelled ? (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50">
                          Cancelled by Restaurant
                        </span>
                      ) : paymentFailed ? (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50">
                          Payment Failed
                        </span>
                      ) : isDelivered ? (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50">
                          {order.orderType === "takeaway" ? "Picked UP" : "Delivered"}
                        </span>
                      ) : isUserCancelled || (isCancelled && order.cancelledBy === 'user') ? (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50">
                          Cancelled By You
                        </span>
                      ) : isCancelled ? (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50">
                          Cancelled
                        </span>
                      ) : isAwaitingPickupPayment ? (
                        <button
                          type="button"
                          onClick={() => navigate(toFoodUserPath(`/user/orders/${order.id}`), { state: { from: '/food/user/orders', order } })}
                          className="px-3 py-1 rounded-full text-[10px] font-black bg-amber-500 text-white shadow-sm border border-amber-500 uppercase tracking-widest active:scale-95 transition-transform"
                        >
                          Pay Now
                        </button>
                      ) : (order.orderType === 'takeaway' && (order.status === 'ready' || order.status === 'ready_for_pickup')) ? (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black bg-green-600 text-white shadow-sm border border-green-600 uppercase tracking-widest">
                          Ready for Pickup
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50 uppercase tracking-wider animate-pulse">
                          {getActiveOrderStatusLabel(order)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Secondary Metadata / Ratings and Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-gray-100/70 dark:border-gray-800/50">
                    {/* Left: Ratings or Countdowns or Cancellation Details */}
                    <div className="flex-1 min-w-0">
                      {isRestaurantCancelled ? (
                        <div className="flex flex-col gap-0.5">
                          {order.cancellationReason && (
                            <p className="text-xs text-red-500 dark:text-red-400 font-medium italic truncate">
                              Reason: {order.cancellationReason}
                            </p>
                          )}
                          <p className="text-[10px] text-gray-400 dark:text-gray-500">Refund processed in 24-48 hours</p>
                        </div>
                      ) : paymentFailed ? (
                        <span className="text-xs text-red-500 font-medium">Please try ordering again</span>
                      ) : isDelivered && order.restaurantRating && (!order.deliveryPartnerId || order.deliveryPartnerRating) ? (
                        <div className="flex items-center flex-wrap gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <span className="font-medium">Your rating:</span>
                          <div className="flex bg-emerald-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold items-center gap-0.5 h-4.5 shrink-0">
                            <span className="opacity-90">Food</span>
                            {order.restaurantRating}<Star className="w-2.5 h-2.5 fill-current text-white" />
                          </div>
                          {order.deliveryPartnerId && order.deliveryPartnerRating && (
                            <div className="flex bg-emerald-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold items-center gap-0.5 h-4.5 shrink-0">
                              <span className="opacity-90">Delivery</span>
                              {order.deliveryPartnerRating}<Star className="w-2.5 h-2.5 fill-current text-white" />
                            </div>
                          )}
                        </div>
                      ) : isDelivered ? (
                        <button
                          type="button"
                          onClick={() => handleOpenRating(order)}
                          className="text-xs text-slate-600 hover:text-[#1F6B45] dark:text-slate-300 font-bold flex items-center gap-1.5 transition-colors py-0.5"
                        >
                          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                          <span>{order.orderType === "takeaway" ? "Rate Restaurant" : "Rate Restaurant & Delivery"}</span>
                        </button>
                      ) : (
                        <div>
                          {/* Countdown Timer */}
                          {countdowns[order.id] && countdowns[order.id] > 0 && (
                            <div className="flex items-center gap-1 text-xs text-[#1F6B45] font-semibold">
                              <Clock size={12} className="animate-pulse shrink-0" />
                              <span>{countdowns[order.id]} min{countdowns[order.id] !== 1 ? 's' : ''} remaining</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: View Details / Track Order & Reorder buttons */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 w-full sm:w-auto pt-1 sm:pt-0">
                      {(!isDelivered && !isCancelled && !paymentFailed) ? (
                        <Link
                          to={toFoodUserPath(`/user/orders/${order.id}`)}
                          state={{ from: '/food/user/orders', order }}
                          className="bg-[#1F6B45] hover:bg-[#14512F] text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm hover:shadow-[#1F6B45]/20 transition-all duration-150 active:scale-95 cursor-pointer ml-auto sm:ml-0"
                        >
                          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                          Track Order
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      ) : (
                        <Link
                          to={toFoodUserPath((isDelivered || isCancelled) ? `/user/orders/${order.id}/details` : `/user/orders/${order.id}`)}
                          state={{ from: '/food/user/orders', order }}
                          className="py-1"
                        >
                          <span className="text-xs font-bold text-gray-600 dark:text-gray-400 hover:text-[#1F6B45] dark:hover:text-[#1F6B45] transition-colors cursor-pointer flex items-center gap-0.5">
                            View Details <ChevronRight className="w-3.5 h-3.5" />
                          </span>
                        </Link>
                      )}

                      {isDelivered && !paymentFailed && (
                        <button
                          onClick={() => handleReorder(order)}
                          className="bg-[#1F6B45] hover:bg-[#14512F] text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm hover:shadow-[#1F6B45]/20 transition-all duration-150 active:scale-95"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reorder
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

       {/* Footer Branding */}
      <div className="flex justify-center mt-8 mb-4">
        <h1 className="text-4xl font-black text-gray-200 dark:text-gray-800 tracking-tighter italic uppercase">eatiefy</h1>
      </div>

      {/* Rating & Feedback Bottom Sheet */}
      {ratingModal.open && ratingModal.order && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-in fade-in duration-200">
          {/* Backdrop */}
          <div
            onClick={handleCloseRating}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
          />

          <div className="relative z-10 w-full sm:max-w-md rounded-t-[2.5rem] sm:rounded-3xl bg-white dark:bg-[#121212] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in slide-in-from-bottom duration-300 border-t sm:border dark:border-gray-800">
            {/* Mobile Drag Handle */}
            <div className="pt-3 pb-1 flex justify-center sm:hidden">
              <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-zinc-700" />
            </div>

            {/* Header with gradient */}
            <div className="bg-gradient-to-r from-[#1F6B45] to-[#14512F] px-6 py-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Star className="w-5 h-5 fill-white" />
                  Rate Your Delivery
                </h2>
                <button
                  type="button"
                  onClick={handleCloseRating}
                  className="text-white/80 hover:text-white transition-colors p-1 rounded-full hover:bg-white/20"
                >
                  <span className="text-xl">x</span>
                </button>
              </div>
              <p className="text-sm text-white/90">{ratingModal.order.restaurant}</p>
            </div>

            <div className="px-6 py-6 font-sans overflow-y-auto">
              <div className="mb-6">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  Restaurant rating (out of 5)
                </p>
                <div className="flex items-center justify-center gap-2 mb-3">
                  {Array.from({ length: 5 }, (_, i) => i + 1).map((num) => {
                    const isActive = (selectedRestaurantRating || 0) >= num
                    return (
                      <button
                        key={`restaurant-${num}`}
                        type="button"
                        onClick={() => setSelectedRestaurantRating(num)}
                        className="p-2 transition-transform hover:scale-125 active:scale-95"
                      >
                        <Star
                          className={`w-10 h-10 transition-all ${isActive
                              ? "text-yellow-400 fill-yellow-400 drop-shadow-lg"
                              : "text-gray-300 hover:text-yellow-200"
                            }`}
                        />
                      </button>
                    )
                  })}
                </div>
                <textarea
                  rows={2}
                  value={restaurantFeedbackText}
                  onChange={(e) => setRestaurantFeedbackText(e.target.value)}
                  className="w-full rounded-xl border-2 border-gray-200 dark:border-gray-800 bg-white dark:bg-[#242424] px-4 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#1F6B45] focus:border-[#1F6B45] resize-none transition-all"
                  placeholder="Restaurant feedback (optional)"
                />
              </div>

              {ratingModalHasDeliveryPartner && (
                <div className="mb-6">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Delivery partner rating (out of 5)
                  </p>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    {Array.from({ length: 5 }, (_, i) => i + 1).map((num) => {
                      const isActive = (selectedDeliveryRating || 0) >= num
                      return (
                        <button
                          key={`delivery-${num}`}
                          type="button"
                          onClick={() => setSelectedDeliveryRating(num)}
                          className="p-2 transition-transform hover:scale-125 active:scale-95"
                        >
                          <Star
                            className={`w-10 h-10 transition-all ${isActive
                                ? "text-yellow-400 fill-yellow-400 drop-shadow-lg"
                                : "text-gray-300 hover:text-yellow-200"
                              }`}
                          />
                        </button>
                      )
                    })}
                  </div>
                  <textarea
                    rows={2}
                    value={deliveryFeedbackText}
                    onChange={(e) => setDeliveryFeedbackText(e.target.value)}
                    className="w-full rounded-xl border-2 border-gray-200 dark:border-gray-800 bg-white dark:bg-[#242424] px-4 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#1F6B45] focus:border-[#1F6B45] resize-none transition-all"
                    placeholder="Delivery partner feedback (optional)"
                  />
                </div>
              )}

              {/* Continue/Save Button */}
              <button
                type="button"
                disabled={ratingSubmitDisabled}
                onClick={handleSubmitRating}
                className={`w-full rounded-2xl h-12 py-3.5 px-4 font-bold text-base transition-all flex items-center justify-center gap-2 shadow-md ${
                  ratingSubmitDisabled
                    ? "bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-zinc-700 cursor-not-allowed opacity-90 shadow-none"
                    : "bg-[#1F6B45] hover:bg-[#1A5C3B] active:scale-[0.99] text-white shadow-[#1F6B45]/25 cursor-pointer"
                }`}
              >
                {submittingRating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-current" />
                    <span className="font-bold text-current">Saving...</span>
                  </>
                ) : (
                  <>
                    <Star className={`w-5 h-5 ${ratingSubmitDisabled ? "text-gray-500 dark:text-gray-400 fill-none" : "text-white fill-white"}`} />
                    <span className="font-bold text-current">Save & Continue</span>
                  </>
                )}
              </button>

              {ratingSubmitDisabled && (
                <p className="text-xs text-center text-red-500 mt-2">Please select all required ratings to continue</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showShareModal && sharePayload && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm px-4 pb-4 pt-10 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#121212] shadow-2xl overflow-hidden border dark:border-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Share restaurant</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Choose an app to share this restaurant</p>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close share modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-5 space-y-3 font-sans">
              {typeof navigator !== "undefined" && navigator.share && (
                <button
                  type="button"
                  onClick={handleSystemShareFromModal}
                  className="w-full rounded-2xl bg-[#1F6B45] px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 hover:bg-[#14512F] transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                  Share via apps
                </button>
              )}

              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => openShareTarget("whatsapp")}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <MessageCircle className="w-5 h-5 text-green-600" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => openShareTarget("telegram")}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Send className="w-5 h-5 text-sky-500" />
                  Telegram
                </button>
                <button
                  type="button"
                  onClick={() => openShareTarget("email")}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Mail className="w-5 h-5 text-rose-500" />
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => openShareTarget("sms")}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <MessagesSquare className="w-5 h-5 text-violet-500" />
                  SMS
                </button>
                <button
                  type="button"
                  onClick={() => openShareTarget("facebook")}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Share2 className="w-5 h-5 text-blue-600" />
                  Facebook
                </button>
                <button
                  type="button"
                  onClick={() => openShareTarget("x")}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Link2 className="w-5 h-5 text-gray-900 dark:text-gray-100" />
                  X
                </button>
                <button
                  type="button"
                  onClick={() => openShareTarget("linkedin")}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Share2 className="w-5 h-5 text-blue-700" />
                  LinkedIn
                </button>
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3 py-4 text-xs font-medium text-gray-700 dark:text-gray-200 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Copy className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  Copy link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

