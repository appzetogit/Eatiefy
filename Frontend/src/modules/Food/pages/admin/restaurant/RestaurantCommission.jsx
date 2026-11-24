import { useState, useMemo, useEffect, useRef } from "react"
import { 
  Search, Plus, Edit, Trash2, ArrowUpDown,
  Loader2, X, Building2, AlertTriangle, Eye
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { adminAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { toast } from "sonner"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

export default function RestaurantCommission() {
  const [searchQuery, setSearchQuery] = useState("")
  const [commissions, setCommissions] = useState([])
  const [approvedRestaurants, setApprovedRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [isAddEditOpen, setIsAddEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isRestaurantSelectOpen, setIsRestaurantSelectOpen] = useState(false)
  const [selectedCommission, setSelectedCommission] = useState(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [formData, setFormData] = useState({
    restaurantId: "",
    defaultCommission: {
      type: "percentage",
      value: ""
    },
    notes: ""
  })
  const [formErrors, setFormErrors] = useState({})
  // Commission history (view icon): delivered orders of one restaurant and the
  // commission the admin earned on each.
  const HISTORY_PAGE_SIZE = 10
  const [historyTarget, setHistoryTarget] = useState(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [historyData, setHistoryData] = useState({ earnings: [], summary: null, pagination: null })
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()
  // Only the newest load may write state, so a quick zone switch cannot be
  // overwritten by the slower response of the previous zone.
  const loadSeqRef = useRef(0)
  const [visibleColumns, setVisibleColumns] = useState({
    si: true,
    restaurant: true,
    restaurantId: true,
    zone: true,
    defaultCommission: true,
    status: true,
    actions: true,
  })

  const filteredCommissions = useMemo(() => {
    if (!searchQuery.trim()) {
      return commissions
    }
    
    const query = searchQuery.toLowerCase().trim()
    return commissions.filter(commission =>
      commission.restaurantName?.toLowerCase().includes(query) ||
      commission.restaurantId?.toLowerCase().includes(query) ||
      commission.restaurant?.name?.toLowerCase().includes(query)
    )
  }, [commissions, searchQuery])

  const filteredRestaurants = useMemo(() => {
    if (!searchQuery.trim()) {
      return approvedRestaurants
    }
    
    const query = searchQuery.toLowerCase().trim()
    return approvedRestaurants.filter(restaurant =>
      restaurant.name?.toLowerCase().includes(query) ||
      restaurant.restaurantId?.toLowerCase().includes(query) ||
      restaurant.ownerName?.toLowerCase().includes(query)
    )
  }, [approvedRestaurants, searchQuery])

  // Reload whenever the zone filter changes
  useEffect(() => {
    // Single fast call to avoid multiple API requests on load
    fetchBootstrap()
  }, [zoneId])

  /**
   * Commissions and the approved restaurants for the selected zone in one call.
   * Also used after every change so `hasCommissionSetup` in the "Add" picker
   * stays in step with the commission list.
   */
  const fetchBootstrap = async () => {
    const seq = ++loadSeqRef.current
    const isLatest = () => seq === loadSeqRef.current
    try {
      setLoading(true)
      const response = await adminAPI.getRestaurantCommissionBootstrap(zoneId ? { zoneId } : {})
      if (!isLatest()) return
      const data = response?.data?.data
      setCommissions(Array.isArray(data?.commissions) ? data.commissions : [])
      setApprovedRestaurants(Array.isArray(data?.restaurants) ? data.restaurants : [])
    } catch (error) {
      debugError('Error fetching bootstrap:', error)
      if (!isLatest()) return
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        toast.error(`Cannot connect to backend server. Please ensure the backend is running on ${API_BASE_URL.replace('/api', '')}`)
      } else {
        toast.error(error.response?.data?.message || 'Failed to fetch commissions')
      }
      setCommissions([])
      setApprovedRestaurants([])
    } finally {
      if (isLatest()) setLoading(false)
    }
  }

  const historyRestaurantId = historyTarget?.restaurant?._id || ""

  useEffect(() => {
    if (!historyRestaurantId) return undefined
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError("")
    adminAPI
      .getRestaurantEarnings({ restaurantId: historyRestaurantId, page: historyPage, limit: HISTORY_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return
        const data = response?.data?.data || {}
        setHistoryData({
          earnings: Array.isArray(data.earnings) ? data.earnings : [],
          summary: data.summary || null,
          pagination: data.pagination || null,
        })
      })
      .catch((error) => {
        if (cancelled) return
        setHistoryData({ earnings: [], summary: null, pagination: null })
        setHistoryError(error?.response?.data?.message || "Could not load commission history")
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [historyRestaurantId, historyPage])

  const openHistory = (commission) => {
    setHistoryData({ earnings: [], summary: null, pagination: null })
    setHistoryPage(1)
    setHistoryTarget(commission)
  }

  const closeHistory = () => {
    setHistoryTarget(null)
    setHistoryData({ earnings: [], summary: null, pagination: null })
  }

  const formatRupees = (value) =>
    `₹${(Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatHistoryDate = (value) => {
    if (!value) return "—"
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  const handleToggleStatus = async (commission) => {
    try {
      await adminAPI.toggleRestaurantCommissionStatus(commission._id)
      await fetchBootstrap()
      toast.success('Commission status updated successfully')
    } catch (error) {
      debugError('Error toggling status:', error)
      toast.error(error.response?.data?.message || 'Failed to update status')
    }
  }

  const handleAdd = () => {
    setSelectedCommission(null)
    setSelectedRestaurant(null)
    setFormData({
      restaurantId: "",
      defaultCommission: {
        type: "percentage",
        value: ""
      },
      notes: ""
    })
    setFormErrors({})
    setIsRestaurantSelectOpen(true)
  }

  const handleSelectRestaurant = (restaurant) => {
    setSelectedRestaurant(restaurant)
    setFormData(prev => ({
      ...prev,
      restaurantId: restaurant._id
    }))
    setIsRestaurantSelectOpen(false)
    setIsAddEditOpen(true)
  }

  const handleEdit = async (commission) => {
    try {
      setLoading(true)
      const response = await adminAPI.getRestaurantCommissionById(commission._id)
      
      let commissionData = null
      if (response?.data?.success && response?.data?.data?.commission) {
        commissionData = response.data.data.commission
      } else if (response?.data?.data?.commission) {
        commissionData = response.data.data.commission
      } else if (response?.data?.commission) {
        commissionData = response.data.commission
      }

      if (commissionData) {
        setSelectedCommission(commissionData)
        setSelectedRestaurant(commissionData.restaurant)
        
        // Handle restaurant ID - always use Mongo _id for API, display ID is separate
        let restaurantId = ""
        if (commissionData.restaurant) {
          if (typeof commissionData.restaurant === 'object' && commissionData.restaurant._id) {
            restaurantId = commissionData.restaurant._id
          } else if (typeof commissionData.restaurant === 'string') {
            restaurantId = commissionData.restaurant
          }
        }
        
        const commValue = commissionData.defaultCommission?.value
        setFormData({
          restaurantId: restaurantId,
          defaultCommission: {
            type: commissionData.defaultCommission?.type || "percentage",
            value: commValue !== undefined && commValue !== null ? String(commValue) : ""
          },
          notes: commissionData.notes || ""
        })
        setFormErrors({})
        setIsAddEditOpen(true)
      }
    } catch (error) {
      debugError('Error fetching commission:', error)
      toast.error(error.response?.data?.message || 'Failed to load commission')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = (commission) => {
    setSelectedCommission(commission)
    setIsDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!selectedCommission) return

    try {
      setDeleting(true)
      await adminAPI.deleteRestaurantCommission(selectedCommission._id)
      await fetchBootstrap()
      toast.success('Commission deleted successfully')
      setIsDeleteOpen(false)
      setSelectedCommission(null)
    } catch (error) {
      debugError('Error deleting commission:', error)
      toast.error(error.response?.data?.message || 'Failed to delete commission')
    } finally {
      setDeleting(false)
    }
  }

  const validateForm = () => {
    const errors = {}
    
    if (!formData.restaurantId) {
      errors.restaurantId = "Restaurant is required"
    }

    const commVal = formData.defaultCommission?.value
    if (commVal === "" || commVal === null || commVal === undefined || isNaN(Number(commVal)) || Number(commVal) < 0) {
      errors.defaultCommission = "Commission value is required and must be 0 or greater"
    } else if (
      formData.defaultCommission?.type === "percentage" && 
      (Number(commVal) < 0 || Number(commVal) > 100)
    ) {
      errors.defaultCommission = "Percentage must be between 0-100"
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) {
      toast.error("Please fix the errors in the form")
      return
    }

    try {
      setSaving(true)
      
      const payload = {
        restaurantId: formData.restaurantId,
        defaultCommission: {
          type: formData.defaultCommission.type,
          value: parseFloat(formData.defaultCommission.value)
        },
        notes: formData.notes
      }

      if (selectedCommission) {
        await adminAPI.updateRestaurantCommission(selectedCommission._id, payload)
        toast.success('Commission updated successfully')
      } else {
        await adminAPI.createRestaurantCommission(payload)
        toast.success('Commission created successfully')
      }

      await fetchBootstrap()
      setIsAddEditOpen(false)
      setSelectedCommission(null)
      setSelectedRestaurant(null)
    } catch (error) {
      debugError('Error saving commission:', error)
      toast.error(error.response?.data?.message || 'Failed to save commission')
    } finally {
      setSaving(false)
    }
  }

  const columnsConfig = {
    si: "Serial Number",
    restaurant: "Restaurant Name",
    restaurantId: "Restaurant ID",
    zone: "Zone",
    defaultCommission: "Default Commission",
    status: "Status",
    actions: "Actions",
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Restaurant Commission</h1>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700 flex items-center justify-center min-w-[2.5rem] h-7">
                {loading ? (
                  <span className="w-5 h-3 rounded bg-slate-300/80 animate-pulse" />
                ) : (
                  filteredCommissions.length
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={handleAdd}
                className="px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2 transition-all shadow-md"
              >
                <Plus className="w-4 h-4" />
                Add Commission
              </button>
            </div>
          </div>

          <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative w-full max-w-xl">
              <input
                type="text"
                placeholder="Search by restaurant name or ID"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <AdminZoneSelect
              value={zoneId}
              onChange={setZoneId}
              zones={zones}
              loading={zonesLoading}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {visibleColumns.si && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>S.No</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.restaurant && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Restaurant Name
                      </th>
                    )}
                    {visibleColumns.restaurantId && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Restaurant ID
                      </th>
                    )}
                    {visibleColumns.zone && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Zone
                      </th>
                    )}
                    {visibleColumns.defaultCommission && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Default Commission
                      </th>
                    )}
                    {visibleColumns.status && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Status
                      </th>
                    )}
                    {visibleColumns.actions && (
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredCommissions.length === 0 ? (
                    <tr>
                      <td colSpan={Object.values(visibleColumns).filter(v => v).length} className="px-6 py-8 text-center text-slate-500">
                        No commissions found
                      </td>
                    </tr>
                  ) : (
                    filteredCommissions.map((commission) => (
                      <tr key={commission._id} className="hover:bg-slate-50 transition-colors">
                        {visibleColumns.si && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-slate-700">{commission.sl || '-'}</span>
                          </td>
                        )}
                        {visibleColumns.restaurant && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-blue-600">
                              {commission.restaurantName || commission.restaurant?.name || '-'}
                            </span>
                          </td>
                        )}
                        {visibleColumns.restaurantId && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">
                              {commission.restaurantId || commission.restaurant?.restaurantId || '-'}
                            </span>
                          </td>
                        )}
                        {visibleColumns.zone && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">{commission.zoneName || '-'}</span>
                          </td>
                        )}
                        {visibleColumns.defaultCommission && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-slate-900">
                              {commission.defaultCommission?.type === 'percentage' ? (
                                <>{commission.defaultCommission.value}%</>
                              ) : (
                                <>₹{commission.defaultCommission.value}</>
                              )}
                            </span>
                          </td>
                        )}
                        {visibleColumns.status && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              onClick={() => handleToggleStatus(commission)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                commission.status ? "bg-green-600" : "bg-slate-300"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  commission.status ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </td>
                        )}
                        {visibleColumns.actions && (
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => openHistory(commission)}
                                className="p-1.5 rounded text-amber-600 hover:bg-amber-50 transition-colors"
                                title="View commission history"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleEdit(commission)}
                                className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(commission)}
                                className="p-1.5 rounded text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Commission history dialog */}
      <Dialog open={Boolean(historyTarget)} onOpenChange={(open) => { if (!open) closeHistory() }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-white p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              Commission history — {historyTarget?.restaurantName || historyTarget?.restaurant?.name || "Restaurant"}
            </DialogTitle>
            <p className="text-xs text-slate-500 mt-1">
              Commission earned on each delivered order. Current rate:{" "}
              {historyTarget?.defaultCommission?.type === "percentage"
                ? `${historyTarget?.defaultCommission?.value ?? 0}%`
                : `₹${historyTarget?.defaultCommission?.value ?? 0}`}
            </p>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            {historyData.summary && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-emerald-50 p-3">
                  <p className="text-[11px] uppercase font-semibold text-emerald-700">Total commission</p>
                  <p className="text-lg font-bold text-emerald-800">{formatRupees(historyData.summary.totalCommission)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-[11px] uppercase font-semibold text-slate-600">Delivered orders</p>
                  <p className="text-lg font-bold text-slate-800">{Number(historyData.summary.totalOrders || 0).toLocaleString("en-IN")}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-[11px] uppercase font-semibold text-slate-600">Food sales</p>
                  <p className="text-lg font-bold text-slate-800">{formatRupees(historyData.summary.totalFoodAmount)}</p>
                </div>
              </div>
            )}

            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
              </div>
            ) : historyError ? (
              <p className="py-10 text-center text-sm text-red-600">{historyError}</p>
            ) : historyData.earnings.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">No commission earned from this restaurant yet.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-700">Order ID</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-700">Date</th>
                      <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-700">Food amount</th>
                      <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-700">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyData.earnings.map((row) => (
                      <tr key={row.transactionId || row.orderId}>
                        <td className="px-4 py-3 font-mono text-slate-700">{row.orderId}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatHistoryDate(row.createdAt)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{formatRupees(row.baseSubtotal)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatRupees(row.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {historyData.pagination && historyData.pagination.pages > 1 && (
            <DialogFooter className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between sm:justify-between">
              <span className="text-xs text-slate-500">
                Page {historyData.pagination.page} of {historyData.pagination.pages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  disabled={historyLoading || historyPage <= 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setHistoryPage((p) => Math.min(historyData.pagination.pages, p + 1))}
                  disabled={historyLoading || historyPage >= historyData.pagination.pages}
                  className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Restaurant Selection Dialog */}
      <Dialog open={isRestaurantSelectOpen} onOpenChange={setIsRestaurantSelectOpen}>
        <DialogContent className="max-w-xl bg-white p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="text-lg font-semibold text-slate-900">Select Restaurant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search restaurants..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {filteredRestaurants
                .filter(r => !r.hasCommissionSetup)
                .map((restaurant) => (
                  <button
                    key={restaurant._id}
                    onClick={() => handleSelectRestaurant(restaurant)}
                    className="w-full p-3 text-left rounded-lg border border-slate-200 hover:bg-blue-50 hover:border-blue-300 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm text-slate-900">{restaurant.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {restaurant.restaurantId}
                          {restaurant.zoneName ? ` · ${restaurant.zoneName}` : ""}
                        </p>
                      </div>
                      <Building2 className="w-4 h-4 text-slate-400" />
                    </div>
                  </button>
                ))}
              {filteredRestaurants.filter(r => !r.hasCommissionSetup).length === 0 && (
                <p className="text-center text-sm text-slate-500 py-4">No restaurants available</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={isAddEditOpen} onOpenChange={setIsAddEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-white p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {selectedCommission ? "Edit Restaurant Commission" : "Add Restaurant Commission"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4">
            {/* Restaurant Info */}
            {selectedRestaurant && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <p className="font-semibold text-sm text-slate-900">{selectedRestaurant.name}</p>
                <p className="text-xs text-slate-600 mt-0.5">{selectedRestaurant.restaurantId || '-'}</p>
              </div>
            )}

            {/* Default Commission */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Default Commission <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <select
                    value={formData.defaultCommission.type}
                    onChange={(e) => {
                      const nextType = e.target.value
                      setFormData((prev) => ({
                        ...prev,
                        defaultCommission: {
                          ...prev.defaultCommission,
                          type: nextType,
                        },
                      }))
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="amount">Fixed Amount (₹)</option>
                  </select>
                </div>
                <div>
                  <input
                    type="number"
                    min="0"
                    step={formData.defaultCommission.type === "percentage" ? "0.1" : "0.01"}
                    value={formData.defaultCommission.value}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      defaultCommission: { ...prev.defaultCommission, value: e.target.value }
                    }))}
                    className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      formErrors.defaultCommission ? "border-red-500" : "border-slate-300"
                    }`}
                    placeholder={formData.defaultCommission.type === "percentage" ? "e.g., 10" : "e.g., 50"}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {formData.defaultCommission.type === "percentage"
                      ? "Enter commission percentage (e.g., 10, or 0 for 0%)"
                      : "Enter fixed commission amount per order"}
                  </p>
                  {formErrors.defaultCommission && (
                    <p className="text-xs text-red-500 mt-1">{formErrors.defaultCommission}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Notes <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                rows="2"
                placeholder="Add any notes or remarks..."
              />
            </div>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-slate-200 bg-slate-50">
            <button
              onClick={() => setIsAddEditOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {selectedCommission ? "Update" : "Create"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-md bg-white p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4 pr-14">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 border border-red-100">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <DialogTitle className="text-base font-semibold text-slate-900 leading-snug">
                  Delete Restaurant Commission
                </DialogTitle>
                <p className="text-sm text-slate-600 leading-relaxed break-words">
                  Remove commission settings for{" "}
                  <span className="font-semibold text-slate-900">
                    {selectedCommission?.restaurantName ||
                      selectedCommission?.restaurant?.name ||
                      "this restaurant"}
                  </span>
                  ? This cannot be undone.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-6 py-4 bg-slate-50 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsDeleteOpen(false)}
              className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="px-4 py-2.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}


