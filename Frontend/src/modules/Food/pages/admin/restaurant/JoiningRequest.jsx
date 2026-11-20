import { useState, useMemo, useEffect, useRef } from "react"
import { 
  Search, Filter, Eye, Check, X, UtensilsCrossed, ArrowUpDown, Loader2,
  FileText, Image as ImageIcon, ExternalLink, CreditCard, Calendar, Star, Building2, User, Phone, Mail, MapPin, Clock
} from "lucide-react"
import { adminAPI, restaurantAPI } from "@food/api"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { refreshSidebarBadges } from "@food/components/admin/AdminSidebar"
import { useAdminBadgeListRefresh } from "@food/hooks/useAdminBadgeListRefresh"
import { getRestaurantDisplayAddress } from "@food/utils/restaurantLocation"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"
import { getRestaurantDietType } from "./RestaurantsList"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const formatTime12Hour = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string" || !timeStr.includes(":")) return "--:-- --"
  const [h, m] = timeStr.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`
}


export default function JoiningRequest() {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_joining_requests_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [sortConfig, setSortConfig] = useState({ key: "createdAt", direction: "desc" })
  const [pendingRequests, setPendingRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [processingRequestId, setProcessingRequestId] = useState(null)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [isApproveOpen, setIsApproveOpen] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [restaurantDetails, setRestaurantDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [showFilterDialog, setShowFilterDialog] = useState(false)
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: ""
  })
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()
  const today = new Date().toISOString().slice(0, 10)

  // Track first render to avoid duplicate fetch in React StrictMode
  const hasFetchedOnceRef = useRef(false)
  // Only the newest fetch may write the list, so a quick zone/page switch cannot
  // be overwritten by a slower earlier response.
  const fetchSeqRef = useRef(0)

  const fetchRequests = async ({ silent = false } = {}) => {
    const seq = ++fetchSeqRef.current
    const isLatest = () => seq === fetchSeqRef.current
    try {
      if (!silent) setLoading(true)
      setError(null)

      // Status and zone are filtered by the API so pagination and totals match the list.
      const response = await adminAPI.getPendingRestaurants({
        status: "pending",
        zoneId: zoneId || undefined,
        search: debouncedSearch || undefined,
        page: currentPage,
        limit: pageSize,
      })
      if (!isLatest()) return
      const payload = response?.data?.data
      const list = Array.isArray(payload?.restaurants)
        ? payload.restaurants
        : Array.isArray(payload)
          ? payload
          : []
      setPendingRequests(list.filter((r) => String(r.status || "").toLowerCase() === "pending"))
      setTotalItems(
        payload?.total ??
        response?.data?.total ??
        list.length,
      )
    } catch (err) {
      debugError("Error fetching restaurant requests:", err)
      if (!silent && isLatest()) {
        setError(err.message || "Failed to fetch restaurant requests")
        setPendingRequests([])
        setTotalItems(0)
      }
    } finally {
      if (!silent && isLatest()) setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, zoneId, filters.dateFrom, filters.dateTo])

  useAdminBadgeListRefresh("restaurants", fetchRequests, [debouncedSearch, currentPage, pageSize, zoneId])

  useEffect(() => {
    fetchRequests()
  }, [debouncedSearch, currentPage, pageSize, zoneId])

  useEffect(() => {
    const onFocus = () => fetchRequests({ silent: true })
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchRequests({ silent: true })
      }
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [debouncedSearch, currentPage, pageSize])

  const currentRequests = pendingRequests

  const filteredRequests = useMemo(() => {
    let filtered = currentRequests

    if (filters.dateFrom || filters.dateTo) {
      filtered = filtered.filter(request => {
        if (!request.createdAt) return false
        const requestDate = new Date(request.createdAt).setHours(0, 0, 0, 0)
        if (filters.dateFrom) {
          const fromDate = new Date(filters.dateFrom).setHours(0, 0, 0, 0)
          if (requestDate < fromDate) return false
        }
        if (filters.dateTo) {
          const toDate = new Date(filters.dateTo).setHours(23, 59, 59, 999)
          if (requestDate > toDate) return false
        }
        return true
      })
    }

    return filtered
  }, [currentRequests, filters])

  const sortedRequests = useMemo(() => {
    const requests = [...filteredRequests]
    const { key, direction } = sortConfig
    const multiplier = direction === "asc" ? 1 : -1

    const getSortValue = (request) => {
      switch (key) {
        case "sl":
          return Number(request.sl || 0)
        case "restaurantName":
          return String(request.restaurantName || "").toLowerCase()
        case "ownerName":
          return String(request.ownerName || "").toLowerCase()
        case "zone":
          return String(request.zone || "").toLowerCase()
        case "status":
          return String(request.status || "").toLowerCase()
        case "createdAt":
        default:
          return new Date(request.createdAt || 0).getTime()
      }
    }

    requests.sort((left, right) => {
      const leftValue = getSortValue(left)
      const rightValue = getSortValue(right)

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * multiplier
      }

      return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * multiplier
    })

    return requests
  }, [filteredRequests, sortConfig])

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }))
  }

  const getSortIconClassName = (key) => {
    if (sortConfig.key !== key) return "w-3 h-3 text-slate-400"
    return sortConfig.direction === "asc" ? "w-3 h-3 text-blue-600" : "w-3 h-3 text-slate-700"
  }

  const clearFilters = () => {
    setFilters({
      dateFrom: "",
      dateTo: ""
    })
  }

  const hasActiveFilters = filters.dateFrom || filters.dateTo

  const handleApprove = (request) => {
    setSelectedRequest(request)
    setIsApproveOpen(true)
  }

  const confirmApprove = async () => {
    if (!selectedRequest) return

    const id = selectedRequest._id
    const restaurantName = selectedRequest.restaurantName

    try {
      setProcessing(true)
      setProcessingRequestId(id)
      await adminAPI.approveRestaurant(id)
      setPendingRequests((prev) => prev.filter((r) => r._id !== id))
      setIsApproveOpen(false)
      setSelectedRequest(null)
      refreshSidebarBadges("restaurants")
      toast.success(`Successfully approved ${restaurantName}'s join request!`)
      await fetchRequests({ silent: true })
    } catch (err) {
      debugError("Error approving request:", err)
      toast.error(err.response?.data?.message || "Failed to approve request. Please try again.")
    } finally {
      setProcessing(false)
      setProcessingRequestId(null)
    }
  }

  const handleReject = (request) => {
    setSelectedRequest(request)
    setRejectionReason("")
    setShowRejectDialog(true)
  }

  const confirmReject = async () => {
    if (!selectedRequest || !rejectionReason.trim()) {
      toast.error("Please provide a rejection reason")
      return
    }

    const id = selectedRequest._id
    const restaurantName = selectedRequest.restaurantName

    try {
      setProcessing(true)
      setProcessingRequestId(id)
      await adminAPI.rejectRestaurant(id, rejectionReason)
      setPendingRequests((prev) => prev.filter((r) => r._id !== id))
      refreshSidebarBadges("restaurants")
      setShowRejectDialog(false)
      setSelectedRequest(null)
      setRejectionReason("")
      toast.success(`Successfully rejected ${restaurantName}'s join request!`)
      await fetchRequests({ silent: true })
    } catch (err) {
      debugError("Error rejecting request:", err)
      toast.error(err.response?.data?.message || "Failed to reject request. Please try again.")
    } finally {
      setProcessing(false)
      setProcessingRequestId(null)
    }
  }

  const formatPhone = (phone) => {
    if (!phone) return "N/A"
    return phone
  }

  // Handle view restaurant details
  const handleViewDetails = async (request) => {
    setSelectedRequest(request)
    setShowDetailsModal(true)
    setLoadingDetails(true)
    setRestaurantDetails(null)
    
    try {
      // First, use fullData if available (has all details from API)
      if (request.fullData) {
        debugLog("Using fullData from request:", request.fullData)
        setRestaurantDetails(request.fullData)
        setLoadingDetails(false)
        return
      }
      
      // Try to fetch full restaurant details from API
      const restaurantId = request._id || request.id
      let response = null
      
      if (restaurantId) {
        try {
          // Try admin API first
          if (adminAPI.getRestaurantById) {
            response = await adminAPI.getRestaurantById(restaurantId)
          }
        } catch (err) {
          debugLog("Admin API failed, trying restaurant API:", err)
        }
        
        // Fallback to regular restaurant API
        if (!response || !response?.data?.success) {
          try {
            response = await restaurantAPI.getRestaurantById(restaurantId)
          } catch (err) {
            debugLog("Restaurant API also failed:", err)
          }
        }
      }
      
      // Check response structure
      if (response?.data?.success) {
        const data = response.data.data
        if (data?.restaurant) {
          setRestaurantDetails(data.restaurant)
        } else if (data) {
          setRestaurantDetails(data)
        } else {
          setRestaurantDetails(request)
        }
      } else {
        // Use the request data we already have
        setRestaurantDetails(request)
      }
    } catch (err) {
      debugError("Error fetching restaurant details:", err)
      // Use the request data we already have
      setRestaurantDetails(request)
    } finally {
      setLoadingDetails(false)
    }
  }

  const closeDetailsModal = () => {
    setShowDetailsModal(false)
    setSelectedRequest(null)
    setRestaurantDetails(null)
  }

  const getNormalizedImageUrl = (image) => {
    if (!image) return ""
    if (typeof image === "string") return image
    return image?.url || ""
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <UtensilsCrossed className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">New Restaurant Join Request</h1>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:flex-initial sm:w-80">
                <input
                  type="text"
                  placeholder="Search by restaurant, owner or phone"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <AdminZoneSelect
                value={zoneId}
                onChange={setZoneId}
                zones={zones}
                loading={zonesLoading}
              />
              <button
                onClick={() => setShowFilterDialog(true)}
                className={`px-4 py-2.5 text-sm font-medium rounded-lg border transition-all flex items-center gap-2 ${
                  hasActiveFilters 
                    ? "border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100" 
                    : "border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                }`}
              >
                <Filter className="w-4 h-4" />
                Filter
                {hasActiveFilters && (
                  <span className="ml-1 px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                    {[filters.dateFrom, filters.dateTo].filter(Boolean).length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                    <button type="button" onClick={() => handleSort("sl")} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                      <span>SL</span>
                      <ArrowUpDown className={getSortIconClassName("sl")} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                    <button type="button" onClick={() => handleSort("restaurantName")} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                      <span>Restaurant Info</span>
                      <ArrowUpDown className={getSortIconClassName("restaurantName")} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                    <button type="button" onClick={() => handleSort("ownerName")} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                      <span>Owner Info</span>
                      <ArrowUpDown className={getSortIconClassName("ownerName")} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                    <button type="button" onClick={() => handleSort("zone")} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                      <span>Zone</span>
                      <ArrowUpDown className={getSortIconClassName("zone")} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                    <button type="button" onClick={() => handleSort("status")} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                      <span>Status</span>
                      <ArrowUpDown className={getSortIconClassName("status")} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                      <p className="text-lg font-semibold text-slate-700">Loading restaurant requests...</p>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                      <p className="text-lg font-semibold text-red-600 mb-1">Error: {error}</p>
                      <p className="text-sm text-slate-500">Failed to load restaurant requests. Please try again.</p>
                    </td>
                  </tr>
                ) : sortedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                        <p className="text-sm text-slate-500">No restaurant requests match your search</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedRequests.map((request, index) => {
                    const isRowProcessing = processingRequestId === request._id
                    return (
                    <tr key={request._id || index} className={`hover:bg-slate-50 transition-colors ${isRowProcessing ? "bg-blue-50/50" : ""}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-700">{request.sl ?? index + 1}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer hover:opacity-80 transition-all"
                            onClick={() => handleViewDetails(request)}
                          >
                            <img
                              src={
                                getNormalizedImageUrl(request?.coverImages?.[0]) ||
                                (typeof request.profileImage === "string"
                                  ? request.profileImage
                                  : (request.profileImage?.url || request.profileImageUrl?.url || request.restaurantImage)) ||
                                "https://via.placeholder.com/40?text=" + (request.restaurantName?.slice(0, 2) || "R").toUpperCase()
                              }
                              alt={request.restaurantName || "Restaurant"}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.src = "https://via.placeholder.com/40?text=" + (request.restaurantName?.slice(0, 2) || "R").toUpperCase()
                              }}
                            />
                          </div>
                          <span 
                            className="text-sm font-medium text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
                            onClick={() => handleViewDetails(request)}
                          >
                            {request.restaurantName}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-900">{request.ownerName}</span>
                          <span className="text-xs text-slate-500">{formatPhone(request.ownerPhone)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">{request.zone || "—"}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isRowProcessing ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Processing...
                          </span>
                        ) : (
                        <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${
                          String(request.status || "").toLowerCase() === "pending"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-red-100 text-red-700"
                        }`}>
                          {request.status}
                        </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleViewDetails(request)}
                            className="p-1.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {String(request.status || "").toLowerCase() === "pending" && (
                            <>
                              <button
                                onClick={() => handleApprove(request)}
                                disabled={processing}
                                className="p-1.5 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Approve"
                              >
                                {isRowProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => handleReject(request)}
                                disabled={processing}
                                className="p-1.5 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Reject"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <AdminListPagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={filters.dateFrom || filters.dateTo ? sortedRequests.length : totalItems}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_joining_requests_pageSize", String(size))
              } catch {}
              setCurrentPage(1)
            }}
            itemLabel="requests"
          />
        </div>
      </div>

      {/* Filter Dialog */}
      {showFilterDialog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowFilterDialog(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Filter className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Filter Requests</h3>
                    <p className="text-xs text-slate-500">Apply filters to refine your search</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowFilterDialog(false)}
                  className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5 text-slate-600" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Zone is filtered with the zone dropdown above the table. */}

                {/* Date Range Filters */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={filters.dateFrom}
                      max={today}
                      onChange={(e) => {
                        const selected = e.target.value > today ? today : e.target.value
                        setFilters({
                          ...filters,
                          dateFrom: selected,
                          dateTo: filters.dateTo && filters.dateTo < selected ? selected : filters.dateTo
                        })
                      }}
                      className="w-full px-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={filters.dateTo}
                      max={today}
                      onChange={(e) => {
                        const selected = e.target.value > today ? today : e.target.value
                        setFilters({ ...filters, dateTo: selected })
                      }}
                      min={filters.dateFrom}
                      className="w-full px-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-6 pt-6 border-t border-slate-200">
                <button
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear All
                </button>
                <button
                  onClick={() => setShowFilterDialog(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approve Confirmation Dialog */}
      <Dialog open={isApproveOpen} onOpenChange={(open) => { if (!processing) setIsApproveOpen(open) }}>
        <DialogContent className="max-w-md bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Approve Request</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            <p className="text-sm text-slate-700">
              Are you sure you want to approve "{selectedRequest?.restaurantName}"'s join request?
            </p>
          </div>
          <DialogFooter className="px-6 pb-6">
            <button
              onClick={() => setIsApproveOpen(false)}
              disabled={processing}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmApprove}
              disabled={processing}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              Approve
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Dialog */}
      {showRejectDialog && selectedRequest && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { if (!processing) setShowRejectDialog(false) }}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <X className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Reject Restaurant Request</h3>
                  <p className="text-sm text-slate-600">{selectedRequest.restaurantName}</p>
                </div>
              </div>
              
              <p className="text-sm text-slate-700 mb-4">
                Are you sure you want to reject this restaurant request? Please provide a reason for rejection.
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Enter reason for rejection..."
                  className="w-full px-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                  rows={4}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setShowRejectDialog(false)
                    setSelectedRequest(null)
                    setRejectionReason("")
                  }}
                  disabled={processing}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmReject}
                  disabled={processing || !rejectionReason.trim()}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Rejecting...
                    </span>
                  ) : (
                    "Reject Request"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restaurant Details Side Panel */}
      {showDetailsModal && selectedRequest && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm transition-opacity" onClick={closeDetailsModal} />
          
          <div 
            className="relative w-full max-w-4xl bg-white h-full shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-5 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <UtensilsCrossed className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Restaurant Details - {selectedRequest.restaurantName || "N/A"}</h2>
              </div>
              <button
                onClick={closeDetailsModal}
                className="p-2 rounded-xl hover:bg-slate-100 transition-all text-slate-400 hover:text-slate-600 border border-transparent hover:border-slate-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {loadingDetails && (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  <span className="ml-3 text-slate-600">Loading details...</span>
                </div>
              )}
              {!loadingDetails && (restaurantDetails || selectedRequest) && (() => {
                const r = restaurantDetails || selectedRequest
                const restaurantPhotoList = Array.isArray(r?.coverImages) ? r.coverImages.filter(Boolean) : []
                const profileImgUrl =
                  getNormalizedImageUrl(restaurantPhotoList[0]) ||
                  (typeof r?.profileImage === "string" ? r.profileImage : (r?.profileImage?.url || r?.profileImageUrl?.url || r?.restaurantImage))
                const openingTime = r?.openingTime || r?.deliveryTimings?.openingTime || r?.onboarding?.step2?.deliveryTimings?.openingTime
                const closingTime = r?.closingTime || r?.deliveryTimings?.closingTime || r?.onboarding?.step2?.deliveryTimings?.closingTime
                const approvalStatus = String(r?.status || "").toLowerCase() || (r?.isActive !== false ? "approved" : "pending")
                const hasFlatDocs = r?.panNumber || r?.panImage || r?.fssaiNumber || r?.accountNumber
                const menuImgList = Array.isArray(r?.menuImages) ? r.menuImages : (r?.onboarding?.step2?.menuImageUrls || [])
                return (
                <div className="space-y-6">
                  {/* Restaurant Basic Info */}
                  <div className="flex items-start gap-6 pb-6 border-b border-slate-200">
                    <div className="w-24 h-24 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                      <img
                        src={profileImgUrl || "https://via.placeholder.com/96"}
                        alt={r?.restaurantName || r?.name || "Restaurant"}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.src = "https://via.placeholder.com/96"
                        }}
                      />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-slate-900 mb-2">
                        {r?.restaurantName || r?.name || "N/A"}
                      </h3>
                      <div className="flex items-center gap-4 flex-wrap">
                        {r?.rating != null && (
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                            <span className="text-sm font-medium text-slate-700">
                              {Number(r.rating).toFixed(1)} ({(r.totalRatings || 0)} reviews)
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-slate-600">
                          <Building2 className="w-4 h-4" />
                          <span className="text-sm">{r?.restaurantId || r?._id || "N/A"}</span>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          approvalStatus === "approved" ? "bg-green-100 text-green-700" : approvalStatus === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                        }`}>
                          {approvalStatus === "approved" ? "Approved" : approvalStatus === "rejected" ? "Rejected" : "Pending Approval"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Onboarding payment — admins verify the fee before approving. */}
                  {(() => {
                    const pay = selectedRequest?.onboardingPaymentDetails || r?.onboardingPaymentDetails
                    const typeLabel =
                      selectedRequest?.restaurantTypeLabel ||
                      r?.restaurantTypeLabel ||
                      pay?.restaurantTypeLabel ||
                      ""
                    const rupee = (v) =>
                      v == null || Number.isNaN(Number(v))
                        ? "—"
                        : `₹${Number(v).toLocaleString("en-IN")}`
                    const paidOn = pay?.paidAt ? new Date(pay.paidAt) : null
                    return (
                      <div className="pb-6 border-b border-slate-200">
                        <h4 className="text-lg font-semibold text-slate-900 mb-4">Onboarding Payment</h4>
                        {!pay ? (
                          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            No onboarding payment recorded for this restaurant.
                          </p>
                        ) : pay.status === "not_required" ? (
                          <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            No onboarding fee applied to this registration.
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <p className="text-xs text-slate-500">Restaurant Type</p>
                              <p className="text-sm font-medium text-slate-900">{typeLabel || "—"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Zone</p>
                              <p className="text-sm font-medium text-slate-900">
                                {pay.zoneName || selectedRequest?.zone || "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Original Price</p>
                              <p className="text-sm font-medium text-slate-700">{rupee(pay.originalPrice)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Offer Applied</p>
                              <p className="text-sm font-medium text-emerald-700">
                                {pay.offerPrice != null ? `${rupee(pay.offerPrice)}${pay.offerName ? ` — ${pay.offerName}` : ""}` : "None"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Final Amount Paid</p>
                              <p className="text-base font-bold text-slate-900">{rupee(pay.finalAmount)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Payment Status</p>
                              <span
                                className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  pay.status === "paid"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {pay.status}
                              </span>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Transaction Reference</p>
                              <p className="text-xs font-mono text-slate-700 break-all">
                                {pay.transactionReference || pay.gatewayOrderId || "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Payment Date</p>
                              <p className="text-sm font-medium text-slate-700">
                                {paidOn ? paidOn.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                              </p>
                            </div>
                          </div>
                        )}
                        <p className="mt-3 text-[11px] text-slate-500">
                          A verified payment only makes this restaurant eligible for review — approval is still your decision.
                        </p>
                      </div>
                    )
                  })()}

                  {/* Owner Information */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Owner Information</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <User className="w-5 h-5 text-slate-400" />
                          <div>
                            <p className="text-xs text-slate-500">Owner Name</p>
                            <p className="text-sm font-medium text-slate-900">{r?.ownerName || "N/A"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Phone className="w-5 h-5 text-slate-400" />
                          <div>
                            <p className="text-xs text-slate-500">Phone</p>
                            <p className="text-sm font-medium text-slate-900">{r?.ownerPhone || r?.phone || "N/A"}</p>
                          </div>
                        </div>
                        {(r?.ownerEmail || r?.email) && (
                          <div className="flex items-center gap-3">
                            <Mail className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500">Email</p>
                              <p className="text-sm font-medium text-slate-900">{r.ownerEmail || r.email}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Location & Contact */}
                    <div>
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Location & Contact</h4>
                      <div className="space-y-3">
                        {(() => {
                          const fullAddress = getRestaurantDisplayAddress(r) || r?.zone || null
                          return fullAddress ? (
                            <div className="flex items-start gap-3">
                              <MapPin className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs text-slate-500">Address</p>
                                <p className="text-sm font-medium text-slate-900">{fullAddress}</p>
                              </div>
                            </div>
                          ) : null
                        })()}
                        {(() => {
                          const diet = getRestaurantDietType(r)
                          return (
                            <div className="flex items-center gap-3">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${diet.badgeClass}`}>
                                <span className={`w-2 h-2 rounded-full ${diet.dotClass}`} />
                                {diet.label}
                              </span>
                            </div>
                          )
                        })()}
                        {(r?.primaryContactNumber || r?.phone) && (
                          <div className="flex items-center gap-3">
                            <Phone className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500">Primary Contact</p>
                              <p className="text-sm font-medium text-slate-900">{r.primaryContactNumber || r.phone}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Timings */}
                  <div>
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Timings & Status</h4>
                      <div className="space-y-3">
                        {(openingTime || closingTime) && (
                          <div className="flex items-center gap-3">
                            <Clock className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500">Opening / Closing</p>
                              <p className="text-sm font-medium text-slate-900">
                                {formatTime12Hour(openingTime)} – {formatTime12Hour(closingTime)}
                              </p>
                            </div>
                          </div>
                        )}
                        {r?.estimatedDeliveryTime && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Estimated Delivery Time</p>
                            <p className="text-sm font-medium text-slate-900">{r.estimatedDeliveryTime}</p>
                          </div>
                        )}
                        {r?.openDays && Array.isArray(r.openDays) && r.openDays.length > 0 && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Open Days</p>
                            <div className="flex flex-wrap gap-2">
                              {r.openDays.map((day, idx) => (
                                <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-medium capitalize">
                                  {day}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Approval Status</p>
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                            approvalStatus === "approved" ? "bg-green-100 text-green-700" : approvalStatus === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                          }`}>
                            {approvalStatus === "approved" ? "Approved" : approvalStatus === "rejected" ? "Rejected" : "Pending"}
                          </span>
                        </div>
                      </div>
                    </div>

                  {/* Registration Documents – flat schema (PAN, GST, FSSAI, Bank) */}
                  {restaurantPhotoList.length > 0 && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Restaurant Photos</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {restaurantPhotoList.map((restaurantImg, idx) => {
                          const imgUrl = getNormalizedImageUrl(restaurantImg)
                          return imgUrl ? (
                            <a
                              key={idx}
                              href={imgUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg overflow-hidden border border-slate-200 hover:border-blue-500 transition-colors"
                            >
                              <img
                                src={imgUrl}
                                alt={`Restaurant ${idx + 1}`}
                                className="w-full h-32 object-cover"
                                onError={(e) => {
                                  e.target.src = "https://via.placeholder.com/200"
                                }}
                              />
                            </a>
                          ) : null
                        })}
                      </div>
                    </div>
                  )}

                  {(hasFlatDocs || r?.onboarding?.step3) && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Registration Documents</h4>
                      <div className="space-y-6">
                        {/* PAN – flat: panNumber, nameOnPan, panImage */}
                        {(r.panNumber || r.panImage || r?.onboarding?.step3?.pan) && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              PAN Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {(r.panNumber || r?.onboarding?.step3?.pan?.panNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">PAN Number</p>
                                  <p className="font-medium text-slate-900">{r.panNumber || r.onboarding?.step3?.pan?.panNumber}</p>
                                </div>
                              )}
                              {(r.nameOnPan || r?.onboarding?.step3?.pan?.nameOnPan) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Name on PAN</p>
                                  <p className="font-medium text-slate-900">{r.nameOnPan || r.onboarding?.step3?.pan?.nameOnPan}</p>
                                </div>
                              )}
                              {(typeof r.panImage === "string" ? r.panImage : r?.panImage?.url || r?.onboarding?.step3?.pan?.image?.url) && (
                                <div className="md:col-span-2">
                                  <p className="text-xs text-slate-500 mb-2">PAN Document</p>
                                  <a
                                    href={typeof r.panImage === "string" ? r.panImage : (r.panImage?.url || r.onboarding?.step3?.pan?.image?.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
                                  >
                                    <ImageIcon className="w-4 h-4" />
                                    <span>View PAN Document</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* GST – flat: gstRegistered, gstNumber, gstLegalName, gstAddress, gstImage */}
                        {(r.gstRegistered != null || r.gstNumber || r?.onboarding?.step3?.gst) && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              GST Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-slate-500 mb-1">GST Registered</p>
                                <p className="font-medium text-slate-900">
                                  {r.gstRegistered != null ? (r.gstRegistered ? "Yes" : "No") : (r?.onboarding?.step3?.gst?.isRegistered ? "Yes" : "No")}
                                </p>
                              </div>
                              {(r.gstNumber || r?.onboarding?.step3?.gst?.gstNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">GST Number</p>
                                  <p className="font-medium text-slate-900">{r.gstNumber || r.onboarding?.step3?.gst?.gstNumber}</p>
                                </div>
                              )}
                              {(r.gstLegalName || r?.onboarding?.step3?.gst?.legalName) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Legal Name</p>
                                  <p className="font-medium text-slate-900">{r.gstLegalName || r.onboarding?.step3?.gst?.legalName}</p>
                                </div>
                              )}
                              {(r.gstAddress || r?.onboarding?.step3?.gst?.address) && (
                                <div className="md:col-span-2">
                                  <p className="text-xs text-slate-500 mb-1">GST Address</p>
                                  <p className="font-medium text-slate-900">{r.gstAddress || r.onboarding?.step3?.gst?.address}</p>
                                </div>
                              )}
                              {(typeof r.gstImage === "string" ? r.gstImage : r?.gstImage?.url || r?.onboarding?.step3?.gst?.image?.url) && (
                                <div className="md:col-span-2">
                                  <p className="text-xs text-slate-500 mb-2">GST Document</p>
                                  <a
                                    href={typeof r.gstImage === "string" ? r.gstImage : (r.gstImage?.url || r.onboarding?.step3?.gst?.image?.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
                                  >
                                    <ImageIcon className="w-4 h-4" />
                                    <span>View GST Document</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* FSSAI – flat: fssaiNumber, fssaiExpiry, fssaiImage */}
                        {(r.fssaiNumber || r.fssaiExpiry || r?.onboarding?.step3?.fssai) && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              FSSAI Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {(r.fssaiNumber || r?.onboarding?.step3?.fssai?.registrationNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">FSSAI Registration Number</p>
                                  <p className="font-medium text-slate-900">{r.fssaiNumber || r.onboarding?.step3?.fssai?.registrationNumber}</p>
                                </div>
                              )}
                              {(r.fssaiExpiry || r?.onboarding?.step3?.fssai?.expiryDate) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">FSSAI Expiry Date</p>
                                  <p className="font-medium text-slate-900">
                                    {new Date(r.fssaiExpiry || r.onboarding?.step3?.fssai?.expiryDate).toLocaleDateString('en-IN', {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric'
                                    })}
                                  </p>
                                </div>
                              )}
                              {(typeof r.fssaiImage === "string" ? r.fssaiImage : r?.fssaiImage?.url || r?.onboarding?.step3?.fssai?.image?.url) && (
                                <div className="md:col-span-2">
                                  <p className="text-xs text-slate-500 mb-2">FSSAI Document</p>
                                  <a
                                    href={typeof r.fssaiImage === "string" ? r.fssaiImage : (r.fssaiImage?.url || r.onboarding?.step3?.fssai?.image?.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
                                  >
                                    <ImageIcon className="w-4 h-4" />
                                    <span>View FSSAI Document</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Bank – flat: accountNumber, ifscCode, accountHolderName, accountType */}
                        {(r.accountNumber || r.ifscCode || r?.onboarding?.step3?.bank) && (
                          <div className="bg-slate-50 rounded-lg p-4">
                            <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                              <CreditCard className="w-4 h-4" />
                              Bank Details
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {(r.accountNumber || r?.onboarding?.step3?.bank?.accountNumber) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Account Number</p>
                                  <p className="font-medium text-slate-900">{r.accountNumber || r.onboarding?.step3?.bank?.accountNumber}</p>
                                </div>
                              )}
                              {(r.ifscCode || r?.onboarding?.step3?.bank?.ifscCode) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">IFSC Code</p>
                                  <p className="font-medium text-slate-900">{r.ifscCode || r.onboarding?.step3?.bank?.ifscCode}</p>
                                </div>
                              )}
                              {(r.accountHolderName || r?.onboarding?.step3?.bank?.accountHolderName) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Account Holder Name</p>
                                  <p className="font-medium text-slate-900">{r.accountHolderName || r.onboarding?.step3?.bank?.accountHolderName}</p>
                                </div>
                              )}
                              {(r.accountType || r?.onboarding?.step3?.bank?.accountType) && (
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Account Type</p>
                                  <p className="font-medium text-slate-900 capitalize">{r.accountType || r.onboarding?.step3?.bank?.accountType}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Menu Images */}
                  {menuImgList.length > 0 && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Menu Images</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {menuImgList.map((menuImg, idx) => {
                          const imgUrl = typeof menuImg === "string" ? menuImg : (menuImg?.url || menuImg)
                          return imgUrl ? (
                            <a
                              key={idx}
                              href={imgUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg overflow-hidden border border-slate-200 hover:border-blue-500 transition-colors"
                            >
                              <img
                                src={imgUrl}
                                alt={`Menu ${idx + 1}`}
                                className="w-full h-32 object-cover"
                                onError={(e) => {
                                  e.target.src = "https://via.placeholder.com/200"
                                }}
                              />
                            </a>
                          ) : null
                        })}
                      </div>
                    </div>
                  )}

                  {/* Registration & approval info */}
                  {(r?.createdAt || r?.restaurantId || r?.businessModel || r?.approvedAt != null) && (
                    <div className="pt-6 border-t border-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900 mb-4">Registration & Approval</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {r.createdAt && (
                          <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Registration Date & Time</p>
                              <p className="font-medium text-slate-900">
                                {new Date(r.createdAt).toLocaleString('en-IN', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </div>
                        )}
                        {r.restaurantId && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Restaurant ID</p>
                            <p className="font-medium text-slate-900">{r.restaurantId}</p>
                          </div>
                        )}
                        {r.approvedAt != null && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Approved At</p>
                            <p className="font-medium text-slate-900">{new Date(r.approvedAt).toLocaleString('en-IN')}</p>
                          </div>
                        )}
                        {r.businessModel && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Business Model</p>
                            <p className="font-medium text-slate-900">{r.businessModel}</p>
                          </div>
                        )}
                        {r.phoneVerified !== undefined && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Phone Verified</p>
                            <p className="font-medium text-slate-900">{r.phoneVerified ? "Yes" : "No"}</p>
                          </div>
                        )}
                        {r.signupMethod && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Signup Method</p>
                            <p className="font-medium text-slate-900 capitalize">{r.signupMethod}</p>
                          </div>
                        )}
                        {r?.onboarding?.completedSteps != null && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Onboarding Steps Completed</p>
                            <p className="font-medium text-slate-900">{r.onboarding.completedSteps} / 4</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Rejection Reason (if rejected) */}
                  {r?.rejectionReason && (
                    <div className="pt-6 border-t border-slate-200">
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <h4 className="text-lg font-semibold text-red-900 mb-2">Rejection Reason</h4>
                        <p className="text-sm text-red-800">{r.rejectionReason}</p>
                        {r.rejectedAt && (
                          <p className="text-xs text-red-600 mt-2">
                            Rejected on: {new Date(r.rejectedAt).toLocaleString('en-IN')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                )
              })()}
              {!loadingDetails && !restaurantDetails && !selectedRequest && (
                <div className="flex flex-col items-center justify-center py-20">
                  <p className="text-lg font-semibold text-slate-700 mb-2">No Details Available</p>
                  <p className="text-sm text-slate-500">Unable to load restaurant details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


