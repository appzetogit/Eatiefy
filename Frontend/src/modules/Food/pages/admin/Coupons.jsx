import { useState, useEffect, useCallback, useMemo } from "react"
import { Search, CheckCircle2, XCircle, Clock, AlertCircle, Trash2, Tag, Store, Percent, Calendar, RefreshCw, X, Eye, Utensils } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const RequiredMark = () => <span className="text-red-500">*</span>


export default function Coupons() {
  const { canCreate, canEdit, canDelete } = useAdminPermissions()
  const [activeTab, setActiveTab] = useState("platform") // "platform" | "restaurant_approval"

  // Platform coupon states
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_coupons_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [offers, setOffers] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [updatingCartVisibility, setUpdatingCartVisibility] = useState({})
  const [deletingOffer, setDeletingOffer] = useState({})
  const [editingOfferId, setEditingOfferId] = useState(null)
  const [originalFormData, setOriginalFormData] = useState(null)
  const [errors, setErrors] = useState({})

  // Restaurant Offer Approval states
  const [restOffers, setRestOffers] = useState([])
  const [restLoading, setRestLoading] = useState(false)
  const [restError, setRestError] = useState(null)
  const [restSearchQuery, setRestSearchQuery] = useState("")
  const [debouncedRestSearch, setDebouncedRestSearch] = useState("")
  const [restStatusFilter, setRestStatusFilter] = useState("all") // "all" | "pending" | "approved" | "rejected"
  const [restPage, setRestPage] = useState(1)
  const [restPageSize, setRestPageSize] = useState(20)
  const [restTotal, setRestTotal] = useState(0)
  const [restCounts, setRestCounts] = useState({ all: 0, pending: 0, approved: 0, rejected: 0 })
  const [restActionLoading, setRestActionLoading] = useState({})
  const [rejectModal, setRejectModal] = useState({ open: false, offer: null, reason: "" })
  const [detailsModal, setDetailsModal] = useState({ open: false, offer: null })

  const [formData, setFormData] = useState({
    couponType: "all",
    couponCode: "",
    discountType: "percentage",
    discountValue: "",
    customerScope: "all",
    restaurantScope: "all",
    restaurantId: "",
    endDate: "",
    startDate: "",
    minOrderValue: "",
    maxDiscount: "",
    usageLimit: "",
    perUserLimit: "",
    isFirstOrderOnly: false,
    zoneIds: [],
  })
  const [zones, setZones] = useState([])

  const isFormDirty = useMemo(() => {
    if (!editingOfferId || !originalFormData) return true
    return JSON.stringify(formData) !== JSON.stringify(originalFormData)
  }, [formData, originalFormData, editingOfferId])

  const fetchOffers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await adminAPI.getAllOffers({
        search: debouncedSearch || undefined,
        page: currentPage,
        limit: pageSize,
      })

      if (response?.data?.success) {
        const offerData = response.data.data
        const list = Array.isArray(offerData?.offers)
          ? offerData.offers
          : Array.isArray(offerData)
            ? offerData
            : []
        setOffers(list)
        setTotalItems(
          response?.data?.data?.total ??
          response?.data?.total ??
          (Array.isArray(list) ? list.length : 0),
        )
      } else {
        setError("Failed to fetch offers")
        setTotalItems(0)
      }
    } catch (err) {
      debugError("Error fetching offers:", err)
      setError(err?.response?.data?.message || "Failed to fetch offers")
      setOffers([])
      setTotalItems(0)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, currentPage, pageSize])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch])

  useEffect(() => {
    fetchOffers()
  }, [fetchOffers])

  // Zones for zone-wise coupons.
  useEffect(() => {
    let cancelled = false
    adminAPI
      .getZones({ limit: 1000 })
      .then((res) => {
        const zoneData = res?.data?.data
        const list = Array.isArray(zoneData?.zones) ? zoneData.zones : Array.isArray(zoneData) ? zoneData : []
        if (!cancelled) setZones(list)
      })
      .catch((err) => debugError("Error loading zones:", err))
    return () => {
      cancelled = true
    }
  }, [])

  const zoneNameById = useMemo(() => {
    const map = new Map()
    zones.forEach((z) => map.set(String(z._id || z.id), z.name || z.zoneName || "Zone"))
    return map
  }, [zones])

  const toggleZone = (zoneId) => {
    const id = String(zoneId)
    const current = Array.isArray(formData.zoneIds) ? formData.zoneIds : []
    const next = current.includes(id) ? current.filter((z) => z !== id) : [...current, id]
    handleFormChange("zoneIds", next)
  }

  const fetchRestaurantOffers = useCallback(async () => {
    try {
      setRestLoading(true)
      setRestError(null)
      const res = await adminAPI.getRestaurantOffers({
        status: restStatusFilter !== "all" ? restStatusFilter : undefined,
        search: debouncedRestSearch || undefined,
        page: restPage,
        limit: restPageSize,
      })
      if (res?.data?.success) {
        const data = res.data.data
        const list = Array.isArray(data?.offers) ? data.offers : []
        setRestOffers(list)
        setRestTotal(data?.total || list.length || 0)
        if (data?.counts) {
          setRestCounts(data.counts)
        }
      } else {
        setRestError("Failed to fetch restaurant offers")
        setRestOffers([])
        setRestTotal(0)
      }
    } catch (err) {
      debugError("Error fetching restaurant offers:", err)
      setRestError(err?.response?.data?.message || "Failed to fetch restaurant offers")
      setRestOffers([])
      setRestTotal(0)
    } finally {
      setRestLoading(false)
    }
  }, [debouncedRestSearch, restStatusFilter, restPage, restPageSize])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRestSearch(restSearchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [restSearchQuery])

  useEffect(() => {
    setRestPage(1)
  }, [debouncedRestSearch, restStatusFilter])

  useEffect(() => {
    fetchRestaurantOffers()
  }, [fetchRestaurantOffers])

  const handleApproveRestOffer = async (offerId) => {
    try {
      setRestActionLoading((prev) => ({ ...prev, [offerId]: "approve" }))
      const res = await adminAPI.approveRestaurantOffer(offerId)
      if (res?.data?.success) {
        toast.success(res.data.message || "Offer approved successfully! It is now live for customers.")
        await fetchRestaurantOffers()
      }
    } catch (err) {
      debugError("Error approving restaurant offer:", err)
      toast.error(err?.response?.data?.message || "Failed to approve offer")
    } finally {
      setRestActionLoading((prev) => ({ ...prev, [offerId]: null }))
    }
  }

  const handleOpenRejectModal = (offer) => {
    setRejectModal({ open: true, offer, reason: "" })
  }

  const handleConfirmReject = async (e) => {
    if (e) e.preventDefault()
    if (!rejectModal.offer) return
    const offerId = rejectModal.offer.id || rejectModal.offer._id || rejectModal.offer.offerId
    try {
      setRestActionLoading((prev) => ({ ...prev, [offerId]: "reject" }))
      const res = await adminAPI.rejectRestaurantOffer(offerId, rejectModal.reason)
      if (res?.data?.success) {
        toast.success(res.data.message || "Offer rejected successfully.")
        setRejectModal({ open: false, offer: null, reason: "" })
        await fetchRestaurantOffers()
      }
    } catch (err) {
      debugError("Error rejecting restaurant offer:", err)
      toast.error(err?.response?.data?.message || "Failed to reject offer")
    } finally {
      setRestActionLoading((prev) => ({ ...prev, [offerId]: null }))
    }
  }

  const handleDeleteRestOffer = async (offerId) => {
    if (!window.confirm("Are you sure you want to delete this restaurant offer?")) return
    try {
      setRestActionLoading((prev) => ({ ...prev, [offerId]: "delete" }))
      const res = await adminAPI.deleteRestaurantOffer(offerId)
      if (res?.data?.success) {
        toast.success("Restaurant offer deleted successfully")
        await fetchRestaurantOffers()
      }
    } catch (err) {
      debugError("Error deleting restaurant offer:", err)
      toast.error(err?.response?.data?.message || "Failed to delete offer")
    } finally {
      setRestActionLoading((prev) => ({ ...prev, [offerId]: null }))
    }
  }

  useEffect(() => {
    const fetchRestaurants = async () => {
      try {
        const response = await adminAPI.getRestaurants({ page: 1, limit: 200 })
        if (response?.data?.success) {
          const restaurantData = response?.data?.data
          const list = Array.isArray(restaurantData?.restaurants)
            ? restaurantData.restaurants
            : Array.isArray(restaurantData)
              ? restaurantData
              : []
          // Backend returns `restaurantName`; normalize to `name` for this dropdown without affecting other pages.
          const normalized = list.map((r) => ({
            ...r,
            name: r?.name || r?.restaurantName || "",
          }))
          setRestaurants(normalized)
        }
      } catch (err) {
        debugError("Error fetching restaurants:", err)
      }
    }

    fetchRestaurants()
  }, [])

  const todayYMD = () => {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${d.getFullYear()}-${m}-${day}`
  }

  const validateForm = (draft) => {
    const e = {}
    const f = draft || formData
    const pct = f.discountType === "percentage"
    const value = Number(f.discountValue)
    if (!String(f.couponCode || "").trim()) e.couponCode = "Coupon code is required"
    if (!Number.isFinite(value) || value <= 0) e.discountValue = "Discount must be greater than 0"
    if (pct && (f.maxDiscount === "" || f.maxDiscount === null || f.maxDiscount === undefined)) {
      e.maxDiscount = "Max discount is required for percentage coupons"
    }
    if (f.minOrderValue !== "" && Number(f.minOrderValue) < 0) e.minOrderValue = "Min order cannot be negative"
    if (f.usageLimit !== "" && Number(f.usageLimit) < 1) e.usageLimit = "Usage limit must be at least 1"
    if (f.perUserLimit !== "" && Number(f.perUserLimit) < 1) e.perUserLimit = "Per user limit must be at least 1"
    const start = f.startDate ? new Date(`${f.startDate}T00:00:00`) : null
    const end = f.endDate ? new Date(`${f.endDate}T00:00:00`) : null
    const now = new Date()
    if (end && end < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      e.endDate = "End date cannot be in the past"
    }
    if (start && end && start > end) {
      e.startDate = "Start date must be before end date"
      e.endDate = "End date must be after start date"
    }
    setErrors(e)
    return { valid: Object.keys(e).length === 0, e }
  }

  const handleFormChange = (field, rawValue) => {
    let value = rawValue
    if (field === "couponCode") {
      value = String(value || "").toUpperCase()
    }
    if (field === "discountType") {
      // When switching to flat-price, clear and disable maxDiscount
      if (value === "flat-price") {
        setFormData((prev) => {
          const next = { ...prev, discountType: value, maxDiscount: "" }
          validateForm(next)
          return next
        })
        return
      }
    }
    const next = { ...formData, [field]: value }
    // Date constraints
    if (field === "startDate" && next.endDate) {
      // Ensure startDate <= endDate
      const s = next.startDate ? new Date(`${next.startDate}T00:00:00`) : null
      const e = new Date(`${next.endDate}T00:00:00`)
      if (s && s > e) {
        // keep but will show error
      }
    }
    if (field === "endDate" && next.startDate) {
      const s = new Date(`${next.startDate}T00:00:00`)
      const e = next.endDate ? new Date(`${next.endDate}T00:00:00`) : null
      if (e && e < s) {
        // keep but will show error
      }
    }
    setFormData(next)
    validateForm(next)
  }

  const resetForm = () => {
    setFormData({
      couponType: "all",
      couponCode: "",
      discountType: "percentage",
      discountValue: "",
      customerScope: "all",
      restaurantScope: "all",
      restaurantId: "",
      endDate: "",
      startDate: "",
      minOrderValue: "",
      maxDiscount: "",
      usageLimit: "",
      perUserLimit: "",
      isFirstOrderOnly: false,
      zoneIds: [],
    })
    setEditingOfferId(null)
    setOriginalFormData(null)
  }

  const handleCreateCoupon = async (e) => {
    e.preventDefault()
    const { valid } = validateForm()
    if (!valid) {
      toast.error("Please fix the highlighted errors")
      return
    }

    if (!formData.couponCode.trim()) {
      toast.error("Coupon code is required")
      return
    }

    const parsedDiscountValue = Number(formData.discountValue)
    if (!Number.isFinite(parsedDiscountValue) || parsedDiscountValue <= 0) {
      toast.error("Discount value must be greater than 0")
      return
    }

    if (formData.restaurantScope === "selected" && !formData.restaurantId) {
      toast.error("Please select a restaurant")
      return
    }

    try {
      setIsSubmitting(true)
      const payload = {
        couponCode: formData.couponCode.trim(),
        couponType: formData.couponType,
        discountType: formData.discountType,
        discountValue: parsedDiscountValue,
        customerScope: formData.customerScope,
        restaurantScope: formData.restaurantScope,
        restaurantId: formData.restaurantScope === "selected" ? formData.restaurantId : undefined,
        endDate: formData.endDate || undefined,
        startDate: formData.startDate || undefined,
        minOrderValue: formData.minOrderValue !== "" ? Number(formData.minOrderValue) : undefined,
        maxDiscount: formData.discountType === "percentage" && formData.maxDiscount !== "" ? Number(formData.maxDiscount) : undefined,
        usageLimit: formData.usageLimit !== "" ? Number(formData.usageLimit) : undefined,
        perUserLimit: formData.perUserLimit !== "" ? Number(formData.perUserLimit) : undefined,
        isFirstOrderOnly: Boolean(formData.isFirstOrderOnly),
        // Empty = valid in every zone.
        zoneIds: Array.isArray(formData.zoneIds) ? formData.zoneIds : [],
      }
      if (editingOfferId) {
        await adminAPI.updateAdminOffer(editingOfferId, payload)
        toast.success("Coupon updated successfully")
      } else {
        await adminAPI.createAdminOffer(payload)
        toast.success("Coupon created successfully")
      }

      resetForm()
      setIsAddOpen(false)
      await fetchOffers()
    } catch (err) {
      debugError("Error saving coupon:", err)
      toast.error(err?.response?.data?.message || "Failed to save coupon")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleShowInCart = async (offerId, itemId, currentValue) => {
    const key = `${offerId}-${itemId}`
    try {
      setUpdatingCartVisibility((prev) => ({ ...prev, [key]: true }))
      const nextValue = !currentValue
      await adminAPI.updateAdminOfferCartVisibility(offerId, itemId, nextValue)
      setOffers((prev) =>
        prev.map((offer) =>
          offer.offerId === offerId && offer.dishId === itemId
            ? { ...offer, showInCart: nextValue }
            : offer,
        ),
      )
    } catch (err) {
      debugError("Error updating cart visibility:", err)
    } finally {
      setUpdatingCartVisibility((prev) => ({ ...prev, [key]: false }))
    }
  }

  const handleDeleteOffer = async (offerId) => {
    if (!offerId) return
    if (deletingOffer[offerId]) return
    try {
      setDeletingOffer((prev) => ({ ...prev, [offerId]: true }))
      await adminAPI.deleteAdminOffer(offerId)
      setOffers((prev) => prev.filter((o) => o.offerId !== offerId))
      toast.success("Coupon deleted successfully")
    } catch (err) {
      debugError("Error deleting offer:", err)
      toast.error(err?.response?.data?.message || "Failed to delete coupon")
    } finally {
      setDeletingOffer((prev) => ({ ...prev, [offerId]: false }))
    }
  }

  const handleEditClick = (offer) => {
    const formatDateForInput = (dateVal) => {
      if (!dateVal) return ""
      try {
        const d = new Date(dateVal)
        if (isNaN(d.getTime())) return ""
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, "0")
        const dd = String(d.getDate()).padStart(2, "0")
        return `${yyyy}-${mm}-${dd}`
      } catch (e) {
        return ""
      }
    }

    const mappedData = {
      couponType: offer.couponType || "all",
      couponCode: offer.couponCode || "",
      discountType: offer.discountType || "percentage",
      discountValue: offer.discountType === "flat-price"
        ? String(offer.originalPrice || "")
        : String(offer.discountPercentage || ""),
      customerScope: offer.customerScope || (offer.customerGroup === "new" ? "first-time" : "all"),
      restaurantScope: offer.restaurantScope || "all",
      restaurantId: offer.restaurantId || "",
      endDate: formatDateForInput(offer.endDate),
      startDate: formatDateForInput(offer.startDate),
      minOrderValue: Number(offer.minOrderValue) > 0 ? String(offer.minOrderValue) : "",
      maxDiscount: offer.maxDiscount !== undefined && offer.maxDiscount !== null ? String(offer.maxDiscount) : "",
      usageLimit: offer.usageLimit !== undefined && offer.usageLimit !== null ? String(offer.usageLimit) : "",
      perUserLimit: offer.perUserLimit !== undefined && offer.perUserLimit !== null ? String(offer.perUserLimit) : "",
      isFirstOrderOnly: offer.isFirstOrderOnly === true,
      zoneIds: Array.isArray(offer.zoneIds) ? offer.zoneIds.map(String) : [],
    }
    setFormData(mappedData)
    setOriginalFormData(mappedData)
    setEditingOfferId(offer.offerId)
    setIsAddOpen(true)

    if (typeof document !== "undefined") {
      const mainEl = document.querySelector("main")
      if (mainEl) {
        mainEl.scrollTo({ top: 0, behavior: "smooth" })
      }
    }
  }

  // Filter offers based on search query
  const filteredOffers = offers

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Top Header & Tab Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Coupons & Offer Approvals</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage platform coupon codes and review restaurant food discount offers</p>
          </div>
          <div className="flex items-center bg-slate-200/90 p-1 rounded-xl border border-slate-300 shadow-inner">
            <button
              type="button"
              onClick={() => setActiveTab("platform")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === "platform"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Tag className="w-4 h-4 text-blue-600" />
              <span>Platform Coupons</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("restaurant_approval")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all relative ${
                activeTab === "restaurant_approval"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Store className="w-4 h-4 text-emerald-600" />
              <span>Restaurant Offers</span>
              {restCounts.pending > 0 && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white animate-pulse">
                  {restCounts.pending} Pending
                </span>
              )}
            </button>
          </div>
        </div>

        {activeTab === "platform" ? (
          <>
            {/* Header */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-slate-900">Platform Coupons</h2>
                </div>
                {(canCreate || canEdit) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isAddOpen) {
                        resetForm()
                        setIsAddOpen(false)
                      } else {
                        setIsAddOpen(true)
                      }
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                  >
                    {isAddOpen ? "Close" : "Add Coupon"}
                  </button>
                )}
              </div>

              {isAddOpen && (
                <form
                  onSubmit={handleCreateCoupon}
                  className="border border-slate-200 rounded-xl p-4 mb-5 bg-slate-50"
                >
                  <h3 className="text-base font-semibold text-slate-900 mb-3">
                    {editingOfferId ? "Edit Coupon" : "Create Coupon"}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Coupon Type</label>
                      <select
                        value={formData.couponType}
                        onChange={(e) => handleFormChange("couponType", e.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="all">Both</option>
                        <option value="delivery">Delivery</option>
                        <option value="takeaway">Takeaway</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Coupon Code <RequiredMark />
                      </label>
                      <input
                        type="text"
                        value={formData.couponCode}
                        onChange={(e) => handleFormChange("couponCode", e.target.value)}
                        placeholder="e.g. NEWUSER50"
                        className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.couponCode ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                      />
                      {errors.couponCode && <p className="mt-1 text-xs text-red-600">{errors.couponCode}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Discount Type</label>
                      <select
                        value={formData.discountType}
                        onChange={(e) => handleFormChange("discountType", e.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="percentage">Percentage</option>
                        <option value="flat-price">Flat Amount</option>
                      </select>
                    </div>

                    <div title={formData.discountType === "flat-price" ? "Max discount is not applicable for flat coupons" : ""}>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        {formData.discountType === "percentage" ? "Discount (%)" : "Discount Amount"} <RequiredMark />
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={formData.discountValue}
                        onChange={(e) => handleFormChange("discountValue", e.target.value)}
                        placeholder={formData.discountType === "percentage" ? "e.g. 20" : "e.g. 100"}
                        className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.discountValue ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                      />
                      {errors.discountValue && <p className="mt-1 text-xs text-red-600">{errors.discountValue}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Customer Scope</label>
                      <select
                        value={formData.customerScope}
                        onChange={(e) => handleFormChange("customerScope", e.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="all">All Users</option>
                        <option value="first-time">First-time Users</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Restaurant Scope</label>
                      <select
                        value={formData.restaurantScope}
                        onChange={(e) => handleFormChange("restaurantScope", e.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="all">All Restaurants</option>
                        <option value="selected">Selected Restaurant</option>
                      </select>
                    </div>

                    <div className="md:col-span-2 lg:col-span-3">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Zones <span className="font-normal text-slate-400">(leave empty for all zones)</span>
                      </label>
                      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-300 bg-white p-2 max-h-32 overflow-y-auto">
                        {zones.length === 0 ? (
                          <span className="text-xs text-slate-400">No zones found</span>
                        ) : (
                          zones.map((zone) => {
                            const id = String(zone._id || zone.id)
                            const selected = (formData.zoneIds || []).includes(id)
                            return (
                              <button
                                type="button"
                                key={id}
                                onClick={() => toggleZone(id)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${selected ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:border-blue-400"}`}
                              >
                                {zone.name || zone.zoneName || "Unnamed Zone"}
                              </button>
                            )
                          })
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Start Date (Optional)</label>
                      <input
                        type="date"
                        value={formData.startDate}
                        onChange={(e) => handleFormChange("startDate", e.target.value)}
                        min={editingOfferId ? undefined : todayYMD()}
                        className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.startDate ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                      />
                      {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Expiry Date (Optional)</label>
                      <input
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => handleFormChange("endDate", e.target.value)}
                        min={formData.startDate || (editingOfferId ? undefined : todayYMD())}
                        className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.endDate ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                      />
                      {errors.endDate && <p className="mt-1 text-xs text-red-600">{errors.endDate}</p>}
                    </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Min Order Value (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formData.minOrderValue}
                      onChange={(e) => handleFormChange("minOrderValue", e.target.value)}
                      placeholder="e.g. 199"
                      className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.minOrderValue ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                    />
                    {errors.minOrderValue && <p className="mt-1 text-xs text-red-600">{errors.minOrderValue}</p>}
                  </div>

                    <div title={formData.discountType === "flat-price" ? "Max discount is not applicable for flat coupons" : ""}>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Max Discount (₹)
                      {formData.discountType === "percentage" && (
                        <>
                          {" "}
                          <RequiredMark />
                        </>
                      )}
                      {formData.discountType === "flat-price" && (
                        <span className="font-normal text-slate-400"> (optional)</span>
                      )}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                        value={formData.maxDiscount}
                        onChange={(e) => handleFormChange("maxDiscount", e.target.value)}
                      placeholder="e.g. 100"
                        disabled={formData.discountType === "flat-price"}
                        className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.maxDiscount ? "border-red-500" : "border-slate-300"} bg-white disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                    />
                      {formData.discountType === "percentage" && errors.maxDiscount && <p className="mt-1 text-xs text-red-600">{errors.maxDiscount}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Usage Limit (global)</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formData.usageLimit}
                      onChange={(e) => handleFormChange("usageLimit", e.target.value)}
                      placeholder="e.g. 1000"
                      className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.usageLimit ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                    />
                    {errors.usageLimit && <p className="mt-1 text-xs text-red-600">{errors.usageLimit}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Per User Limit</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formData.perUserLimit}
                      onChange={(e) => handleFormChange("perUserLimit", e.target.value)}
                      placeholder="e.g. 1"
                      className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.perUserLimit ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                    />
                    {errors.perUserLimit && <p className="mt-1 text-xs text-red-600">{errors.perUserLimit}</p>}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="isFirstOrderOnly"
                      type="checkbox"
                      checked={formData.isFirstOrderOnly}
                      onChange={(e) => handleFormChange("isFirstOrderOnly", e.target.checked)}
                      className="h-4 w-4"
                    />
                    <label htmlFor="isFirstOrderOnly" className="text-sm text-slate-700">First order only</label>
                  </div>

                    {formData.restaurantScope === "selected" && (
                      <div className="md:col-span-2 lg:col-span-3">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Select Restaurant <RequiredMark />
                        </label>
                        <select
                          value={formData.restaurantId}
                          onChange={(e) => handleFormChange("restaurantId", e.target.value)}
                          className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Choose a restaurant</option>
                          {restaurants.map((restaurant) => (
                            <option key={restaurant._id} value={restaurant._id}>
                              {restaurant.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>



                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={isSubmitting || Object.keys(errors).length > 0 || !isFormDirty}
                      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {editingOfferId
                        ? (isSubmitting ? "Saving..." : "Save Coupon")
                        : (isSubmitting ? "Creating..." : "Create Coupon")}
                    </button>
                    {editingOfferId && (
                      <button
                        type="button"
                        onClick={() => {
                          resetForm()
                          setIsAddOpen(false)
                        }}
                        className="px-4 py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-200 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              )}

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by restaurant name, dish name, or coupon code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Offers List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Offers List
                </h2>
                <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700 flex items-center justify-center min-w-[2.5rem] h-7">
                  {loading ? (
                    <span className="w-5 h-3 rounded bg-slate-300/80 animate-pulse" />
                  ) : (
                    `${totalItems} ${totalItems === 1 ? 'offer' : 'offers'}`
                  )}
                </span>
              </div>

              {loading ? (
                <div className="text-center py-20">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="text-sm text-slate-500 mt-4">Loading offers...</p>
                </div>
              ) : error ? (
                <div className="text-center py-20">
                  <p className="text-lg font-semibold text-red-600 mb-1">Error</p>
                  <p className="text-sm text-slate-500">{error}</p>
                </div>
              ) : filteredOffers.length === 0 ? (
                <div className="text-center py-20">
                  <p className="text-lg font-semibold text-slate-700 mb-1">No Offers Found</p>
                  <p className="text-sm text-slate-500">
                    {searchQuery ? "No offers match your search criteria" : "No offers have been created yet"}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">SI</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Restaurant</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Dish</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Coupon Code</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Coupon Type</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Customer Scope</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Discount</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Price</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Min Order</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Usage</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Status</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Show In Cart</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Valid Until</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {filteredOffers.map((offer) => (
                        <tr key={`${offer.offerId}-${offer.dishId}`} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-slate-700">{offer.sl}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-slate-900">
                              {offer.restaurantScope === "all" || offer.restaurantName === "All Restaurants" ? "All Restaurants" : offer.restaurantName}
                            </span>
                            <span className="block text-xs text-slate-500 mt-0.5">
                              {Array.isArray(offer.zoneIds) && offer.zoneIds.length > 0
                                ? offer.zoneIds.map((id) => zoneNameById.get(String(id)) || "Zone").join(", ")
                                : "All zones"}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                              {offer.dishName}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-mono font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded whitespace-nowrap">
                              {offer.couponCode}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              offer.couponType === "delivery"
                                ? "bg-emerald-100 text-emerald-700"
                                : offer.couponType === "takeaway"
                                ? "bg-orange-100 text-orange-700"
                                : "bg-slate-100 text-slate-700"
                            }`}>
                              {offer.couponType === "delivery" ? "Delivery" : offer.couponType === "takeaway" ? "Takeaway" : "Both"}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              offer.customerGroup === "new"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-slate-100 text-slate-700"
                            }`}>
                              {offer.customerGroup === "new" ? "First-time Users" : "All Users"}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700 whitespace-nowrap">
                              {offer.discountType === 'flat-price'
                                ? `\u20B9${offer.originalPrice - offer.discountedPrice} OFF`
                                : `${offer.discountPercentage}% OFF${Number(offer.maxDiscount) ? ` (up to \u20B9${Number(offer.maxDiscount)})` : ""}`}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">
                              {offer.dishId === "all"
                                ? (Number(offer.minOrderValue) ? `Min \u20B9${Number(offer.minOrderValue)}` : "All Items")
                                : (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400 line-through">{"\u20B9"}{offer.originalPrice}</span>
                                    <span className="text-sm font-semibold text-green-600">{"\u20B9"}{offer.discountedPrice}</span>
                                  </div>
                                )}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">
                              {Number(offer.minOrderValue) ? `\u20B9${Number(offer.minOrderValue)}` : "—"}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">
                              {`${Number(offer.usedCount || 0)} / ${Number(offer.usageLimit || 0) > 0 ? Number(offer.usageLimit) : "∞"}`}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {(() => {
                              const expired = offer.endDate ? (new Date(offer.endDate).getTime() < new Date(new Date().toDateString()).getTime()) : false
                              const status = expired ? 'expired' : (offer.status || 'inactive')
                              const cls =
                                status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : status === 'paused'
                                  ? 'bg-orange-100 text-orange-700'
                                  : status === 'expired'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-gray-100 text-gray-700'
                              return (
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>
                                  {status}
                                </span>
                              )
                            })()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleToggleShowInCart(offer.offerId, offer.dishId, offer.showInCart !== false)}
                              disabled={!canEdit || !!updatingCartVisibility[`${offer.offerId}-${offer.dishId}`]}
                              className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors ${
                                offer.showInCart !== false ? "bg-green-600" : "bg-slate-300"
                              } disabled:opacity-60`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  offer.showInCart !== false ? "translate-x-7" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700 whitespace-nowrap">
                              {offer.endDate
                                ? (() => {
                                    const d = new Date(offer.endDate)
                                    const dd = String(d.getDate()).padStart(2, '0')
                                    const month = d.toLocaleString('en-US', { month: 'short' })
                                    const yyyy = d.getFullYear()
                                    return `${dd} ${month} ${yyyy}`
                                  })()
                                : 'No expiry'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => handleEditClick(offer)}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                                >
                                  Edit
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOffer(offer.offerId)}
                                  disabled={!!deletingOffer[offer.offerId]}
                                  className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-60"
                                >
                                  {deletingOffer[offer.offerId] ? "Deleting..." : "Delete"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
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
                    localStorage.setItem("admin_coupons_pageSize", String(size))
                  } catch {}
                  setCurrentPage(1)
                }}
                itemLabel="offers"
              />
            </div>
          </>
        ) : (
          /* =========================================================================
             RESTAURANT OFFER APPROVALS TAB
             ========================================================================= */
          <div className="space-y-6">
            {/* Filter Pills & Search Card */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                {/* Status Filter Tabs */}
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: "all", label: "All Offers", count: restCounts.all },
                    { id: "pending", label: "Pending Approval", count: restCounts.pending, color: "text-amber-700 bg-amber-50 border-amber-300" },
                    { id: "approved", label: "Approved", count: restCounts.approved, color: "text-emerald-700 bg-emerald-50 border-emerald-300" },
                    { id: "rejected", label: "Rejected", count: restCounts.rejected, color: "text-rose-700 bg-rose-50 border-rose-300" },
                  ].map((filter) => {
                    const isSelected = restStatusFilter === filter.id
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => setRestStatusFilter(filter.id)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-2 ${
                          isSelected
                            ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                            : filter.color || "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        <span>{filter.label}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
                            isSelected
                              ? "bg-slate-800 text-slate-200"
                              : "bg-white/80 border border-current opacity-90"
                          }`}
                        >
                          {filter.count || 0}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Refresh Button */}
                <button
                  type="button"
                  onClick={() => fetchRestaurantOffers()}
                  disabled={restLoading}
                  className="self-end md:self-auto inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${restLoading ? "animate-spin" : ""}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {/* Search input */}
              <div className="mt-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by restaurant name or offer title..."
                  value={restSearchQuery}
                  onChange={(e) => setRestSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Restaurant Offers Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Restaurant Menu Offers</h2>
                  <p className="text-xs text-slate-500">Offers configured by restaurant owners for their menu items</p>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  {restTotal} {restTotal === 1 ? "Offer" : "Offers"}
                </span>
              </div>

              {restLoading ? (
                <div className="text-center py-20">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
                  <p className="text-sm text-slate-500 mt-4">Loading restaurant offers...</p>
                </div>
              ) : restError ? (
                <div className="text-center py-20">
                  <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-2" />
                  <p className="text-lg font-semibold text-red-600 mb-1">Failed to load</p>
                  <p className="text-sm text-slate-500">{restError}</p>
                </div>
              ) : restOffers.length === 0 ? (
                <div className="text-center py-20">
                  <Store className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-base font-semibold text-slate-700">No Restaurant Offers Found</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {restSearchQuery
                      ? "No offers match your search term"
                      : restStatusFilter !== "all"
                      ? `No ${restStatusFilter} offers at this moment`
                      : "No restaurants have created any food discount offers yet"}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Restaurant</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Offer Title</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Discount</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Applied To</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Validity Period</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Status</th>
                        <th className="px-4 py-3.5 text-right text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {restOffers.map((item) => {
                        const offerId = item.id || item._id
                        const isActionLoading = !!restActionLoading[offerId]
                        const approvalStatus = item.approvalStatus || (item.status === "pending_approval" ? "pending" : "approved")
                        const scope = item.applicableTo || item.appliesTo
                        const dishes = Array.isArray(item.items) && item.items.length > 0 ? item.items : (Array.isArray(item.dishes) ? item.dishes : [])
                        const categories = Array.isArray(item.categories) ? item.categories : []
                        const offerTitle = item.title || item.name || "Untitled Offer"

                        return (
                          <tr key={offerId} className="hover:bg-slate-50/80 transition-colors">
                            {/* Restaurant Info */}
                            <td className="px-4 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 font-bold text-xs shrink-0">
                                  <Store className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{item.restaurantName || "Restaurant"}</p>
                                  <p className="text-[11px] text-slate-400 font-mono">ID: {String(item.restaurantId).slice(-6)}</p>
                                </div>
                              </div>
                            </td>

                            {/* Offer Title & Description */}
                            <td className="px-4 py-4 max-w-xs">
                              <button
                                type="button"
                                onClick={() => setDetailsModal({ open: true, offer: item })}
                                className="font-semibold text-sm text-slate-900 hover:text-emerald-700 text-left transition-colors cursor-pointer"
                              >
                                {offerTitle}
                              </button>
                              {item.description && (
                                <p className="text-xs text-slate-500 truncate max-w-xs mt-0.5">{item.description}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-slate-500">
                                {Number(item.minOrderValue) > 0 && (
                                  <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-medium">
                                    Min Order: ₹{item.minOrderValue}
                                  </span>
                                )}
                                {Number(item.maxDiscountAmount) > 0 && (
                                  <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-medium">
                                    Max Disc: ₹{item.maxDiscountAmount}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Discount */}
                            <td className="px-4 py-4 whitespace-nowrap">
                              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs">
                                <Percent className="w-3.5 h-3.5" />
                                <span>
                                  {item.discountType === "flat"
                                    ? `₹${item.discountValue} FLAT OFF`
                                    : `${item.discountValue}% OFF`}
                                </span>
                              </div>
                            </td>

                            {/* Scope / Dishes */}
                            <td className="px-4 py-4 max-w-sm">
                              {scope === "entire_menu" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  Entire Menu
                                </span>
                              )}
                              {(scope === "category" || scope === "specific_categories") && (
                                <div>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200 mb-1">
                                    Categories ({categories.length})
                                  </span>
                                  {categories.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {categories.slice(0, 3).map((cat) => (
                                        <span key={cat._id || cat.id} className="text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                                          {cat.name}
                                        </span>
                                      ))}
                                      {categories.length > 3 && (
                                        <span className="text-[10px] text-slate-500 self-center">+{categories.length - 3} more</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {(scope === "specific_items" || scope === "specific_dishes") && (
                                <div>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 mb-1">
                                    Dishes ({dishes.length})
                                  </span>
                                  {dishes.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {dishes.slice(0, 3).map((d) => (
                                        <span key={d._id || d.id} className="text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                                          {d.name} {d.price ? `(₹${d.price})` : ""}
                                        </span>
                                      ))}
                                      {dishes.length > 3 && (
                                        <span className="text-[10px] text-slate-500 self-center">+{dishes.length - 3} more</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {!["entire_menu", "category", "specific_categories", "specific_items", "specific_dishes"].includes(scope) && (
                                <span className="text-xs text-slate-400">
                                  {scope ? scope.replace(/_/g, " ") : "Not specified"}
                                </span>
                              )}
                            </td>

                            {/* Validity & Active Days */}
                            <td className="px-4 py-4 whitespace-nowrap text-xs text-slate-600">
                              <div className="flex items-center gap-1 font-medium">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                <span>{item.validFrom ? new Date(item.validFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Now"}</span>
                                <span>→</span>
                                <span>{item.validTill ? new Date(item.validTill).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Ongoing"}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                                {Array.isArray(item.activeDays) && item.activeDays.length > 0 ? (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200" title={item.activeDays.join(", ")}>
                                    {item.activeDays.length === 7 ? "Every Day" : item.activeDays.map(d => d.slice(0, 3)).join(", ")}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                    Every Day
                                  </span>
                                )}
                                {item.activeTimeSlot?.start && item.activeTimeSlot?.end && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                                    {item.activeTimeSlot.start} - {item.activeTimeSlot.end}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Approval Status Badge */}
                            <td className="px-4 py-4 whitespace-nowrap">
                              {approvalStatus === "pending" && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                  <Clock className="w-3.5 h-3.5 animate-pulse" />
                                  <span>Pending Approval</span>
                                </span>
                              )}
                              {approvalStatus === "approved" && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approved & Live</span>
                                </span>
                              )}
                              {approvalStatus === "rejected" && (
                                <div>
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Rejected</span>
                                  </span>
                                  {item.rejectionReason && (
                                    <p className="text-[11px] text-rose-600 font-medium mt-1 max-w-[180px] truncate" title={item.rejectionReason}>
                                      Reason: {item.rejectionReason}
                                    </p>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Action Buttons */}
                            <td className="px-4 py-4 whitespace-nowrap text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDetailsModal({ open: true, offer: item })}
                                  title="View Full Offer Details"
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>

                                {canEdit && approvalStatus === "pending" && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleApproveRestOffer(offerId)}
                                      disabled={isActionLoading}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>{restActionLoading[offerId] === "approve" ? "Approving..." : "Approve"}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenRejectModal(item)}
                                      disabled={isActionLoading}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50 transition-colors"
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                      <span>Reject</span>
                                    </button>
                                  </>
                                )}

                                {canEdit && approvalStatus === "approved" && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenRejectModal(item)}
                                    disabled={isActionLoading}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50/50 text-rose-700 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50 transition-colors"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Revoke</span>
                                  </button>
                                )}

                                {canEdit && approvalStatus === "rejected" && (
                                  <button
                                    type="button"
                                    onClick={() => handleApproveRestOffer(offerId)}
                                    disabled={isActionLoading}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>{restActionLoading[offerId] === "approve" ? "Approving..." : "Re-Approve"}</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleDeleteRestOffer(offerId)}
                                  disabled={isActionLoading}
                                  title="Delete Offer"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <AdminListPagination
                currentPage={restPage}
                pageSize={restPageSize}
                totalItems={restTotal}
                onPageChange={setRestPage}
                onPageSizeChange={(size) => {
                  setRestPageSize(size)
                  setRestPage(1)
                }}
                itemLabel="restaurant offers"
              />
            </div>

            {/* Rejection Reason Modal */}
            {rejectModal.open && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-rose-600">
                      <XCircle className="w-5 h-5" />
                      <h3 className="font-bold text-slate-900 text-base">Reject Restaurant Offer</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRejectModal({ open: false, offer: null, reason: "" })}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleConfirmReject} className="p-6">
                    <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 space-y-1">
                      <p>
                        <span className="font-semibold text-slate-800">Restaurant:</span> {rejectModal.offer?.restaurantName || "Restaurant"}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Offer Title:</span> {rejectModal.offer?.title || rejectModal.offer?.name || "Untitled Offer"}
                      </p>
                    </div>

                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Reason for Rejection (Visible to Restaurant Owner)
                      </label>
                      <textarea
                        rows={3}
                        value={rejectModal.reason}
                        onChange={(e) => setRejectModal((prev) => ({ ...prev, reason: e.target.value }))}
                        placeholder="e.g., Discount percentage is higher than maximum allowed, please adjust to 20% or less..."
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 resize-none"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setRejectModal({ open: false, offer: null, reason: "" })}
                        className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={restActionLoading[rejectModal.offer?.id || rejectModal.offer?._id] === "reject"}
                        className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
                      >
                        {restActionLoading[rejectModal.offer?.id || rejectModal.offer?._id] === "reject" ? "Rejecting..." : "Confirm Rejection"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Offer Full Details Modal */}
            {detailsModal.open && detailsModal.offer && (() => {
              const off = detailsModal.offer
              const offId = off.id || off._id || off.offerId
              const status = off.approvalStatus || (off.status === "pending_approval" ? "pending" : "approved")
              const dishes = Array.isArray(off.items) && off.items.length > 0 ? off.items : (Array.isArray(off.dishes) ? off.dishes : [])
              const categories = Array.isArray(off.categories) ? off.categories : []
              const allWeekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
              const activeDays = Array.isArray(off.activeDays) ? off.activeDays : []
              const isAllDays = activeDays.length === 0 || activeDays.length === 7

              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
                  <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                          <Percent className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 text-base">{off.title || off.name || "Offer Details"}</h3>
                          <p className="text-xs text-slate-500">
                            {off.restaurantName || "Restaurant"} &bull; ID: {String(off.restaurantId?._id || off.restaurantId || "").slice(-6)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetailsModal({ open: false, offer: null })}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Content Scrollable */}
                    <div className="p-6 overflow-y-auto space-y-5 text-sm">
                      {/* Top Badges */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-extrabold text-xs">
                          {off.discountType === "flat" ? `₹${off.discountValue} FLAT OFF` : `${off.discountValue}% OFF`}
                        </span>

                        {status === "pending" && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                            <Clock className="w-3.5 h-3.5 animate-pulse" />
                            Pending Approval
                          </span>
                        )}
                        {status === "approved" && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approved & Live
                          </span>
                        )}
                        {status === "rejected" && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
                            <XCircle className="w-3.5 h-3.5" />
                            Rejected
                          </span>
                        )}

                        {off.isActive === false && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">Paused</span>
                        )}
                      </div>

                      {/* Description */}
                      {off.description && (
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-700">
                          <p className="font-semibold text-slate-900 mb-0.5">Description:</p>
                          <p>{off.description}</p>
                        </div>
                      )}

                      {/* Rejection Reason if any */}
                      {off.rejectionReason && (
                        <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-800">
                          <p className="font-semibold text-rose-900 mb-0.5 flex items-center gap-1">
                            <XCircle className="w-4 h-4 text-rose-600" /> Rejection Reason:
                          </p>
                          <p>{off.rejectionReason}</p>
                        </div>
                      )}

                      {/* Grid of Key Info */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="text-slate-500 font-medium">Minimum Order Value</span>
                          <p className="text-sm font-bold text-slate-900">
                            {Number(off.minOrderValue) > 0 ? `₹${off.minOrderValue}` : "No minimum required"}
                          </p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="text-slate-500 font-medium">Max Discount Capped</span>
                          <p className="text-sm font-bold text-slate-900">
                            {Number(off.maxDiscountAmount) > 0 ? `₹${off.maxDiscountAmount}` : "No maximum cap"}
                          </p>
                        </div>
                      </div>

                      {/* Selected Days (Issue 98 requirement) */}
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-indigo-600" />
                            Selected Active Days
                          </span>
                          <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            {isAllDays ? "Active Every Day" : `${activeDays.length} Days Selected`}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {allWeekDays.map((day) => {
                            const isSelected = isAllDays || activeDays.includes(day)
                            return (
                              <span
                                key={day}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                  isSelected
                                    ? "bg-indigo-600 text-white shadow-xs"
                                    : "bg-slate-200/60 text-slate-400 line-through"
                                }`}
                              >
                                {day}
                              </span>
                            )
                          })}
                        </div>
                      </div>

                      {/* Operating Time Slot & Validity */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-amber-600" /> Active Hours / Time Slot
                          </span>
                          <p className="text-sm font-bold text-slate-900">
                            {off.activeTimeSlot?.start && off.activeTimeSlot?.end
                              ? `${off.activeTimeSlot.start} – ${off.activeTimeSlot.end}`
                              : "All Day (24 Hours)"}
                          </p>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" /> Validity Period
                          </span>
                          <p className="text-sm font-bold text-slate-900">
                            {off.validFrom ? new Date(off.validFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Now"}
                            {" → "}
                            {off.validTill ? new Date(off.validTill).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Ongoing"}
                          </p>
                        </div>
                      </div>

                      {/* Applied Scope & Items/Categories */}
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80">
                        <span className="text-xs font-bold text-slate-800 block mb-2">
                          Applicable Items / Scope:{" "}
                          <span className="text-emerald-700 font-extrabold capitalize">
                            {(off.applicableTo || off.appliesTo || "").replace(/_/g, " ")}
                          </span>
                        </span>

                        {(off.applicableTo === "entire_menu" || off.appliesTo === "entire_menu") && (
                          <p className="text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200">
                            This offer applies to all dishes on the restaurant's active menu.
                          </p>
                        )}

                        {(off.applicableTo === "category" || off.applicableTo === "specific_categories" || off.appliesTo === "category") && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1.5">Categories covered ({categories.length}):</p>
                            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-white rounded-lg border border-slate-200">
                              {categories.length > 0 ? (
                                categories.map((cat, idx) => (
                                  <span key={cat._id || cat.id || idx} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-md font-medium">
                                    {cat.name}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-400 italic">No category names resolved</span>
                              )}
                            </div>
                          </div>
                        )}

                        {(off.applicableTo === "specific_items" || off.applicableTo === "specific_dishes" || off.appliesTo === "specific_items") && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1.5">Dishes covered ({dishes.length}):</p>
                            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 bg-white rounded-lg border border-slate-200">
                              {dishes.length > 0 ? (
                                dishes.map((dish, idx) => (
                                  <span key={dish._id || dish.id || idx} className="text-xs bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5">
                                    <Utensils className="w-3 h-3 text-amber-600" />
                                    <span>{dish.name}</span>
                                    {dish.price !== undefined && (
                                      <span className="font-bold text-amber-700">(₹{dish.price})</span>
                                    )}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-400 italic">No specific dishes attached</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                      <button
                        type="button"
                        onClick={() => setDetailsModal({ open: false, offer: null })}
                        className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        Close
                      </button>

                      <div className="flex items-center gap-2">
                        {canEdit && status === "pending" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                handleApproveRestOffer(offId)
                                setDetailsModal({ open: false, offer: null })
                              }}
                              disabled={!!restActionLoading[offId]}
                              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{restActionLoading[offId] === "approve" ? "Approving..." : "Approve Offer"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDetailsModal({ open: false, offer: null })
                                handleOpenRejectModal(off)
                              }}
                              disabled={!!restActionLoading[offId]}
                              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject Offer</span>
                            </button>
                          </>
                        )}

                        {canEdit && status === "approved" && (
                          <button
                            type="button"
                            onClick={() => {
                              setDetailsModal({ open: false, offer: null })
                              handleOpenRejectModal(off)
                            }}
                            disabled={!!restActionLoading[offId]}
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50 transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Revoke Approval</span>
                          </button>
                        )}

                        {canEdit && status === "rejected" && (
                          <button
                            type="button"
                            onClick={() => {
                              handleApproveRestOffer(offId)
                              setDetailsModal({ open: false, offer: null })
                            }}
                            disabled={!!restActionLoading[offId]}
                            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{restActionLoading[offId] === "approve" ? "Approving..." : "Re-Approve Offer"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

