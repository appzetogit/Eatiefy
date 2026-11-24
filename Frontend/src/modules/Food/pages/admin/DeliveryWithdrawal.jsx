import { useState, useEffect } from "react"
import { Search, Wallet, Eye, CheckCircle, XCircle, Loader2, Package, QrCode } from "lucide-react"
import { adminAPI } from "@food/api"
import { refreshSidebarBadges } from "@food/components/admin/AdminSidebar"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@food/components/ui/dialog"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const TABS = [
  { key: "All", label: "All" },
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Approved" },
  { key: "Rejected", label: "Rejected" },
]

export default function DeliveryWithdrawal() {
  const { canEdit } = useAdminPermissions()
  const [activeTab, setActiveTab] = useState("All")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_delivery_withdraws_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [processingAction, setProcessingAction] = useState(null)
  const [rejectionReason, setRejectionReason] = useState("")
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [approveTarget, setApproveTarget] = useState(null)
  const [transactionId, setTransactionId] = useState("")
  // Zone picked in the header: only withdrawals of riders in that zone.
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, activeTab, zoneId])

  useEffect(() => {
    fetchRequests()
  }, [activeTab, debouncedSearch, currentPage, pageSize, zoneId])

  const fetchRequests = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getDeliveryWithdrawals({
        status: activeTab,
        page: currentPage,
        limit: pageSize,
        search: debouncedSearch || undefined,
        zoneId: zoneId || undefined,
      })
      if (response?.data?.success) {
        setRequests(response.data.data?.requests || [])
        setTotalItems(
          response.data.data?.total ??
          response.data?.total ??
          (response.data.data?.requests || []).length,
        )
      } else {
        toast.error(response?.data?.message || "Failed to fetch delivery withdrawal requests")
        setRequests([])
        setTotalItems(0)
      }
    } catch (error) {
      debugError("Error fetching delivery withdrawal requests:", error)
      toast.error(error.response?.data?.message || "Failed to fetch delivery withdrawal requests")
      setRequests([])
      setTotalItems(0)
    } finally {
      setLoading(false)
    }
  }

  const filteredRequests = requests

  const getStatusBadge = (status) => {
    if (status === "Approved" || status === "Processed") return "bg-green-100 text-green-700"
    if (status === "Pending") return "bg-amber-100 text-amber-700"
    if (status === "Rejected") return "bg-red-100 text-red-700"
    return "bg-slate-100 text-slate-700"
  }

  const handleView = (req) => {
    setSelectedRequest(req)
    setIsViewOpen(true)
  }

  const openApproveDialog = (req) => {
    setApproveTarget(req)
    setTransactionId("")
  }

  const closeApproveDialog = () => {
    setApproveTarget(null)
    setTransactionId("")
  }

  // Approval needs the bank/UPI reference of the payout just made; it is stored with the
  // withdrawal so a later dispute can be settled against it.
  const handleApprove = async () => {
    const id = approveTarget?.id
    const txnId = transactionId.trim()
    if (!id) return
    if (txnId.length < 4) {
      toast.error("Enter the transaction ID of the payout (at least 4 characters)")
      return
    }
    try {
      setProcessingAction(id)
      const response = await adminAPI.updateDeliveryWithdrawalStatus(id, {
        status: "Approved",
        transactionId: txnId,
      })
      if (response?.data?.success) {
        toast.success("Withdrawal request approved successfully")
        closeApproveDialog()
        refreshSidebarBadges("deliveryWithdrawals")
        fetchRequests()
      }
 else {
        toast.error(response?.data?.message || "Failed to approve")
      }
    } catch (error) {
      const msg = error.response?.data?.message || error.message || "Failed to approve withdrawal request"
      debugError("Error approving delivery withdrawal:", error?.response?.data || error, msg)
      toast.error(msg)
    } finally {
      setProcessingAction(null)
    }
  }

  const handleReject = async (id) => {
    try {
      setProcessingAction(id)
      const response = await adminAPI.updateDeliveryWithdrawalStatus(id, {
        status: "Rejected",
        rejectionReason: rejectionReason,
      })
      if (response?.data?.success) {
        toast.success("Withdrawal request rejected successfully")
        setShowRejectModal(false)
        setRejectionReason("")
        setSelectedRequest(null)
        refreshSidebarBadges("deliveryWithdrawals")
        fetchRequests()
      }
 else {
        toast.error(response?.data?.message || "Failed to reject")
      }
    } catch (error) {
      debugError("Error rejecting delivery withdrawal:", error)
      toast.error(error.response?.data?.message || "Failed to reject withdrawal request")
    } finally {
      setProcessingAction(null)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return "N/A"
    try {
      return new Date(dateString).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    } catch {
      return String(dateString)
    }
  }

  const formatCurrency = (amount) => {
    if (amount == null) return "\u20B90.00"
    return `\u20B9${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Wallet className="w-5 h-5 text-emerald-600" />
            <h1 className="text-2xl font-bold text-slate-900">Delivery Withdrawal</h1>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            View and manage delivery boy withdrawal requests. Pending requests can be approved or rejected.
          </p>
            </div>
            <AdminZoneSelect value={zoneId} onChange={setZoneId} zones={zones} loading={zonesLoading} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex gap-2 border-b border-slate-200">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.key
                    ? "border-emerald-600 text-emerald-600"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">Withdrawal Requests</h2>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
                {totalItems}
              </span>
            </div>
            <div className="relative flex-1 sm:flex-initial min-w-[200px] max-w-xs">
              <input
                type="text"
                placeholder="Search by delivery name, ID, phone"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-4" />
              <p className="text-slate-600">Loading withdrawal requests…</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">#</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Delivery Boy</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Request Time</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <Package className="w-16 h-16 text-slate-400 mb-4" />
                          <p className="text-lg font-semibold text-slate-700">No requests</p>
                          <p className="text-sm text-slate-500">
                            No {activeTab.toLowerCase()} withdrawal requests.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((req, index) => (
                      <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{index + 1}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{formatCurrency(req.amount)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{req.deliveryName || "N/A"}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{req.deliveryIdString || "N/A"}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{formatDate(req.requestedAt || req.createdAt)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(req.status)}`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleView(req)}
                              className="p-2 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors"
                              title="View details"
                            >
                              <Eye className="w-4 h-4 text-amber-600" />
                            </button>
                            {req.status === "Pending" && canEdit && (
                              <>
                                <button
                                  onClick={() => openApproveDialog(req)}
                                  disabled={processingAction === req.id}
                                  className="p-2 rounded-lg bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Approve"
                                >
                                  {processingAction === req.id ? (
                                    <Loader2 className="w-4 h-4 text-green-600 animate-spin" />
                                  ) : (
                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                  )}
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedRequest(req)
                                    setShowRejectModal(true)
                                  }}
                                  disabled={processingAction === req.id}
                                  className="p-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Reject"
                                >
                                  <XCircle className="w-4 h-4 text-red-600" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <AdminListPagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_delivery_withdraws_pageSize", String(size))
              } catch {}
              setCurrentPage(1)
            }}
            itemLabel="withdrawals"
          />
        </div>

        {/* View details dialog */}
        <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
          <DialogContent className="max-w-md bg-white p-0">
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle>Withdrawal request details</DialogTitle>
            </DialogHeader>
            {selectedRequest && (
              <div className="px-6 pb-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Amount</label>
                  <p className="text-sm font-medium text-slate-900 mt-1">{formatCurrency(selectedRequest.amount)}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Delivery boy</label>
                  <p className="text-sm font-medium text-slate-900 mt-1">{selectedRequest.deliveryName || "N/A"}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Delivery ID</label>
                  <p className="text-sm font-medium text-slate-900 mt-1">{selectedRequest.deliveryIdString || "N/A"}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Phone</label>
                  <p className="text-sm font-medium text-slate-900 mt-1">{selectedRequest.deliveryPhone || "N/A"}</p>
                </div>
                {selectedRequest.upiId && (
                  <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <QrCode className="w-4 h-4 text-emerald-600" />
                      <label className="text-xs font-bold text-emerald-800 uppercase">UPI Information</label>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">{selectedRequest.upiId}</p>
                      {selectedRequest.upiQrCode && (
                        <button 
                          onClick={() => window.open(selectedRequest.upiQrCode, '_blank')}
                          className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 transition-colors flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          View QR
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Bank Name</label>
                    <p className="text-sm font-medium text-slate-900 mt-1">{selectedRequest.bankDetails?.bankName || "N/A"}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Account Number</label>
                    <p className="text-sm font-medium text-slate-900 mt-1">{selectedRequest.bankDetails?.accountNumber || "N/A"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">IFSC Code</label>
                    <p className="text-sm font-medium text-slate-900 mt-1 uppercase text-emerald-600">{selectedRequest.bankDetails?.ifscCode || "N/A"}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Holder Name</label>
                    <p className="text-sm font-medium text-slate-900 mt-1">{selectedRequest.bankDetails?.accountHolderName || "N/A"}</p>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Request time</label>
                  <p className="text-sm font-medium text-slate-900 mt-1">{formatDate(selectedRequest.requestedAt || selectedRequest.createdAt)}</p>
                </div>
                {(selectedRequest.status === "Approved" || selectedRequest.status === "Processed") && selectedRequest.processedAt && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Processed at</label>
                    <p className="text-sm font-medium text-slate-900 mt-1">{formatDate(selectedRequest.processedAt)}</p>
                  </div>
                )}
                {selectedRequest.status === "Rejected" && selectedRequest.processedAt && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Rejected at</label>
                    <p className="text-sm font-medium text-slate-900 mt-1">{formatDate(selectedRequest.processedAt)}</p>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
                  <p className="mt-1">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(selectedRequest.status)}`}>
                      {selectedRequest.status}
                    </span>
                  </p>
                </div>
                {selectedRequest.transactionId && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Transaction ID</label>
                    <p className="text-sm font-medium text-slate-900 mt-1 font-mono break-all">{selectedRequest.transactionId}</p>
                  </div>
                )}
                {selectedRequest.rejectionReason && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Rejection reason</label>
                    <p className="text-sm font-medium text-slate-900 mt-1">{selectedRequest.rejectionReason}</p>
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="px-6 pb-6">
              <button
                onClick={() => setIsViewOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
              >
                Close
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve modal: asks for the payout's transaction ID */}
        <Dialog open={Boolean(approveTarget)} onOpenChange={(open) => { if (!open) closeApproveDialog() }}>
          <DialogContent className="max-w-md bg-white p-0">
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle>Approve withdrawal request</DialogTitle>
            </DialogHeader>
            <div className="px-6 pb-6 space-y-4">
              <p className="text-sm text-slate-600">
                {approveTarget?.deliveryName || "Delivery partner"} · {approveTarget ? formatCurrency(approveTarget.amount) : ""}
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Transaction ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder="Bank / UPI reference of the payout"
                  maxLength={64}
                  autoFocus
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Saved with this withdrawal as proof of payment. It can't be changed later.
                </p>
              </div>
            </div>
            <DialogFooter className="px-6 pb-6 flex gap-2">
              <button
                onClick={closeApproveDialog}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={processingAction === approveTarget?.id || transactionId.trim().length < 4}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingAction === approveTarget?.id ? "Approving…" : "Approve"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject modal */}
        <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
          <DialogContent className="max-w-md bg-white p-0">
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle>Reject withdrawal request</DialogTitle>
            </DialogHeader>
            <div className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Rejection reason (optional)
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Enter reason for rejection…"
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>
            <DialogFooter className="px-6 pb-6 flex gap-2">
              <button
                onClick={() => {
                  setShowRejectModal(false)
                  setRejectionReason("")
                  setSelectedRequest(null)
                }}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => selectedRequest && handleReject(selectedRequest.id)}
                disabled={processingAction === selectedRequest?.id}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingAction === selectedRequest?.id ? "Rejecting…" : "Reject"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

