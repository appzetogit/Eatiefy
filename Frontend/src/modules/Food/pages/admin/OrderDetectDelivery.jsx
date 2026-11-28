import { useMemo, useState, useEffect, useRef } from "react"
import { Package, Truck, CheckCircle, Clock, XCircle } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import OrdersTopbar from "@food/components/admin/orders/OrdersTopbar"
import OrderDetectDeliveryTable from "@food/components/admin/orders/OrderDetectDeliveryTable"
import ViewOrderDetectDeliveryDialog from "@food/components/admin/orders/ViewOrderDetectDeliveryDialog"
import SettingsDialog from "@food/components/admin/orders/SettingsDialog"
import FilterPanel from "@food/components/admin/orders/FilterPanel"
import { useGenericTableManagement } from "@food/components/admin/orders/useGenericTableManagement"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import { TableSkeleton } from "@food/components/ui/loading-skeletons"
import { Skeleton } from "@food/components/ui/skeleton"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const getOrderStatus = (order) => String(order?.orderStatus || order?.status || "").toLowerCase()
const isCancelledOrder = (status, cancelledAt) =>
  status === "cancelled" ||
  status === "cancelled_by_user" ||
  status === "cancelled_by_restaurant" ||
  status === "cancelled_by_admin" ||
  Boolean(cancelledAt)

// Function to map backend order status to frontend display status
const mapOrderStatus = (order) => {
  const status = getOrderStatus(order)
  const { deliveryPartnerName, deliveryState, cancelledAt } = order

  // If cancelled, show as Rejected
  if (isCancelledOrder(status, cancelledAt)) {
    return "Rejected"
  }

  // If delivered, show as Ordered Delivered
  if (status === 'delivered') {
    return "Ordered Delivered"
  }

  // Check delivery state phases
  if (deliveryState?.currentPhase === 'at_delivery' || deliveryState?.currentPhase === 'at_drop') {
    return "Reached Drop"
  }

  if (deliveryState?.currentPhase === 'at_pickup') {
    return "Delivery Boy Reached Pickup"
  }

  // Order ID Accepted — must also match on orderStatus (picked_up / out_for_delivery),
  // same as the backend's detectDeliveryCounts aggregation. Checking this before the
  // "Delivery Boy Assigned" fallback below keeps the row's status text in sync with
  // which stat card the backend actually counted this order under.
  if (
    deliveryState?.status === 'order_confirmed' ||
    deliveryState?.currentPhase === 'en_route_to_delivery' ||
    deliveryState?.orderIdConfirmedAt ||
    status === 'picked_up' ||
    status === 'out_for_delivery'
  ) {
    return "Order ID Accepted"
  }

  // If delivery boy is assigned
  if (deliveryPartnerName) {
    return "Delivery Boy Assigned"
  }

  // Map backend status to frontend status
  const statusMap = {
    'created': 'Ordered',
    'pending': 'Ordered',
    'confirmed': 'Restaurant Accepted',
    'preparing': 'Restaurant Accepted',
    'ready_for_pickup': 'Restaurant Accepted',
    'ready': 'Restaurant Accepted',
  }

  return statusMap[status] || 'Ordered'
}

