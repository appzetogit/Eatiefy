import { useParams, Link, useNavigate, useLocation } from "react-router-dom"
import React, { useState, useEffect } from "react"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  ArrowLeft,
  Package,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Truck,
  MessageCircle,
  Phone,
  Mail,
  FileText,
  RefreshCw,
  CreditCard,
  MapPin,
  HelpCircle,
  Loader2,
  ExternalLink,
  ChevronRight
} from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import ScrollReveal from "@food/components/user/ScrollReveal"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import { useOrders } from "@food/context/OrdersContext"
import { orderAPI } from "@food/api"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"

const commonIssues = [
  {
    id: "late-delivery",
    title: "Order is Late",
    icon: Clock,
    description: "Your order hasn't arrived within the estimated time",
    solutions: [
      "Check the order tracking page for real-time updates",
      "Contact the delivery driver if contact information is available",
      "Wait an additional 15-20 minutes as delays can occur",
      "Contact support if the order is more than 30 minutes late"
    ],
    actions: [
      { label: "Track Order", path: "track" },
      { label: "Contact Support", path: "support" }
    ]
  },
  {
    id: "missing-items",
    title: "Missing Items",
    icon: Package,
    description: "Some items from your order are missing",
    solutions: [
      "Check your order receipt to verify what was ordered",
      "Check if items were delivered separately",
      "Contact support immediately with your order number",
      "Take photos if possible to help with the investigation"
    ],
    actions: [
      { label: "View Invoice", path: "invoice" },
      { label: "Report Issue", path: "support" }
    ]
  },
  {
    id: "wrong-order",
    title: "Wrong Order Received",
    icon: XCircle,
    description: "You received items different from what you ordered",
    solutions: [
      "Keep the incorrect order - you won't be charged for it",
      "Contact support immediately with your order number",
      "We'll arrange a replacement or full refund",
      "You may be eligible for a discount on your next order"
    ],
    actions: [
      { label: "View Order Details", path: "track" },
      { label: "Report Issue", path: "support" }
    ]
  },
  {
    id: "quality-issue",
    title: "Quality Issue",
    icon: AlertCircle,
    description: "Food quality doesn't meet expectations",
    solutions: [
      "Contact support within 24 hours of delivery",
      "Describe the issue in detail",
      "Take photos if possible",
      "We'll process a full refund or replacement"
    ],
    actions: [
      { label: "Report Issue", path: "support" },
      { label: "Request Refund", path: "support" }
    ]
  },
  {
    id: "payment-issue",
    title: "Payment Problem",
    icon: CreditCard,
    description: "Issues with payment or billing",
    solutions: [
      "Check your payment method in your profile",
      "Verify the charge on your bank statement",
      "Contact support if you were charged incorrectly",
      "We'll investigate and process a refund if needed"
    ],
    actions: [
      { label: "View Invoice", path: "invoice" },
      { label: "Contact Support", path: "support" }
    ]
  },
  {
    id: "cancel-order",
    title: "Cancel Order",
    icon: RefreshCw,
    description: "Need to cancel your order",
    solutions: [
      "Orders can be cancelled within 5 minutes of placement",
      "After 5 minutes, contact support for cancellation",
      "If the order is already being prepared, cancellation may not be possible",
      "Refunds are processed automatically for cancelled orders"
    ],
    actions: [
      { label: "Contact Support", path: "support" },
      { label: "View Order", path: "track" }
    ]
  }
]

