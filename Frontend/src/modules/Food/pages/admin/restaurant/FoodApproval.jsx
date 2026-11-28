import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Search, CheckCircle2, XCircle, Eye, Clock, Loader2, ListChecks, Store, AlertTriangle } from "lucide-react"
import { Card } from "@food/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { refreshSidebarBadges } from "@food/components/admin/AdminSidebar"
import { useAdminBadgeListRefresh } from "@food/hooks/useAdminBadgeListRefresh"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}



const getRequestId = (request) => String(request?._id || request?.id || '')
const getEntityType = (request) => (request?.entityType === 'addon' ? 'addon' : 'food')
const getSelectionKey = (request) => `${getEntityType(request)}:${getRequestId(request)}`

const ComparisonField = ({ label, oldVal, newVal, type = 'text' }) => {
  const isChanged = String(oldVal ?? '') !== String(newVal ?? '');
  if (!isChanged) return null;

  const formatValue = (val) => {
    if (type === 'price') return `₹${val || 0}`;
    if (type === 'boolean') return val ? 'On' : 'Off';
    return val || 'None';
  };

  return (
    <div className="p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</label>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium line-through decoration-2 ${type === 'boolean' ? (oldVal ? 'text-blue-500 decoration-blue-500/30' : 'text-gray-400 decoration-gray-400/50') : 'text-red-500 decoration-red-500/50'}`}>
          {formatValue(oldVal)}
        </span>
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-50 text-gray-400">
           <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="9 5l7 7-7 7" /></svg>
        </div>
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${type === 'boolean' ? (newVal ? 'text-green-600 bg-green-50' : 'text-gray-600 bg-gray-100') : 'text-green-600 bg-green-50'}`}>
          {formatValue(newVal)}
        </span>
      </div>
    </div>
  );
};

const ImageComparison = ({ oldImage, newImage, oldImages = [], newImages = [] }) => {
    // Single image comparison
    const isSingleImageChanged = oldImage !== newImage;
    
    // Array images comparison
    const oldSet = new Set(oldImages || []);
    const newSet = new Set(newImages || []);
    const removed = (oldImages || []).filter(img => !newSet.has(img));
    const added = (newImages || []).filter(img => !oldSet.has(img));
    
    const hasChanges = isSingleImageChanged || removed.length > 0 || added.length > 0;
    if (!hasChanges) return null;

    return (
        <div className="col-span-full space-y-4 pt-4 border-t border-gray-100">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Image Variations</label>
            <div className="flex flex-wrap gap-6">
                {isSingleImageChanged && (
                    <div className="flex gap-4 items-center p-3 bg-slate-50 rounded-xl border border-dashed border-gray-200">
                        <div className="relative">
                            <img src={oldImage} className="w-20 h-20 object-cover rounded-lg border-2 border-red-100 opacity-40 grayscale" alt="Old" />
                            <div className="absolute inset-0 flex items-center justify-center"><XCircle className="w-6 h-6 text-red-500/50" /></div>
                            <span className="absolute -top-2 -left-2 bg-red-100 text-red-600 text-[8px] font-bold px-1.5 py-0.5 rounded">OLD</span>
                        </div>
                        <div className="text-gray-300">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="9 5l7 7-7 7" /></svg>
                        </div>
                        <div className="relative">
                            <img src={newImage} className="w-20 h-20 object-cover rounded-lg border-2 border-green-400 shadow-md transition-transform hover:scale-105" alt="New" />
                            <span className="absolute -top-2 -left-2 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm">NEW</span>
                        </div>
                    </div>
                )}
                
                {removed.map((img, idx) => (
                    <div key={`rem-${idx}`} className="relative opacity-60">
                        <img src={img} className="w-20 h-20 object-cover rounded-lg border-2 border-red-200 grayscale" alt="Removed" />
                        <div className="absolute inset-0 flex items-center justify-center"><XCircle className="w-6 h-6 text-red-500" /></div>
                        <span className="absolute -bottom-4 left-0 right-0 text-[8px] text-center text-red-500 font-bold">REMOVED</span>
                    </div>
                ))}
                
                {added.map((img, idx) => (
                    <div key={`add-${idx}`} className="relative">
                        <img src={img} className="w-20 h-20 object-cover rounded-lg border-2 border-green-500 shadow-sm" alt="Added" />
                        <span className="absolute -bottom-4 left-0 right-0 text-[8px] text-center text-green-600 font-bold">ADDED</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default function FoodApproval() {
  const { canEdit } = useAdminPermissions()
  const [foodRequests, setFoodRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [zones, setZones] = useState([])
  const [selectedZone, setSelectedZone] = useState("all")
  const [zonesLoading, setZonesLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_food_approval_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [processing, setProcessing] = useState(false)
  const isMountedRef = useRef(true)
  // Several triggers (approve refetch, badge refresh, focus, interval) can overlap;
  // only the most recently started fetch may write state, so a slower older
  // response can't resurrect rows that were already approved/rejected.
  const latestFetchIdRef = useRef(0)
  // id -> fetch watermark for items approved/rejected from this page. A fetch
  // started at or before the watermark may have read the DB before the action
  // committed, so the item is hidden from its result. Infinity = action in flight.
  const actionedIdsRef = useRef(new Map())

  // Bulk approval: rows ticked in the table (selection key -> { id, entityType })
  // and the "Bulk Approve" dialog state.
  const [selectedItems, setSelectedItems] = useState(() => new Map())
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkMode, setBulkMode] = useState("restaurants")
  const [bulkRestaurants, setBulkRestaurants] = useState([])
  const [bulkRestaurantsLoading, setBulkRestaurantsLoading] = useState(false)
  const [bulkRestaurantsError, setBulkRestaurantsError] = useState("")
  const [bulkAllRestaurants, setBulkAllRestaurants] = useState(false)
  const [bulkRestaurantIds, setBulkRestaurantIds] = useState(() => new Set())
  const [bulkRestaurantSearch, setBulkRestaurantSearch] = useState("")
  const [bulkConfirming, setBulkConfirming] = useState(false)

  // Fetch active zones dynamically
  useEffect(() => {
    let active = true
    setZonesLoading(true)
    adminAPI
      .getZones({ limit: 1000, isActive: true })
      .then((res) => {
        const payload = res?.data?.data ?? res?.data
        const list = Array.isArray(payload?.zones)
          ? payload.zones
          : Array.isArray(payload)
            ? payload
            : []
        if (active) setZones(list)
      })
      .catch(() => {
        if (active) setZones([])
      })
      .finally(() => {
        if (active) setZonesLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // Fetch pending food approval requests
  const fetchFoodRequests = useCallback(async ({ silent = false } = {}) => {
    const fetchId = ++latestFetchIdRef.current
    const isLatest = () => isMountedRef.current && fetchId === latestFetchIdRef.current
    try {
      if (!silent) {
        setLoading(true)
      }
      const response = await adminAPI.getPendingFoodApprovals({
        search: debouncedSearch || undefined,
        zoneId: selectedZone !== 'all' ? selectedZone : undefined,
        page: currentPage,
        limit: pageSize,
      })
      const payload = response?.data?.data ?? response?.data
      const data = Array.isArray(payload?.requests)
        ? payload.requests
        : Array.isArray(payload)
          ? payload
          : []
      if (!isLatest()) return
      const actioned = actionedIdsRef.current
      const visible = data.filter((item) => {
        const watermark = actioned.get(String(item._id || item.id))
        return watermark === undefined || fetchId > watermark
      })
      // Watermarks below this fetch can no longer affect any later fetch.
      actioned.forEach((watermark, id) => {
        if (watermark < fetchId) actioned.delete(id)
      })
      const total = Number(payload?.total ?? response?.data?.total ?? data.length) || 0
      setFoodRequests(visible)
      setTotalItems(Math.max(0, total - (data.length - visible.length)))
    } catch (error) {
      debugError('Error fetching food approval requests:', error)
      if (!isLatest()) return
      if (!silent) {
        toast.error('Failed to load food approval requests')
      }
      setFoodRequests([])
      setTotalItems(0)
    } finally {
      // The latest fetch owns the spinner: it clears a loading state left by a
      // superseded non-silent fetch whose result was discarded.
      if (isLatest()) {
        setLoading(false)
      }
    }
  }, [debouncedSearch, selectedZone, currentPage, pageSize])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, selectedZone])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch])

  useAdminBadgeListRefresh("foodApprovals", fetchFoodRequests, [fetchFoodRequests])

  useEffect(() => {
    isMountedRef.current = true
    fetchFoodRequests()

    const onFocus = () => fetchFoodRequests({ silent: true })
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchFoodRequests({ silent: true })
      }
    }
    const onPageShow = () => fetchFoodRequests({ silent: true })

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchFoodRequests({ silent: true })
      }
    }, 30000)

    window.addEventListener("focus", onFocus)
    window.addEventListener("pageshow", onPageShow)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      isMountedRef.current = false
      clearInterval(intervalId)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("pageshow", onPageShow)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [fetchFoodRequests, debouncedSearch, currentPage, pageSize])

  const filteredRequests = foodRequests
  const totalRequests = totalItems

  // ----- Bulk approval -----
  const removeFromSelection = (requests) => {
    setSelectedItems((prev) => {
      if (!prev.size) return prev
      const next = new Map(prev)
      requests.forEach((r) => next.delete(getSelectionKey(r)))
      return next.size === prev.size ? prev : next
    })
  }

  // A selection only makes sense for the filter it was made under.
  useEffect(() => {
    setSelectedItems((prev) => (prev.size ? new Map() : prev))
  }, [debouncedSearch, selectedZone])

  const actionableOnPage = filteredRequests.filter((r) => r.isActionable)
  const allOnPageSelected =
    actionableOnPage.length > 0 && actionableOnPage.every((r) => selectedItems.has(getSelectionKey(r)))

  const toggleRowSelection = (request) => {
    if (!request?.isActionable) return
    const key = getSelectionKey(request)
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, { id: getRequestId(request), entityType: getEntityType(request) })
      return next
    })
  }

  const togglePageSelection = () => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (allOnPageSelected) {
        actionableOnPage.forEach((r) => next.delete(getSelectionKey(r)))
      } else {
        actionableOnPage.forEach((r) =>
          next.set(getSelectionKey(r), { id: getRequestId(r), entityType: getEntityType(r) }),
        )
      }
      return next
    })
  }

  const loadBulkRestaurants = useCallback(async () => {
    setBulkRestaurantsLoading(true)
    setBulkRestaurantsError("")
    try {
      const response = await adminAPI.getPendingApprovalRestaurants({
        zoneId: selectedZone !== 'all' ? selectedZone : undefined,
      })
      const payload = response?.data?.data ?? response?.data
      const list = Array.isArray(payload?.restaurants) ? payload.restaurants : []
      if (!isMountedRef.current) return
      setBulkRestaurants(list)
      // Keep only choices that still have pending items.
      setBulkRestaurantIds((prev) => {
        const valid = new Set(list.map((r) => String(r.restaurantId)))
        return new Set([...prev].filter((id) => valid.has(id)))
      })
    } catch (error) {
      debugError('Error loading restaurants for bulk approval:', error)
      if (!isMountedRef.current) return
      setBulkRestaurants([])
      setBulkRestaurantsError(error?.response?.data?.message || 'Failed to load restaurants')
    } finally {
      if (isMountedRef.current) setBulkRestaurantsLoading(false)
    }
  }, [selectedZone])

  useEffect(() => {
    if (showBulkModal) loadBulkRestaurants()
  }, [showBulkModal, loadBulkRestaurants])

  const openBulkModal = (mode) => {
    setBulkMode(mode)
    setBulkConfirming(false)
    setBulkAllRestaurants(false)
    setBulkRestaurantIds(new Set())
    setBulkRestaurantSearch("")
    setShowBulkModal(true)
  }

  const closeBulkModal = () => {
    if (processing) return
    setShowBulkModal(false)
    setBulkConfirming(false)
  }

  const toggleBulkRestaurant = (restaurantId) => {
    setBulkConfirming(false)
    setBulkRestaurantIds((prev) => {
      const next = new Set(prev)
      const key = String(restaurantId)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visibleBulkRestaurants = useMemo(() => {
    const term = bulkRestaurantSearch.trim().toLowerCase()
    if (!term) return bulkRestaurants
    return bulkRestaurants.filter(
      (r) =>
        String(r.restaurantName || '').toLowerCase().includes(term) ||
        String(r.displayId || '').toLowerCase().includes(term),
    )
  }, [bulkRestaurants, bulkRestaurantSearch])

  const bulkRestaurantsTotal = bulkRestaurants.reduce((sum, r) => sum + (Number(r.total) || 0), 0)
  const bulkPlannedCount =
    bulkMode === 'selected'
      ? selectedItems.size
      : bulkAllRestaurants
        ? bulkRestaurantsTotal
        : bulkRestaurants
            .filter((r) => bulkRestaurantIds.has(String(r.restaurantId)))
            .reduce((sum, r) => sum + (Number(r.total) || 0), 0)
  const bulkPlannedRestaurants =
    bulkMode === 'restaurants'
      ? (bulkAllRestaurants ? bulkRestaurants.length : bulkRestaurantIds.size)
      : 0
  const selectedZoneLabel = (() => {
    if (selectedZone === 'all') return 'All Zones'
    const zone = zones.find((z) => String(z._id || z.id) === String(selectedZone))
    return zone?.zoneName || zone?.name || zone?.serviceLocation || 'Selected zone'
  })()

  const handleBulkApprove = async () => {
    if (processing || bulkPlannedCount <= 0) return
    if (!bulkConfirming) {
      setBulkConfirming(true)
      return
    }

    const zoneId = selectedZone !== 'all' ? selectedZone : undefined
    const itemsMode = bulkMode === 'selected'
    const items = itemsMode ? [...selectedItems.values()] : []
    const payload = itemsMode
      ? { items }
      : bulkAllRestaurants
        ? { allRestaurants: true, zoneId }
        : { restaurantIds: [...bulkRestaurantIds], zoneId }

    try {
      setProcessing(true)
      // Hide picked rows from any list response that lands while this runs.
      items.forEach((item) => actionedIdsRef.current.set(String(item.id), Infinity))

      const response = await adminAPI.bulkApprovePending(payload)
      const result = response?.data?.data ?? {}
      const approvedIds = [...(result.approvedFoodIds || []), ...(result.approvedAddonIds || [])].map(String)
      const approvedSet = new Set(approvedIds)
      const watermark = latestFetchIdRef.current
      approvedIds.forEach((id) => actionedIdsRef.current.set(id, watermark))
      items.forEach((item) => {
        if (!approvedSet.has(String(item.id))) actionedIdsRef.current.delete(String(item.id))
      })

      const approvedCount = Number(result.approvedCount ?? approvedIds.length) || 0
      if (approvedCount > 0) {
        toast.success(response?.data?.message || `${approvedCount} item(s) approved successfully`)
      } else {
        toast.info(response?.data?.message || 'Nothing left to approve, items were already processed')
      }

      if (itemsMode) {
        setSelectedItems(new Map())
      } else if (approvedSet.size) {
        setSelectedItems((prev) => {
          const next = new Map([...prev].filter(([, item]) => !approvedSet.has(String(item.id))))
          return next.size === prev.size ? prev : next
        })
      }
      setShowBulkModal(false)
      setBulkConfirming(false)

      if (currentPage !== 1) {
        setCurrentPage(1) // list shrank; page 1 is refetched by the page-change effect
      } else {
        await fetchFoodRequests({ silent: true })
      }
      refreshSidebarBadges("foodApprovals")
    } catch (error) {
      debugError('Error bulk approving items:', error)
      items.forEach((item) => actionedIdsRef.current.delete(String(item.id)))
      setBulkConfirming(false)
      toast.error(error?.response?.data?.message || 'Failed to approve items')
      await fetchFoodRequests()
      if (showBulkModal && !itemsMode) loadBulkRestaurants()
    } finally {
      setProcessing(false)
    }
  }

  // Handle approve food item or addon
  const handleApprove = async (request) => {
    if (!request?.isActionable) return
    const id = request._id || request.id
    try {
      setProcessing(true)
      actionedIdsRef.current.set(String(id), Infinity)
      setFoodRequests(prev => prev.filter(item => (item._id || item.id) !== id))

      if (request.entityType === 'addon') {
        await adminAPI.approveRestaurantAddon(id)
        toast.success('Add-on approved successfully')
      } else {
        await adminAPI.approveFoodItem(id)
        toast.success('Food item approved successfully')
      }
      actionedIdsRef.current.set(String(id), latestFetchIdRef.current)
      removeFromSelection([request])

      await fetchFoodRequests({ silent: true })
      refreshSidebarBadges("foodApprovals")
      setShowDetailModal(false)
      setSelectedRequest(null)
    } catch (error) {
      debugError('Error approving item:', error)
      actionedIdsRef.current.delete(String(id))
      toast.error(error?.response?.data?.message || 'Failed to approve item')
      await fetchFoodRequests()
    } finally {
      setProcessing(false)
    }
  }

  // Handle reject food item or addon
  const handleReject = async () => {
    if (!selectedRequest?.isActionable) {
      setShowRejectModal(false)
      return
    }
    if (!rejectReason.trim()) {
      toast.error('Please provide a rejection reason')
      return
    }

    const id = selectedRequest._id || selectedRequest.id
    try {
      setProcessing(true)
      actionedIdsRef.current.set(String(id), Infinity)
      setFoodRequests(prev => prev.filter(item => (item._id || item.id) !== id))

      if (selectedRequest.entityType === 'addon') {
        await adminAPI.rejectRestaurantAddon(id, rejectReason)
        toast.success('Add-on rejected')
      } else {
        await adminAPI.rejectFoodItem(id, rejectReason)
        toast.success('Food item rejected')
      }
      actionedIdsRef.current.set(String(id), latestFetchIdRef.current)
      removeFromSelection([selectedRequest])

      await fetchFoodRequests({ silent: true })
      refreshSidebarBadges("foodApprovals")
      setShowRejectModal(false)
      setShowDetailModal(false)
      setSelectedRequest(null)
      setRejectReason("")
    } catch (error) {
      debugError('Error rejecting item:', error)
      actionedIdsRef.current.delete(String(id))
      toast.error(error?.response?.data?.message || 'Failed to reject item')
      await fetchFoodRequests()
    } finally {
      setProcessing(false)
    }
  }

  // View food item details
  const handleViewDetails = (request) => {
    setSelectedRequest(request)
    setShowDetailModal(true)
  }

  // Open reject modal
  const handleRejectClick = (request) => {
    if (!request?.isActionable) return
    setSelectedRequest(request)
    setShowRejectModal(true)
  }

  return (
    <div className="p-6 space-y-4">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">
            Food Approval
          </h1>
        </div>
      </div>

      {/* Food Approval List Section */}
      <Card className="border border-gray-200 shadow-sm">
        <div className="p-4">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Pending Food & Add-on Approvals</h2>
              <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-600">
                {totalRequests}
              </span>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                {selectedItems.size > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => openBulkModal("selected")}
                      disabled={processing}
                      className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Approve Selected ({selectedItems.size})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedItems(new Map())}
                      disabled={processing}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => openBulkModal(selectedItems.size > 0 ? "selected" : "restaurants")}
                  disabled={processing}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#006fbd] bg-white px-3 py-1.5 text-xs font-semibold text-[#006fbd] hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ListChecks className="w-4 h-4" />
                  Bulk Approve
                </button>
              </div>
            )}
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-2.5 flex items-center text-gray-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Search by name, category, restaurant or status"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:border-[#006fbd] focus:ring-1 focus:ring-[#006fbd]"
              />
            </div>
            <div className="w-full sm:w-56">
              <select
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                disabled={zonesLoading}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm text-gray-700 focus:outline-none focus:border-[#006fbd] focus:ring-1 focus:ring-[#006fbd]"
              >
                <option value="all">All Zones</option>
                {zones.map((zone) => (
                  <option key={zone._id || zone.id} value={String(zone._id || zone.id)}>
                    {zone.zoneName || zone.name || zone.serviceLocation || 'Unnamed Zone'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#006fbd]" />
            </div>
          ) : (
            <div className="border-t border-gray-200">
              <div className="w-full overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead style={{ backgroundColor: "rgba(0, 111, 189, 0.1)" }}>
                    <tr>
                      <th className="px-3 py-3 !text-center">
                        <input
                          type="checkbox"
                          aria-label="Select all items on this page"
                          checked={allOnPageSelected}
                          onChange={togglePageSelection}
                          disabled={processing || actionableOnPage.length === 0}
                          className="h-4 w-4 cursor-pointer accent-[#006fbd] disabled:cursor-not-allowed"
                        />
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        S.No
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Restaurant
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Zone
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Item Name
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Price
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Requested Date
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Action Type
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filteredRequests.length === 0 ? (
                      <tr>
                        <td colSpan="12" className="px-3 py-8 text-center text-sm text-gray-500">
                          {loading ? "Loading..." : "No food or add-on records found."}
                        </td>
                      </tr>
                    ) : (
                      filteredRequests.map((request, index) => (
                        <tr key={request._id || request.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3 !text-center">
                            <input
                              type="checkbox"
                              aria-label={`Select ${request.itemName || 'item'}`}
                              checked={selectedItems.has(getSelectionKey(request))}
                              onChange={() => toggleRowSelection(request)}
                              disabled={processing || !request.isActionable}
                              className="h-4 w-4 cursor-pointer accent-[#006fbd] disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 font-semibold !text-center">
                            {(currentPage - 1) * pageSize + index + 1}
                          </td>
                          <td className="px-3 py-3 !text-center max-w-[200px]">
                            <div className="text-sm truncate" title={request.restaurantName}>
                              <div className="font-semibold text-gray-900 truncate">{request.restaurantName || '-'}</div>
                              <div className="text-gray-500 text-xs truncate" title={request.restaurantId}>{request.restaurantId || '-'}</div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-700 !text-center whitespace-nowrap">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                              {request.zoneName || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-700 !text-center max-w-[150px] truncate" title={request.category}>
                            {request.category || '-'}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-700 font-semibold !text-center max-w-[200px] truncate" title={request.itemName}>
                            {request.itemName || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 capitalize !text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${request.entityType === 'addon' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {request.entityType || 'food'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm !text-center">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                              request.isActionable
                                ? 'bg-amber-100 text-amber-700'
                                : String(request.approvalStatus || '').toLowerCase() === 'approved'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-700'
                            }`}>
                              {request.approvalStatus || (request.isActionable ? 'pending' : 'active')}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 font-semibold !text-center">
                            {request.price !== null && request.price !== undefined ? `Rs ${request.price}` : '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 !text-center">
                            {request.requestedAt ? new Date(request.requestedAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm !text-center">
                            {request.actionType === 'UPDATED' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-700">
                                    Changes
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                                    New Added
                                </span>
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap !text-center text-sm">
                            <div className="flex justify-center gap-1.5">
                              <button
                                onClick={() => handleViewDetails(request)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors"
                                style={{ backgroundColor: "#006fbd" }}
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {canEdit && (
                                <>
                                  <button
                                    onClick={() => handleApprove(request)}
                                    disabled={processing || !request.isActionable}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Approve"
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleRejectClick(request)}
                                    disabled={processing || !request.isActionable}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Reject"
                                  >
                                    <XCircle className="w-4 h-4" />
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

              <AdminListPagination
                currentPage={currentPage}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                  setPageSize(size)
                  try {
                    localStorage.setItem("admin_food_approval_pageSize", String(size))
                  } catch {}
                  setCurrentPage(1)
                }}
                itemLabel="requests"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Bulk Approve Modal */}
      <Dialog open={showBulkModal} onOpenChange={(open) => (open ? setShowBulkModal(true) : closeBulkModal())}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0 bg-white rounded-2xl border-none shadow-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 bg-slate-50/50">
            <DialogTitle className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-[#006fbd]" />
              Bulk Approve
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-1">
              Zone: <span className="font-semibold text-gray-700">{selectedZoneLabel}</span>. Only items that are still pending are approved.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-4">
            {/* Mode switch */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {[
                { key: "restaurants", label: "By Restaurant", Icon: Store },
                { key: "selected", label: `Selected Items (${selectedItems.size})`, Icon: CheckCircle2 },
              ].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setBulkMode(key)
                    setBulkConfirming(false)
                  }}
                  disabled={processing}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    bulkMode === key ? "bg-white text-[#006fbd] shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {bulkMode === "restaurants" ? (
              <div className="space-y-3">
                {bulkRestaurantsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-[#006fbd]" />
                  </div>
                ) : bulkRestaurantsError ? (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                    <p>{bulkRestaurantsError}</p>
                    <button
                      type="button"
                      onClick={loadBulkRestaurants}
                      className="mt-2 text-xs font-semibold underline"
                    >
                      Retry
                    </button>
                  </div>
                ) : bulkRestaurants.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No restaurants have pending items in this zone.
                  </p>
                ) : (
                  <>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#006fbd]/30 bg-blue-50/60 px-4 py-3">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={bulkAllRestaurants}
                          onChange={(e) => {
                            setBulkAllRestaurants(e.target.checked)
                            setBulkConfirming(false)
                          }}
                          disabled={processing}
                          className="h-4 w-4 accent-[#006fbd]"
                        />
                        <span className="text-sm font-semibold text-gray-900">All restaurants</span>
                      </span>
                      <span className="text-xs font-medium text-gray-500">
                        {bulkRestaurants.length} restaurants · {bulkRestaurantsTotal} items
                      </span>
                    </label>

                    {!bulkAllRestaurants && (
                      <>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-2.5 flex items-center text-gray-400">
                            <Search className="w-4 h-4" />
                          </span>
                          <input
                            type="text"
                            placeholder="Search restaurant"
                            value={bulkRestaurantSearch}
                            onChange={(e) => setBulkRestaurantSearch(e.target.value)}
                            className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:border-[#006fbd] focus:ring-1 focus:ring-[#006fbd]"
                          />
                        </div>
                        <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-100">
                          {visibleBulkRestaurants.length === 0 ? (
                            <p className="py-4 text-center text-sm text-gray-500">No matching restaurant.</p>
                          ) : (
                            visibleBulkRestaurants.map((r) => {
                              const id = String(r.restaurantId)
                              const counts = [
                                r.foodCount ? `${r.foodCount} food` : null,
                                r.addonCount ? `${r.addonCount} add-on` : null,
                              ].filter(Boolean).join(" · ")
                              return (
                                <label
                                  key={id}
                                  className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50"
                                >
                                  <span className="flex min-w-0 items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={bulkRestaurantIds.has(id)}
                                      onChange={() => toggleBulkRestaurant(id)}
                                      disabled={processing}
                                      className="h-4 w-4 shrink-0 accent-[#006fbd]"
                                    />
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-semibold text-gray-900">{r.restaurantName}</span>
                                      <span className="block text-xs text-gray-400">{r.displayId}</span>
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-xs font-medium text-gray-500">{counts}</span>
                                </label>
                              )
                            })
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-100 bg-slate-50 p-4 text-sm text-gray-700">
                {selectedItems.size > 0 ? (
                  <p>
                    <span className="font-semibold">{selectedItems.size}</span> item(s) ticked in the table will be approved.
                  </p>
                ) : (
                  <p className="text-gray-500">
                    No items selected. Close this and tick items in the table, or use "By Restaurant".
                  </p>
                )}
              </div>
            )}

            {bulkPlannedCount > 0 && (
              <p className="text-sm text-gray-600">
                {bulkMode === "restaurants"
                  ? `${bulkPlannedCount} item(s) from ${bulkPlannedRestaurants} restaurant(s) will be approved.`
                  : `${bulkPlannedCount} item(s) will be approved.`}
              </p>
            )}

            {bulkConfirming && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  These items will go live for customers right away and the restaurants will be notified. Continue?
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="p-6 pt-4 border-t border-gray-100 bg-slate-50/50 flex gap-2">
            <button
              type="button"
              onClick={closeBulkModal}
              disabled={processing}
              className="px-6 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBulkApprove}
              disabled={processing || bulkPlannedCount <= 0 || (bulkMode === "restaurants" && bulkRestaurantsLoading)}
              className="px-6 py-2 text-sm font-semibold text-white bg-green-600 rounded-xl hover:bg-green-700 shadow-lg shadow-green-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing
                ? "Approving..."
                : bulkConfirming
                  ? `Yes, approve ${bulkPlannedCount} item(s)`
                  : bulkPlannedCount > 0
                    ? `Approve ${bulkPlannedCount} item(s)`
                    : "Approve"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Details Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 bg-white shadow-2xl rounded-2xl border-none">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 bg-slate-50/50">
            <DialogTitle className="text-xl font-bold text-gray-900">
              {selectedRequest?.entityType === 'addon' ? 'Add-on Details' : 'Food Item Details'}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-1">
              Review the submitted details before approval.
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <div className="p-6 space-y-6">
              {/* Restaurant Info */}
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 flex items-center justify-between">
                <div>
                   <h3 className="font-bold text-xs text-blue-700 uppercase tracking-wider mb-1">Restaurant</h3>
                   <p className="text-sm font-semibold text-gray-900">{selectedRequest.restaurantName || '-'}</p>
                   <p className="text-xs text-gray-500">ID: {selectedRequest.restaurantId || '-'}</p>
                   <p className="text-xs text-blue-800 font-medium mt-1">Zone: {selectedRequest.zoneName || '—'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className="px-3 py-1 bg-white rounded-full border border-blue-100 text-[10px] font-bold text-blue-600">
                        {selectedRequest.entityType?.toUpperCase()}
                    </div>
                    {selectedRequest.actionType === 'UPDATED' && (
                        <div className="px-2 py-0.5 bg-yellow-100 rounded text-[9px] font-bold text-yellow-700 uppercase">
                            Changes
                        </div>
                    )}
                </div>
              </div>

              {selectedRequest.actionType === 'UPDATED' && selectedRequest.oldData ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <ComparisonField label="Item Name" oldVal={selectedRequest.oldData.name} newVal={selectedRequest.newData?.name} />
                       <ComparisonField label="Category" oldVal={selectedRequest.oldData.categoryName || selectedRequest.oldData.category} newVal={selectedRequest.newData?.categoryName || selectedRequest.newData?.category} />
                       <ComparisonField label="Price" oldVal={selectedRequest.oldData.price} newVal={selectedRequest.newData?.price} type="price" />
                       <ComparisonField label="Food Type" oldVal={selectedRequest.oldData.foodType} newVal={selectedRequest.newData?.foodType} />
                       {(() => {
                         const oldV = selectedRequest.oldData.variants || []
                         const newV = selectedRequest.newData?.variants || []
                         const oldStr = oldV.map(v => `${v.name}:₹${v.price}`).join(', ')
                         const newStr = newV.map(v => `${v.name}:₹${v.price}`).join(', ')
                         if (oldStr === newStr || (!oldStr && !newStr)) return null
                         return (
                           <div className="col-span-full">
                             <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Variants</label>
                             <div className="grid grid-cols-2 gap-3">
                               <div>
                                 <p className="text-[10px] text-gray-400 mb-1">Before</p>
                                 {oldV.length > 0 ? oldV.map((v, i) => (
                                   <div key={i} className="flex justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mb-1">
                                     <span className="text-sm text-gray-700">{v.name}</span>
                                     <span className="text-sm font-bold text-red-600">₹{v.price}</span>
                                   </div>
                                 )) : <p className="text-sm text-gray-400 italic">None</p>}
                               </div>
                               <div>
                                 <p className="text-[10px] text-gray-400 mb-1">After</p>
                                 {newV.length > 0 ? newV.map((v, i) => (
                                   <div key={i} className="flex justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-1.5 mb-1">
                                     <span className="text-sm text-gray-700">{v.name}</span>
                                     <span className="text-sm font-bold text-green-600">₹{v.price}</span>
                                   </div>
                                 )) : <p className="text-sm text-gray-400 italic">None</p>}
                               </div>
                             </div>
                           </div>
                         )
                       })()}
                       <ComparisonField label="Preparation Time" oldVal={selectedRequest.oldData.preparationTime} newVal={selectedRequest.newData?.preparationTime} />
                       <ComparisonField label="Recommend" oldVal={selectedRequest.oldData.isRecommended} newVal={selectedRequest.newData?.isRecommended} type="boolean" />
                       <ComparisonField label="In Stock" oldVal={selectedRequest.oldData.isAvailable} newVal={selectedRequest.newData?.isAvailable} type="boolean" />
                       
                       <div className="col-span-full">
                          <ComparisonField label="Description" oldVal={selectedRequest.oldData.description} newVal={selectedRequest.newData?.description} />
                       </div>
                       
                       <ImageComparison 
                          oldImage={selectedRequest.oldData.image} 
                          newImage={selectedRequest.newData?.image} 
                          oldImages={selectedRequest.oldData.images} 
                          newImages={selectedRequest.newData?.images} 
                       />
                   </div>
                </div>
              ) : (
                /* Item Info (Existing View) */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Item Name</label>
                          <p className="text-sm font-semibold text-gray-900">{selectedRequest.itemName || '-'}</p>
                      </div>
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Category</label>
                          <p className="text-sm text-gray-700">{selectedRequest.category || '-'}</p>
                      </div>
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Price</label>
                          {selectedRequest.variants && selectedRequest.variants.length > 0 ? (
                            <p className="text-xs text-gray-500 font-medium">Starts from ₹{selectedRequest.price}</p>
                          ) : (
                            <p className="text-sm font-bold text-green-600">{selectedRequest.price !== null && selectedRequest.price !== undefined ? `₹${selectedRequest.price}` : '-'}</p>
                          )}
                      </div>
                      {selectedRequest.variants && selectedRequest.variants.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Variants</label>
                          <div className="space-y-1.5">
                            {selectedRequest.variants.map((v, i) => (
                              <div key={i} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                                <span className="text-sm font-medium text-gray-800">{v.name}</span>
                                <span className="text-sm font-bold text-green-600">₹{v.price}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status</label>
                          <p className="text-sm text-gray-700 capitalize font-medium">{selectedRequest.approvalStatus || 'pending'}</p>
                      </div>
                      {selectedRequest.entityType !== 'addon' && (
                        <>
                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Preparation Time</label>
                              <p className="text-sm text-gray-700">
                                {(() => {
                                  const prep = String(selectedRequest.preparationTime ?? '').trim()
                                  if (!prep) return 'Not specified'
                                  return /^\d+$/.test(prep) ? `${prep} mins` : prep
                                })()}
                              </p>
                          </div>
                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Recommended</label>
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${selectedRequest.isRecommended ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                {selectedRequest.isRecommended ? 'Yes - recommended' : 'No'}
                              </span>
                          </div>
                        </>
                      )}
                  </div>

                  <div className="space-y-4">
                      {selectedRequest.foodType && (
                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Food Type</label>
                              <p className="text-sm text-gray-700">{selectedRequest.foodType}</p>
                          </div>
                      )}
                      {selectedRequest.requestedAt && (
                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Requested On</label>
                              <p className="text-sm text-gray-700">{new Date(selectedRequest.requestedAt).toLocaleString()}</p>
                          </div>
                      )}
                  </div>

                  {selectedRequest.description && (
                    <div className="col-span-full">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Description</label>
                      <p className="text-sm text-gray-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">{selectedRequest.description}</p>
                    </div>
                  )}

                  {/* Images */}
                  {(() => {
                    const allImages = (selectedRequest.images || []).filter(img => img && typeof img === 'string');
                    if (selectedRequest.image && !allImages.includes(selectedRequest.image)) {
                        allImages.unshift(selectedRequest.image);
                    }
                    
                    return allImages.length > 0 ? (
                      <div className="col-span-full">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Images ({allImages.length})
                        </label>
                        <div className="flex flex-wrap gap-3">
                          {allImages.map((img, idx) => (
                              <img 
                                key={idx}
                                src={img} 
                                alt="Item preview"
                                className="w-24 h-24 object-cover rounded-xl border border-gray-100 shadow-sm hover:scale-105 transition-transform cursor-zoom-in"
                                onClick={() => window.open(img, '_blank')}
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="p-6 pt-4 border-t border-gray-100 bg-slate-50/50 flex gap-2">
            <button
              type="button"
              onClick={() => setShowDetailModal(false)}
              className="px-6 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
            {canEdit && selectedRequest?.isActionable && (
              <>
                <button
                  type="button"
                  onClick={() => handleRejectClick(selectedRequest)}
                  className="px-6 py-2 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 shadow-lg shadow-red-200 transition-all active:scale-95"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => handleApprove(selectedRequest)}
                  disabled={processing}
                  className="px-6 py-2 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 shadow-lg shadow-green-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  {processing ? "Processing..." : "Approve Item"}
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Modal */}
      <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
        <DialogContent className="max-w-md p-0 bg-white rounded-2xl border-none shadow-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 bg-red-50/30">
            <DialogTitle className="text-xl font-bold text-red-700 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Reject Item
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-1">
              Please provide a clear reason for rejecting this {selectedRequest?.entityType || 'item'}.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="rejectReason" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="rejectReason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Tell the restaurant why this item was rejected..."
                  required
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                />
              </div>
            </div>
            <DialogFooter className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={processing || !rejectReason.trim()}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95 disabled:opacity-50"
              >
                {processing ? "Processing..." : "Confirm Rejection"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
