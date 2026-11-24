import { useState, useEffect } from "react"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  ArrowLeft,
  ShoppingBag,
  Phone,
  Copy,
  Download,
  User,
  CreditCard,
  Calendar,
  MapPin,
  RotateCcw,
  FileText,
  X,
  Check,
} from "lucide-react"
import { orderAPI, restaurantAPI } from "@food/api"
import { useCart } from "@food/context/CartContext"
import { toast } from "sonner"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { setupPdfFonts } from "@food/utils/pdfFontUtils"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { isVegMenuItem } from "@food/utils/vegMode"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import SafeImage from "@food/components/SafeImage"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function UserOrderDetails() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useAppBackNavigation()
  const { replaceCart } = useCart()
  const { orderId } = useParams()
  const initialOrder = location.state?.order || null
  const [order, setOrder] = useState(initialOrder)
  const [restaurant, setRestaurant] = useState(null)
  const [loading, setLoading] = useState(() => !initialOrder)

  useEffect(() => {
    let isMounted = true
    const fetchOrderDetails = async () => {
      try {
        if (!initialOrder) {
          setLoading(true)
        }
        // Fetch using the ID from params (which will now be the MongoDB _id)
        const response = await orderAPI.getOrderDetails(orderId)

        if (!isMounted) return

        let orderData = null
        if (response?.data?.success && response.data.data?.order) {
          orderData = response.data.data.order
        } else if (response?.data?.order && typeof response.data.order === 'object') {
          orderData = response.data.order
        } else {
          toast.error("Order not found")
          navigate(toFoodUserPath("/user/orders"))
          return
        }

        setOrder(orderData)

        // If restaurantId is just a string (not populated), fetch restaurant details separately
        const restaurantId = orderData.restaurantId
        if (restaurantId && typeof restaurantId === 'string' && !orderData.restaurant) {
          try {
            const restaurantResponse = await restaurantAPI.getRestaurantById(restaurantId)
            if (!isMounted) return
            if (restaurantResponse?.data?.success && restaurantResponse.data.data?.restaurant) {
              setRestaurant(restaurantResponse.data.data.restaurant)
            } else if (restaurantResponse?.data?.restaurant) {
              setRestaurant(restaurantResponse.data.restaurant)
            }
          } catch (restaurantError) {
            debugWarn("Failed to fetch restaurant details:", restaurantError)
            // Don't show error toast, just log it - order details can still be shown
          }
        }
      } catch (error) {
        debugError("Error fetching order details:", error)
        if (isMounted) {
          toast.error(
            error?.response?.data?.message || "Failed to load order details"
          )
          navigate(toFoodUserPath("/user/orders"))
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchOrderDetails()
    return () => {
      isMounted = false
    }
  }, [orderId, navigate])

  const handleCopyOrderId = async () => {
    if (!order) return
    const id = order.orderId || order._id || orderId
    try {
      await navigator.clipboard.writeText(String(id))
      toast.success("Order ID copied")
    } catch {
      toast.error("Failed to copy Order ID")
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#141414] flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400 text-sm">Loading order details...</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#141414] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-700 dark:text-gray-300 text-sm font-medium">Order not found</p>
          <button
            onClick={() => navigate(toFoodUserPath("/user/orders"))}
            className="px-4 py-2 rounded-lg bg-[#1F6B45] text-white text-sm font-semibold hover:bg-[#14512F] transition-all active:scale-95 shadow-md"
          >
            Back to Orders
          </button>
        </div>
      </div>
    )
  }

  const orderIdDisplay = order.orderId || order.order_id || (orderId && !/^[a-f0-9]{24}$/i.test(String(orderId)) ? orderId : null) || order._id || orderId
  // Use fetched restaurant data if available, otherwise use order.restaurantId or order.restaurant
  const restaurantObj = restaurant || order.restaurantId || order.restaurant || {}
  const restaurantName =
    order.restaurantName ||
    restaurantObj.restaurantName ||
    restaurantObj.name ||
    (typeof restaurantObj === 'string' ? restaurantObj : '') ||
    "Restaurant"

  // Build restaurant address (try restaurant fields first, then fall back)
  const restaurantLocation = (() => {
    const loc = restaurantObj.location || {}

    // Priority 1: direct address on restaurant object
    if (restaurantObj.address) return restaurantObj.address

    // Priority 2: formattedAddress from location
    if (loc.formattedAddress) return loc.formattedAddress

    // Priority 3: generic address / street-style fields
    if (loc.address) return loc.address

    if (loc.street || loc.city) {
      const parts = [
        loc.street,
        loc.area,
        loc.city,
        loc.state,
        loc.zipCode || loc.pincode || loc.postalCode,
      ].filter(Boolean)
      if (parts.length) return parts.join(", ")
    }

    // Priority 4: addressLine1 / addressLine2 style
    if (loc.addressLine1) {
      const parts = [
        loc.addressLine1,
        loc.addressLine2,
        loc.city,
        loc.state,
      ].filter(Boolean)
      if (parts.length) return parts.join(", ")
    }

    // Priority 5: order-level restaurantAddress if present
    if (order.restaurantAddress) return order.restaurantAddress

    // Don't fallback to user delivery address - show empty or "Address not available"
    return "Address not available"
  })()

  const items = Array.isArray(order.items) ? order.items : []
  const pricing = order.pricing || {}
  const sendsCutlery = order.sendCutlery !== false

  const userName = order.userName || order.customerName || ""
  const userPhone = order.userPhone || order.customerPhone || ""
  const paymentMethod = order.payment?.method || "Online"
  const paymentDate = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-IN", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    : ""

  // Try all common field names the backend may use for the delivery address
  const addressText = (() => {
    const candidates = [
      order.deliveryAddress,
      order.address,
      order.deliveryAddressId,
      order.userAddress,
    ].filter(Boolean);

    for (const addr of candidates) {
      // If addr is a plain string
      if (typeof addr === "string" && addr.trim()) return addr.trim();

      if (typeof addr === "object") {
        if (addr.formattedAddress) return addr.formattedAddress;
        if (addr.address && typeof addr.address === "string") return addr.address;
        const parts = [
          addr.houseNo || addr.houseNumber,
          addr.buildingName,
          addr.street || addr.streetAddress || addr.addressLine1,
          addr.addressLine2,
          addr.area || addr.locality || addr.neighbourhood,
          addr.landmark,
          addr.city || addr.town,
          addr.state,
          addr.zipCode || addr.pincode || addr.postalCode || addr.zip,
        ].filter(Boolean);
        if (parts.length) return parts.join(", ");
      }
    }
    return "";
  })();

  const savings =
    (pricing.discount || 0) +
    (pricing.originalItemTotal || 0) -
    (pricing.subtotal || 0)

  // Restaurant phone (multiple fallbacks) - use fetched restaurant data first
  const restaurantPhone =
    restaurantObj.primaryContactNumber ||
    restaurantObj.phone ||
    restaurantObj.contactNumber ||
    order.restaurantPhone ||
    ""

  const handleCallRestaurant = () => {
    if (!restaurantPhone) {
      toast.error("Restaurant phone number not available")
      return
    }
    window.location.href = `tel:${restaurantPhone}`
  }

  const handleDownloadSummary = async () => {
    try {
      const companyName = await getCompanyNameAsync()
      // Create new PDF document
      const doc = new jsPDF()
      setupPdfFonts(doc)

      // Title
      doc.setFontSize(16)
      doc.setFont('Roboto', 'bold')
      doc.text(`${companyName} Order: Summary and Receipt`, 105, 20, { align: 'center' })

      // Order details section
      let yPos = 35
      doc.setFontSize(10)
      doc.setFont('Roboto', 'normal')

      // Order ID
      doc.setFont('Roboto', 'bold')
      doc.text('Order ID:', 20, yPos)
      doc.setFont('Roboto', 'normal')
      doc.text(orderIdDisplay, 60, yPos)
      yPos += 7

      // Order Time
      doc.setFont('Roboto', 'bold')
      doc.text('Order Time:', 20, yPos)
      doc.setFont('Roboto', 'normal')
      const orderTimeLines = doc.splitTextToSize(paymentDate || 'N/A', 130)
      doc.text(orderTimeLines, 60, yPos)
      yPos += orderTimeLines.length * 7

      // Customer Name
      doc.setFont('Roboto', 'bold')
      doc.text('Customer Name:', 20, yPos)
      doc.setFont('Roboto', 'normal')
      doc.text(userName || 'Customer', 60, yPos)
      yPos += 7

      // Delivery Address
      doc.setFont('Roboto', 'bold')
      doc.text('Delivery Address:', 20, yPos)
      doc.setFont('Roboto', 'normal')
      const addressLines = doc.splitTextToSize(addressText || 'N/A', 130)
      doc.text(addressLines, 60, yPos)
      yPos += addressLines.length * 7

      // Restaurant Name
      doc.setFont('Roboto', 'bold')
      doc.text('Restaurant Name:', 20, yPos)
      doc.setFont('Roboto', 'normal')
      doc.text(restaurantName, 60, yPos)
      yPos += 7

      // Restaurant Address
      doc.setFont('Roboto', 'bold')
      doc.text('Restaurant Address:', 20, yPos)
      doc.setFont('Roboto', 'normal')
      const restaurantAddressLines = doc.splitTextToSize(restaurantLocation || 'N/A', 130)
      doc.text(restaurantAddressLines, 60, yPos)
      yPos += restaurantAddressLines.length * 7 + 5

      // Items table
      const tableData = items.map(item => [
        item.variantName ? `${item.name || 'Item'} (${item.variantName})` : (item.name || 'Item'),
        String(item.quantity || item.qty || 1),
        `₹${Number(item.price || 0).toFixed(2)}`,
        `₹${Number((item.price || 0) * (item.quantity || item.qty || 1)).toFixed(2)}`
      ])

      autoTable(doc, {
        startY: yPos,
        head: [['Item', 'Quantity', 'Unit Price', 'Total Price']],
        body: tableData,
        theme: 'striped',
        headStyles: { font: 'Roboto', fontStyle: 'bold', fillColor: [0, 0, 0], textColor: 255, fontSize: 10 },
        styles: { font: 'Roboto', fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 30, halign: 'center' },
          2: { cellWidth: 35, halign: 'right' },
          3: { cellWidth: 35, halign: 'right', fontStyle: 'bold' }
        }
      })

      // Get final Y position after table (autoTable adds lastAutoTable property)
      const finalY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : yPos + (tableData.length * 8) + 20

      // Total
      doc.setFontSize(12)
      doc.setFont('Roboto', 'bold')
      doc.text('Total:', 145, finalY + 10, { align: 'right' })
      doc.text(`₹${Number(pricing.total || 0).toFixed(2)}`, 195, finalY + 10, { align: 'right' })

      // Save PDF instantly
      const fileName = `Order_Summary_${orderIdDisplay}_${Date.now()}.pdf`
      doc.save(fileName)

      toast.success("Summary downloaded successfully!")
    } catch (error) {
      debugError("Error generating PDF:", error)
      toast.error("Failed to download summary")
    }
  }

  const handleReorder = (currentOrder) => {
    const restaurantTarget =
      restaurantObj.slug ||
      restaurantObj._id ||
      restaurantObj.restaurantId ||
      (typeof currentOrder?.restaurantId === "string" ? currentOrder.restaurantId : currentOrder?.restaurantId?._id)

    if (!restaurantTarget || !items.length) {
      toast.error("Order items or restaurant information not available")
      return
    }

    const reorderItems = items
      .map((item, index) => {
        const itemId = item.id || item.itemId || item._id
        if (!itemId) return null

        return {
          id: itemId,
          name: item.name || item.foodName || "Item",
          price: Number(item.price) || 0,
          image: item.image || "",
          restaurant: restaurantName,
          restaurantId: restaurantObj._id || restaurantObj.restaurantId || currentOrder?.restaurantId,
          description: item.description || "",
          isVeg: isVegMenuItem(item, restaurantObj),
          quantity: Math.max(1, Number(item.quantity || item.qty) || 1),
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#141414] pb-[calc(6.5rem+env(safe-area-inset-bottom,16px))] font-sans relative">
      {/* Header */}
      <div className="bg-white dark:bg-[#121212] p-4 flex items-center sticky top-0 z-20 shadow-sm border-b dark:border-gray-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-300 cursor-pointer" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Order Details</h1>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="p-4 space-y-4">
        {/* Status Card */}
        <div className="bg-white dark:bg-[#121212] p-4 rounded-xl flex items-center gap-3.5 shadow-sm border dark:border-gray-800">
          {(() => {
            const isCancelled = order.status === "cancelled" || order.status === "cancelled_by_restaurant" || order.status === "restaurant_cancelled" || order.status?.includes('cancel');
            const isDelivered = order.status === "delivered";
            return (
              <>
                <div className={`p-2.5 rounded-lg flex items-center justify-center ${
                  isCancelled
                    ? "bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400"
                    : isDelivered
                      ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400"
                }`}>
                  {isCancelled ? (
                    <X className="w-5 h-5" />
                  ) : isDelivered ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <ShoppingBag className="w-5 h-5 animate-pulse" />
                  )}
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 dark:text-gray-100 leading-tight">
                    {isDelivered
                      ? (order.orderType === "takeaway" ? "Order Picked UP" : "Order was delivered")
                      : isCancelled
                        ? "Order was cancelled"
                        : "Order Status: " + (order.status?.toUpperCase() || "PROCESSING")}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {isDelivered
                      ? "Thank you for ordering"
                      : isCancelled
                        ? "This order was not fulfilled"
                        : "We are processing your order"}
                  </p>
                </div>
              </>
            );
          })()}
        </div>

        {/* Cancellation Details Alert Box */}
        {(order.status === "cancelled" || order.status === "cancelled_by_restaurant" || order.status === "restaurant_cancelled" || order.status?.includes('cancel')) && (
          <div className="bg-red-50/60 dark:bg-red-950/10 border border-red-100/60 dark:border-red-900/20 rounded-xl p-4 shadow-sm flex gap-3 items-start">
            <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-red-800 dark:text-red-400 uppercase tracking-widest block">
                Cancellation Reason
              </span>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">
                {order.cancellationReason || "The restaurant was unable to fulfill this order."}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 pt-0.5">
                Refund will be initiated to your source payment method.
              </p>
            </div>
          </div>
        )}

        {/* Restaurant Info Card */}
        <div className="bg-white dark:bg-[#121212] p-4 rounded-xl shadow-sm border dark:border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <img
                src={
                  restaurantObj.profileImage?.url ||
                  restaurantObj.profileImage ||
                  order.restaurantImage ||
                  (Array.isArray(items) && items[0]?.image) ||
                  "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=100&q=80"
                }
                alt={restaurantName}
                className="w-10 h-10 rounded-lg object-cover"
              />
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">{restaurantName}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{restaurantLocation}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCallRestaurant}
              className="w-8 h-8 rounded-full border border-[#1F6B45]/20 flex items-center justify-center text-[#1F6B45] hover:bg-[#1F6B45]/5"
            >
              <Phone className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Order ID: #{orderIdDisplay}
            </span>
            <button type="button" onClick={handleCopyOrderId}>
              <Copy className="w-3 h-3 text-gray-400 dark:text-gray-500 cursor-pointer" />
            </button>
          </div>

          {order.note && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                Note: {order.note}
              </span>
            </div>
          )}

          <div className="border-t border-dashed border-gray-200 dark:border-gray-800 my-3" />

          {/* Items */}
          {items.map((item, idx) => (
            <div key={idx} className="flex justify-between items-start mt-4 first:mt-0">
              <div className="flex items-center gap-3">
                  <div className="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 rounded-xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800">
                    <SafeImage
                      src={item.image}
                      fallbackSrc={dishFallbackImage}
                      alt={item.name}
                      className="w-full h-full object-cover transform hover:scale-110 transition-transform duration-500"
                    />
                  </div>
                <div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 border ${isVegMenuItem(item, restaurant) ? "border-green-600" : "border-red-600"
                        } flex items-center justify-center p-[1px]`}
                    >
                      <div
                        className={`w-full h-full rounded-full ${isVegMenuItem(item, restaurant) ? "bg-green-600" : "bg-red-600"
                          }`}
                      />
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                      {item.quantity || item.qty || 1} x {item.name}{item.variantName ? ` (${item.variantName})` : ""}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-sm text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                ₹{(item.price || 0).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {/* Restaurant Complaint Button - visible after delivery */}
        {order && order.status === "delivered" && (
          <button
            type="button"
            onClick={() => {
              const orderMongoId = order._id || orderId
              if (!orderMongoId) {
                toast.error("Order ID not available. Please refresh the page.")
                return
              }
              const orderIdString = typeof orderMongoId === 'object' && orderMongoId.toString
                ? orderMongoId.toString()
                : String(orderMongoId)
              navigate(`/user/complaints/submit/${encodeURIComponent(orderIdString)}`)
            }}
            className="w-full bg-[#1F6B45]/5 border border-[#1F6B45]/20 text-[#1F6B45] py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-[#1F6B45]/10 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Restaurant Complaint
          </button>
        )}

        {/* Bill Summary Card */}
        <div className="bg-white dark:bg-[#121212] rounded-xl shadow-sm overflow-hidden border dark:border-gray-800">
          <div className="p-4 flex justify-between items-center border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Bill Summary</h3>
            </div>
            <button
              type="button"
              onClick={handleDownloadSummary}
              className="w-7 h-7 rounded-full bg-[#1F6B45]/10 flex items-center justify-center text-[#1F6B45] hover:bg-[#1F6B45]/20 transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Item total</span>
              <div>
                {pricing.originalItemTotal && (
                  <span className="text-gray-400 dark:text-gray-500 line-through mr-1">
                    ₹{Number(pricing.originalItemTotal).toFixed(2)}
                  </span>
                )}
                <span className="text-gray-800 dark:text-gray-200">
                  ₹{Number(pricing.subtotal || pricing.total || 0).toFixed(2)}
                </span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">GST (govt. taxes)</span>
              <span className="text-gray-800 dark:text-gray-200">
                ₹{Number(pricing.tax || 0).toFixed(2)}
              </span>
            </div>
            {order.orderType !== "takeaway" && order.orderType !== "dining" && (
              <div className="flex justify-between">
                <span className="text-gray-400 dark:text-gray-500 font-medium">Delivery fee</span>
                {pricing.deliveryFee === 0 && (
                  <span className="text-[#1F6B45] text-[10px] font-bold border border-[#1F6B45] px-1 rounded ml-1">
                    FREE
                  </span>
                )}
                <span className="text-[#1F6B45] dark:text-[#a04882] font-medium uppercase">
                  {pricing.deliveryFee ? `₹${Number(pricing.deliveryFee).toFixed(2)}` : "Free"}
                </span>
              </div>
            )}
            {Number(pricing.packagingFee || order.packagingFee || order.packagingCharge || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Packaging fee</span>
                <span className="text-gray-800 dark:text-gray-200">
                  ₹{Number(pricing.packagingFee || order.packagingFee || order.packagingCharge || 0).toFixed(2)}
                </span>
              </div>
            )}
            {Number(pricing.platformFee || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Platform fee</span>
                <span className="text-gray-800 dark:text-gray-200">
                  ₹{Number(pricing.platformFee || 0).toFixed(2)}
                </span>
              </div>
            )}
            {Number(pricing.discount || order.discountAmount || order.couponDiscount || 0) > 0 && (
              <div className="flex justify-between text-[#1F6B45] dark:text-green-400">
                <span className="font-medium">Coupon Discount</span>
                <span className="font-medium">
                  -₹{Number(pricing.discount || order.discountAmount || order.couponDiscount || 0).toFixed(2)}
                </span>
              </div>
            )}
            {Number(pricing.subscriptionFee || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Subscription / other fees</span>
                <span className="text-gray-800 dark:text-gray-200">
                  ₹{Number(pricing.subscriptionFee || 0).toFixed(2)}
                </span>
              </div>
            )}

            <div className="border-t border-gray-100 dark:border-gray-800 my-2 pt-2 flex justify-between items-center">
              <span className="font-bold text-gray-800 dark:text-gray-100 flex items-center">
                Paid
                {(() => {
                  const method = (order.payment?.method || order.paymentMethod || "online").toLowerCase();
                  if (method === "cash" || method === "cod") {
                    return (
                      <span className="px-2 py-0.5 ml-2.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
                        COD
                      </span>
                    );
                  }
                  return (
                    <span className="px-2 py-0.5 ml-2.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/50">
                      Online
                    </span>
                  );
                })()}
              </span>
              <span className="font-bold text-gray-800 dark:text-gray-100">
                ₹{Number(pricing.total || 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Savings Banner */}
          {savings > 0 && (
            <div className="relative bg-[#1F6B45]/5 p-3 pb-4 mt-2">
              <div className="absolute -top-1.5 left-0 w-full overflow-hidden leading-none">
                <svg
                  className="relative block w-[calc(100%+1.3px)] h-[8px]"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 1200 120"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M0,0V46.29c47,0,47,69.5,94,69.5s47-69.5,94-69.5,47,69.5,94,69.5,47-69.5,94-69.5,47,69.5,94,69.5,47-69.5,94-69.5,47,69.5,94,69.5,47-69.5,94-69.5,47,69.5,94,69.5V0Z"
                    fill="#ffffff"
                    className="fill-white"
                  />
                </svg>
              </div>

              <div className="flex items-center justify-center gap-2 pt-1 text-[#1F6B45] font-bold text-sm">
                <span></span>
                <span>
                  You saved ₹{Number(savings).toFixed(2)} on this order!
                </span>
              </div>
            </div>
          )}
        </div>

        {/* User & Delivery Details */}
        <div className="bg-white dark:bg-[#121212] p-4 rounded-xl shadow-sm space-y-4 border dark:border-gray-800">
          {/* User */}
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm">
                Customer Details
              </h4>
              <p className="text-gray-600 dark:text-gray-300 text-xs mt-0.5 font-medium">{userName || "Customer"}</p>
              <p className="text-gray-400 dark:text-gray-500 text-[11px] mt-0.5">{userPhone}</p>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800/50" />

          {/* Payment */}
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm">
                Payment Method
              </h4>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-gray-500 dark:text-gray-400 text-xs">Paid via</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                  (paymentMethod.toLowerCase() === 'cash' || paymentMethod.toLowerCase() === 'cod')
                    ? 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700'
                    : 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/50'
                }`}>
                  {paymentMethod}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800/50" />

          {/* Date */}
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
              <Calendar className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm">
                Payment Date
              </h4>
              <p className="text-gray-600 dark:text-gray-300 text-xs mt-0.5 font-medium">{paymentDate}</p>
            </div>
          </div>

          {/* Address */}
          {order.orderType !== "takeaway" && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-800/50" />
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm">
                    Delivery Address
                  </h4>
                  <p className="text-gray-600 dark:text-gray-300 text-xs mt-0.5 leading-relaxed font-medium">
                    {addressText || "Address not available"}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fixed Bottom Action Bar with Safe Area Support */}
      <div className="fixed bottom-0 left-0 right-0 w-full bg-white/95 dark:bg-[#121212]/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,16px))] z-30">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleReorder(order)}
            className="flex-1 bg-[#1F6B45] text-white py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#14512F] transition-all active:scale-[0.98] shadow-md shadow-[#1F6B45]/20 cursor-pointer min-h-[46px]"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <span>Reorder</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadSummary}
            className="flex-1 bg-white dark:bg-[#242424] border border-[#1F6B45] text-[#1F6B45] hover:bg-[#1F6B45]/5 py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer min-h-[46px]"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Invoice</span>
          </button>
        </div>
      </div>

    </div>
  )
}



