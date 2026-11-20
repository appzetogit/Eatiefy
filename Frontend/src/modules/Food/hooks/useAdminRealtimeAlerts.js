import { useEffect, useRef } from "react"
import io from "socket.io-client"
import { toast } from "sonner"
import { API_BASE_URL } from "@food/api/config"

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
 *  - admin_badges_update: pending counts changed (any cause) -> refresh the
 *    sidebar badges, the bell and the open list page immediately, and toast
 *    when a count went up and no notification already announced it.
 */
export default function useAdminRealtimeAlerts({ onAlert, onNavigate } = {}) {
  const onAlertRef = useRef(onAlert)
  const onNavigateRef = useRef(onNavigate)
  onAlertRef.current = onAlert
  onNavigateRef.current = onNavigate

  useEffect(() => {
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("admin_accessToken") : null
    const configured = String(API_BASE_URL || "").replace(/\/api(\/v\d+)?\/?$/, "")
    // Same-origin deployments leave the base URL empty.
    const backendUrl = configured || (typeof window !== "undefined" ? window.location.origin : "")
    if (!token || !backendUrl.startsWith("http")) return undefined

    const socket = io(backendUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    })

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

    const handleBadges = ({ counts = {}, initial } = {}) => {
      const prev = lastCounts
      lastCounts = counts
      // Pull the authoritative numbers + refresh the bell/list the same way the
      // existing sidebar logic does for its own polling.
      window.dispatchEvent(new CustomEvent("refresh-sidebar-badges"))
      if (!prev) return
      const increased = Object.keys(BADGE_ALERTS).filter((key) => Number(counts[key] || 0) > Number(prev[key] || 0))
      if (increased.length === 0) return
      onAlertRef.current?.({ source: "badges", keys: increased })
      // A real notification already announced this a moment ago.
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
    socket.on("admin_badges_update", handleBadges)
    return () => {
      socket.off("admin_live_notification", handleLive)
      socket.off("admin_new_registration", handleLive)
      socket.off("admin_badges_update", handleBadges)
      socket.disconnect()
    }
  }, [])
}