// Function to build status history from order data
const buildStatusHistory = (order) => {
  const history = []
  const { createdAt, tracking, deliveryState, deliveryPartnerName, deliveryPartnerPhone, cancelledAt } = order
  const status = getOrderStatus(order)

  // Format timestamp helper
  const formatTimestamp = (date) => {
    if (!date) return null
    const d = new Date(date)
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }

  // Ordered - always first
  history.push({
    status: "Ordered",
    timestamp: formatTimestamp(createdAt) || "N/A"
  })

  // Rejected (if cancelled)
  if (isCancelledOrder(status, cancelledAt)) {
    history.push({
      status: "Rejected",
      timestamp: formatTimestamp(cancelledAt) || formatTimestamp(order.updatedAt) || "N/A"
    })
    return history
  }

  // Restaurant Accepted (confirmed)
  if (tracking?.confirmed?.status && tracking?.confirmed?.timestamp) {
    history.push({
      status: "Restaurant Accepted",
      timestamp: formatTimestamp(tracking.confirmed.timestamp)
    })
  } else if (status === 'confirmed' || status === 'preparing' || status === 'ready' || status === 'ready_for_pickup') {
    history.push({
      status: "Restaurant Accepted",
      timestamp: formatTimestamp(order.updatedAt) || "N/A"
    })
  }

  // Delivery Boy Assigned
  if (deliveryPartnerName) {
    history.push({
      status: "Delivery Boy Assigned",
      timestamp: formatTimestamp(deliveryState?.acceptedAt) || formatTimestamp(order.updatedAt) || "N/A",
      deliveryBoy: deliveryPartnerName || "Delivery Boy",
      deliveryBoyNumber: deliveryPartnerPhone || "N/A"
    })
  }

  // Delivery Boy Reached Pickup
  if (deliveryState?.reachedPickupAt) {
    history.push({
      status: "Delivery Boy Reached Pickup",
      timestamp: formatTimestamp(deliveryState.reachedPickupAt)
    })
  } else if (deliveryState?.currentPhase === 'at_pickup') {
    history.push({
      status: "Delivery Boy Reached Pickup",
      timestamp: formatTimestamp(order.updatedAt) || "N/A"
    })
  }

  // Order ID Accepted
  if (deliveryState?.orderIdConfirmedAt) {
    history.push({
      status: "Order ID Accepted",
      timestamp: formatTimestamp(deliveryState.orderIdConfirmedAt)
    })
  } else if (deliveryState?.status === 'order_confirmed' || deliveryState?.currentPhase === 'en_route_to_delivery') {
    history.push({
      status: "Order ID Accepted",
      timestamp: formatTimestamp(order.updatedAt) || "N/A"
    })
  }

  // Reached Drop - must come before Ordered Delivered
  // Check multiple conditions to ensure we catch it even if order is already delivered
  if (deliveryState?.reachedDropAt) {
    // First priority: use reachedDropAt timestamp if available
    history.push({
      status: "Reached Drop",
      timestamp: formatTimestamp(deliveryState.reachedDropAt)
    })
  } else if (
    deliveryState?.currentPhase === 'at_delivery' ||
    deliveryState?.currentPhase === 'at_drop' ||
    deliveryState?.status === 'en_route_to_delivery'
  ) {
    // Second priority: check if currently at delivery phase
    history.push({
      status: "Reached Drop",
      timestamp: formatTimestamp(order.updatedAt) || "N/A"
    })
  } else if (status === 'delivered' && deliveryPartnerName) {
    // Third priority: if order is delivered and delivery boy was assigned,
    // it means reached drop must have happened (can't deliver without reaching drop)
    // Only add if not already added above
    const hasReachedDrop = history.some(h => h.status === "Reached Drop")
    if (!hasReachedDrop) {
      history.push({
        status: "Reached Drop",
        timestamp: formatTimestamp(order.deliveredAt) || formatTimestamp(order.updatedAt) || "N/A"
      })
    }
  }

  // Ordered Delivered - must come after Reached Drop
  if (status === 'delivered' && tracking?.delivered?.timestamp) {
    history.push({
      status: "Ordered Delivered",
      timestamp: formatTimestamp(tracking.delivered.timestamp)
    })
  } else if (status === 'delivered') {
    history.push({
      status: "Ordered Delivered",
      timestamp: formatTimestamp(order.deliveredAt) || formatTimestamp(order.updatedAt) || "N/A"
    })
  }

  return history
}

