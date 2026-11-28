import { useState, useEffect, useCallback, useRef } from "react"
import { Search, PiggyBank, Loader2, Package, RefreshCw } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { formatRestaurantId } from "@food/utils/formatRestaurantId"

const PAGE_SIZE = 20
const REFRESH_MS = 15000

const formatCurrency = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STAT_CARDS = [
  { key: "availableBalance", label: "Available Balance", color: "text-emerald-600", bg: "bg-emerald-50" },
  { key: "totalEarning", label: "Total Earning", color: "text-blue-600", bg: "bg-blue-50" },
  { key: "commission", label: "Admin Commission", color: "text-violet-600", bg: "bg-violet-50" },
  { key: "totalWithdrawn", label: "Total Withdrawn", color: "text-orange-600", bg: "bg-orange-50" },
  { key: "pendingWithdrawal", label: "Pending Withdrawal", color: "text-rose-600", bg: "bg-rose-50" },
  { key: "deliveredOrders", label: "Delivered Orders", color: "text-slate-900", bg: "bg-slate-100", isCount: true },
]

const COLUMNS = [
  "#",
  "Restaurant",
  "Owner",
  "Delivered Orders",
  "Available Balance",
  "Total Earning",
  "Admin Commission",
  "Withdrawn",
  "Pending Withdrawal",
]

export default function RestaurantWallet() {
  const [wallets, setWallets] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  // Only the newest request may update the screen.
  const requestRef = useRef(0)

  const fetchWallets = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++requestRef.current
    try {
      if (!silent) setLoading(true)
      const res = await adminAPI.getRestaurantWallets({
        search: search || undefined,
        page,
        limit: PAGE_SIZE,
      })
      if (requestId !== requestRef.current) return
      const data = res?.data?.data
      setWallets(data?.wallets || [])
      setSummary(data?.summary || null)
      setTotal(data?.pagination?.total || 0)
      setPages(data?.pagination?.pages || 1)
    } catch (err) {
      if (requestId !== requestRef.current) return
      // A failed background refresh keeps the figures already on screen.
      if (!silent) {
        toast.error(err?.response?.data?.message || "Failed to fetch restaurant wallets")
        setWallets([])
        setSummary(null)
        setTotal(0)
        setPages(1)
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    fetchWallets()
    const interval = setInterval(() => fetchWallets({ silent: true }), REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchWallets])

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim()
      if (next === search) return
      setPage(1)
      setSearch(next)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchInput, search])

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <PiggyBank className="w-5 h-5 text-emerald-600" />
              <h1 className="text-2xl font-bold text-slate-900">Restaurant Wallet</h1>
            </div>
            <button
              onClick={() => fetchWallets()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Total Earning = restaurant share from delivered orders. Available Balance = unsettled earning minus approved and pending withdrawals.
          </p>
        </div>

        {/* Stats Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          {STAT_CARDS.map((stat) => (
            <div key={stat.key} className={`${stat.bg} rounded-xl border border-slate-200 p-4 shadow-sm`}>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className={`text-lg font-bold ${stat.color}`}>
                {!summary ? "—" : stat.isCount ? summary[stat.key] : formatCurrency(summary[stat.key])}
              </p>
            </div>
          ))}
        </div>

        {/* Table Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">Wallets</h2>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700 flex items-center justify-center min-w-[2.5rem] h-7">
                {loading ? <span className="w-5 h-3 rounded bg-slate-300/80 animate-pulse" /> : total}
              </span>
            </div>
            <div className="relative flex-1 sm:flex-initial min-w-[200px] max-w-xs">
              <input
                type="text"
                placeholder="Search by name or phone"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-4" />
              <p className="text-slate-600">Loading wallets…</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {COLUMNS.map((column) => (
                      <th key={column} className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {wallets.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <Package className="w-16 h-16 text-slate-400 mb-4" />
                          <p className="text-lg font-semibold text-slate-700">No wallets found</p>
                          <p className="text-sm text-slate-500 mt-1">
                            {search ? `No results for "${search}"` : "No restaurants found."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    wallets.map((w, i) => (
                      <tr key={w.restaurantId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-semibold text-slate-800">{w.name || "—"}</span>
                            <span className="text-xs text-slate-500">{formatRestaurantId(w.restaurantId)}</span>
                            {w.status !== "approved" && (
                              <span className="inline-flex w-fit px-2 py-0.5 rounded-full text-[10px] font-bold capitalize bg-amber-100 text-amber-700">
                                {String(w.status || "").replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm text-slate-700">{w.ownerName || "—"}</span>
                            <span className="text-xs text-slate-500">{w.phone || "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{w.deliveredOrders}</td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${w.availableBalance > 0 ? "text-emerald-600" : "text-slate-700"}`}>
                            {formatCurrency(w.availableBalance)}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-slate-800">{formatCurrency(w.totalEarning)}</td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-violet-600">{formatCurrency(w.commission)}</td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-orange-600">{formatCurrency(w.totalWithdrawn)}</td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`text-sm font-medium ${w.pendingWithdrawal > 0 ? "text-rose-600" : "text-slate-700"}`}>
                            {formatCurrency(w.pendingWithdrawal)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
              <p className="text-sm text-slate-600">
                Page {page} of {pages} · {total} total
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  disabled={page >= pages}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
