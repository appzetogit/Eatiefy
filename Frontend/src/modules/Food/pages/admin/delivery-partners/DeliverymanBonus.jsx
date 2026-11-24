import { useState, useEffect } from "react"
import { Search, Gift, Plus, Loader2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"

const formatCurrency = (amount) =>
  `\u20B9${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const formatDate = (dateString) => {
  if (!dateString) return "N/A"
  try {
    return new Date(dateString).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return dateString
  }
}

export default function DeliverymanBonus() {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_deliveryman_bonus_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [deliveryPartners, setDeliveryPartners] = useState([])
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ deliveryPartnerId: "", amount: "", reference: "" })

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch])

  useEffect(() => {
    adminAPI.getDeliveryPartners({ limit: 1000, status: "approved" })
      .then((res) => {
        if (res?.data?.success) {
          setDeliveryPartners(res.data.data.deliveryPartners || [])
        }
      })
      .catch(() => {})
  }, [])

  const fetchTransactions = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getDeliveryPartnerBonusTransactions({
        page: currentPage,
        limit: pageSize,
        search: debouncedSearch || undefined,
      })
      if (response?.data?.success) {
        setTransactions(response.data.data.transactions || [])
        setTotalItems(response.data.data.pagination?.total ?? (response.data.data.transactions || []).length)
      } else {
        setTransactions([])
        setTotalItems(0)
        toast.error(response?.data?.message || "Failed to fetch bonus transactions")
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to fetch bonus transactions")
      setTransactions([])
      setTotalItems(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTransactions()
  }, [currentPage, pageSize, debouncedSearch])

  const handleAddBonus = async (e) => {
    e.preventDefault()
    if (!form.deliveryPartnerId) {
      toast.error("Please select a delivery partner")
      return
    }
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Please enter a valid amount")
      return
    }
    try {
      setSubmitting(true)
      await adminAPI.addDeliveryPartnerBonus(form.deliveryPartnerId, amount, form.reference.trim())
      toast.success("Bonus added successfully")
      setIsAddOpen(false)
      setForm({ deliveryPartnerId: "", amount: "", reference: "" })
      fetchTransactions()
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to add bonus")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <Gift className="w-5 h-5 text-violet-600" />
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">Deliveryman Bonus</h1>
                <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
                  {loading ? "..." : totalItems}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:flex-initial min-w-[250px]">
                <input
                  type="text"
                  placeholder="Search by name, phone"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>
              <button
                type="button"
                onClick={() => setIsAddOpen(true)}
                className="px-4 py-2.5 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 flex items-center gap-2 transition-all"
              >
                <Plus className="w-4 h-4" />
                Add Bonus
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">SI</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Deliveryman</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Reference</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                        No bonus transactions found
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx, index) => (
                      <tr key={tx.transactionId || tx._id || index} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                          {(currentPage - 1) * pageSize + index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-blue-600">{tx.deliveryman || "Unknown"}</span>
                            {tx.deliveryId && (
                              <span className="text-xs text-slate-500">{tx.deliveryId}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-violet-600">
                          {formatCurrency(tx.amount ?? tx.bonus)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 max-w-xs truncate" title={tx.reference}>
                          {tx.reference || "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                          {formatDate(tx.createdAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          <AdminListPagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_deliveryman_bonus_pageSize", String(size))
              } catch {
                /* ignore */
              }
            }}
            itemLabel="transactions"
          />
        </div>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md bg-white p-0 overflow-hidden gap-0">
          {/* pr-14 keeps the title clear of the close button, which is
              absolutely positioned at right-5 by the Dialog primitive. */}
          <DialogHeader className="px-5 pt-5 pb-4 pr-14 sm:px-6 sm:pt-6 border-b border-slate-100">
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-violet-600 shrink-0" />
              Add Delivery Bonus
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddBonus} className="px-5 py-5 sm:px-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Delivery Partner</label>
              <select
                required
                value={form.deliveryPartnerId}
                onChange={(e) => setForm({ ...form, deliveryPartnerId: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
              >
                <option value="">Select delivery partner</option>
                {deliveryPartners.map((dp) => (
                  <option key={dp._id} value={dp._id}>{dp.name} {dp.phone ? `(${dp.phone})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Amount (₹)</label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                placeholder="e.g. 500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Reference (optional)</label>
              <input
                type="text"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                placeholder="e.g. Performance bonus"
              />
            </div>
            <DialogFooter className="pt-2 gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 flex items-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Add Bonus
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
