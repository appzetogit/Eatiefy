import { useEffect, useState } from "react"
import { Eye, MapPin, Package, User, Phone, Mail, Calendar, Clock, Truck, CreditCard, Receipt, CheckCircle2, FileText, Loader2, CheckCircle, XCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@food/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { removePlusCode } from "@food/utils/common"
import {
  resolveRestaurantItemUnitPrice,
  resolveItemMarkupUnit,
} from "@food/utils/restaurantOrderPricing"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const ADMIN_ORDER_STATUS_OPTIONS = [
  "Pending",
  "Accepted",
  "Processing",
  "Ready for Pickup",
  "Food On The Way",
  "Delivered",
  "Cancelled by User",
  "Cancelled by Restaurant",
  "Canceled",
]

const ADMIN_PAYMENT_STATUS_OPTIONS = [
  "Pending",
  "Paid",
  "COD Pending",
  "Failed",
  "Refunded",
]

const getStatusColor = (orderStatus) => {
  const colors = {
    "Delivered": "bg-emerald-100 text-emerald-700",
    "Pending": "bg-blue-100 text-blue-700",
    "Scheduled": "bg-blue-100 text-blue-700",
    "Accepted": "bg-green-100 text-green-700",
    "Processing": "bg-orange-100 text-orange-700",
    "Food On The Way": "bg-yellow-100 text-yellow-700",
    "Canceled": "bg-rose-100 text-rose-700",
    "Cancelled by Restaurant": "bg-red-100 text-red-700",
    "Cancelled by User": "bg-orange-100 text-orange-700",
    "Payment Failed": "bg-red-100 text-red-700",
    "Refunded": "bg-sky-100 text-sky-700",
    "Dine In": "bg-indigo-100 text-indigo-700",
    "Offline Payments": "bg-slate-100 text-slate-700",
  }
  return colors[orderStatus] || "bg-slate-100 text-slate-700"
}

const resolveCustomerId = (order) => {
  if (!order) return null
  return (
    order.customerId ||
    order.userId?._id ||
    order.userId?.id ||
    (typeof order.userId === "string" ? order.userId : null)
  )
}

const getPaymentStatusColor = (paymentStatus) => {
  if (paymentStatus === "Paid" || paymentStatus === "Collected") return "text-emerald-600"
  if (paymentStatus === "COD Pending" || paymentStatus === "Not Collected" || paymentStatus === "Awaiting Pickup Payment") return "text-amber-600"
  if (paymentStatus === "Unpaid" || paymentStatus === "Failed") return "text-red-600"
  return "text-slate-600"
}

const resolveDisplayOrderStatus = (order) => {
  if (!order) return "Pending"
  const existing = String(order.orderStatus || "").trim()
  if (ADMIN_ORDER_STATUS_OPTIONS.includes(existing)) return existing

  const backendStatus = String(order.orderStatus || order.status || "").toLowerCase()
  if (!backendStatus || backendStatus === "created") return "Pending"
  if (backendStatus === "confirmed") return "Accepted"
  if (backendStatus === "preparing") return "Processing"
  if (backendStatus === "ready_for_pickup") return "Ready for Pickup"
  if (backendStatus === "reached_pickup") return "Ready for Pickup"
  if (backendStatus === "picked_up" || backendStatus === "reached_drop") return "Food On The Way"
  if (backendStatus === "delivered") return "Delivered"
  if (backendStatus === "cancelled_by_restaurant") return "Cancelled by Restaurant"
  if (backendStatus === "cancelled_by_user") return "Cancelled by User"
  if (backendStatus === "cancelled_by_admin") return "Canceled"
  return existing || "Pending"
}

const resolveDisplayPaymentStatus = (order) => {
  if (!order) return "Pending"

  // 1:1 with DB payment.status (friendly labels only)
  const raw = String(order.payment?.status || "").toLowerCase()
  if (raw === "refunded") return "Refunded"
  if (raw === "failed") return "Failed"
  if (raw === "paid" || raw === "authorized" || raw === "captured" || raw === "settled") {
    return "Paid"
  }
  if (raw === "cod_pending") return "COD Pending"
  if (raw === "awaiting_pickup_payment") return "Awaiting Pickup Payment"

  // Legacy UI labels → current friendly labels
  if (order.paymentStatus === "Collected") return "Paid"
  if (order.paymentStatus === "Not Collected") return "COD Pending"
  if (ADMIN_PAYMENT_STATUS_OPTIONS.includes(order.paymentStatus)) {
    return order.paymentStatus
  }

  return "Pending"
}

export default function ViewOrderDialog({ isOpen, onOpenChange, order, onOrderUpdated }) {
  const { canEdit } = useAdminPermissions()
  const [customerTotalOrders, setCustomerTotalOrders] = useState(undefined)
  const [customerDeliveredOrders, setCustomerDeliveredOrders] = useState(undefined)
  const [customerCancelledOrders, setCustomerCancelledOrders] = useState(undefined)
  const [loadingCustomerOrders, setLoadingCustomerOrders] = useState(false)
  const [loadedCustomerId, setLoadedCustomerId] = useState(null)
  const [draftOrderStatus, setDraftOrderStatus] = useState("Pending")
  const [draftPaymentStatus, setDraftPaymentStatus] = useState("Pending")
  const [draftCancelReason, setDraftCancelReason] = useState("")
  const [updatingStatuses, setUpdatingStatuses] = useState(false)

  useEffect(() => {
    if (!isOpen || !order) return
    setDraftOrderStatus(resolveDisplayOrderStatus(order))
    setDraftPaymentStatus(resolveDisplayPaymentStatus(order))
    setDraftCancelReason("")
  }, [isOpen, order?.id, order?.orderId, order?.orderStatus, order?.paymentStatus, order?.payment?.status])

  useEffect(() => {
    if (draftOrderStatus === "Delivered" && draftPaymentStatus !== "Paid") {
      setDraftPaymentStatus("Paid")
    }
  }, [draftOrderStatus])

  const baselineOrderStatus = resolveDisplayOrderStatus(order)
  const baselinePaymentStatus = resolveDisplayPaymentStatus(order)
  const hasAdminStatusChanges =
    draftOrderStatus !== baselineOrderStatus || draftPaymentStatus !== baselinePaymentStatus
  // Cancelling here is a cancel the customer sees: it needs the reason they will read.
  const isCancellingOrder =
    draftOrderStatus !== baselineOrderStatus && /cancel/i.test(draftOrderStatus)

  useEffect(() => {
    if (!isOpen || !order) return

    const customerId = resolveCustomerId(order)
    if (!customerId) {
      setCustomerTotalOrders(null)
      setCustomerDeliveredOrders(null)
      setCustomerCancelledOrders(null)
      setLoadingCustomerOrders(false)
      setLoadedCustomerId(null)
      return
    }

    let cancelled = false
    setLoadingCustomerOrders(true)
    setCustomerTotalOrders(undefined)
    setCustomerDeliveredOrders(undefined)
    setCustomerCancelledOrders(undefined)
    setLoadedCustomerId(null)

    ;(async () => {
      try {
        const response = await adminAPI.getCustomerById(customerId)
        const data = response?.data?.data || response?.data
        const user = data?.user || data?.customer
        if (!cancelled) {
          setCustomerTotalOrders(Number(user?.totalOrders ?? user?.totalOrder ?? 0))
          setCustomerDeliveredOrders(Number(user?.totalDeliveredOrders ?? 0))
          setCustomerCancelledOrders(Number(user?.totalCancelledOrders ?? 0))
          setLoadedCustomerId(customerId)
        }
      } catch (error) {
        debugError("Error fetching customer order count:", error)
        if (!cancelled) {
          setCustomerTotalOrders(null)
          setCustomerDeliveredOrders(null)
          setCustomerCancelledOrders(null)
          setLoadedCustomerId(customerId)
        }
      } finally {
        if (!cancelled) setLoadingCustomerOrders(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, order?.id, order?.orderId, order?.customerId, order?.userId])

  if (!order) return null

  const customerId = resolveCustomerId(order)
  const showTotalOrdersSkeleton =
    Boolean(customerId) &&
    (loadingCustomerOrders || loadedCustomerId !== customerId)

  const customerPendingOrders = typeof customerTotalOrders === 'number'
    ? Math.max(0, customerTotalOrders - (customerDeliveredOrders || 0) - (customerCancelledOrders || 0))
    : undefined

  const displayOrderStatus = resolveDisplayOrderStatus(order)
  const displayPaymentStatus = resolveDisplayPaymentStatus(order)

  const handleAdminStatusUpdate = async () => {
    if (!hasAdminStatusChanges || updatingStatuses) return
    const orderKey = order.id || order._id || order.orderId
    if (!orderKey) {
      toast.error("Order id not found")
      return
    }

    const payload = {}
    if (draftOrderStatus !== baselineOrderStatus) payload.orderStatus = draftOrderStatus
    if (draftPaymentStatus !== baselinePaymentStatus) payload.paymentStatus = draftPaymentStatus
    if (!payload.orderStatus && !payload.paymentStatus) return
    if (isCancellingOrder) {
      const reason = draftCancelReason.trim()
      if (!reason) {
        toast.error("Enter the cancellation reason the customer will see")
        return
      }
      payload.cancellationReason = reason
    }

    setUpdatingStatuses(true)
    try {
      const response = await adminAPI.updateOrderStatuses(orderKey, payload)
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || "Update failed")
      }
      const updated = response?.data?.data?.order || response?.data?.order
      const nextOrder = {
        ...order,
        ...(updated || {}),
        id: order.id || order._id || updated?._id,
        orderId: order.orderId || updated?.orderId,
        orderStatus:
          draftOrderStatus !== baselineOrderStatus
            ? draftOrderStatus
            : resolveDisplayOrderStatus({
                ...order,
                ...updated,
                orderStatus: updated?.orderStatus || order.orderStatus,
              }),
        paymentStatus:
          draftPaymentStatus !== baselinePaymentStatus
            ? draftPaymentStatus
            : resolveDisplayPaymentStatus({ ...order, ...updated }),
        payment: updated?.payment || order.payment,
        status: updated?.orderStatus || order.status,
        deliveredAt: updated?.deliveredAt || order.deliveredAt,
        items:
          Array.isArray(updated?.items) && updated.items.length
            ? updated.items
            : order.items,
      }

      onOrderUpdated?.(nextOrder)
      toast.success("Order updated successfully")
    } catch (error) {
      debugError("Admin status update failed:", error)
      toast.error(
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          "Failed to update order",
      )
    } finally {
      setUpdatingStatuses(false)
    }
  }

  // Debug: Log order data to check billImageUrl
  if (order.billImageUrl) {
    debugLog('?? Bill Image URL found:', order.billImageUrl)
  } else {
    debugLog('?? Bill Image URL not found in order:', {
      orderId: order.orderId,
      hasBillImageUrl: !!order.billImageUrl,
      orderKeys: Object.keys(order)
    })
  }

  // Format address for display
  const formatAddress = (address) => {
    if (!address || typeof address !== "object") return "N/A"

    const formattedAddress = String(address.formattedAddress || "").trim()
    const rawAddress = String(address.address || "").trim()
    const parts = [
      formattedAddress,
      rawAddress,
      address.label,
      address.houseNumber,
      address.street,
      address.additionalDetails,
      address.landmark,
      address.addressLine1,
      address.addressLine2,
      address.area,
      address.city,
      address.state,
      address.zipCode,
      address.postalCode,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)

    const uniqueParts = []
    parts.forEach((part) => {
      const key = part.toLowerCase()
      const isContained = uniqueParts.some((existingPart) => {
        const existingKey = existingPart.toLowerCase()
        return existingKey === key || existingKey.includes(key) || key.includes(existingKey)
      })
      if (isContained) return
      uniqueParts.push(part)
    })

    return uniqueParts.length > 0 ? removePlusCode(uniqueParts.join(", ")) : "Address not available"
  }

  // Get coordinates if available
  const getCoordinates = (address) => {
    if (address?.location?.coordinates && Array.isArray(address.location.coordinates) && address.location.coordinates.length === 2) {
      const [lng, lat] = address.location.coordinates
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    }
    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] bg-white p-0 overflow-y-auto lg:left-[calc(50%+var(--admin-sidebar-offset,10rem))]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-orange-600" />
            Order Details
          </DialogTitle>
          <DialogDescription>
            View complete information about this order
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-6 space-y-6">
          {/* Basic Order Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Order ID
                </p>
                <p className="text-sm font-medium text-slate-900">{order.orderId || order.id || order.subscriptionId}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Order Date
                </p>
                <p className="text-sm font-medium text-slate-900">{order.date}{order.time ? `, ${order.time}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-3 mt-4">
                {/* Total Orders Box */}
                <div className="inline-flex flex-col self-start w-fit min-w-[8.5rem] bg-blue-100 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">Total Orders</span>
                  </div>
                  {showTotalOrdersSkeleton ? (
                    <span
                      className="inline-block h-7 w-10 rounded bg-blue-200/70 animate-pulse"
                      aria-label="Loading total orders"
                    />
                  ) : !customerId ? (
                    <p className="text-xl font-bold text-blue-600">-</p>
                  ) : (
                    <p className="text-xl font-bold text-blue-600">{customerTotalOrders ?? "-"}</p>
                  )}
                </div>

                {/* Delivered Orders Box */}
                <div className="inline-flex flex-col self-start w-fit min-w-[8.5rem] bg-green-100 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">Delivered</span>
                  </div>
                  {showTotalOrdersSkeleton ? (
                    <span
                      className="inline-block h-7 w-10 rounded bg-green-200/70 animate-pulse"
                      aria-label="Loading delivered orders"
                    />
                  ) : !customerId ? (
                    <p className="text-xl font-bold text-green-600">-</p>
                  ) : (
                    <p className="text-xl font-bold text-green-600">{customerDeliveredOrders ?? "-"}</p>
                  )}
                </div>

                {/* Cancelled Orders Box */}
                <div className="inline-flex flex-col self-start w-fit min-w-[8.5rem] bg-red-100 border border-red-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">Cancelled</span>
                  </div>
                  {showTotalOrdersSkeleton ? (
                    <span
                      className="inline-block h-7 w-10 rounded bg-red-200/70 animate-pulse"
                      aria-label="Loading cancelled orders"
                    />
                  ) : !customerId ? (
                    <p className="text-xl font-bold text-red-600">-</p>
                  ) : (
                    <p className="text-xl font-bold text-red-600">{customerCancelledOrders ?? "-"}</p>
                  )}
                </div>

                {/* Pending Orders Box */}
                <div className="inline-flex flex-col self-start w-fit min-w-[8.5rem] bg-amber-100 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">Pending</span>
                  </div>
                  {showTotalOrdersSkeleton ? (
                    <span
                      className="inline-block h-7 w-10 rounded bg-amber-200/70 animate-pulse"
                      aria-label="Loading pending orders"
                    />
                  ) : !customerId ? (
                    <p className="text-xl font-bold text-amber-600">-</p>
                  ) : (
                    <p className="text-xl font-bold text-amber-600">{customerPendingOrders ?? "-"}</p>
                  )}
                </div>
              </div>
              {order.orderOtp && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider flex items-center gap-2 font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    Handover Code (OTP)
                  </p>
                  <p className="text-lg font-bold text-slate-950 tracking-[0.2em]">{order.orderOtp}</p>
                </div>
              )}
              {order.estimatedDeliveryTime && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Estimated Delivery Time
                  </p>
                  <p className="text-sm font-medium text-slate-900">{order.estimatedDeliveryTime} minutes</p>
                </div>
              )}
              {order.deliveredAt && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Delivered At
                  </p>
                  <p className="text-sm font-medium text-slate-900">
                    {new Date(order.deliveredAt).toLocaleString('en-GB', { 
                      day: '2-digit', 
                      month: 'short', 
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    }).toUpperCase()}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {order.orderStatus && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Order Status</p>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(displayOrderStatus)}`}>
                    {displayOrderStatus}
                  </span>
                  {order.cancellationReason && (
                    <p className="text-xs text-red-600 mt-1">
                      <span className="font-medium">
                        {order.cancelledBy === 'user' ? 'Cancelled by User - ' : 
                         order.cancelledBy === 'restaurant' ? 'Cancelled by Restaurant - ' : 
                         'Cancellation '}Reason:
                      </span> {order.cancellationReason}
                    </p>
                  )}
                  {order.cancelledAt && (
                    <p className="text-xs text-slate-500 mt-1">
                      Cancelled: {new Date(order.cancelledAt).toLocaleString('en-GB', { 
                        day: '2-digit', 
                        month: 'short', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }).toUpperCase()}
                    </p>
                  )}
                </div>
              )}
              {(order.paymentStatus || order.paymentCollectionStatus != null || order.payment?.status) && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    Payment Status
                  </p>
                  <p className={`text-sm font-medium ${getPaymentStatusColor(displayPaymentStatus)}`}>
                    {displayPaymentStatus}
                  </p>
                </div>
              )}

              {/* Admin Controls — optional independent status updates */}
              <div hidden={!canEdit} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm">
                <h4 className="text-sm font-bold text-slate-900 mb-4">Admin Controls</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Change Order Status
                    </label>
                    <Select
                      value={draftOrderStatus}
                      onValueChange={setDraftOrderStatus}
                      disabled={updatingStatuses}
                    >
                      <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-slate-900 shadow-none hover:border-slate-300 focus:border-[#FF6B4A] focus:ring-[#FF6B4A]/30">
                        <SelectValue placeholder="Select order status" />
                      </SelectTrigger>
                      <SelectContent
                        side="bottom"
                        sideOffset={4}
                        avoidCollisions={false}
                        position="popper"
                        scrollToTopOnOpen
                        className="select-menu-scroll z-[12000] max-h-48 border-slate-200 bg-white text-slate-900 shadow-xl"
                      >
                        {ADMIN_ORDER_STATUS_OPTIONS.map((status) => (
                          <SelectItem
                            key={status}
                            value={status}
                            className="cursor-pointer rounded-md border-0 py-2.5 focus:bg-orange-50 focus:text-slate-900 data-[state=checked]:bg-orange-50 data-[state=checked]:font-semibold"
                          >
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Change Payment Status
                    </label>
                    <Select
                      value={draftPaymentStatus}
                      onValueChange={setDraftPaymentStatus}
                      disabled={updatingStatuses}
                    >
                      <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-slate-900 shadow-none hover:border-slate-300 focus:border-[#FF6B4A] focus:ring-[#FF6B4A]/30">
                        <SelectValue placeholder="Select payment status" />
                      </SelectTrigger>
                      <SelectContent
                        side="bottom"
                        sideOffset={4}
                        avoidCollisions={false}
                        position="popper"
                        scrollToTopOnOpen
                        className="select-menu-scroll z-[12000] max-h-48 border-slate-200 bg-white text-slate-900 shadow-xl"
                      >
                        {ADMIN_PAYMENT_STATUS_OPTIONS.map((status) => (
                          <SelectItem
                            key={status}
                            value={status}
                            className="cursor-pointer rounded-md border-0 py-2.5 focus:bg-orange-50 focus:text-slate-900 data-[state=checked]:bg-orange-50 data-[state=checked]:font-semibold"
                          >
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {isCancellingOrder && (
                  <div className="mt-4 space-y-1.5">
                    <label
                      htmlFor="admin-cancel-reason"
                      className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
                    >
                      Cancellation reason (shown to the customer)
                    </label>
                    <textarea
                      id="admin-cancel-reason"
                      value={draftCancelReason}
                      onChange={(e) => setDraftCancelReason(e.target.value)}
                      disabled={updatingStatuses}
                      rows={2}
                      maxLength={300}
                      placeholder="e.g. Restaurant is closed for the day"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-none outline-none focus:border-[#FF6B4A] focus:ring-2 focus:ring-[#FF6B4A]/30"
                    />
                  </div>
                )}
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleAdminStatusUpdate}
                    disabled={!hasAdminStatusChanges || updatingStatuses}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#FF6B4A] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#f25a38] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingStatuses ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Updating…
                      </>
                    ) : (
                      "Update"
                    )}
                  </button>
                </div>
              </div>

              {order.deliveryType && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Truck className="w-4 h-4" />
                    Delivery Type
                  </p>
                  <p className="text-sm font-medium text-slate-900">{order.deliveryType}</p>
                </div>
              )}
            </div>
          </div>

          {/* Customer Information */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <User className="w-4 h-4" />
              Customer Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer Name</p>
                <p className="text-sm font-medium text-slate-900">{order.customerName || "N/A"}</p>
              </div>
              {order.customerPhone && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Phone
                  </p>
                  <p className="text-sm font-medium text-slate-900">{order.customerPhone}</p>
                </div>
              )}
              {order.customerEmail && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email
                  </p>
                  <p className="text-sm font-medium text-slate-900">{order.customerEmail || "NA"}</p>
                </div>
              )}
            </div>
            {order.note && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Note for Restaurant
                </p>
                <p className="text-sm text-blue-900 italic">"{order.note}"</p>
              </div>
            )}
          </div>

          {/* Restaurant Information */}
          {order.restaurant && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Restaurant Information</h3>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Restaurant Name</p>
                <p className="text-sm font-medium text-slate-900">{order.restaurant}</p>
              </div>
            </div>
          )}

          {/* Order Items */}
          {order.items && Array.isArray(order.items) && order.items.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Order Items ({order.items.length})
              </h3>
              <div className="space-y-3">
                {order.items.map((item, index) => {
                  const variantLabel = String(
                    item.variantName ||
                      item.variant ||
                      item.selectedVariant?.name ||
                      item.variationName ||
                      "",
                  ).trim()
                  return (
                  <div key={index} className="flex items-start justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <span className="text-xs font-bold text-slate-700 bg-white px-2 py-1 rounded shrink-0">
                          {item.quantity || 1}x
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {item.name || item.foodName || item.title || "Unknown Item"}
                          </p>
                          {variantLabel ? (
                            <p className="text-xs text-slate-500 mt-0.5 font-medium">
                              {variantLabel}
                            </p>
                          ) : null}
                          {Array.isArray(item.addons) && item.addons.length > 0 ? (
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {item.addons
                                .map((a) => a.name || a.title || a)
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          ) : null}
                        </div>
                        {item.isVeg !== undefined && (
                          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${item.isVeg ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {item.isVeg ? 'Veg' : 'Non-Veg'}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-slate-500 mt-1 ml-8">{item.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      {(() => {
                        const qty = Number(item.quantity || 1) || 1
                        const sellingUnit =
                          Number(item.customerPrice) ||
                          Number(item.otherPrice) ||
                          Number(item.price) ||
                          0
                        let baseUnit = resolveRestaurantItemUnitPrice(item)
                        let markupUnit = resolveItemMarkupUnit(item)

                        // Fallback: selling - base when markup fields missing
                        if (!(markupUnit > 0) && sellingUnit > baseUnit + 0.01) {
                          markupUnit = Math.round((sellingUnit - baseUnit) * 100) / 100
                        }

                        // Order-level admin markup fallback (older / restaurant-rule orders)
                        if (!(markupUnit > 0)) {
                          const orderMarkup = Number(
                            order.markupTotal ?? order.pricing?.markupTotal ?? 0,
                          )
                          const itemCount = Array.isArray(order.items) ? order.items.length : 0
                          if (orderMarkup > 0 && itemCount === 1) {
                            markupUnit = Math.round((orderMarkup / qty) * 100) / 100
                            if (!(Number(item.basePrice) >= 0) || Math.abs(baseUnit - sellingUnit) < 0.01) {
                              baseUnit = Math.max(0, Math.round((sellingUnit - markupUnit) * 100) / 100)
                            }
                          }
                        }

                        const baseLine = Math.round(baseUnit * qty * 100) / 100
                        const markupLine = Math.round(markupUnit * qty * 100) / 100
                        const totalLine =
                          markupLine > 0
                            ? Math.round((baseLine + markupLine) * 100) / 100
                            : Math.round((sellingUnit || baseUnit) * qty * 100) / 100

                        if (markupLine > 0) {
                          return (
                            <div className="leading-tight">
                              <p className="text-sm font-semibold text-slate-900">
                                ₹{baseLine.toFixed(2)}
                              </p>
                              <p className="text-[11px] font-semibold text-rose-600 mt-0.5">
                                + ₹{markupLine.toFixed(2)} admin
                              </p>
                              <p className="text-[11px] font-bold text-slate-900 mt-0.5">
                                Total ₹{totalLine.toFixed(2)}
                              </p>
                            </div>
                          )
                        }

                        return (
                          <p className="text-sm font-semibold text-slate-900">
                            ₹{baseLine.toFixed(2)}
                          </p>
                        )
                      })()}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bill Image (Captured by Delivery Boy) */}
          {(order.billImageUrl || order.billImage || order.deliveryState?.billImageUrl) && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-orange-600" />
                Bill Image (Captured by Delivery Boy)
              </h3>
              <div className="space-y-3">
                <div className="relative w-full max-w-2xl border-2 border-slate-300 rounded-xl overflow-hidden bg-white shadow-sm">
                  <img
                    src={order.billImageUrl || order.billImage || order.deliveryState?.billImageUrl}
                    alt="Order Bill"
                    className="w-full h-auto object-contain max-h-[500px] mx-auto block"
                    loading="lazy"
                    onError={(e) => {
                      debugError('? Failed to load bill image:', e.target.src)
                      e.target.style.display = 'none';
                      const errorDiv = e.target.parentElement.querySelector('.error-message');
                      if (errorDiv) errorDiv.style.display = 'block';
                    }}
                    onLoad={() => {
                      debugLog('? Bill image loaded successfully')
                    }}
                  />
                  <div className="error-message hidden p-6 text-center text-slate-500 text-sm bg-slate-50">
                    <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                    Failed to load bill image
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={order.billImageUrl || order.billImage || order.deliveryState?.billImageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                  >
                    <Eye className="w-4 h-4" />
                    View Full Size
                  </a>
                  <a
                    href={order.billImageUrl || order.billImage || order.deliveryState?.billImageUrl}
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <Package className="w-4 h-4" />
                    Download
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Delivery Address */}
          {order.address && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Delivery Address
              </h3>
              <div className="space-y-2 p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-900">{formatAddress(order.address)}</p>
                {order.address.label && (
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Label:</span> {order.address.label}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Delivery Partner Information */}
          {(order.deliveryPartnerName || order.deliveryPartnerPhone) && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Delivery Partner
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {order.deliveryPartnerName && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</p>
                    <p className="text-sm font-medium text-slate-900">{order.deliveryPartnerName}</p>
                  </div>
                )}
                {order.deliveryPartnerPhone && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Phone</p>
                    <p className="text-sm font-medium text-slate-900">{order.deliveryPartnerPhone}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pricing Breakdown */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Pricing Breakdown</h3>
            <div className="space-y-2">
              {(() => {
                const items = Array.isArray(order.items) ? order.items : []
                const computedBase = items.reduce((sum, item) => {
                  const qty = Number(item.quantity || 1) || 1
                  return sum + resolveRestaurantItemUnitPrice(item) * qty
                }, 0)
                const computedMarkup = items.reduce((sum, item) => {
                  const qty = Number(item.quantity || 1) || 1
                  return sum + resolveItemMarkupUnit(item) * qty
                }, 0)
                const baseSubtotal = Number(
                  order.baseSubtotal ??
                    order.pricing?.baseSubtotal ??
                    (computedBase > 0 ? computedBase : order.totalItemAmount) ??
                    0,
                )
                const markupTotal = Number(
                  order.markupTotal ??
                    order.pricing?.markupTotal ??
                    computedMarkup ??
                    0,
                )
                return (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Subtotal (Restaurant)</span>
                      <span className="font-medium text-slate-900">
                        ₹{Number(baseSubtotal || 0).toFixed(2)}
                      </span>
                    </div>
                    {markupTotal > 0 ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Admin Pricing</span>
                        <span className="font-medium text-rose-600">
                          + ₹{Number(markupTotal).toFixed(2)}
                        </span>
                      </div>
                    ) : null}
                  </>
                )
              })()}
              {order.itemDiscount !== undefined && order.itemDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Discount</span>
                  <span className="font-medium text-emerald-600">-₹{order.itemDiscount.toFixed(2)}</span>
                </div>
              )}
              {order.couponDiscount !== undefined && order.couponDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Coupon Discount</span>
                  <span className="font-medium text-emerald-600">-₹{order.couponDiscount.toFixed(2)}</span>
                </div>
              )}
              {order.deliveryCharge !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Delivery Charge</span>
                  <span className="font-medium text-slate-900">
                    {order.deliveryCharge > 0 ? `₹${order.deliveryCharge.toFixed(2)}` : <span className="text-emerald-600">Free delivery</span>}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Platform Fee</span>
                <span className="font-medium text-slate-900">
                  {order.platformFee !== undefined && order.platformFee > 0 
                    ? `₹${order.platformFee.toFixed(2)}` 
                    : <span className="text-slate-400">₹0.00</span>}
                </span>
              </div>
              {order.vatTax !== undefined && order.vatTax > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Tax (GST)</span>
                  <span className="font-medium text-slate-900">₹{order.vatTax.toFixed(2)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200">
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-slate-700">Total Amount</span>
                  <span className="text-xl font-bold text-emerald-600">
                    ₹{(order.totalAmount || order.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