// Transform backend order to frontend format
const transformOrder = (order, index) => {
  const user = order?.userId && typeof order.userId === "object" ? order.userId : null
  const restaurant = order?.restaurantId && typeof order.restaurantId === "object" ? order.restaurantId : null
  const deliveryFromDispatch =
    order?.dispatch?.deliveryPartnerId && typeof order.dispatch.deliveryPartnerId === "object"
      ? order.dispatch.deliveryPartnerId
      : null

  const deliveryBoyName =
    order.deliveryPartnerName ||
    order.deliveryBoyName ||
    deliveryFromDispatch?.name ||
    order.deliveryPartnerId?.name ||
    null

  const deliveryBoyNumber =
    order.deliveryPartnerPhone ||
    order.deliveryBoyNumber ||
    deliveryFromDispatch?.phone ||
    order.deliveryPartnerId?.phone ||
    null

  const normalizedOrder = {
    ...order,
    status: order.status || order.orderStatus,
    deliveryPartnerName: deliveryBoyName,
    deliveryPartnerPhone: deliveryBoyNumber,
  }

  const orderDate = new Date(order.createdAt)
  const dateStr = orderDate.toLocaleDateString('en-GB', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  }).toUpperCase()
  const timeStr = orderDate.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  }).toUpperCase()

  const displayStatus = mapOrderStatus(normalizedOrder)

  return {
    sl: index + 1,
    orderId: order.orderId,
    userName: order.customerName || order.userName || user?.name || 'Unknown',
    userNumber: order.customerPhone || order.userNumber || user?.phone || order.deliveryAddress?.phone || 'N/A',
    restaurantName: order.restaurantName || order.restaurant || restaurant?.restaurantName || 'Unknown Restaurant',
    deliveryBoyName,
    deliveryBoyNumber,
    status: displayStatus,
    packagingCharge: order.pricing?.packagingFee || order.packagingFee || 0,
    packagingFee: order.pricing?.packagingFee || order.packagingFee || 0,
    platformFee: order.pricing?.platformFee || order.platformFee || 0,
    platformCharge: order.pricing?.platformFee || order.platformFee || 0,
    // Heavy status history only when opening detail dialog (keeps page changes fast)
    statusHistory: null,
    orderDate: dateStr,
    orderTime: timeStr,
    originalOrder: order,
  }
}

