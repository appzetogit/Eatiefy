import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@food/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Activity, ArrowUpRight, ShoppingBag, CreditCard, Truck, Receipt, DollarSign, Store, UserCheck, Package, UserCircle, Clock, CheckCircle, Plus, XCircle, IndianRupee, ClipboardCheck } from "lucide-react"
import { adminAPI } from "@food/api"
const debugLog = () => {}
const debugError = () => {}

const INR_SYMBOL = "\u20B9"

function formatCurrency(amount, options = {}) {
  const numericAmount = Number(amount || 0)
  const formattedAmount = numericAmount.toLocaleString("en-IN", options)
  return `${INR_SYMBOL}${formattedAmount}`
}


export default function AdminHome() {
  const navigate = useNavigate()
  const [selectedZone, setSelectedZone] = useState("all")
  const [selectedPeriod, setSelectedPeriod] = useState("overall")
  const [isLoading, setIsLoading] = useState(true)
  const [dashboardData, setDashboardData] = useState(null)
  // A failed load must not render as a real "₹0 / 0 orders" dashboard.
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [zones, setZones] = useState([])

  // Fetch zone list for filter
  useEffect(() => {
    const fetchZones = async () => {
      try {
        const response = await adminAPI.getZones({ page: 1, limit: 1000 })
        const zoneData = response?.data?.data
        const list = Array.isArray(zoneData?.zones)
          ? zoneData.zones
          : Array.isArray(zoneData)
            ? zoneData
            : []
        setZones(list)
      } catch (error) {
        debugError("Error fetching zones:", error)
        setZones([])
      }
    }

    fetchZones()
  }, [])

  // Fetch dashboard stats from backend when filters change
  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        setIsLoading(true)
        const params = {
          period: selectedPeriod,
          ...(selectedZone !== "all" ? { zoneId: selectedZone } : {}),
        }
        const response = await adminAPI.getDashboardStats(params)
        if (response.data?.success && response.data?.data) {
          setDashboardData(response.data.data)
          setLoadError(null)
          debugLog("Dashboard stats fetched:", response.data.data)
        } else {
          setLoadError("The server returned an unexpected response.")
          debugError("Invalid dashboard response format:", response.data)
        }
      } catch (error) {
        const status = Number(error?.response?.status || 0)
        setLoadError(
          status === 429
            ? "Too many requests. Please wait a moment and retry."
            : error?.response?.data?.message || "Could not load dashboard figures.",
        )
        debugError("Error fetching dashboard stats:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDashboardStats()
  }, [selectedZone, selectedPeriod, reloadKey])

  // Get order stats from real data
  const getOrderStats = () => {
    if (!dashboardData?.orders?.byStatus) {
      return [
        { label: "Delivered", value: 0, color: "#0ea5e9" },
        { label: "Cancelled", value: 0, color: "#ef4444" },
        { label: "Refunded", value: 0, color: "#f59e0b" },
        { label: "Pending", value: 0, color: "#10b981" },
        { label: "Processing", value: 0, color: "#f97316" },
        { label: "In Transit", value: 0, color: "#8b5cf6" },
      ]
    }

    const byStatus = dashboardData.orders.byStatus
    return [
      { label: "Delivered", value: byStatus.delivered || 0, color: "#0ea5e9" },
      { label: "Cancelled", value: byStatus.cancelled || 0, color: "#ef4444" },
      { label: "Refunded", value: byStatus.refunded || 0, color: "#f59e0b" },
      { label: "Pending", value: byStatus.pending || 0, color: "#10b981" },
      { label: "Processing", value: byStatus.processing || 0, color: "#f97316" },
      { label: "In Transit", value: byStatus.inTransit || 0, color: "#8b5cf6" },
    ]
  }

  // Get monthly data from real data
  const getMonthlyData = () => {
    if (!dashboardData?.monthlyData || dashboardData.monthlyData.length === 0) {
      // Return empty data structure if no data
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return monthNames.map(month => ({ month, commission: 0, revenue: 0, orders: 0 }))
    }

    // Use real monthly data from backend
    return dashboardData.monthlyData.map(item => ({
      month: item.month,
      commission: item.commission || 0,
      revenue: item.revenue || 0,
      orders: item.orders || 0
    }))
  }

  const orderStats = getOrderStats()
  const monthlyData = getMonthlyData()

  // Calculate totals from real data
  const revenueTotal = dashboardData?.revenue?.total || 0
  const cashOrdersTotal = dashboardData?.cod?.cashOrders || 0
  const onlineOrdersTotal = dashboardData?.cod?.onlineOrders || 0
  const cancelledOrdersTotal = dashboardData?.orders?.byStatus?.cancelled || 0
  const deliveryBoyEarningTotal =
    dashboardData?.deliveryBoyEarning ?? dashboardData?.riderEarnings?.total ?? 0
  const restaurantEarningTotal = dashboardData?.restaurantEarning || 0
  const onboardingEarningTotal = Number(dashboardData?.onboardingEarning?.total || 0)
  const onboardingPaymentsCount = Number(dashboardData?.onboardingEarning?.payments || 0)
  const onboardingDiscount = Number(dashboardData?.onboardingEarning?.discount || 0)
  const commissionTotal = dashboardData?.commission?.total || 0
  const ordersTotal = dashboardData?.orders?.total || 0
  const platformFeeTotal = dashboardData?.platformFee?.total || 0
  const deliveryFeeTotal = dashboardData?.deliveryFee?.total || 0
  const gstTotal = dashboardData?.gst?.total || 0
  const totalAdminEarnings = dashboardData?.totalAdminEarnings || 0

  // Additional stats
  const totalRestaurants = dashboardData?.restaurants?.total || 0
  const pendingRestaurantRequests = dashboardData?.restaurants?.pendingRequests || 0
  // Every restaurant that completed signup in the selected zone/period (not deleted).
  const onboarded = dashboardData?.restaurants?.onboarded || {}
  const restaurantsOnboardedTotal = Number(onboarded.total || 0)
  // The card counts live (approved) restaurants only; the rest are shown as context.
  const onboardedBreakdown = [
    [onboarded.inReview, "in review"],
    [onboarded.paymentPending, "payment pending"],
    [onboarded.rejected, "rejected"],
    [onboarded.banned, "banned"],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${Number(count).toLocaleString("en-IN")} ${label}`)
    .join(" · ")
  const totalDeliveryBoys = dashboardData?.deliveryBoys?.total || 0
  const pendingDeliveryBoyRequests = dashboardData?.deliveryBoys?.pendingRequests || 0
  const totalFoods = dashboardData?.foods?.total || 0
  const totalAddons = dashboardData?.addons?.total || 0
  const totalCustomers = dashboardData?.customers?.total || 0
  const pendingOrders = dashboardData?.orderStats?.pending || 0
  const processingOrders = dashboardData?.orderStats?.processing || 0
  const completedOrders = dashboardData?.orderStats?.completed || 0

  const pieData = orderStats.map((item) => ({
    name: item.label,
    value: item.value,
    fill: item.color,
  }))

  const deliveryProfit = dashboardData?.deliveryProfit || 0
  const periodLabel = selectedPeriod === "overall" ? "Overall" : 
                    selectedPeriod === "today" ? "Today's" : 
                    `This ${selectedPeriod}'s`

  const activityFeed = dashboardData?.liveSignals || []
  const totalRevenueHelper = [
    `Comm: ${formatCurrency(commissionTotal)}`,
    `Platform: ${formatCurrency(platformFeeTotal)}`,
    `Delivery Net: ${formatCurrency(deliveryProfit)}`,
    `GST: ${formatCurrency(gstTotal)}`,
  ].join(" + ")

  if (isLoading && !dashboardData) {
    return <DashboardSkeleton />
  }

  const retryLoad = () => setReloadKey((k) => k + 1)

  // Nothing loaded yet: an error panel, never a dashboard full of zeros.
  if (loadError && !dashboardData) {
    return (
      <div className="px-4 pb-10 lg:px-6 pt-4">
        <div role="alert" className="rounded-3xl border border-red-200 bg-red-50 px-6 py-10 text-center">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <h1 className="text-lg font-semibold text-red-900">Dashboard could not be loaded</h1>
          <p className="mt-1 text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={retryLoad}
            className="mt-5 inline-flex items-center rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pb-10 lg:px-6 pt-4">
      {/* A refresh failed after figures loaded: keep them, but say they are stale. */}
      {loadError && dashboardData && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>Showing the last loaded figures. Refresh failed: {loadError}</span>
          <button type="button" onClick={retryLoad} className="font-semibold underline underline-offset-2">
            Retry
          </button>
        </div>
      )}
      <div className="relative overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_30px_120px_-60px_rgba(0,0,0,0.28)]">

        <div className="flex flex-col gap-4 border-b border-neutral-200 bg-linear-to-br from-white via-neutral-50 to-neutral-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Admin Overview</p>
              <h1 className="text-2xl font-semibold text-neutral-900">Operations Command</h1>
            </div>

          </div>
          <div className="flex flex-wrap gap-3">
            <Select value={selectedZone} onValueChange={setSelectedZone}>
              <SelectTrigger className="min-w-[160px] border-neutral-300 bg-white text-neutral-900">
                <SelectValue placeholder="All zones" />
              </SelectTrigger>
              <SelectContent className="border-neutral-200 bg-white text-neutral-900">
                <SelectItem value="all">All zones</SelectItem>
                {zones.map((zone) => (
                  <SelectItem key={zone._id} value={zone._id}>
                    {zone.zoneName || zone.name || "Unnamed Zone"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="min-w-[140px] border-neutral-300 bg-white text-neutral-900">
                <SelectValue placeholder="Overall" />
              </SelectTrigger>
              <SelectContent className="border-neutral-200 bg-white text-neutral-900">
                <SelectItem value="overall">Overall</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="year">This year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Gross revenue"
              value={formatCurrency(revenueTotal)}
              helper={`${periodLabel} delivered order totals (GMV)`}
              icon={<ShoppingBag className="h-5 w-5 text-emerald-600" />}
              accent="bg-emerald-200/40"
              path="/admin/food/transaction-report"
              loading={isLoading}
            />
            <MetricCard
              title="Commission earned"
              value={formatCurrency(commissionTotal)}
              helper={`${periodLabel} restaurant cut`}
              icon={<ArrowUpRight className="h-5 w-5 text-indigo-600" />}
              accent="bg-indigo-200/40"
              path="/admin/food/transaction-report?focus=platform-total"
              loading={isLoading}
            />
            <MetricCard
              title="Orders processed"
              value={processingOrders.toLocaleString("en-IN")}
              helper="Orders currently being processed"
              icon={<Activity className="h-5 w-5 text-amber-600" />}
              accent="bg-amber-200/40"
              path="/admin/food/orders/processing"
              loading={isLoading}
            />
            <MetricCard
              title="Platform fee"
              value={formatCurrency(platformFeeTotal)}
              helper={`Platform service fees: ${periodLabel}`}
              icon={<CreditCard className="h-5 w-5 text-purple-600" />}
              accent="bg-purple-200/40"
              path="/admin/food/fee-settings"
              loading={isLoading}
            />
            <MetricCard
              title="Delivery fee"
              value={formatCurrency(deliveryFeeTotal)}
              helper={`Total delivery fees: ${periodLabel}`}
              icon={<Truck className="h-5 w-5 text-blue-600" />}
              accent="bg-blue-200/40"
              path="/admin/food/transaction-report"
              loading={isLoading}
            />
            <MetricCard
              title="GST"
              value={formatCurrency(gstTotal)}
              helper={`Total tax collected: ${periodLabel}`}
              icon={<Receipt className="h-5 w-5 text-orange-600" />}
              accent="bg-orange-200/40"
              path="/admin/food/tax-report"
              loading={isLoading}
            />
            <MetricCard
              title="Platform Total"
              value={formatCurrency(totalAdminEarnings, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              helper={totalRevenueHelper}
              icon={<DollarSign className="h-5 w-5 text-green-600" />}
              accent="bg-green-200/40"
              path="/admin/food/transaction-report?focus=platform-total"
              loading={isLoading}
            />
            <MetricCard
              title="Total restaurants"
              value={totalRestaurants.toLocaleString("en-IN")}
              helper="Approved restaurants"
              icon={<Store className="h-5 w-5 text-blue-600" />}
              accent="bg-blue-200/40"
              path="/admin/food/restaurants"
            />
            <MetricCard
              title="Restaurant request pending"
              value={pendingRestaurantRequests.toLocaleString("en-IN")}
              helper="Awaiting approval"
              icon={<UserCheck className="h-5 w-5 text-orange-600" />}
              accent="bg-orange-200/40"
              path="/admin/food/restaurants/joining-request"
            />
            <MetricCard
              title="Total delivery boy"
              value={totalDeliveryBoys.toLocaleString("en-IN")}
              helper="Approved delivery partners"
              icon={<Truck className="h-5 w-5 text-indigo-600" />}
              accent="bg-indigo-200/40"
              path="/admin/food/delivery-partners"
            />
            <MetricCard
              title="Delivery boy request pending"
              value={pendingDeliveryBoyRequests.toLocaleString("en-IN")}
              helper="Awaiting verification"
              icon={<Clock className="h-5 w-5 text-yellow-600" />}
              accent="bg-yellow-200/40"
              path="/admin/food/delivery-partners/join-request"
            />
            <MetricCard
              title="Total foods"
              value={totalFoods.toLocaleString("en-IN")}
              helper="Approved menu items"
              icon={<Package className="h-5 w-5 text-purple-600" />}
              accent="bg-purple-200/40"
              path="/admin/food/foods"
            />
            <MetricCard
              title="Total addons"
              value={totalAddons.toLocaleString("en-IN")}
              helper="Approved addon items"
              icon={<Plus className="h-5 w-5 text-pink-600" />}
              accent="bg-pink-200/40"
              path="/admin/food/addons"
            />
            <MetricCard
              title="Total customers"
              value={totalCustomers.toLocaleString("en-IN")}
              helper="Registered users"
              icon={<UserCircle className="h-5 w-5 text-cyan-600" />}
              accent="bg-cyan-200/40"
              path="/admin/food/customers"
            />
            <MetricCard
              title="Total orders"
              value={ordersTotal.toLocaleString("en-IN")}
              helper={`${periodLabel} all orders`}
              icon={<Package className="h-5 w-5 text-slate-600" />}
              accent="bg-slate-200/40"
              path="/admin/food/orders/all"
              loading={isLoading}
            />
            <MetricCard
              title="Pending orders"
              value={pendingOrders.toLocaleString("en-IN")}
              helper="Orders awaiting processing"
              icon={<Clock className="h-5 w-5 text-red-600" />}
              accent="bg-red-200/40"
              path="/admin/food/orders/pending"
              loading={isLoading}
            />
            <MetricCard
              title="Completed orders"
              value={completedOrders.toLocaleString("en-IN")}
              helper="Successfully delivered"
              icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
              accent="bg-emerald-200/40"
              path="/admin/food/orders/delivered"
              loading={isLoading}
            />
            <MetricCard
              title="Total Cash Orders"
              value={cashOrdersTotal.toLocaleString("en-IN")}
              helper={`${periodLabel} cash / COD orders`}
              icon={<IndianRupee className="h-5 w-5 text-teal-600" />}
              accent="bg-teal-200/40"
              path="/admin/food/orders/all"
              loading={isLoading}
            />
            <MetricCard
              title="Total Online Orders"
              value={onlineOrdersTotal.toLocaleString("en-IN")}
              helper={`${periodLabel} online payment orders`}
              icon={<CreditCard className="h-5 w-5 text-sky-600" />}
              accent="bg-sky-200/40"
              path="/admin/food/orders/all"
              loading={isLoading}
            />
            <MetricCard
              title="Total Cancelled Orders"
              value={cancelledOrdersTotal.toLocaleString("en-IN")}
              helper={`${periodLabel} cancelled orders`}
              icon={<XCircle className="h-5 w-5 text-rose-600" />}
              accent="bg-rose-200/40"
              path="/admin/food/orders/canceled"
              loading={isLoading}
            />
            <MetricCard
              title="Delivery Boy Earning"
              value={formatCurrency(deliveryBoyEarningTotal)}
              helper={`${periodLabel} rider payout on delivered orders`}
              icon={<Truck className="h-5 w-5 text-violet-600" />}
              accent="bg-violet-200/40"
              path="/admin/food/delivery-partners/earnings"
              loading={isLoading}
            />
            <MetricCard
              title="Restaurants Earning"
              value={formatCurrency(restaurantEarningTotal)}
              helper={`${periodLabel} restaurant share (subtotal + packaging − commission)`}
              icon={<Store className="h-5 w-5 text-lime-600" />}
              accent="bg-lime-200/40"
              path="/admin/food/restaurants/earnings"
              loading={isLoading}
            />
            <MetricCard
              title="Restaurants Onboarded"
              value={restaurantsOnboardedTotal.toLocaleString("en-IN")}
              helper={
                restaurantsOnboardedTotal > 0 || onboardedBreakdown
                  ? `${periodLabel} live restaurants${onboardedBreakdown ? ` · not counted: ${onboardedBreakdown}` : ""}`
                  : `No restaurant signups: ${periodLabel.toLowerCase()}`
              }
              icon={<ClipboardCheck className="h-5 w-5 text-teal-600" />}
              accent="bg-teal-200/40"
              path="/admin/food/restaurants"
              loading={isLoading}
            />
            <MetricCard
              title="Onboarding Earning"
              value={formatCurrency(onboardingEarningTotal, { maximumFractionDigits: 2 })}
              helper={
                onboardingPaymentsCount > 0
                  ? `${periodLabel} onboarding fees from ${onboardingPaymentsCount.toLocaleString("en-IN")} paid restaurant${onboardingPaymentsCount === 1 ? "" : "s"}${onboardingDiscount > 0 ? ` · ${formatCurrency(onboardingDiscount)} offer discount` : ""}`
                  : `No onboarding fees collected: ${periodLabel.toLowerCase()}`
              }
              icon={<IndianRupee className="h-5 w-5 text-cyan-700" />}
              accent="bg-cyan-200/40"
              path="/admin/food/onboarding-pricing?tab=payments"
              loading={isLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2 min-w-0 border-neutral-200 bg-white">
              <CardHeader className="flex flex-col gap-2 border-b border-neutral-200 pb-4">
                <CardTitle className="text-lg text-neutral-900">Revenue trajectory</CardTitle>
                <p className="text-sm text-neutral-500">
                  Commission and gross revenue with monthly order volume
                </p>
              </CardHeader>
              <CardContent className="min-w-0 pt-4">
                <div className="h-80 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={monthlyData}>
                      <defs>
                        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="comFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" stroke="#6b7280" />
                      <YAxis stroke="#6b7280" />
                      <Tooltip
                        contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}
                        labelStyle={{ color: "#111827" }}
                        itemStyle={{ color: "#111827" }}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#0ea5e9"
                        fillOpacity={1}
                        fill="url(#revFill)"
                        name="Gross revenue"
                      />
                      <Area
                        type="monotone"
                        dataKey="commission"
                        stroke="#a855f7"
                        fillOpacity={1}
                        fill="url(#comFill)"
                        name="Commission"
                      />
                      <Bar
                        dataKey="orders"
                        fill="#ef4444"
                        radius={[6, 6, 0, 0]}
                        name="Orders"
                        barSize={10}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 border-neutral-200 bg-white">
              <CardHeader className="flex items-center justify-between border-b border-neutral-200 pb-4">
                <div>
                  <CardTitle className="text-lg text-neutral-900">Order mix</CardTitle>
                  <p className="text-sm text-neutral-500">Distribution by state</p>
                </div>
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700">
                  {ordersTotal.toLocaleString("en-IN")} orders
                </span>
              </CardHeader>
              <CardContent className="min-w-0 pt-4">
                <div className="h-72 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={4}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}
                        labelStyle={{ color: "#111827" }}
                        itemStyle={{ color: "#111827" }}
                      />
                      <Legend
                        formatter={(value) => <span style={{ color: "#111827", fontSize: 12 }}>{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {orderStats.map((item) => (
                    <div
                      key={item.label}
                    onClick={() => {
                        const routes = {
                          'Delivered': '/admin/food/orders/delivered',
                          'Cancelled': '/admin/food/orders/canceled',
                          'Refunded': '/admin/food/orders/refunded',
                          'Pending': '/admin/food/orders/pending',
                          'Processing': '/admin/food/orders/processing',
                          'In Transit': '/admin/food/orders/food-on-the-way',
                        }
                        navigate(routes[item.label] || '/admin/food/orders/all')
                      }}
                      className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-2 cursor-pointer hover:bg-neutral-50 hover:border-neutral-300 transition-all group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full transition-transform group-hover:scale-125" style={{ background: item.color }} />
                        <p className="text-sm text-neutral-800 group-hover:text-neutral-900">{item.label}</p>
                      </div>
                      <p className="text-sm font-semibold text-neutral-900">{item.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="min-w-0 border-neutral-200 bg-white">
              <CardHeader className="flex items-center justify-between border-b border-neutral-200 pb-4">
                <CardTitle className="text-lg text-neutral-900">Momentum snapshot</CardTitle>
                <span className="text-xs text-neutral-500">Summary: {ordersTotal} Orders</span>
              </CardHeader>
              <CardContent className="min-w-0 pt-4">
                <div className="h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={monthlyData.slice(-6)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" stroke="#6b7280" />
                      <YAxis stroke="#6b7280" />
                      <Tooltip
                        contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}
                        labelStyle={{ color: "#111827" }}
                        itemStyle={{ color: "#111827" }}
                      />
                      <Legend />
                      <Bar dataKey="orders" fill="#0ea5e9" radius={[8, 8, 0, 0]} name="Orders" />
                      <Bar dataKey="commission" fill="#a855f7" radius={[8, 8, 0, 0]} name="Commission" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-neutral-200 bg-white">
              <CardHeader className="border-b border-neutral-200 pb-4">
                <CardTitle className="text-lg text-neutral-900">Live signals</CardTitle>
                <p className="text-sm text-neutral-500">Ops notes and service health</p>
              </CardHeader>
              <CardContent className="space-y-3 pt-4 h-[300px] overflow-y-auto custom-scrollbar">
                {activityFeed.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-10 text-neutral-400">
                    <Activity className="h-10 w-10 mb-2 opacity-20" />
                    <p className="text-sm">No recent signals</p>
                  </div>
                ) : (
                  activityFeed.map((item, idx) => {
                    const getIcon = (type) => {
                      switch (type) {
                        case "order_pending":
                          return <Clock className="h-4 w-4 text-amber-600" />
                        case "order_delivered":
                          return <CheckCircle className="h-4 w-4 text-emerald-600" />
                        case "order_cancelled":
                          return <XCircle className="h-4 w-4 text-red-600" />
                        case "restaurant":
                          return <Store className="h-4 w-4 text-blue-600" />
                        case "delivery":
                          return <Truck className="h-4 w-4 text-purple-600" />
                        case "customer":
                          return <UserCircle className="h-4 w-4 text-pink-600" />
                        default:
                          return <Activity className="h-4 w-4 text-neutral-600" />
                      }
                    }

                    const getBg = (type) => {
                      switch (type) {
                        case "order_pending":
                          return "bg-amber-50"
                        case "order_delivered":
                          return "bg-emerald-50"
                        case "order_cancelled":
                          return "bg-red-50"
                        case "restaurant":
                          return "bg-blue-50"
                        case "delivery":
                          return "bg-purple-50"
                        case "customer":
                          return "bg-pink-50"
                        default:
                          return "bg-neutral-50"
                      }
                    }

                    return (
                      <div
                        key={idx}
                        className={`flex items-start gap-3 rounded-xl border border-neutral-200 ${getBg(item.type)} px-3 py-3 hover:border-neutral-300 transition-all`}
                      >
                        <div className="mt-0.5">{getIcon(item.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-neutral-900 truncate">{item.title}</p>
                            <span className="text-[10px] text-neutral-400 whitespace-nowrap">{item.time}</span>
                          </div>
                          <p className="text-xs text-neutral-600 line-clamp-1">{item.detail}</p>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            <Card className="border-neutral-200 bg-white">
              <CardHeader className="border-b border-neutral-200 pb-4">
                <CardTitle className="text-lg text-neutral-900">Order states</CardTitle>
                <p className="text-sm text-neutral-500">Quick glance by status</p>
              </CardHeader>
              <CardContent className="grid gap-3 pt-4">
                {orderStats.map((item) => (
                  <div
                    key={item.label}
                    onClick={() => {
                      const routes = {
                        'Delivered': '/admin/food/orders/delivered',
                        'Cancelled': '/admin/food/orders/canceled',
                        'Refunded': '/admin/food/orders/refunded',
                        'Pending': '/admin/food/orders/pending',
                        'Processing': '/admin/food/orders/processing',
                        'In Transit': '/admin/food/orders/food-on-the-way',
                      }
                      navigate(routes[item.label] || '/admin/food/orders/all')
                    }}
                    className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 cursor-pointer hover:bg-neutral-100 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold text-neutral-900 transition-transform group-hover:scale-110"
                        style={{ background: `${item.color}1A`, color: item.color }}
                      >
                        {item.label.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="text-sm text-neutral-900 group-hover:font-medium">{item.label}</p>
                        <p className="text-xs text-neutral-500">Tracked in {selectedPeriod}</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-neutral-900">{item.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ title, value, helper, icon, accent, path, loading = false }) {
  const navigate = useNavigate()
  return (
    <Card
      className="group relative overflow-hidden border-neutral-200 bg-white p-0 cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 active:scale-[0.98]"
      onClick={() => path && navigate(path)}
    >
      <CardContent className="relative flex flex-col gap-2 px-4 pb-4 pt-4 h-full">
        <div className={`absolute inset-0 opacity-40 transition-opacity duration-300 group-hover:opacity-60 ${accent}`} />
        <div className="relative flex items-center justify-between z-10">
          <div className="flex-1 min-w-0 mr-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 font-bold mb-1 truncate">{title}</p>
            <div className="text-xl font-bold text-neutral-900 leading-tight mb-1 min-h-[1.75rem] flex items-center">
              {loading ? (
                <span className="inline-block h-6 w-24 rounded-md bg-neutral-200 animate-pulse" />
              ) : (
                value
              )}
            </div>
            <p className="text-[10px] text-neutral-500 font-medium line-clamp-2 leading-snug break-words">
              {loading ? (
                <span className="inline-block h-3 w-32 rounded bg-neutral-100 animate-pulse" />
              ) : (
                helper
              )}
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/90 ring-1 ring-neutral-200 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 group-hover:shadow-md">
            {icon}
          </div>
        </div>
        <div className="absolute bottom-2 right-2 opacity-0 transform translate-x-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0">
          <ArrowUpRight className="h-3 w-3 text-neutral-400" />
        </div>
      </CardContent>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="px-4 pb-10 lg:px-6 pt-4 w-full">
      <div className="relative overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_30px_120px_-60px_rgba(0,0,0,0.28)]">
        {/* Header Skeleton */}
        <div className="flex flex-col gap-4 border-b border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div>
              <div className="h-3 w-32 rounded bg-neutral-200 animate-pulse mb-2" />
              <div className="h-6 w-48 rounded bg-neutral-300 animate-pulse" />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="h-10 w-[160px] rounded-lg bg-neutral-200 animate-pulse" />
            <div className="h-10 w-[140px] rounded-lg bg-neutral-200 animate-pulse" />
          </div>
        </div>

        {/* Cards Skeleton */}
        <div className="space-y-6 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="border border-neutral-200 rounded-xl bg-white p-4 h-[100px] flex items-center justify-between">
                <div className="flex flex-col gap-2 w-2/3">
                  <div className="h-2 w-16 bg-neutral-200 rounded animate-pulse" />
                  <div className="h-6 w-24 bg-neutral-300 rounded animate-pulse" />
                  <div className="h-2 w-32 bg-neutral-100 rounded animate-pulse" />
                </div>
                <div className="h-10 w-10 bg-neutral-200 rounded-xl animate-pulse shrink-0" />
              </div>
            ))}
          </div>
          
          {/* Charts Skeleton */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 border border-neutral-200 rounded-xl bg-white p-4 h-[400px]">
              <div className="h-5 w-40 bg-neutral-200 rounded animate-pulse mb-2" />
              <div className="h-3 w-64 bg-neutral-100 rounded animate-pulse mb-6" />
              <div className="h-[300px] w-full bg-neutral-50 rounded animate-pulse" />
            </div>
            <div className="border border-neutral-200 rounded-xl bg-white p-4 h-[400px]">
              <div className="h-5 w-32 bg-neutral-200 rounded animate-pulse mb-2" />
              <div className="h-3 w-48 bg-neutral-100 rounded animate-pulse mb-6" />
              <div className="h-[250px] w-[250px] bg-neutral-50 rounded-full animate-pulse mx-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