export default function OrderHelp() {
  const { orderId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { getOrderById } = useOrders()

  const initialOrder = location?.state?.order || (orderId ? getOrderById(orderId) : null)
  const [order, setOrder] = useState(initialOrder)
  const [loading, setLoading] = useState(!initialOrder)
  const [supportInfo, setSupportInfo] = useState({
    phone: "+91 1800-123-4567",
    email: "support@eatiefy.com"
  })

  // Load live support config if available
  useEffect(() => {
    let isMounted = true
    const fetchSupportConfig = async () => {
      try {
        const res = await api.get(API_ENDPOINTS.ADMIN.SUPPORT_USER_PUBLIC)
        const data = res?.data?.data || res?.data
        if (isMounted && data && typeof data === "object") {
          setSupportInfo({
            phone: data.mobile || data.phone || "+91 1800-123-4567",
            email: data.email || "support@eatiefy.com"
          })
        }
      } catch (_) {}
    }
    fetchSupportConfig()
    return () => { isMounted = false }
  }, [])

  // Fetch or refresh order details
  useEffect(() => {
    let isMounted = true
    const effectiveId = orderId || location?.state?.orderId

    if (!effectiveId) {
      setLoading(false)
      return
    }

    const fetchOrder = async () => {
      try {
        if (!order) setLoading(true)
        const res = await orderAPI.getOrderDetails(effectiveId).catch(() => orderAPI.getOrder(effectiveId))
        const fetched = res?.data?.data?.order || res?.data?.order || res?.data?.data || res?.data
        if (isMounted && fetched && typeof fetched === "object") {
          setOrder(fetched)
        }
      } catch (err) {
        console.warn("[OrderHelp] Could not fetch order details:", err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchOrder()
    return () => { isMounted = false }
  }, [orderId, location?.state?.orderId])

  const formatDate = (dateString) => {
    if (!dateString) return "Recently placed"
    try {
      const date = new Date(dateString)
      if (isNaN(date.getTime())) return "Recently placed"
      return date.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    } catch {
      return "Recently placed"
    }
  }

  const getStatusColor = (status) => {
    const s = String(status || "").toLowerCase()
    if (s.includes("cancel") || s.includes("reject")) return "bg-red-500"
    if (s.includes("deliver") || s.includes("completed")) return "bg-emerald-600"
    if (s.includes("out") || s.includes("pick") || s.includes("way")) return "bg-blue-600"
    if (s.includes("prep") || s.includes("cook") || s.includes("ready")) return "bg-amber-500"
    if (s.includes("confirm") || s.includes("accept")) return "bg-red-600"
    return "bg-slate-700"
  }

  const getStatusLabel = (status) => {
    if (!status) return "Processing"
    const s = String(status).toLowerCase()
    if (s.includes("placed") || s.includes("pending")) return "Order Placed"
    if (s.includes("confirm") || s.includes("accept")) return "Confirmed"
    if (s.includes("prepar") || s.includes("cook") || s.includes("ready")) return "Preparing"
    if (s.includes("out") || s.includes("way") || s.includes("delivery") || s.includes("picked")) return "Out for Delivery"
    if (s.includes("deliver") || s.includes("completed")) return "Delivered"
    if (s.includes("cancel") || s.includes("reject")) return "Cancelled"
    return String(status).toUpperCase()
  }

  const getAddressString = (addr) => {
    if (!addr) return null
    if (typeof addr === "string") return addr
    if (addr.formattedAddress) return addr.formattedAddress
    const parts = [
      addr.street || addr.addressLine1 || addr.line1 || addr.address,
      addr.additionalDetails || addr.landmark || addr.addressLine2,
      [addr.city, addr.state, addr.zipCode || addr.pincode].filter(Boolean).join(" ")
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(", ") : (addr.name || null)
  }

  const displayOrderId = order?.orderId || order?.order_id || order?.orderNumber || (orderId && !/^[a-f0-9]{24}$/i.test(String(orderId)) ? orderId : null) || order?._id || order?.id || orderId || "Order"
  const orderTotal = Number(order?.pricing?.total ?? order?.pricing?.grandTotal ?? order?.total ?? order?.amount ?? 0)
  const orderItems = Array.isArray(order?.items) ? order.items : (Array.isArray(order?.orderItems) ? order.orderItems : [])
  const addressText = getAddressString(order?.deliveryAddress || order?.address)
  const restaurantTitle = order?.restaurantName || order?.restaurantId?.restaurantName || order?.restaurant?.restaurantName || order?.restaurant?.name

  const handleAction = (action) => {
    const targetOrderId = order?._id || order?.orderId || orderId || displayOrderId
    switch (action) {
      case "track":
        navigate(toFoodUserPath(`/user/orders/${targetOrderId}`))
        break
      case "invoice":
        navigate(toFoodUserPath(`/user/orders/${targetOrderId}/invoice`))
        break
      case "support":
      case "refund":
        navigate(toFoodUserPath("/user/profile/support"), {
          state: {
            order: order || { _id: targetOrderId, orderId: targetOrderId },
            orderId: targetOrderId,
            type: "order",
            step: "order_issue",
            fromTracking: true,
            from: location.pathname,
            backTo: location.pathname
          }
        })
        break
      default:
        break
    }
  }

  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-slate-50/50 dark:bg-[#141414] p-4 md:p-6 lg:p-8 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#1F6B45]" />
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">Loading Order Support...</p>
        </div>
      </AnimatedPage>
    )
  }

  if (!order && !loading) {
    return (
      <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 via-white to-orange-50/20 dark:from-[#141414] dark:via-[#141414] dark:to-[#141414] p-4">
        <div className="max-w-4xl mx-auto pt-8">
          <Card className="shadow-lg border-slate-200 dark:border-zinc-800">
            <CardContent className="py-12 text-center space-y-4">
              <AlertCircle className="h-14 w-14 mx-auto text-[#1F6B45]" />
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Order Support</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {orderId ? `We couldn't load details for Order #${orderId}. You can still contact our support team or view other orders.` : "No order was selected for support."}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 justify-center pt-2">
                <Button variant="outline" onClick={goBack} className="rounded-xl">
                  <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
                </Button>
                <Link to={toFoodUserPath("/user/orders")}>
                  <Button variant="outline" className="rounded-xl">View All Orders</Button>
                </Link>
                <Link 
                  to={toFoodUserPath("/user/profile/support")}
                  state={{
                    order: order || { _id: displayOrderId, orderId: displayOrderId },
                    orderId: displayOrderId,
                    fromTracking: true,
                    from: location.pathname,
                    backTo: location.pathname
                  }}
                >
                  <Button className="bg-[#1F6B45] hover:bg-[#1A5C3B] text-white rounded-xl">
                    <MessageCircle className="w-4 h-4 mr-1.5" /> Contact Support
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-orange-50/30 via-white to-gray-50/30 dark:from-[#141414] dark:via-[#141414] dark:to-[#141414] p-4 md:p-6 lg:p-8 pb-32 md:pb-28">
      <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-4 md:space-y-5 lg:space-y-6 pb-12">
        {/* Header */}
        <ScrollReveal>
          <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
            <Button
              variant="ghost"
              size="icon"
              onClick={goBack}
              className="rounded-full h-9 w-9 md:h-10 md:w-10 bg-white dark:bg-zinc-900 shadow-sm border border-slate-200 dark:border-zinc-800"
            >
              <ArrowLeft className="h-4 w-4 md:h-5 md:w-5 text-gray-800 dark:text-white" />
            </Button>
            <div>
              <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">Order Help & Support</h1>
              <p className="text-xs md:text-sm text-muted-foreground font-medium">Order #{displayOrderId}</p>
            </div>
          </div>
        </ScrollReveal>

        {/* Order Summary Card */}
        <ScrollReveal delay={0.05}>
          <Card className="shadow-md border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden rounded-2xl">
            <CardHeader className="p-4 md:p-5 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base md:text-lg font-bold text-gray-900 dark:text-white">
                  <Package className="h-4 w-4 md:h-5 md:w-5 text-[#1F6B45]" />
                  Order Summary
                </CardTitle>
                <Badge className={`${getStatusColor(order.orderStatus || order.status)} text-white text-xs px-2.5 py-0.5 font-semibold`}>
                  {getStatusLabel(order.orderStatus || order.status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4 md:p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Order ID</p>
                  <p className="font-semibold text-sm truncate text-gray-900 dark:text-white">#{displayOrderId}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Placed On</p>
                  <p className="font-semibold text-sm text-gray-900 dark:text-white">{formatDate(order.createdAt || order.date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Total Amount</p>
                  <p className="font-bold text-sm text-[#1F6B45]">₹{orderTotal.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Items</p>
                  <p className="font-semibold text-sm text-gray-900 dark:text-white">
                    {orderItems.length > 0 ? `${orderItems.length} ${orderItems.length === 1 ? 'item' : 'items'}` : "Order Items"}
                  </p>
                </div>
              </div>

              {restaurantTitle && (
                <div className="pt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Restaurant: </span>
                  {restaurantTitle}
                </div>
              )}

              {addressText && (
                <div className="pt-3 border-t border-slate-100 dark:border-zinc-800">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Delivery Address</p>
                      <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{addressText}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Quick Actions */}
        <ScrollReveal delay={0.1}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 rounded-xl hover:border-[#1F6B45]/40 transition-colors shadow-sm"
              onClick={() => handleAction("track")}
            >
              <div className="p-2 rounded-lg bg-orange-50 dark:bg-zinc-800 text-[#1F6B45]">
                <Truck className="h-4 w-4" />
              </div>
              <div className="text-left">
                <div className="font-semibold text-sm text-gray-900 dark:text-white">Track Order</div>
                <div className="text-[11px] text-muted-foreground">Real-time status</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 rounded-xl hover:border-[#1F6B45]/40 transition-colors shadow-sm"
              onClick={() => handleAction("invoice")}
            >
              <div className="p-2 rounded-lg bg-orange-50 dark:bg-zinc-800 text-[#1F6B45]">
                <FileText className="h-4 w-4" />
              </div>
              <div className="text-left">
                <div className="font-semibold text-sm text-gray-900 dark:text-white">View Invoice</div>
                <div className="text-[11px] text-muted-foreground">Download receipt</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 rounded-xl hover:border-[#1F6B45]/40 transition-colors shadow-sm"
              onClick={() => handleAction("support")}
            >
              <div className="p-2 rounded-lg bg-orange-50 dark:bg-zinc-800 text-[#1F6B45]">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div className="text-left">
                <div className="font-semibold text-sm text-gray-900 dark:text-white">Raise Ticket</div>
                <div className="text-[11px] text-muted-foreground">Support assistance</div>
              </div>
            </Button>
          </div>
        </ScrollReveal>

        {/* Common Issues Section */}
        <ScrollReveal delay={0.15}>
          <div className="space-y-3 pt-2">
            <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">What do you need help with?</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {commonIssues.map((issue) => {
                const Icon = issue.icon
                return (
                  <Card
                    key={issue.id}
                    className="shadow-sm border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden flex flex-col justify-between"
                  >
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-orange-50 dark:bg-zinc-800 rounded-xl flex-shrink-0">
                          <Icon className="h-4 w-4 md:h-5 md:w-5 text-[#1F6B45]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm md:text-base font-bold text-gray-900 dark:text-white">{issue.title}</CardTitle>
                          <CardDescription className="mt-0.5 text-xs text-muted-foreground">{issue.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4 pt-2">
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Recommended Steps:</p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {issue.solutions.map((solution, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                              <span>{solution}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                        {issue.actions.map((act, idx) => (
                          <Button
                            key={idx}
                            variant={idx === 0 ? "default" : "outline"}
                            size="sm"
                            className={`rounded-lg text-xs h-8 ${idx === 0 ? "bg-[#1F6B45] hover:bg-[#1A5C3B] text-white" : ""}`}
                            onClick={() => handleAction(act.path)}
                          >
                            {act.label}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </ScrollReveal>

        {/* Contact Support Channels Section */}
        <ScrollReveal delay={0.2}>
          <Card id="contact-support" className="shadow-md border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden">
            <CardHeader className="p-4 md:p-5 border-b border-slate-100 dark:border-zinc-800">
              <CardTitle className="text-base md:text-lg font-bold flex items-center gap-2 text-gray-900 dark:text-white">
                <MessageCircle className="h-5 w-5 text-[#1F6B45]" />
                Direct Support for Order #{displayOrderId}
              </CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Our support team is available 24/7 to resolve any issues with this order.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 md:p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-start gap-3 p-3.5 bg-slate-50 dark:bg-zinc-800/60 rounded-xl border border-slate-100 dark:border-zinc-800">
                  <div className="p-2 bg-orange-100 dark:bg-zinc-700 rounded-lg text-[#1F6B45]">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white">Helpline</h3>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Mention order #{displayOrderId}
                    </p>
                    <a
                      href={`tel:${supportInfo.phone}`}
                      className="text-xs font-semibold text-[#1F6B45] hover:underline"
                    >
                      {supportInfo.phone}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 dark:bg-zinc-800/60 rounded-xl border border-slate-100 dark:border-zinc-800">
                  <div className="p-2 bg-orange-100 dark:bg-zinc-700 rounded-lg text-[#1F6B45]">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white">Email Support</h3>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Subject auto-tagged with order ID
                    </p>
                    <a
                      href={`mailto:${supportInfo.email}?subject=Help with Order %23${displayOrderId}`}
                      className="text-xs font-semibold text-[#1F6B45] hover:underline"
                    >
                      {supportInfo.email}
                    </a>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  className="w-full bg-[#1F6B45] hover:bg-[#1A5C3B] text-white font-semibold h-11 rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                  onClick={() => handleAction("support")}
                >
                  <MessageCircle className="h-4 w-4" />
                  Create Support Ticket with Order Context
                </Button>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Navigation Footer */}
        <ScrollReveal delay={0.25}>
          <div className="flex gap-3 pt-2 mb-4">
            <Link to={toFoodUserPath("/user/orders")} className="flex-1">
              <Button variant="outline" className="w-full rounded-xl border-slate-200 dark:border-zinc-800 text-xs sm:text-sm">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                All Orders
              </Button>
            </Link>
            <Link to={toFoodUserPath("/user/help")} className="flex-1">
              <Button variant="outline" className="w-full rounded-xl border-slate-200 dark:border-zinc-800 text-xs sm:text-sm">
                <HelpCircle className="h-4 w-4 mr-1.5" />
                Help Center
              </Button>
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </AnimatedPage>
  )
}