export default function OrderDetectDelivery() {
  const [visibleColumns, setVisibleColumns] = useState({
    si: true,
    orderId: true,
    userInfo: true,
    restaurantName: true,
    deliveryBoy: true,
    status: true,
    actions: true,
  })

  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_order_detect_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalOrders, setTotalOrders] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusStats, setStatusStats] = useState({
    total: 0,
    Ordered: 0,
    "Restaurant Accepted": 0,
    Rejected: 0,
    "Delivery Boy Assigned": 0,
    "Delivery Boy Reached Pickup": 0,
    "Order ID Accepted": 0,
    "Reached Drop": 0,
    "Ordered Delivered": 0,
  })
  const [countsReady, setCountsReady] = useState(false)
  const needDetectCountsRef = useRef(true)
  // Zone + search the cards were last counted for; any change needs fresh counts.
  const countsScopeRef = useRef(null)
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()
  // Only the newest fetch may write state, so a quick zone/page switch cannot be
  // overwritten by a slower earlier response.
  const fetchSeqRef = useRef(0)

  const fetchOrders = async () => {
    const seq = ++fetchSeqRef.current
    const isLatest = () => seq === fetchSeqRef.current
    try {
      setIsLoading(true)
      setError(null)
      const countsScope = JSON.stringify([zoneId, debouncedSearch])
      // Checked here rather than relying on the reset effect, which runs after this fetch starts.
      const withCounts = needDetectCountsRef.current || countsScopeRef.current !== countsScope
      const params = {
        page: currentPage,
        limit: pageSize,
        zoneId: zoneId || undefined,
        search: debouncedSearch || undefined,
        // This dashboard tracks the delivery-partner journey (assigned → reached
        // pickup → order ID accepted → reached drop). Takeaway/dining orders never
        // go through that journey, so without this they padded "Ordered" /
        // "Restaurant Accepted" and skewed every card's count.
        orderType: "delivery",
        // Dashboard counts — only when search/zone changes or first load (keeps page flips fast)
        ...(withCounts ? { includeDetectDeliveryCounts: 1 } : {}),
      }

      const response = await adminAPI.getOrders(params)
      if (!isLatest()) return

      const payload = response?.data?.data || response?.data || {}
      const rawOrders =
        payload?.orders ??
        payload?.docs ??
        payload?.data ??
        (Array.isArray(payload) ? payload : [])
      const nextOrders = Array.isArray(rawOrders) ? rawOrders : []
      const meta = payload?.meta || payload?.pagination || {}
      const nextTotal = Number(meta.total ?? payload?.total ?? nextOrders.length) || 0

      if (response.data?.success && nextOrders.length >= 0) {
        const transformedOrders = nextOrders.map((order, index) =>
          transformOrder(order, (currentPage - 1) * pageSize + index),
        )
        setOrders(transformedOrders)
        setTotalOrders(nextTotal)
        if (payload?.detectDeliveryCounts) {
          setStatusStats({
            Ordered: 0,
            "Restaurant Accepted": 0,
            Rejected: 0,
            "Delivery Boy Assigned": 0,
            "Delivery Boy Reached Pickup": 0,
            "Order ID Accepted": 0,
            "Reached Drop": 0,
            "Ordered Delivered": 0,
            ...payload.detectDeliveryCounts,
            total: nextTotal,
          })
          setCountsReady(true)
          needDetectCountsRef.current = false
          countsScopeRef.current = countsScope
        } else {
          setStatusStats((prev) => ({ ...prev, total: nextTotal }))
        }
      } else {
        debugError("Failed to fetch orders:", response.data)
        setError(response.data?.message || "Failed to fetch orders")
        toast.error("Failed to fetch orders")
        setOrders([])
        setTotalOrders(0)
      }
    } catch (error) {
      debugError("Error fetching orders:", error)
      if (!isLatest()) return
      setError(error.response?.data?.message || "Failed to fetch orders")
      toast.error(error.response?.data?.message || "Failed to fetch orders")
      setOrders([])
      setTotalOrders(0)
    } finally {
      if (isLatest()) setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debouncedSearch, zoneId])

  const {
    searchQuery,
    setSearchQuery,
    isFilterOpen,
    setIsFilterOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isViewOrderOpen,
    setIsViewOrderOpen,
    selectedOrder,
    filters,
    setFilters,
    filteredData,
    count,
    activeFiltersCount,
    handleApplyFilters,
    handleResetFilters,
    handleExport,
    handleViewOrder: openViewOrder,
    handlePrintOrder,
  } = useGenericTableManagement(
    orders,
    "Order Detect Delivery",
    [],
  )

  const handleViewOrder = (order) => {
    const original = order?.originalOrder || order
    const withHistory = {
      ...order,
      statusHistory: buildStatusHistory({
        ...original,
        deliveryPartnerName: order.deliveryBoyName || original.deliveryPartnerName,
        deliveryPartnerPhone: order.deliveryBoyNumber || original.deliveryPartnerPhone,
        status: original.orderStatus || original.status,
      }),
    }
    openViewOrder(withHistory)
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    needDetectCountsRef.current = true
    setCountsReady(false)
    setCurrentPage(1)
  }, [debouncedSearch, zoneId])

  // Statistics — from ALL matching orders (API), not current page
  const stats = useMemo(
    () => ({
      total: statusStats.total || totalOrders,
      ordered: statusStats.Ordered || 0,
      restaurantAccepted: statusStats["Restaurant Accepted"] || 0,
      rejected: statusStats.Rejected || 0,
      deliveryBoyAssigned: statusStats["Delivery Boy Assigned"] || 0,
      reachedPickup: statusStats["Delivery Boy Reached Pickup"] || 0,
      orderIdAccepted: statusStats["Order ID Accepted"] || 0,
      reachedDrop: statusStats["Reached Drop"] || 0,
      delivered: statusStats["Ordered Delivered"] || 0,
    }),
    [statusStats, totalOrders],
  )

  const showStatsSkeleton = isLoading && !countsReady
  const showTableSkeleton = isLoading

  const resetColumns = () => {
    setVisibleColumns({
      si: true,
      orderId: true,
      userInfo: true,
      restaurantName: true,
      deliveryBoy: true,
      status: true,
      actions: true,
    })
  }

  const handleToggleColumn = (columnKey) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [columnKey]: !prev[columnKey],
    }))
  }

  // Error state
  if (error && orders.length === 0 && !isLoading) {
    return (
      <div className="p-4 lg:p-6 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Error Loading Orders</h3>
          <p className="text-sm text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const statCards = [
    { key: "total", label: "Total Orders", value: stats.total, color: "text-slate-900", iconBg: "bg-blue-50", Icon: Package, iconColor: "text-blue-600" },
    { key: "ordered", label: "Ordered", value: stats.ordered, color: "text-blue-600", iconBg: "bg-blue-50", Icon: Clock, iconColor: "text-blue-600" },
    { key: "restaurantAccepted", label: "Restaurant Accepted", value: stats.restaurantAccepted, color: "text-emerald-600", iconBg: "bg-emerald-50", Icon: CheckCircle, iconColor: "text-emerald-600" },
    { key: "rejected", label: "Rejected", value: stats.rejected, color: "text-red-600", iconBg: "bg-red-50", Icon: XCircle, iconColor: "text-red-600" },
    { key: "deliveryBoyAssigned", label: "Delivery Boy Assigned", value: stats.deliveryBoyAssigned, color: "text-purple-600", iconBg: "bg-purple-50", Icon: Truck, iconColor: "text-purple-600" },
    { key: "reachedPickup", label: "Delivery Boy Reached Pickup", value: stats.reachedPickup, color: "text-orange-600", iconBg: "bg-orange-50", Icon: Package, iconColor: "text-orange-600" },
    { key: "orderIdAccepted", label: "Order ID Accepted", value: stats.orderIdAccepted, color: "text-indigo-600", iconBg: "bg-indigo-50", Icon: CheckCircle, iconColor: "text-indigo-600" },
    { key: "reachedDrop", label: "Reached Drop", value: stats.reachedDrop, color: "text-amber-600", iconBg: "bg-amber-50", Icon: Truck, iconColor: "text-amber-600" },
    { key: "delivered", label: "Delivered", value: stats.delivered, color: "text-emerald-600", iconBg: "bg-emerald-50", Icon: CheckCircle, iconColor: "text-emerald-600" },
  ]

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <OrdersTopbar 
        title="Order Detect Delivery" 
        count={totalOrders} 
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

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {showStatsSkeleton
          ? Array.from({ length: 9 }, (_, index) => (
              <div
                key={`stat-skel-${index}`}
                className="bg-white rounded-xl shadow-sm border border-slate-200 p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24 rounded-full" />
                    <Skeleton className="h-7 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-12 w-12 rounded-lg" />
                </div>
              </div>
            ))
          : statCards.map(({ key, label, value, color, iconBg, Icon, iconColor }) => (
              <div key={key} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500 mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  </div>
                  <div className={`p-3 ${iconBg} rounded-lg`}>
                    <Icon className={`w-6 h-6 ${iconColor}`} />
                  </div>
                </div>
              </div>
            ))}
      </div>

      <SettingsDialog
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        visibleColumns={visibleColumns}
        toggleColumn={handleToggleColumn}
        resetColumns={resetColumns}
        columnsConfig={{
          si: "Serial Number",
          orderId: "Order ID",
          userInfo: "User Name & Number",
          restaurantName: "Restaurant Name",
          deliveryBoy: "Delivery Boy Name & Number",
          status: "Status",
          actions: "Actions",
        }}
      />
      <ViewOrderDetectDeliveryDialog
        isOpen={isViewOrderOpen}
        onOpenChange={setIsViewOrderOpen}
        order={selectedOrder}
      />
      {showTableSkeleton ? (
        <TableSkeleton rows={8} columns={7} />
      ) : (
        <>
          <OrderDetectDeliveryTable 
            orders={filteredData} 
            visibleColumns={visibleColumns}
            onViewOrder={handleViewOrder}
            onPrintOrder={handlePrintOrder}
          />
          <AdminListPagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalOrders}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_order_detect_pageSize", String(size))
              } catch {}
              setCurrentPage(1)
            }}
            itemLabel="orders"
          />
        </>
      )}
      <FilterPanel
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        filters={filters}
        setFilters={setFilters}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />
    </div>
  )
}
