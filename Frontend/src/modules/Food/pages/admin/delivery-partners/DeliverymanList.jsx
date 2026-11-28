import React, { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { Search, Download, ChevronDown, Eye, User, Star, ArrowUpDown, Settings, FileText, FileSpreadsheet, Loader2, Check, Columns, ExternalLink, Calendar, MapPin, CreditCard, Mail, Phone, Bike, FileCheck, Pencil, Save, Trash2, X } from "lucide-react"
import { adminAPI } from "@food/api"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { exportDeliverymenToExcel, exportDeliverymenToPDF } from "@food/components/admin/deliveryman/deliverymanExportUtils"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"
const debugError = () => {}


const formatCurrency = (amount) => {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount)) return "\u20B90.00"
  return `\u20B9${numericAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** URL query key holding the selected zone, so a filtered view survives refresh and can be shared. */
const ZONE_QUERY_PARAM = "zone"

const getZoneLabel = (zone) => zone?.name || zone?.zoneName || zone?.serviceLocation || "Unnamed zone"

/** Active zones first, then alphabetical. */
const sortZones = (zones) =>
  [...zones].sort((a, b) => {
    const activeDiff = Number(b?.isActive !== false) - Number(a?.isActive !== false)
    return activeDiff || getZoneLabel(a).localeCompare(getZoneLabel(b))
  })

const withWalletSummary = (partner, wallet) => ({
  ...partner,
  walletSummary: wallet || null,
  pocketBalance: wallet?.pocketBalance || 0,
  cashInHand: wallet?.cashInHand || 0,
  remainingCashLimit: wallet?.remainingCashLimit || 0,
  totalEarning: wallet?.totalEarning || 0,
  bonus: wallet?.bonus || 0,
  totalWithdrawn: wallet?.totalWithdrawn || 0,
  availableCashLimit: wallet?.availableCashLimit || 0,
})

/**
 * One page of the list. Partners and their wallet figures come from two
 * endpoints that filter (search + zone), order and page identically on the
 * backend, so rows pair up by id. Wallet figures are optional: if they fail
 * the partners still list, with zero balances.
 */
const loadDeliverymenPage = async (query) => {
  const [partnersResult, walletsResult] = await Promise.allSettled([
    adminAPI.getDeliveryPartners(query),
    adminAPI.getDeliveryBoyWallets(query),
  ])
  if (partnersResult.status !== "fulfilled" || !partnersResult.value?.data?.success) {
    throw partnersResult.reason || new Error("Failed to fetch delivery partners")
  }
  const { deliveryPartners = [], pagination = {} } = partnersResult.value.data.data || {}
  if (walletsResult.status === "rejected") debugError("Error fetching wallet rows:", walletsResult.reason)
  const walletRows =
    walletsResult.status === "fulfilled" && walletsResult.value?.data?.success
      ? walletsResult.value.data.data?.wallets || []
      : []
  const walletMap = new Map(walletRows.map((wallet) => [String(wallet.deliveryId), wallet]))

  return {
    total: pagination.total ?? deliveryPartners.length,
    rows: deliveryPartners.map((partner) => withWalletSummary(partner, walletMap.get(String(partner._id)))),
  }
}

const describeLoadError = (err) => {
  if (err?.code === "ERR_NETWORK") return "Network error. Please check if backend server is running."
  if (err?.response?.status === 401) return "Unauthorized. Please login again."
  if (err?.response?.status === 403) return "Access denied. You don't have permission to view this."
  return err?.response?.data?.message || err?.message || "Failed to fetch delivery partners. Please try again."
}

export default function DeliverymanList() {
  const { canEdit, canDelete } = useAdminPermissions()
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [deliverymen, setDeliverymen] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_deliverymen_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalDeliverymen, setTotalDeliverymen] = useState(0)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [viewDetails, setViewDetails] = useState(null)
  const [editingDeliveryId, setEditingDeliveryId] = useState(null)
  const [editValues, setEditValues] = useState({ pocketBalance: "", cashInHand: "" })
  const [savingDeliveryId, setSavingDeliveryId] = useState(null)
  const [deletingDeliveryId, setDeletingDeliveryId] = useState(null)
  // Partners deleted in this session. A list request already in flight when the delete
  // lands (the 8s refresh) must not put the row back.
  const deletedIdsRef = useRef(new Set())
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" })
  const [visibleColumns, setVisibleColumns] = useState({
    si: true,
    name: true,
    rating: true,
    contact: true,
    zone: true,
    totalOrders: true,
    pocketBalance: true,
    cashInHand: true,
    remainingCashLimit: true,
    availabilityStatus: true,
    actions: true,
  })

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedZoneId = searchParams.get(ZONE_QUERY_PARAM) || ""
  const [zones, setZones] = useState([])
  const [zonesStatus, setZonesStatus] = useState("loading") // loading | ready | error

  const loadZones = useCallback(async () => {
    setZonesStatus("loading")
    try {
      const response = await adminAPI.getZones({ limit: 1000 })
      const list = response?.data?.data?.zones
      if (!response?.data?.success || !Array.isArray(list)) throw new Error("Invalid zones response")
      setZones(sortZones(list))
      setZonesStatus("ready")
    } catch (err) {
      debugError("Error fetching zones:", err)
      setZonesStatus("error")
    }
  }, [])

  useEffect(() => {
    loadZones()
  }, [loadZones])

  const selectZone = useCallback((zoneId) => {
    setCurrentPage(1)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (zoneId) next.set(ZONE_QUERY_PARAM, zoneId)
      else next.delete(ZONE_QUERY_PARAM)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const selectedZone = useMemo(
    () => zones.find((zone) => String(zone._id) === selectedZoneId) || null,
    [zones, selectedZoneId],
  )

  // A zone in the URL that no longer exists (deleted, or a stale link) is dropped.
  useEffect(() => {
    if (zonesStatus === "ready" && selectedZoneId && !selectedZone) selectZone("")
  }, [zonesStatus, selectedZoneId, selectedZone, selectZone])

  const listQuery = useMemo(() => ({
    page: currentPage,
    limit: pageSize,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(selectedZoneId ? { zoneId: selectedZoneId } : {}),
  }), [currentPage, pageSize, debouncedSearch, selectedZoneId])
  const listQueryKey = JSON.stringify(listQuery)

  // The query the screen currently shows. Switching zone/page/search quickly can
  // leave an older request in flight; its answer must not replace the new one.
  const latestQueryKeyRef = useRef(listQueryKey)

  const fetchDeliverymen = useCallback(async (query, { quiet = false } = {}) => {
    const key = JSON.stringify(query)
    if (!quiet) {
      setLoading(true)
      setError(null)
    }
    try {
      const { rows, total } = await loadDeliverymenPage(query)
      if (key !== latestQueryKeyRef.current) return
      setDeliverymen(rows.filter((row) => !deletedIdsRef.current.has(String(row._id))))
      setTotalDeliverymen(total)
    } catch (err) {
      debugError("Error fetching delivery partners:", err)
      if (quiet || key !== latestQueryKeyRef.current) return
      setError(describeLoadError(err))
      setDeliverymen([])
    } finally {
      if (!quiet && key === latestQueryKeyRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch])

  // Load on page / search / zone change, and keep the figures fresh while open.
  useEffect(() => {
    latestQueryKeyRef.current = listQueryKey
    fetchDeliverymen(listQuery)

    const interval = setInterval(() => {
      fetchDeliverymen(listQuery, { quiet: true })
    }, 8000)

    return () => {
      clearInterval(interval)
    }
  }, [listQueryKey])

  const filteredDeliverymen = useMemo(() => {
    // Backend already handles search; apply client-side sorting on top.
    const result = [...deliverymen]

    if (sortConfig.key) {
      const dir = sortConfig.direction === "asc" ? 1 : -1
      result.sort((a, b) => {
        let aValue
        let bValue
        switch (sortConfig.key) {
          case "name":
            aValue = String(a.name || "").toLowerCase()
            bValue = String(b.name || "").toLowerCase()
            break
          case "rating":
            aValue = Number(a.rating || 0)
            bValue = Number(b.rating || 0)
            break
          case "contact":
            aValue = String(a.email || "").toLowerCase()
            bValue = String(b.email || "").toLowerCase()
            break
          case "zone":
            aValue = String(a.zone || "").toLowerCase()
            bValue = String(b.zone || "").toLowerCase()
            break
          case "totalOrders":
            aValue = Number(a.totalOrders || 0)
            bValue = Number(b.totalOrders || 0)
            break
          case "pocketBalance":
            aValue = Number(a.pocketBalance || 0)
            bValue = Number(b.pocketBalance || 0)
            break
          case "cashInHand":
            aValue = Number(a.cashInHand || 0)
            bValue = Number(b.cashInHand || 0)
            break
          case "remainingCashLimit":
            aValue = Number(a.remainingCashLimit || 0)
            bValue = Number(b.remainingCashLimit || 0)
            break
          default:
            return 0
        }
        if (aValue < bValue) return -1 * dir
        if (aValue > bValue) return 1 * dir
        return 0
      })
    }

    return result
  }, [deliverymen, sortConfig])

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }))
  }

  const handleView = async (deliveryman) => {
    try {
      setLoading(true)
      const response = await adminAPI.getDeliveryPartnerById(deliveryman._id)
      
      if (response.data && response.data.success) {
        setViewDetails({
          ...response.data.data.delivery,
          walletSummary: deliveryman.walletSummary || null,
pocketBalance: deliveryman.pocketBalance || 0,
cashInHand: deliveryman.cashInHand || 0,
remainingCashLimit: deliveryman.remainingCashLimit || 0,
totalEarning: deliveryman.totalEarning || 0,
bonus: deliveryman.bonus || 0,
totalWithdrawn: deliveryman.totalWithdrawn || 0,
availableCashLimit: deliveryman.availableCashLimit || 0,
        })
        setIsViewOpen(true)
      } else {
        alert("Failed to load details")
      }
    } catch (err) {
      debugError("Error fetching details:", err)
      alert(err.response?.data?.message || "Failed to load details")
    } finally {
      setLoading(false)
    }
  }

  const handleExportPDF = () => {
    if (filteredDeliverymen.length === 0) {
      alert("No data to export")
      return
    }
    exportDeliverymenToPDF(filteredDeliverymen)
  }

  const handleExportExcel = () => {
    if (filteredDeliverymen.length === 0) {
      alert("No data to export")
      return
    }
    exportDeliverymenToExcel(filteredDeliverymen)
  }

  const toggleColumn = (columnKey) => {
    setVisibleColumns(prev => ({ ...prev, [columnKey]: !prev[columnKey] }))
  }

  const resetColumns = () => {
    setVisibleColumns({
      si: true,
      name: true,
      rating: true,
      contact: true,
      zone: true,
      totalOrders: true,
      pocketBalance: true,
      cashInHand: true,
      remainingCashLimit: true,
      availabilityStatus: true,
      actions: true,
    })
  }

  const columnsConfig = {
    si: "Serial Number",
    name: "Name",
    rating: "Rating",
    contact: "Contact",
    zone: "Zone",
    totalOrders: "Total Orders",
    pocketBalance: "Pocket Balance",
    cashInHand: "Cash In Hand",
    remainingCashLimit: "Remaining Cash Limit",
    availabilityStatus: "Availability Status",
    actions: "Actions",
  }

  const startEditingWallet = (deliveryman) => {
    setEditingDeliveryId(String(deliveryman._id))
    setEditValues({
      pocketBalance: String(Number(deliveryman.pocketBalance) || 0),
      cashInHand: String(Number(deliveryman.cashInHand) || 0),
    })
  }

  const cancelEditingWallet = () => {
    setEditingDeliveryId(null)
    setEditValues({ pocketBalance: "", cashInHand: "" })
  }

  const updateWalletFieldValue = (field, value) => {
    setEditValues((prev) => ({ ...prev, [field]: value }))
  }

  const saveWalletChanges = async (deliveryman) => {
    const nextPocketBalance = Number(editValues.pocketBalance)
    const nextCashInHand = Number(editValues.cashInHand)

    if (!Number.isFinite(nextPocketBalance) || nextPocketBalance < 0) {
      toast.error("Pocket balance must be a valid non-negative number")
      return
    }

    if (!Number.isFinite(nextCashInHand) || nextCashInHand < 0) {
      toast.error("Cash in hand must be a valid non-negative number")
      return
    }

    try {
      setSavingDeliveryId(String(deliveryman._id))
      const response = await adminAPI.updateDeliveryBoyWallet({
        walletId: deliveryman.walletSummary?.walletId,
        deliveryId: deliveryman._id,
        pocketBalance: nextPocketBalance,
        cashInHand: nextCashInHand,
      })

      if (!response?.data?.success) {
        toast.error(response?.data?.message || "Failed to update wallet")
        return
      }

      const updatedWallet = response.data.data || {}
      setDeliverymen((prev) =>
        prev.map((item) =>
          String(item._id) === String(deliveryman._id)
            ? {
                ...item,
                pocketBalance: updatedWallet.pocketBalance ?? nextPocketBalance,
                cashInHand: updatedWallet.cashInHand ?? nextCashInHand,
                remainingCashLimit: updatedWallet.remainingCashLimit ?? item.remainingCashLimit,
                availableCashLimit: updatedWallet.availableCashLimit ?? item.availableCashLimit,
                walletSummary: {
                  ...(item.walletSummary || {}),
                  walletId: updatedWallet.walletId || item.walletSummary?.walletId,
                  pocketBalance: updatedWallet.pocketBalance ?? nextPocketBalance,
                  cashCollected: updatedWallet.cashInHand ?? nextCashInHand,
                  remainingCashLimit: updatedWallet.remainingCashLimit ?? item.remainingCashLimit,
                  availableCashLimit: updatedWallet.availableCashLimit ?? item.availableCashLimit,
                },
              }
            : item,
        ),
      )

      setViewDetails((prev) => {
        if (!prev || String(prev._id) !== String(deliveryman._id)) {
          return prev
        }

        return {
          ...prev,
          pocketBalance: updatedWallet.pocketBalance ?? nextPocketBalance,
          cashInHand: updatedWallet.cashInHand ?? nextCashInHand,
          remainingCashLimit: updatedWallet.remainingCashLimit ?? prev.remainingCashLimit,
          availableCashLimit: updatedWallet.availableCashLimit ?? prev.availableCashLimit,
          walletSummary: {
            ...(prev.walletSummary || {}),
            walletId: updatedWallet.walletId || prev.walletSummary?.walletId,
            pocketBalance: updatedWallet.pocketBalance ?? nextPocketBalance,
            cashCollected: updatedWallet.cashInHand ?? nextCashInHand,
            remainingCashLimit: updatedWallet.remainingCashLimit ?? prev.remainingCashLimit,
            availableCashLimit: updatedWallet.availableCashLimit ?? prev.availableCashLimit,
          },
        }
      })

      toast.success("Wallet updated")
      cancelEditingWallet()
    } catch (err) {
      debugError("Error updating delivery wallet:", err)
      toast.error(err.response?.data?.message || "Failed to update wallet")
    } finally {
      setSavingDeliveryId(null)
    }
  }

  const handleDelete = async (deliveryman) => {
    const deliverymanId = String(deliveryman?._id || "")
    if (!deliverymanId) {
      toast.error("Delivery partner not found")
      return
    }

    const name = deliveryman?.name || "this delivery partner"
    const pocketBalance = Number(deliveryman?.pocketBalance) || 0
    const confirmed = window.confirm(
      `Permanently delete ${name}?\n\n` +
        "Their account, wallet, documents and login are removed from the database and cannot be restored. " +
        "Orders and payment history stay for your records." +
        (pocketBalance > 0
          ? `\n\nUnpaid pocket balance of ${formatCurrency(pocketBalance)} will no longer be payable to them.`
          : ""),
    )
    if (!confirmed) return

    setDeletingDeliveryId(deliverymanId)
    try {
      let response
      try {
        response = await adminAPI.deleteDeliveryPartner(deliverymanId)
      } catch (err) {
        // The rider still holds COD cash: the server names the exact amount, and only an
        // explicit write-off of that amount lets the delete through.
        const body = err?.response?.data
        if (err?.response?.status !== 409 || body?.code !== "CASH_IN_HAND_WRITE_OFF_REQUIRED") throw err
        const cashInHand = Number(body?.data?.cashInHand)
        const writeOff = window.confirm(
          `${body.message}\n\nDelete anyway and write off ${formatCurrency(cashInHand)}?`,
        )
        if (!writeOff) return
        response = await adminAPI.deleteDeliveryPartner(deliverymanId, { writeOffCashInHand: cashInHand })
      }

      if (!response?.data?.success) {
        toast.error(response?.data?.message || "Failed to delete delivery partner")
        return
      }

      const wasViewingDeletedPartner = Boolean(viewDetails && String(viewDetails._id) === deliverymanId)
      deletedIdsRef.current.add(deliverymanId)
      setDeliverymen((prev) => prev.filter((item) => String(item._id) !== deliverymanId))
      setTotalDeliverymen((prev) => Math.max(0, prev - 1))
      setViewDetails((prev) => (prev && String(prev._id) === deliverymanId ? null : prev))
      if (wasViewingDeletedPartner) setIsViewOpen(false)
      toast.success(response.data.message || "Delivery partner deleted")

      // Refill the page from the server; step back when this was the page's last row.
      if (deliverymen.length === 1 && currentPage > 1) setCurrentPage((page) => page - 1)
      else fetchDeliverymen(listQuery, { quiet: true })
    } catch (err) {
      debugError("Error deleting delivery partner:", err)
      toast.error(err?.response?.data?.message || "Failed to delete delivery partner")
    } finally {
      setDeletingDeliveryId(null)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-slate-600" />
              <h1 className="text-2xl font-bold text-slate-900">Deliveryman List</h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={`px-4 py-2.5 text-sm font-medium rounded-lg border flex items-center gap-2 transition-all whitespace-nowrap ${
                      selectedZone
                        ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                        : "border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                    }`}
                    title="Show delivery partners of one zone"
                  >
                    <MapPin className="w-4 h-4" />
                    <span className="font-bold max-w-40 truncate">
                      {selectedZone ? getZoneLabel(selectedZone) : "All Zones"}
                    </span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
                  <DropdownMenuLabel>Filter by zone</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => selectZone("")} className="cursor-pointer justify-between">
                    <span>All Zones</span>
                    {!selectedZoneId && <Check className="w-4 h-4 text-blue-600" />}
                  </DropdownMenuItem>
                  {zonesStatus === "loading" && (
                    <DropdownMenuItem disabled>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading zones...
                    </DropdownMenuItem>
                  )}
                  {zonesStatus === "error" && (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault()
                        loadZones()
                      }}
                      className="cursor-pointer text-red-600"
                    >
                      Couldn't load zones. Tap to retry
                    </DropdownMenuItem>
                  )}
                  {zonesStatus === "ready" && zones.length === 0 && (
                    <DropdownMenuItem disabled>No zones created yet</DropdownMenuItem>
                  )}
                  {zones.map((zone) => {
                    const zoneId = String(zone._id)
                    return (
                      <DropdownMenuItem
                        key={zoneId}
                        onSelect={() => selectZone(zoneId)}
                        className="cursor-pointer justify-between gap-2"
                      >
                        <span className="truncate">{getZoneLabel(zone)}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {zone.isActive === false && (
                            <span className="text-[10px] font-semibold uppercase text-slate-400">Inactive</span>
                          )}
                          {zoneId === selectedZoneId && <Check className="w-4 h-4 text-blue-600" />}
                        </span>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative flex-1 sm:flex-initial min-w-[250px]">
                <input
                  type="text"
                  placeholder="Search by name or restaur..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>

              <button
                onClick={handleExportPDF}
                className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all"
                title="Export as PDF"
              >
                <FileText className="w-4 h-4" />
                <span className="text-black font-bold">PDF</span>
              </button>
              <button
                onClick={handleExportExcel}
                className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all"
                title="Export as Excel"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span className="text-black font-bold">Excel</span>
              </button>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-all"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Deliveryman</span>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700 flex items-center justify-center min-w-[2.5rem] h-7">
                {loading ? (
                  <span className="w-5 h-3 rounded bg-slate-300/80 animate-pulse" />
                ) : (
                  totalDeliverymen
                )}
              </span>
              {selectedZone && (
                <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <MapPin className="w-3.5 h-3.5" />
                  in {getZoneLabel(selectedZone)}
                  <button
                    type="button"
                    onClick={() => selectZone("")}
                    className="p-0.5 rounded-full hover:bg-blue-100"
                    title="Show all zones"
                    aria-label="Clear zone filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
              <button
                onClick={() => fetchDeliverymen(listQuery)}
                className="mt-2 text-sm text-red-600 underline hover:text-red-800"
              >
                Retry
              </button>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-3 text-sm text-slate-600">Loading delivery partners...</span>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {visibleColumns.si && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>SI</span>
                        </div>
                      </th>
                    )}
                    {visibleColumns.name && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Name</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'name' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.rating && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('rating')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Rating</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'rating' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.contact && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('contact')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Contact</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'contact' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.zone && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('zone')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Zone</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'zone' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.totalOrders && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('totalOrders')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Total Orders</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'totalOrders' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.pocketBalance && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('pocketBalance')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Pocket Balance</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'pocketBalance' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.cashInHand && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('cashInHand')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Cash In Hand</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'cashInHand' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.remainingCashLimit && (
                      <th
                        className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => handleSort('remainingCashLimit')}
                      >
                        <div className="flex items-center gap-2">
                          <span>Remaining Cash Limit</span>
                          <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === 'remainingCashLimit' ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                      </th>
                    )}
                    {visibleColumns.availabilityStatus && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>Availability Status</span>
                        </div>
                      </th>
                    )}
                    {visibleColumns.actions && (
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredDeliverymen.length === 0 ? (
                    <tr>
                      <td colSpan={Object.values(visibleColumns).filter(v => v).length} className="px-6 py-8 text-center text-slate-500">
                        {error
                          ? "Error loading delivery partners"
                          : selectedZone
                            ? `No delivery partners found in ${getZoneLabel(selectedZone)}`
                            : "No delivery partners found"}
                      </td>
                    </tr>
                  ) : (
                    filteredDeliverymen.map((dm, index) => (
                      <tr key={dm._id} className="hover:bg-slate-50 transition-colors">
                        {visibleColumns.si && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-slate-700">{(currentPage - 1) * pageSize + index + 1}</span>
                          </td>
                        )}
                        {visibleColumns.name && (
                          <td className="px-6 py-4 whitespace-nowrap align-middle">
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:opacity-80 transition-all border border-slate-200"
                                style={{ background: 'linear-gradient(135deg, #E8EEF7 0%, #C5D3E5 100%)' }}
                                onClick={() => handleView(dm)}
                              >
                                <img
                                  src={dm.profileImage?.url ?? dm.profilePhoto ?? "/assets/images/profile_avatar.webp"}
                                  alt={dm.name}
                                  className="w-full h-full object-cover"
                                  style={{ mixBlendMode: 'multiply' }}
                                  onError={(e) => { e.currentTarget.src = "/assets/images/profile_avatar.webp" }}
                                />
                              </div>
                              <span
                                className="text-sm font-medium text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
                                onClick={() => handleView(dm)}
                              >
                                {dm.name}
                              </span>
                            </div>
                          </td>
                        )}
                        {visibleColumns.rating && (
                          <td className="px-6 py-4 whitespace-nowrap align-middle">
                            <div
                              className="inline-flex items-center justify-center gap-1.5 min-w-[60px] px-2.5 py-1 rounded-lg border"
                              style={dm.rating > 0
                                ? { backgroundColor: '#fffbeb', borderColor: '#fde68a' }
                                : { backgroundColor: 'transparent', borderColor: 'transparent' }}
                            >
                              {dm.rating > 0 ? (
                                <>
                                  <span className="text-sm font-bold text-amber-700 leading-none">{Number(dm.rating).toFixed(1)}</span>
                                  <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                                </>
                              ) : (
                                <span className="text-sm text-slate-400 leading-none">N/A</span>
                              )}
                            </div>
                          </td>
                        )}
                        {visibleColumns.contact && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-sm text-slate-700">{dm.email}</span>
                              <span className="text-xs text-slate-500">{dm.phone}</span>
                            </div>
                          </td>
                        )}
                        {visibleColumns.zone && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">{dm.zone}</span>
                          </td>
                        )}
                        {visibleColumns.totalOrders && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">{dm.totalOrders || 0}</span>
                          </td>
                        )}
                        {visibleColumns.pocketBalance && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            {editingDeliveryId === String(dm._id) ? (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editValues.pocketBalance}
                                onChange={(e) => updateWalletFieldValue("pocketBalance", e.target.value)}
                                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                              />
                            ) : (
                              <span className="text-sm text-slate-700">{formatCurrency(dm.pocketBalance)}</span>
                            )}
                          </td>
                        )}
                        {visibleColumns.cashInHand && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            {editingDeliveryId === String(dm._id) ? (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editValues.cashInHand}
                                onChange={(e) => updateWalletFieldValue("cashInHand", e.target.value)}
                                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                              />
                            ) : (
                              <span className="text-sm text-slate-700">{formatCurrency(dm.cashInHand)}</span>
                            )}
                          </td>
                        )}
                        {visibleColumns.remainingCashLimit && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">{formatCurrency(dm.remainingCashLimit)}</span>
                          </td>
                        )}
                        {visibleColumns.availabilityStatus && (
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-xs">
                                Active Status: <span className={`${dm.status === 'Online' ? 'text-blue-600' : 'text-slate-600'} underline`}>{dm.status}</span>
                              </span>
                            </div>
                          </td>
                        )}
                        {visibleColumns.actions && (
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              {editingDeliveryId === String(dm._id) ? (
                                <>
                                  <button
                                    onClick={() => saveWalletChanges(dm)}
                                    disabled={savingDeliveryId === String(dm._id)}
                                    className="p-1.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                                    title="Save Wallet"
                                  >
                                    {savingDeliveryId === String(dm._id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                  </button>
                                  <button
                                    onClick={cancelEditingWallet}
                                    disabled={savingDeliveryId === String(dm._id)}
                                    className="p-1.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
                                    title="Cancel"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </>
                              ) : canEdit ? (
                                <button
                                  onClick={() => startEditingWallet(dm)}
                                  className="p-1.5 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                                  title="Edit Wallet"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              ) : null}
                              <button 
                                onClick={() => handleView(dm)}
                                className="p-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors" 
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {canDelete && (
                                <button
                                  onClick={() => handleDelete(dm)}
                                  disabled={Boolean(deletingDeliveryId)}
                                  className="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                                  title="Delete Delivery Partner"
                                >
                                  {deletingDeliveryId === String(dm._id) ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
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
            totalItems={totalDeliverymen}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_deliverymen_pageSize", String(size))
              } catch {
                /* ignore */
              }
            }}
            itemLabel="delivery partners"
            className="mt-4"
          />
        </div>
      </div>

      {/* View Details Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-3xl bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100 max-h-[85vh] overflow-y-auto">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="text-xl font-bold text-slate-900">Delivery Partner Details</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            {viewDetails ? (
              <div className="space-y-6 mt-4">
                {/* Profile Image & Basic Info */}
                <div className="flex items-start gap-6 pb-6 border-b border-slate-200">
                  <div className="flex-shrink-0">
                    {viewDetails.profileImage?.url ? (
                      <img 
                        src={viewDetails.profileImage.url} 
                        alt={viewDetails.name}
                        className="w-24 h-24 rounded-full object-cover border-2 border-slate-200"
                        onError={(e) => { e.currentTarget.src = "/assets/images/profile_avatar.webp" }}
                      />
                    ) : (
                      <img
                        src="/assets/images/profile_avatar.webp"
                        alt={viewDetails.name}
                        className="w-24 h-24 rounded-full object-cover border-2 border-slate-200"
                      />
                    )}
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <User className="w-3 h-3" /> Name
                      </label>
                      <p className="text-sm font-medium text-slate-900 mt-1">{viewDetails.name || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <Mail className="w-3 h-3" /> Email
                      </label>
                      <p className="text-sm text-slate-900 mt-1">{viewDetails.email || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <Phone className="w-3 h-3" /> Phone
                      </label>
                      <p className="text-sm text-slate-900 mt-1">{viewDetails.phone || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Delivery ID</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">{viewDetails.deliveryId || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-1 ${
                        viewDetails.status === 'pending' ? 'bg-blue-100 text-blue-700' :
                        viewDetails.status === 'approved' || viewDetails.status === 'active' ? 'bg-green-100 text-green-700' :
                        viewDetails.status === 'blocked' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {viewDetails.status === 'blocked' ? 'Rejected' : (viewDetails.status?.charAt(0).toUpperCase() + viewDetails.status?.slice(1) || "N/A")}
                      </span>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Zone
                      </label>
                      <div className="flex items-center gap-2 mt-1">
                        <select
                          value={viewDetails.zoneId || ""}
                          onChange={async (e) => {
                            const newZoneId = e.target.value;
                            const partnerId = viewDetails._id;
                            try {
                              const res = await adminAPI.updateDeliveryPartner(partnerId, { zoneId: newZoneId || null });
                              if (res?.data?.success) {
                                toast.success("Zone updated successfully");
                                const updatedData = res.data.data?.delivery || res.data.data?.partner || res.data.data || {};
                                setViewDetails((prev) => ({
                                  ...prev,
                                  zoneId: newZoneId || null,
                                  zoneName: updatedData.zoneName || updatedData.zone || "",
                                  zone: updatedData.zone || updatedData.zoneName || "",
                                }));
                                setDeliverymen((prev) =>
                                  prev.map((item) =>
                                    String(item._id) === String(partnerId)
                                      ? {
                                          ...item,
                                          zoneId: newZoneId || null,
                                          zoneName: updatedData.zoneName || updatedData.zone || "",
                                          zone: updatedData.zone || updatedData.zoneName || "",
                                        }
                                      : item,
                                  ),
                                );
                                fetchDeliverymen(listQuery, { quiet: true });
                              }
                            } catch (err) {
                              toast.error(err?.response?.data?.message || "Failed to update zone");
                            }
                          }}
                          className="w-full text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                        >
                          <option value="">No Zone Assigned</option>
                          {zones.map((z) => (
                            <option key={String(z._id)} value={String(z._id)}>
                              {getZoneLabel(z)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {viewDetails.rejectionReason && (
                      <div className="col-span-2">
                        <label className="text-xs font-semibold text-slate-500 uppercase text-red-600">Rejection Reason</label>
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-1">
                          <p className="text-sm text-red-700 whitespace-pre-wrap">{viewDetails.rejectionReason}</p>
                        </div>
                      </div>
                    )}
                    {viewDetails.dateOfBirth && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Date of Birth
                        </label>
                        <p className="text-sm text-slate-900 mt-1">
                          {new Date(viewDetails.dateOfBirth).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    )}
                    {viewDetails.gender && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase">Gender</label>
                        <p className="text-sm text-slate-900 mt-1 capitalize">{viewDetails.gender || "N/A"}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Location Details */}
                {viewDetails.location && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <MapPin className="w-4 h-4" /> Location Details
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {viewDetails.location.addressLine1 && (
                        <div className="col-span-2">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Address Line 1</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.addressLine1}</p>
                        </div>
                      )}
                      {viewDetails.location.addressLine2 && (
                        <div className="col-span-2">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Address Line 2</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.addressLine2}</p>
                        </div>
                      )}
                      {viewDetails.location.area && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Area</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.area}</p>
                        </div>
                      )}
                      {viewDetails.location.city && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">City</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.city}</p>
                        </div>
                      )}
                      {viewDetails.location.state && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">State</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.state}</p>
                        </div>
                      )}
                      {viewDetails.location.zipCode && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Zip Code</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.zipCode}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Vehicle Details */}
                {viewDetails.vehicle && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <Bike className="w-4 h-4" /> Vehicle Details
                    </h3>
                    <div className="grid grid-cols-4 gap-4">
                      {viewDetails.vehicle.brand && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Brand</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.vehicle.brand}</p>
                        </div>
                      )}
                      {viewDetails.vehicle.model && (
                        <div className="text-right col-span-1">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Model</label>
                          <p className="text-xs text-slate-900 mt-1">{viewDetails.vehicle.model}</p>
                        </div>
                      )}
                      {viewDetails.vehicle.number && (
                        <div className="col-span-2">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Vehicle Number</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.vehicle.number}</p>
                        </div>
                      )}
                      {viewDetails.vehicle.type && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Vehicle Type</label>
                          <p className="text-sm text-slate-900 mt-1 capitalize">{viewDetails.vehicle.type}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Pocket Details */}
                <div className="pb-6 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <CreditCard className="w-4 h-4" /> Pocket Details
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Pocket Balance</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.pocketBalance || viewDetails.walletSummary?.pocketBalance)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Cash In Hand</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.cashInHand || viewDetails.walletSummary?.cashCollected)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Remaining Cash Limit</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.remainingCashLimit || viewDetails.walletSummary?.remainingCashLimit)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Total Earning</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.totalEarning || viewDetails.walletSummary?.totalEarning)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Bonus</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.bonus || viewDetails.walletSummary?.bonus)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Total Withdrawn</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.totalWithdrawn || viewDetails.walletSummary?.totalWithdrawn)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Documents */}
                {viewDetails.documents && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <FileCheck className="w-4 h-4" /> Documents
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Aadhar */}
                      {viewDetails.documents.aadhar && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Aadhar Card</label>
                          <div className="mt-2">
                            {viewDetails.documents.aadhar.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.aadhar.number}</p>
                            )}
                            {viewDetails.documents.aadhar.document && (
                              <a 
                                href={viewDetails.documents.aadhar.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* PAN */}
                      {viewDetails.documents.pan && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">PAN Card</label>
                          <div className="mt-2">
                            {viewDetails.documents.pan.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.pan.number}</p>
                            )}
                            {viewDetails.documents.pan.document && (
                              <a 
                                href={viewDetails.documents.pan.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Driving License */}
                      {viewDetails.documents.drivingLicense && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Driving License</label>
                          <div className="mt-2">
                            {viewDetails.documents.drivingLicense.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.drivingLicense.number}</p>
                            )}
                            {viewDetails.documents.drivingLicense.expiryDate && (
                              <p className="text-xs text-slate-500 mb-1">
                                Expiry: {new Date(viewDetails.documents.drivingLicense.expiryDate).toLocaleDateString('en-GB')}
                              </p>
                            )}
                            {viewDetails.documents.drivingLicense.document && (
                              <a 
                                href={viewDetails.documents.drivingLicense.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Vehicle RC */}
                      {viewDetails.documents.vehicleRC && (viewDetails.documents.vehicleRC.number || viewDetails.documents.vehicleRC.document) && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Vehicle RC</label>
                          <div className="mt-2">
                            {viewDetails.documents.vehicleRC.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.vehicleRC.number}</p>
                            )}
                            {viewDetails.documents.vehicleRC.document && (
                              <a 
                                href={viewDetails.documents.vehicleRC.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Bank Details */}
                {viewDetails.documents?.bankDetails && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Bank Details
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {viewDetails.documents.bankDetails.accountHolderName && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Account Holder Name</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.accountHolderName}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.accountNumber && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Account Number</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.accountNumber}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.ifscCode && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">IFSC Code</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.ifscCode}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.bankName && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Bank Name</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.bankName}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Additional Info */}
                <div className="grid grid-cols-2 gap-4">
                  {viewDetails.signupMethod && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Signup Method</label>
                      <p className="text-sm text-slate-900 mt-1 capitalize">{viewDetails.signupMethod}</p>
                    </div>
                  )}
                  {viewDetails.phoneVerified !== undefined && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Phone Verified</label>
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-1 ${
                        viewDetails.phoneVerified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {viewDetails.phoneVerified ? 'Verified' : 'Not Verified'}
                      </span>
                    </div>
                  )}
                  {viewDetails.createdAt && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Joined Date</label>
                      <p className="text-sm text-slate-900 mt-1">
                        {new Date(viewDetails.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            )}
          </div>
          <DialogFooter className="px-6 pb-6 border-t border-slate-200">
            <button
              onClick={() => setIsViewOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-md bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Table Settings
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Columns className="w-4 h-4" />
                Visible Columns
              </h3>
              <div className="space-y-2">
                {Object.entries(columnsConfig).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns[key]}
                      onChange={() => toggleColumn(key)}
                      className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                    {visibleColumns[key] && (
                      <Check className="w-4 h-4 text-emerald-600 ml-auto" />
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={resetColumns}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                Reset
              </button>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-md"
              >
                Apply
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
