import React, { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import {
  ArrowLeft,
  RotateCcw,
  ShoppingBag,
  Utensils,
  ChevronRight,
  Loader2,
  Sparkles,
  Flame,
  Clock,
  MapPin,
  Compass,
} from "lucide-react"
import { orderAPI } from "@food/api"
import { useCart } from "@food/context/CartContext"
import { toast } from "sonner"
import FloatingHomeDock from "@food/components/user/FloatingHomeDock"
import { isVegMenuItem } from "@food/utils/vegMode"
import SafeImage from "@food/components/SafeImage"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"

export default function Reorder() {
  const navigate = useNavigate()
  const { replaceCart } = useCart()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    let isMounted = true

    const fetchUserOrders = async () => {
      try {
        setLoading(true)
        let fetchedOrders = []

        // Try API first if user is logged in
        try {
          const response = await orderAPI.getOrders({ limit: 50, page: 1 })
          if (response?.data?.success && response?.data?.data?.orders) {
            fetchedOrders = response.data.data.orders
          } else if (response?.data?.orders) {
            fetchedOrders = response.data.orders
          } else if (Array.isArray(response?.data?.data)) {
            fetchedOrders = response.data.data
          }
        } catch (apiErr) {
          console.warn("API orders fetch failed or user not logged in:", apiErr)
        }

        // Fallback or merge with localStorage userOrders
        let localOrders = []
        try {
          const saved = localStorage.getItem("userOrders")
          if (saved) {
            localOrders = JSON.parse(saved)
          }
        } catch {
          // ignore error
        }

        // Combine and deduplicate
        const orderMap = new Map()
        localOrders.forEach((o) => {
          const id = o.id || o._id || o.orderId
          if (id) orderMap.set(id, o)
        })
        fetchedOrders.forEach((o) => {
          const id = o.orderId || o._id || o.id
          if (id) orderMap.set(id, o)
        })

        const allOrders = Array.from(orderMap.values()).sort(
          (a, b) =>
            new Date(b.createdAt || Date.now()) -
            new Date(a.createdAt || Date.now())
        )

        if (isMounted) {
          setOrders(allOrders)
        }
      } catch (error) {
        console.error("Error loading orders for orders page:", error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchUserOrders()

    return () => {
      isMounted = false
    }
  }, [])

  const handleReorder = (order) => {
    const items = order.items || []
    if (!items.length) {
      toast.info("No items found in this order to order again.")
      return
    }

    const restaurantId =
      order.restaurantId?._id ||
      order.restaurantId ||
      order.restaurantSlug ||
      "restaurant"

    const restaurantName =
      order.restaurantId?.restaurantName ||
      order.restaurantName ||
      order.restaurant ||
      "Restaurant"

    const reorderItems = items
      .map((item, index) => {
        const itemId = item.id || item.itemId || item._id
        const itemImg =
          item.image ||
          item.foodImage ||
          item.imageUrl ||
          item.itemImage ||
          item.foodId?.image ||
          ""

        return {
          id: itemId || `item-${index}`,
          name: item.name || item.foodName || "Item",
          price: Number(item.price || item.unitPrice || 0),
          image: itemImg,
          restaurant: restaurantName,
          restaurantId: restaurantId,
          isVeg: isVegMenuItem(item, order.restaurantId),
          quantity: Math.max(1, Number(item.quantity) || 1),
        }
      })
      .filter((item) => item.price > 0 || item.name)

    if (!reorderItems.length) {
      toast.error("No valid items to order.")
      return
    }

    replaceCart(reorderItems)
    toast.success("Items added to cart!")

    const targetRoute =
      typeof restaurantId === "string" && restaurantId !== "restaurant"
        ? `/food/user/restaurants/${restaurantId}`
        : `/food/user/cart`

    navigate(targetRoute)
  }

  // Dynamic Status Badge Helper
  const renderStatusBadge = (status) => {
    const rawStatus = String(status || "delivered").toLowerCase().trim()

    if (rawStatus === "delivered" || rawStatus === "completed") {
      return (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 flex-shrink-0">
          Delivered
        </span>
      )
    }

    if (rawStatus.includes("cancel")) {
      return (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 flex-shrink-0">
          Cancelled
        </span>
      )
    }

    if (rawStatus === "out_for_delivery" || rawStatus === "on_the_way" || rawStatus === "outfordelivery") {
      return (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 flex-shrink-0 animate-pulse">
          Out for Delivery
        </span>
      )
    }

    if (
      rawStatus === "preparing" ||
      rawStatus === "cooking" ||
      rawStatus === "ready" ||
      rawStatus === "ready_for_pickup"
    ) {
      return (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 flex-shrink-0">
          Preparing
        </span>
      )
    }

    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400 flex-shrink-0">
        {status ? String(status).toUpperCase() : "CONFIRMED"}
      </span>
    )
  }

  const isLiveOrder = (status) => {
    const s = String(status || "").toLowerCase()
    return (
      s === "pending" ||
      s === "confirmed" ||
      s === "preparing" ||
      s === "cooking" ||
      s === "ready" ||
      s === "ready_for_pickup" ||
      s === "out_for_delivery" ||
      s === "outfordelivery" ||
      s === "on_the_way"
    )
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#141414] pb-32 transition-colors duration-200">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-[#242424] border-b border-gray-100 dark:border-gray-800 px-4 py-3.5 flex items-center justify-between shadow-xs">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-1 rounded-full text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base sm:text-lg font-extrabold tracking-wider text-gray-900 dark:text-white uppercase">
          ORDERS
        </h1>
        <div className="w-8" />
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
            <Loader2 className="w-9 h-9 animate-spin text-[#24963F]" />
            <p className="text-sm font-semibold">Loading your orders...</p>
          </div>
        ) : orders.length === 0 ? (
          /* Empty State - Modern Zomato Standard */
          <div className="flex flex-col items-center justify-center text-center py-10 px-4">
            <div className="relative mb-6 flex items-center justify-center">
              {/* Ambient Glow */}
              <div className="absolute w-44 h-44 rounded-full bg-emerald-100/60 dark:bg-emerald-950/40 blur-2xl pointer-events-none" />

              <div className="w-48 h-48 sm:w-56 sm:h-56 relative flex items-center justify-center">
                {!imageError ? (
                  <img
                    src="/assets/empty_reorder_plate.png"
                    alt="Empty Food Orders"
                    className="w-full h-full object-contain drop-shadow-md transition-transform duration-500 hover:scale-105"
                    loading="lazy"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  /* Fallback Illustration */
                  <div className="w-40 h-40 rounded-full bg-gradient-to-tr from-emerald-50 to-emerald-100 dark:from-emerald-950/60 dark:to-emerald-900/40 border-2 border-dashed border-[#24963F]/40 flex flex-col items-center justify-center shadow-inner">
                    <Utensils className="w-16 h-16 text-[#24963F] opacity-85 mb-1" />
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      No Orders Yet
                    </span>
                  </div>
                )}
              </div>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">
              Uh Oh! You don’t have any food orders
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-sm font-medium">
              Order your favorite meals now to avail exclusive deals and fast
              doorstep delivery!
            </p>

            {/* Feature Pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-7">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/50 text-[#24963F] border border-emerald-200 dark:border-emerald-900">
                <Clock className="w-3.5 h-3.5" /> Under 30 mins
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-600 border border-amber-200 dark:border-amber-900">
                <Flame className="w-3.5 h-3.5" /> Flat Deals
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-50 dark:bg-purple-950/50 text-purple-600 border border-purple-200 dark:border-purple-900">
                <Sparkles className="w-3.5 h-3.5" /> Best Restaurants
              </span>
            </div>

            <Link
              to="/food/user"
              className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-[#24963F] to-[#16A34A] text-white font-bold text-sm sm:text-base shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 transition-all transform active:scale-95"
            >
              <ShoppingBag className="w-4 h-4" />
              Order Now
            </Link>
          </div>
        ) : (
          /* Previous Orders List */
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Past Orders
              </h2>
              <span className="text-xs text-gray-400 font-medium">
                {orders.length} {orders.length === 1 ? "Order" : "Orders"}
              </span>
            </div>

            {orders.map((order, idx) => {
              const restaurantName =
                order.restaurantId?.restaurantName ||
                order.restaurantName ||
                order.restaurant ||
                "Eatiefy Restaurant"

              const restaurantId =
                order.restaurantId?._id ||
                order.restaurantId?.id ||
                (typeof order.restaurantId === "string"
                  ? order.restaurantId
                  : null)

              const restaurantImage =
                order.restaurantId?.profileImage?.url ||
                order.restaurantId?.profileImage ||
                order.restaurantId?.coverImage ||
                order.restaurantImage ||
                order.restaurantId?.image ||
                null

              const orderDate = order.createdAt
                ? new Date(order.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "Recent Order"

              const items = order.items || []
              const totalPrice = order.pricing?.total || order.total || 0
              const orderStatus = order.status || order.orderStatus || "delivered"
              const hasLiveStatus = isLiveOrder(orderStatus)
              const orderIdDisplay = order.orderId || order._id || order.id

              return (
                <div
                  key={order.id || order._id || idx}
                  className="bg-white dark:bg-[#242424] rounded-2xl p-4 sm:p-5 shadow-xs border border-gray-100 dark:border-gray-800 hover:shadow-md transition-all"
                >
                  {/* Restaurant & Date Header */}
                  <div className="flex items-center justify-between pb-3.5 border-b border-gray-100 dark:border-gray-800/80">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 overflow-hidden border border-gray-100 dark:border-gray-800 flex items-center justify-center flex-shrink-0">
                        {restaurantImage ? (
                          <SafeImage
                            src={restaurantImage}
                            alt={restaurantName}
                            className="w-full h-full object-cover"
                            fallbackSrc={dishFallbackImage}
                          />
                        ) : (
                          <Utensils className="w-5 h-5 text-[#24963F]" />
                        )}
                      </div>

                      <div className="min-w-0">
                        {restaurantId ? (
                          <Link
                            to={`/food/user/restaurants/${restaurantId}`}
                            className="font-bold text-gray-900 dark:text-white text-sm sm:text-base hover:text-[#24963F] dark:hover:text-emerald-400 transition-colors flex items-center gap-1 truncate"
                          >
                            <span className="truncate">{restaurantName}</span>
                            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                          </Link>
                        ) : (
                          <h3 className="font-bold text-gray-900 dark:text-white text-sm sm:text-base truncate">
                            {restaurantName}
                          </h3>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {orderDate}
                        </p>
                      </div>
                    </div>

                    {/* Dynamic Status Badge */}
                    <div className="flex-shrink-0 ml-2">
                      {renderStatusBadge(orderStatus)}
                    </div>
                  </div>

                  {/* Food Items List with dynamic food photos */}
                  <div className="py-3.5 space-y-3">
                    {items.map((item, itemIdx) => {
                      const isVeg = isVegMenuItem(item, order.restaurantId)
                      const itemName =
                        item.name || item.foodName || "Food Item"
                      const itemQty = item.quantity || item.qty || 1
                      const itemPrice = Number(item.price || item.unitPrice || 0)
                      const itemTotal = itemPrice * itemQty
                      const foodPhoto =
                        item.image ||
                        item.foodImage ||
                        item.imageUrl ||
                        item.itemImage ||
                        item.foodId?.image ||
                        item.foodId?.profileImage ||
                        ""

                      return (
                        <div
                          key={item._id || item.id || item.itemId || itemIdx}
                          className="flex items-center justify-between gap-3 group"
                        >
                          {/* Left: Food photo + info */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Dynamic Food Photo Thumbnail */}
                            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-100 dark:border-gray-800 flex-shrink-0 shadow-xs relative">
                              <SafeImage
                                src={foodPhoto}
                                fallbackSrc={dishFallbackImage}
                                alt={itemName}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            </div>

                            {/* Food Details */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {/* Veg / Non-Veg Indicator */}
                                <span
                                  className={`w-3.5 h-3.5 rounded-xs border flex items-center justify-center p-[2px] flex-shrink-0 ${
                                    isVeg
                                      ? "border-emerald-600"
                                      : "border-red-600"
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      isVeg ? "bg-emerald-600" : "bg-red-600"
                                    }`}
                                  />
                                </span>

                                <span className="font-bold text-xs sm:text-sm text-gray-900 dark:text-gray-100 truncate">
                                  {itemName}
                                </span>
                              </div>

                              {item.variantName ? (
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                                  {item.variantName}
                                </p>
                              ) : null}

                              <div className="flex items-center gap-2 mt-1 text-[11px] sm:text-xs text-gray-500 dark:text-gray-400">
                                <span className="font-semibold text-gray-700 dark:text-gray-300">
                                  {itemQty} × ₹{itemPrice}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Right: Price */}
                          {itemTotal > 0 && (
                            <div className="text-right flex-shrink-0">
                              <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100">
                                ₹{itemTotal}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Total & Action Footer */}
                  <div className="pt-3.5 border-t border-gray-100 dark:border-gray-800/80 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[11px] sm:text-xs text-gray-400 font-medium block">
                        Total Amount
                      </span>
                      <span className="font-extrabold text-gray-900 dark:text-white text-base sm:text-lg">
                        ₹{totalPrice}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* If Active live order, give Live Track button */}
                      {hasLiveStatus && orderIdDisplay && (
                        <button
                          onClick={() =>
                            navigate(toFoodUserPath(`/user/orders/${orderIdDisplay}`))
                          }
                          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 font-bold text-xs sm:text-sm hover:bg-blue-100 transition-all active:scale-95 cursor-pointer"
                        >
                          <Compass className="w-3.5 h-3.5 animate-spin" />
                          Track
                        </button>
                      )}

                      {/* Order Button */}
                      <button
                        onClick={() => handleReorder(order)}
                        className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#24963F] to-[#16A34A] text-white font-bold text-xs sm:text-sm shadow-sm hover:shadow-md hover:opacity-95 transition-all active:scale-95 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        Order Again
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <FloatingHomeDock hasBottomNav />
    </div>
  )
}
