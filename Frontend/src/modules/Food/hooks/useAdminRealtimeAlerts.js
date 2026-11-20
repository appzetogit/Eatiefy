import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { createAppSocket } from "@food/api/socketClient"

// Sidebar badge key -> what to tell the admin when its pending count goes up.
const BADGE_ALERTS = {
  restaurants: ["New restaurant request", "/admin/food/restaurants/joining-request"],
  deliveryPartners: ["New delivery partner request", "/admin/food/delivery-partners/join-request"],
  foodApprovals: ["Food / add-on awaiting approval", "/admin/food/food-approval"],
  categories: ["Category awaiting approval", "/admin/food/categories"],
  orders: ["New order", "/admin/food/orders/pending"],
  offlinePayments: ["Offline payment to verify", "/admin/food/orders/offline-payments"],
  restaurantWithdrawals: ["Restaurant withdrawal request", "/admin/food/restaurant-withdraws"],
  deliveryWithdrawals: ["Delivery withdrawal request", "/admin/food/delivery-withdrawal"],
  cashConfirmations: ["Cash deposit to confirm", "/admin/food/cash-confirmations"],
  userSupportTickets: ["New support ticket", "/admin/food/support-tickets"],
  deliverySupportTickets: ["New delivery support ticket", "/admin/food/delivery-support-tickets"],
  earningAddons: ["Earning add-on pending", "/admin/food/delivery-partners/earning-addon-history"],
  safetyReports: ["Safety / emergency report", "/admin/food/safety-emergency-reports"],
  emergencyHelp: ["Delivery emergency help request", "/admin/food/delivery-emergency-help"],
  restaurantComplaints: ["New restaurant complaint", "/admin/food/restaurants/complaints"],
  restaurantOffers: ["Restaurant offer awaiting approval", "/admin/food/coupons"],
  contactMessages: ["New contact message", "/admin/food/contact-messages"],
}

/**
 * Live admin alerts over Socket.IO. Mount once in the admin shell.
 *  - admin_live_notification: every notification the backend sends admins.
 *  - admin_new_order: realtime new order alerts.
 *  - order_status_update: order transitions (accepted, cooking, delivered, etc.).
 *  - admin_badges_update: pending counts changed -> refresh the sidebar badges,
 *    the bell, and the active list page immediately without requiring a browser refresh.
 */
export default function useAdminRealtimeAlerts({ onAlert, onNavigate } = {}) {
  const onAlertRef = useRef(onAlert)
  const onNavigateRef = useRef(onNavigate)
  onAlertRef.current = onAlert
  onNavigateRef.current = onNavigate

  useEffect(() => {
    const socket = createAppSocket({
      role: "admin",
      label: "AdminRealtimeAlerts",
    })
    if (!socket) return undefined

    let lastCounts = null
    let lastLiveAt = 0

    const goTo = (link) => link && onNavigateRef.current?.(link)

    const handleLive = (payload = {}) => {
      lastLiveAt = Date.now()
      toast.info(payload.title || "New notification", {
        id: `admin-live-${payload.id || lastLiveAt}`,
        description: payload.body,
        duration: 12000,
        action: payload.link ? { label: "Open", onClick: () => goTo(payload.link) } : undefined,
      })
      window.dispatchEvent(new CustomEvent("refresh-sidebar-badges"))
      onAlertRef.current?.(payload)
    }

    const handleNewOrder = (payload = {}) => {
      lastLiveAt = Date.now()
      const orderId = payload?.orderId || payload?.displayOrderId || payload?._id || "New"
      const title = "New order received"
      const body = payload?.restaurantName
        ? `${payload.restaurantName} • Order #${orderId}`
        : `Order #${orderId} has been placed`
      const link = "/admin/food/orders/pending"

      toast.info(title, {
        id: `admin-order-${orderId}-${lastLiveAt}`,
        description: body,
        duration: 12000,
        action: { label: "View Orders", onClick: () => goTo(link) },
      })

      window.dispatchEvent(new CustomEvent("refresh-sidebar-badges"))
      window.dispatchEvent(new CustomEvent("admin-list-refresh", { detail: { changedKeys: ["orders"] } }))
      onAlertRef.current?.({
        id: `order-${orderId}-${lastLiveAt}`,
        title,
        body,
        link,
        type: "order",
        createdAt: new Date().toISOString(),
      })
    }

    const handleOrderStatusUpdate = (payload = {}) => {
      window.dispatchEvent(new CustomEvent("refresh-sidebar-badges"))
      window.dispatchEvent(new CustomEvent("admin-list-refresh", { detail: { changedKeys: ["orders"] } }))
    }

    const handleBadges = ({ counts = {}, initial } = {}) => {
      const prev = lastCounts
      lastCounts = counts
      window.dispatchEvent(new CustomEvent("refresh-sidebar-badges"))

      if (!prev) return
      const changedKeys = Object.keys({ ...prev, ...counts }).filter(
        (key) => Number(prev[key] || 0) !== Number(counts[key] || 0)
      )
      if (changedKeys.length > 0) {
        window.dispatchEvent(new CustomEvent("admin-list-refresh", { detail: { counts, changedKeys } }))
      }

      const increased = Object.keys(BADGE_ALERTS).filter(
        (key) => Number(counts[key] || 0) > Number(prev[key] || 0)
      )
      if (increased.length === 0) return
      onAlertRef.current?.({ source: "badges", keys: increased, counts })

      // Real notification already announced this a moment ago.
      if (Date.now() - lastLiveAt < 6000 || initial) return
      increased.forEach((key) => {
        const [label, link] = BADGE_ALERTS[key]
        const added = Number(counts[key] || 0) - Number(prev[key] || 0)
        toast.info(label, {
          id: `admin-badge-${key}`,
          description: added > 1 ? `${added} new` : undefined,
          duration: 10000,
          action: { label: "Open", onClick: () => goTo(link) },
        })
      })
    }

    socket.on("admin_live_notification", handleLive)
    socket.on("admin_new_registration", handleLive)
    socket.on("admin_new_order", handleNewOrder)
    socket.on("new_order", handleNewOrder)
    socket.on("order_status_update", handleOrderStatusUpdate)
    socket.on("admin_badges_update", handleBadges)

    return () => {
      socket.off("admin_live_notification", handleLive)
      socket.off("admin_new_registration", handleLive)
      socket.off("admin_new_order", handleNewOrder)
      socket.off("new_order", handleNewOrder)
      socket.off("order_status_update", handleOrderStatusUpdate)
      socket.off("admin_badges_update", handleBadges)
      socket.disconnect()
    }
  }, [])
}
