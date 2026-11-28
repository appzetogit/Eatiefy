import { useCallback, useEffect, useState } from "react"
import { Wallet, TrendingUp, TrendingDown, Loader2, Calendar } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
]

const formatCurrency = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const formatDate = (value) => {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

const EMPTY_SUMMARY = {
  income: { commission: 0, platformFee: 0, adminMarkup: 0, deliveryFee: 0, taxes: 0, subscription: 0, total: 0 },
  deductions: { riderPayouts: 0, couponDiscounts: 0, deliveryBonuses: 0, earningAddonRewards: 0, referralRewards: 0, total: 0 },
  netEarning: 0,
  orders: { delivered: 0, orderValue: 0, foodSales: 0 },
  riderIncentive: 0,
  subscriptionPayments: 0,
  counts: { deliveryBonuses: 0, earningAddonRewards: 0, referralRewards: 0 },
}

function BreakdownRow({ label, hint, value, tone = "text-slate-900" }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm text-slate-700">{label}</p>
        {hint ? <p className="text-xs text-slate-400 mt-0.5">{hint}</p> : null}
      </div>
      <p className={`text-sm font-semibold whitespace-nowrap ${tone}`}>{formatCurrency(value)}</p>
    </div>
  )
}

export default function AdminEarning() {
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()
  const [period, setPeriod] = useState("month")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [notZoneFiltered, setNotZoneFiltered] = useState([])

  const hasCustomRange = Boolean(fromDate || toDate)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getAdminEarnings({
        page: currentPage,
        limit: pageSize,
        zoneId: zoneId || undefined,
        ...(hasCustomRange ? { fromDate: fromDate || undefined, toDate: toDate || undefined } : { period }),
      })
      const data = response?.data?.data
      if (!response?.data?.success || !data) throw new Error(response?.data?.message || "Failed to load admin earnings")
      setSummary({ ...EMPTY_SUMMARY, ...data.summary })
      setOrders(Array.isArray(data.orders) ? data.orders : [])
      setTotal(Number(data.pagination?.total) || 0)
      setNotZoneFiltered(Array.isArray(data.filters?.notZoneFiltered) ? data.filters.notZoneFiltered : [])
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to load admin earnings")
      setSummary(EMPTY_SUMMARY)
      setOrders([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, zoneId, period, fromDate, toDate, hasCustomRange])

  useEffect(() => {
    load()
  }, [load])

  // Any filter change goes back to the first page.
  useEffect(() => {
    setCurrentPage(1)
  }, [zoneId, period, fromDate, toDate, pageSize])

  const { income, deductions } = summary
  const net = Number(summary.netEarning) || 0

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header + filters */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Admin Earning</h1>
                <p className="text-sm text-slate-600">
                  What the platform itself earns from commission, fees, taxes and subscriptions, and what it pays out of that.
                </p>
              </div>
            </div>
            <AdminZoneSelect value={zoneId} onChange={setZoneId} zones={zones} loading={zonesLoading} />
          </div>

          <div className="mt-5 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setPeriod(p.key)
                    setFromDate("")
                    setToDate("")
                  }}
                  className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    !hasCustomRange && period === p.key
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              <Calendar className="w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                aria-label="From date"
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                aria-label="To date"
              />
            </div>
          </div>
        </div>

        {loading && orders.length === 0 && summary === EMPTY_SUMMARY ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            {/* Totals */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 text-emerald-600">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Total income</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(income.total)}</p>
                <p className="text-xs text-slate-500 mt-1">
                  From {Number(summary.orders.delivered).toLocaleString("en-IN")} delivered orders
                  {summary.subscriptionPayments ? ` and ${summary.subscriptionPayments} subscription payments` : ""}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 text-rose-600">
                  <TrendingDown className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Total deductions</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(deductions.total)}</p>
                <p className="text-xs text-slate-500 mt-1">Paid out of the income above</p>
              </div>
              <div className={`rounded-xl border p-5 ${net >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                <div className={`flex items-center gap-2 ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  <Wallet className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Net earning</span>
                </div>
                <p className={`mt-2 text-2xl font-bold ${net >= 0 ? "text-emerald-800" : "text-rose-800"}`}>{formatCurrency(net)}</p>
                <p className="text-xs text-slate-500 mt-1">Income minus deductions</p>
              </div>
            </div>

            {/* Breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-base font-semibold text-slate-900 mb-1">Income</h2>
                <BreakdownRow label="Restaurant commission" hint="Commission on delivered orders" value={income.commission} />
                <BreakdownRow label="Platform fee" hint="Fee charged to customers" value={income.platformFee} />
                <BreakdownRow label="Admin markup" hint="Markup added on item prices" value={income.adminMarkup} />
                <BreakdownRow label="Delivery fee collected" hint="Before paying delivery partners" value={income.deliveryFee} />
                <BreakdownRow label="Taxes collected" hint="GST / tax charged on orders" value={income.taxes} />
                <BreakdownRow
                  label="Subscription"
                  hint={`Restaurant onboarding fees (${summary.subscriptionPayments} paid)`}
                  value={income.subscription}
                />
                <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-200">
                  <p className="text-sm font-semibold text-slate-900">Total income</p>
                  <p className="text-sm font-bold text-emerald-700">{formatCurrency(income.total)}</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-base font-semibold text-slate-900 mb-1">Deductions</h2>
                <BreakdownRow
                  label="Delivery partner payouts"
                  hint={`Base earning + Eatiefy incentive (incentive part: ${formatCurrency(summary.riderIncentive)})`}
                  value={deductions.riderPayouts}
                  tone="text-rose-600"
                />
                <BreakdownRow label="Coupon discounts" hint="Discounts given to customers" value={deductions.couponDiscounts} tone="text-rose-600" />
                <BreakdownRow
                  label="Delivery partner bonuses"
                  hint={`${summary.counts.deliveryBonuses} bonuses paid`}
                  value={deductions.deliveryBonuses}
                  tone="text-rose-600"
                />
                <BreakdownRow
                  label="Earning addon rewards"
                  hint={`${summary.counts.earningAddonRewards} offers credited`}
                  value={deductions.earningAddonRewards}
                  tone="text-rose-600"
                />
                <BreakdownRow
                  label="Referral rewards"
                  hint={`${summary.counts.referralRewards} rewards credited`}
                  value={deductions.referralRewards}
                  tone="text-rose-600"
                />
                <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-200">
                  <p className="text-sm font-semibold text-slate-900">Total deductions</p>
                  <p className="text-sm font-bold text-rose-600">{formatCurrency(deductions.total)}</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Restaurant payouts (the food value restaurants keep) are not the platform's money and are left out. Delivery-fee and
              rider figures are summed over all delivered orders, so a delivery that cost more than its fee shows up as a loss.
              {notZoneFiltered.includes("referralRewards")
                ? " Referral rewards belong to customers, who have no zone, so they are not narrowed by the selected zone."
                : ""}
            </p>

            {/* Per-order earnings */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-900">
                  Earning by order <span className="ml-2 text-sm font-normal text-slate-500">({total.toLocaleString("en-IN")} delivered)</span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {[
                        ["Order ID", "left"],
                        ["Date", "left"],
                        ["Restaurant", "left"],
                        ["Order value", "right"],
                        ["Commission", "right"],
                        ["Platform fee", "right"],
                        ["Markup", "right"],
                        ["Delivery fee", "right"],
                        ["Taxes", "right"],
                        ["Rider payout", "right"],
                        ["Discount", "right"],
                        ["Net", "right"],
                      ].map(([label, align]) => (
                        <th
                          key={label}
                          className={`px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-700 whitespace-nowrap ${
                            align === "right" ? "text-right" : "text-left"
                          }`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-12 text-center">
                          <Loader2 className="w-6 h-6 animate-spin text-emerald-500 inline-block" />
                        </td>
                      </tr>
                    ) : orders.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                          No delivered orders in this period.
                        </td>
                      </tr>
                    ) : (
                      orders.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">{row.orderId}</td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{row.restaurant}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.orderValue)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.commission)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.platformFee)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.adminMarkup)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.deliveryFee)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.taxes)}</td>
                          <td className="px-4 py-3 text-right text-rose-600">{formatCurrency(row.riderPayout)}</td>
                          <td className="px-4 py-3 text-right text-rose-600">{formatCurrency(row.couponDiscount)}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${row.net >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                            {formatCurrency(row.net)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <AdminListPagination
                currentPage={currentPage}
                pageSize={pageSize}
                totalItems={total}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
                itemLabel="orders"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
