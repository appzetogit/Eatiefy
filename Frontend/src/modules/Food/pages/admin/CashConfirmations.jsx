import { useCallback, useEffect, useRef, useState } from "react"

import { Search, CheckCircle2, Loader2, Package, RefreshCw, XCircle } from "lucide-react"

import { adminAPI } from "@food/api"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"

import { toast } from "sonner"

import { refreshSidebarBadges } from "@food/components/admin/AdminSidebar"

import { useAdminBadgeListRefresh } from "@food/hooks/useAdminBadgeListRefresh"

import {

  Dialog,

  DialogContent,

  DialogHeader,

  DialogTitle,

  DialogFooter,

} from "@food/components/ui/dialog"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"



const formatCurrency = (amount) => {

  if (amount == null) return "\u20B90.00"

  return `\u20B9${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

}



const formatDateOnly = (value) => {

  if (!value) return "\u2014"

  try {

    return new Date(value).toLocaleDateString("en-IN", {

      day: "2-digit",

      month: "short",

      year: "numeric",

    })

  } catch {

    return "\u2014"

  }

}



const TABS = [

  { key: "all", label: "All" },

  { key: "pending", label: "Pending" },

  { key: "confirmed", label: "Confirmed" },

]



export default function CashConfirmations() {
  const { canEdit } = useAdminPermissions()

  const [activeTab, setActiveTab] = useState("all")

  // Zone picked in the header: only cash submissions of riders in that zone.
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()

  const handleZoneChange = (nextZoneId) => {
    setPage(1)
    setZoneId(nextZoneId)
  }

  const [searchQuery, setSearchQuery] = useState("")

  const [transactions, setTransactions] = useState([])

  const [loading, setLoading] = useState(true)

  const [page, setPage] = useState(1)

  const [pages, setPages] = useState(1)

  const [total, setTotal] = useState(0)

  const [selectedTx, setSelectedTx] = useState(null)

  const [processingAction, setProcessingAction] = useState(null)

  const limit = 20

  const searchDebounceRef = useRef(null)

  const requestIdRef = useRef(0)

  const loadingRequestIdRef = useRef(0)

  const skipSearchEffectRef = useRef(true)



  const fetchConfirmations = useCallback(async ({

    silent = false,

    page: pageOverride,

    search: searchOverride,

    tab: tabOverride,

  } = {}) => {

    const requestId = ++requestIdRef.current

    const p = pageOverride ?? page

    const q = searchOverride !== undefined ? searchOverride : searchQuery

    const tab = tabOverride ?? activeTab



    try {

      if (!silent) {

        setLoading(true)

        loadingRequestIdRef.current = requestId

      }

      const res = await adminAPI.getCashConfirmations({

        search: q.trim() || undefined,

        tab,

        zoneId: zoneId || undefined,

        page: p,

        limit,

      })

      if (requestId !== requestIdRef.current) return



      if (res?.data?.success) {

        const data = res.data.data

        setTransactions(data?.transactions || [])

        setTotal(data?.pagination?.total || 0)

        setPages(data?.pagination?.pages || 1)

      } else if (!silent) {

        toast.error(res?.data?.message || "Failed to fetch cash confirmations")

        setTransactions([])

      }

    } catch (err) {

      if (requestId !== requestIdRef.current) return

      if (!silent) {

        toast.error(err?.response?.data?.message || "Failed to fetch cash confirmations")

        setTransactions([])

      }

    } finally {

      // Silent badge/focus refreshes bump requestIdRef; don't leave the UI stuck on loading.
      if (!silent && loadingRequestIdRef.current === requestId) {

        setLoading(false)

      }

    }

  }, [activeTab, page, searchQuery, zoneId])



  useAdminBadgeListRefresh("cashConfirmations", fetchConfirmations, [fetchConfirmations])



  useEffect(() => {

    fetchConfirmations()

  }, [fetchConfirmations])



  useEffect(() => {

    if (skipSearchEffectRef.current) {

      skipSearchEffectRef.current = false

      return

    }

    if (searchDebounceRef.current) {

      clearTimeout(searchDebounceRef.current)

    }

    searchDebounceRef.current = setTimeout(() => {

      setPage(1)

      fetchConfirmations({ page: 1, search: searchQuery, silent: true })

    }, 400)

    return () => {

      if (searchDebounceRef.current) {

        clearTimeout(searchDebounceRef.current)

      }

    }

  }, [searchQuery, fetchConfirmations])



  useEffect(() => {

    const onFocus = () => fetchConfirmations({ silent: true })

    const onVisibility = () => {

      if (document.visibilityState === "visible") {

        fetchConfirmations({ silent: true })

      }

    }

    window.addEventListener("focus", onFocus)

    document.addEventListener("visibilitychange", onVisibility)

    return () => {

      window.removeEventListener("focus", onFocus)

      document.removeEventListener("visibilitychange", onVisibility)

    }

  }, [fetchConfirmations])



  const getStatusBadge = (status) => {

    const s = String(status || "").toLowerCase()

    if (s === "completed") return "bg-emerald-100 text-emerald-700"

    if (s === "failed") return "bg-red-100 text-red-700"

    if (s === "received") return "bg-emerald-100 text-emerald-700"

    if (s === "not received") return "bg-red-100 text-red-700"

    if (s === "pending") return "bg-amber-100 text-amber-700"

    return "bg-slate-100 text-slate-700"

  }



  const isPending = (tx) => String(tx?.rawStatus || tx?.status || "").toLowerCase() === "pending"



  const handleSettlementAction = async (action) => {

    if (!selectedTx?.id) return

    try {

      setProcessingAction(action)

      const res = await adminAPI.updateCashLimitSettlement(selectedTx.id, { action })

      if (res?.data?.success) {

        toast.success(

          action === "received"

            ? "Cash received. Delivery partner limit updated."

            : "Marked as not received.",

        )

        setSelectedTx(null)

        refreshSidebarBadges("cashConfirmations")

        fetchConfirmations({ silent: true })

      } else {

        toast.error(res?.data?.message || "Failed to update confirmation")

      }

    } catch (err) {

      toast.error(err?.response?.data?.message || "Failed to update confirmation")

    } finally {

      setProcessingAction(null)

    }

  }



  const handleTabChange = (tabKey) => {

    setActiveTab(tabKey)

    setPage(1)

    fetchConfirmations({ tab: tabKey, page: 1 })

  }



  const handlePageChange = (nextPage) => {

    setPage(nextPage)

    fetchConfirmations({ page: nextPage, silent: true })

  }



  return (

    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">

      <div className="max-w-full mx-auto">

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">

          <div className="flex items-center justify-between gap-4">

            <div className="flex items-center gap-3 min-w-0">

              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />

              <div className="min-w-0">

                <h1 className="text-2xl font-bold text-slate-900">Cash Confirmations</h1>

                <p className="text-sm text-slate-600 mt-1">

                  Cash submissions need admin confirmation before the delivery partner&apos;s limit is restored.

                </p>

              </div>

            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <AdminZoneSelect value={zoneId} onChange={handleZoneChange} zones={zones} loading={zonesLoading} />
            <button

              onClick={() => fetchConfirmations()}

              disabled={loading}

              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 shrink-0"

            >

              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />

              Refresh

            </button>
            </div>

          </div>

        </div>



        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">

          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">

            <div className="flex flex-wrap gap-2">

              {TABS.map((tab) => (

                <button

                  key={tab.key}

                  onClick={() => handleTabChange(tab.key)}

                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${

                    activeTab === tab.key

                      ? "bg-slate-900 text-white border-slate-900"

                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"

                  }`}

                >

                  {tab.label}

                </button>

              ))}

            </div>

            <div className="relative flex-1 lg:flex-initial min-w-[220px] max-w-sm">

              <input

                type="text"

                placeholder="Search name or phone"

                value={searchQuery}

                onChange={(e) => setSearchQuery(e.target.value)}

                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"

              />

              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

            </div>

          </div>



          {loading ? (

            <div className="py-20 text-center">

              <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-4" />

              <p className="text-slate-600">Loading confirmations...</p>

            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full min-w-[900px]">

                <thead className="bg-slate-50 border-b border-slate-200">

                  <tr>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">S.No</th>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Date</th>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Delivery Boy</th>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Phone</th>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Amount</th>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Method</th>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status</th>

                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>

                  </tr>

                </thead>

                <tbody className="bg-white divide-y divide-slate-100">

                  {transactions.length === 0 ? (

                    <tr>

                      <td colSpan={8} className="px-6 py-20 text-center">

                        <div className="flex flex-col items-center justify-center">

                          <Package className="w-16 h-16 text-slate-400 mb-4" />

                          <p className="text-lg font-semibold text-slate-700">No cash submissions found</p>

                          <p className="text-sm text-slate-500 mt-1">

                            {searchQuery

                              ? `No results for "${searchQuery}"`

                              : "No manual cash submissions yet."}

                          </p>

                        </div>

                      </td>

                    </tr>

                  ) : (

                    transactions.map((tx, i) => (

                      <tr key={tx.id || i} className="hover:bg-slate-50 transition-colors">

                        <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-500">{(page - 1) * limit + i + 1}</td>

                        <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600">{formatDateOnly(tx.createdAt)}</td>

                        <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-slate-800">{tx.deliveryName || "\u2014"}</td>

                        <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600">{tx.deliveryPhone || "\u2014"}</td>

                        <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-emerald-700">{formatCurrency(tx.amount)}</td>

                        <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600">{tx.paymentMethod || "Cash"}</td>

                        <td className="px-4 py-4 whitespace-nowrap">

                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${getStatusBadge(tx.status)}`}>

                            {String(tx.status || "Pending")}

                          </span>

                        </td>

                        <td className="px-4 py-4 whitespace-nowrap">

                          {isPending(tx) ? (

                            canEdit && (
                            <button

                              type="button"

                              onClick={() => setSelectedTx(tx)}

                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800"

                            >

                              Confirm Cash

                            </button>
                            )

                          ) : (

                            <span className={`text-xs font-bold ${

                              tx.actionLabel === "Received" ? "text-emerald-700" : "text-red-600"

                            }`}>

                              {tx.actionLabel || "\u2014"}

                            </span>

                          )}

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

                Page {page} of {pages} &middot; {total} total

              </p>

              <div className="flex gap-2">

                <button

                  onClick={() => handlePageChange(Math.max(1, page - 1))}

                  disabled={page <= 1}

                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"

                >

                  Previous

                </button>

                <button

                  onClick={() => handlePageChange(Math.min(pages, page + 1))}

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



      <Dialog open={Boolean(selectedTx)} onOpenChange={(open) => !open && setSelectedTx(null)}>

        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] p-0 overflow-hidden border border-slate-200 bg-white shadow-2xl gap-0">

          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100 text-left">

            <DialogTitle className="text-lg font-bold text-slate-900">Confirm Cash Submission</DialogTitle>

            {selectedTx && (

              <p className="text-sm text-slate-600 font-normal mt-2 leading-relaxed">

                Have you received <span className="font-bold text-slate-900">{formatCurrency(selectedTx.amount)}</span> cash from{" "}

                <span className="font-bold text-slate-900">{selectedTx.deliveryName || "this delivery boy"}</span>?

              </p>

            )}

          </DialogHeader>



          {selectedTx && (

            <div className="px-6 py-5 space-y-5">

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-5 text-center">

                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Amount</p>

                <p className="text-3xl font-bold text-emerald-700 mt-1">{formatCurrency(selectedTx.amount)}</p>

              </div>



              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">

                {[

                  ["Delivery Boy", selectedTx.deliveryName],

                  ["Phone", selectedTx.deliveryPhone || "\u2014"],

                  ["Date", formatDateOnly(selectedTx.createdAt)],

                  ["Method", selectedTx.paymentMethod || "Cash"],

                ].map(([label, value]) => (

                  <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 bg-white">

                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">{label}</span>

                    <span className="text-sm font-semibold text-slate-900 text-right break-all">{value}</span>

                  </div>

                ))}

              </div>



              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">

                <p className="text-xs text-amber-900 leading-relaxed">

                  Confirm only after you have physically received this cash from{" "}

                  <span className="font-bold">{selectedTx.deliveryName || "the delivery boy"}</span>.

                  Selecting <span className="font-bold">Received</span> will restore their available cash limit instantly.

                </p>

              </div>

            </div>

          )}



          <DialogFooter className="px-6 py-4 bg-slate-50 border-t border-slate-100 gap-3 sm:justify-stretch flex-col sm:flex-row">

            <button

              type="button"

              disabled={Boolean(processingAction)}

              onClick={() => handleSettlementAction("received")}

              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 active:scale-[0.98] transition-all disabled:opacity-50 shadow-sm"

            >

              {processingAction === "received" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}

              Received

            </button>

            <button

              type="button"

              disabled={Boolean(processingAction)}

              onClick={() => handleSettlementAction("not_received")}

              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-50 shadow-sm"

            >

              {processingAction === "not_received" ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}

              Not Received

            </button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

    </div>

  )

}


