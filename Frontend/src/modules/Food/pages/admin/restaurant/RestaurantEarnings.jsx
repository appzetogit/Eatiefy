import { useState, useEffect, useCallback } from "react"
import { Search, Download, ChevronDown, Store, IndianRupee, FileText, FileSpreadsheet, Loader2, MapPin, Building2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"

const formatCurrency = (amount) => {
  return `\u20B9${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatDate = (dateString) => {
  if (!dateString) return 'N/A'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-IN', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function RestaurantEarnings() {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [earnings, setEarnings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_restaurant_earnings_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [summary, setSummary] = useState({
    totalRestaurants: 0,
    totalEarnings: 0,
    totalOrders: 0
  })
  const [filters, setFilters] = useState({
    period: 'all',
    zoneId: '',
    restaurantId: '',
    fromDate: '',
    toDate: ''
  })
  const [zones, setZones] = useState([])
  const [restaurants, setRestaurants] = useState([])

  // Fetch zones for zone-wise filtering
  useEffect(() => {
    let isMounted = true
    const fetchZones = async () => {
      try {
        const response = await adminAPI.getZones({ limit: 1000 })
        if (response?.data?.success && response.data.data?.zones && isMounted) {
          setZones(response.data.data.zones)
        }
      } catch (err) {
        console.error("Error fetching zones:", err)
      }
    }
    fetchZones()
    return () => { isMounted = false }
  }, [])

  // Fetch restaurants for restaurant filter dropdown (optionally scoped by zone)
  const fetchRestaurants = useCallback(async () => {
    try {
      const params = { limit: 1000 }
      if (filters.zoneId) {
        params.zoneId = filters.zoneId
      }
      const response = await adminAPI.getRestaurants(params)
      if (response?.data?.success) {
        setRestaurants(response.data.data.restaurants || [])
      }
    } catch (err) {
      console.error("Error fetching restaurants:", err)
    }
  }, [filters.zoneId])

  useEffect(() => {
    fetchRestaurants()
  }, [fetchRestaurants])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, filters])

  // Fetch restaurant earnings from API
  const fetchEarnings = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const params = {
        page: currentPage,
        limit: pageSize,
        period: filters.period,
        ...(filters.zoneId && { zoneId: filters.zoneId }),
        ...(filters.restaurantId && { restaurantId: filters.restaurantId }),
        ...(filters.fromDate && { fromDate: filters.fromDate }),
        ...(filters.toDate && { toDate: filters.toDate }),
        ...(debouncedSearch && { search: debouncedSearch })
      }

      const response = await adminAPI.getRestaurantEarnings(params)

      if (response.data?.success) {
        setEarnings(response.data.data.earnings || [])
        setSummary(response.data.data.summary || {})
        setTotalItems(response.data.data.pagination?.total ?? (response.data.data.earnings || []).length)
      } else {
        setError(response.data?.message || "Failed to fetch restaurant earnings")
        setEarnings([])
        setTotalItems(0)
      }
    } catch (err) {
      console.error("Error fetching restaurant earnings:", err)
      const errorMessage = err.response?.data?.message || "Failed to fetch restaurant earnings. Please try again."
      setError(errorMessage)
      toast.error(errorMessage)
      setEarnings([])
      setTotalItems(0)
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, filters, debouncedSearch])

  useEffect(() => {
    fetchEarnings()
  }, [fetchEarnings])

  const handleFilterChange = (key, value) => {
    setFilters(prev => {
      // If changing zone, reset restaurant selection
      if (key === 'zoneId') {
        return { ...prev, zoneId: value, restaurantId: '' }
      }
      return { ...prev, [key]: value }
    })
    setCurrentPage(1)
  }

  const handleExport = (format) => {
    if (earnings.length === 0) {
      toast.info("No data to export")
      return
    }

    const formatMoney = (val) => {
      const num = Number(val)
      return Number.isFinite(num) ? num.toFixed(2) : "0.00"
    }

    const headers = [
      { key: "sl", label: "SI" },
      { key: "restaurantName", label: "Restaurant" },
      { key: "zoneName", label: "Zone" },
      { key: "restaurantPhone", label: "Phone" },
      { key: "orderId", label: "Order ID" },
      { key: "amount", label: "Earning (INR)" },
      { key: "orderTotal", label: "Order Total (INR)" },
      { key: "orderStatus", label: "Status" },
      { key: "createdAt", label: "Date" },
    ]

    const data = earnings.map((item, index) => ({
      sl: (currentPage - 1) * pageSize + index + 1,
      restaurantName: item.restaurantName || 'N/A',
      zoneName: item.zoneName || 'N/A',
      restaurantPhone: item.restaurantPhone || 'N/A',
      orderId: item.orderId || 'N/A',
      amount: formatMoney(item.amount),
      orderTotal: formatMoney(item.orderTotal),
      orderStatus: item.orderStatus || 'N/A',
      createdAt: formatDate(item.createdAt)
    }))

    switch (format) {
      case "csv": {
        const csvContent = [
          headers.map(h => h.label).join(","),
          ...data.map(row => headers.map(h => `"${String(row[h.key] || '').replace(/"/g, '""')}"`).join(","))
        ].join("\n")
        const csvBlob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" })
        const csvLink = document.createElement("a")
        csvLink.href = URL.createObjectURL(csvBlob)
        csvLink.download = `restaurant_earnings_${new Date().toISOString().split('T')[0]}.csv`
        csvLink.click()
        toast.success("CSV exported successfully")
        break
      }
      case "excel": {
        const escapeHtml = (str) => String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        const htmlContent = `<html><head><meta charset="utf-8">
<style>
  table { border-collapse: collapse; font-family: sans-serif; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background-color: #f1f5f9; font-weight: bold; }
</style></head><body>
<table>
<thead><tr>${headers.map(h => `<th>${escapeHtml(h.label)}</th>`).join("")}</tr></thead>
<tbody>${data.map(row => `<tr>${headers.map(h => `<td>${escapeHtml(row[h.key])}</td>`).join("")}</tr>`).join("")}</tbody>
</table></body></html>`
        const excelBlob = new Blob([htmlContent], { type: "application/vnd.ms-excel;charset=utf-8" })
        const excelLink = document.createElement("a")
        excelLink.href = URL.createObjectURL(excelBlob)
        excelLink.download = `restaurant_earnings_${new Date().toISOString().split('T')[0]}.xls`
        excelLink.click()
        toast.success("Excel exported successfully")
        break
      }
      case "json": {
        const jsonContent = JSON.stringify(data, null, 2)
        const jsonBlob = new Blob([jsonContent], { type: "application/json;charset=utf-8" })
        const jsonLink = document.createElement("a")
        jsonLink.href = URL.createObjectURL(jsonBlob)
        jsonLink.download = `restaurant_earnings_${new Date().toISOString().split('T')[0]}.json`
        jsonLink.click()
        toast.success("JSON exported successfully")
        break
      }
      default:
        toast.error("Invalid export format")
    }
  }

  if (loading && earnings.length === 0) {
    return (
      <div className="p-4 lg:p-6 bg-slate-50 min-h-screen w-full max-w-full overflow-x-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-gray-600">Loading restaurant earnings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen w-full max-w-full overflow-x-hidden">
      <div className="w-full mx-auto">
        {/* Page Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center shadow-sm">
                <Store className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Restaurant Earning</h1>
                <p className="text-sm text-slate-600">View all restaurant earnings and zone-wise details</p>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Total Restaurants</p>
                <p className="text-2xl font-bold text-slate-900">{summary.totalRestaurants || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Total Earnings</p>
                <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.totalEarnings || 0)}</p>
                {Number(summary.totalFoodAmount) > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    Food Subtotal: {formatCurrency(summary.totalFoodAmount)}
                  </p>
                )}
              </div>
              <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center">
                <IndianRupee className="w-6 h-6 text-emerald-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Total Orders</p>
                <p className="text-2xl font-bold text-slate-900">{summary.totalOrders || 0}</p>
                {Number(summary.totalOrderAmount) > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    Orders Volume: {formatCurrency(summary.totalOrderAmount)}
                  </p>
                )}
              </div>
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center">
                <FileText className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Period</label>
              <select
                value={filters.period}
                onChange={(e) => handleFilterChange('period', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                <span>Zone</span>
              </label>
              <select
                value={filters.zoneId}
                onChange={(e) => handleFilterChange('zoneId', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                <option value="">All Zones</option>
                {zones.map(z => (
                  <option key={z._id} value={z._id}>{z.name || z.zoneName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1">
                <Store className="w-3.5 h-3.5 text-slate-500" />
                <span>Restaurant</span>
              </label>
              <select
                value={filters.restaurantId}
                onChange={(e) => handleFilterChange('restaurantId', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                <option value="">All Restaurants</option>
                {restaurants.map(r => (
                  <option key={r._id} value={r._id}>{r.restaurantName || r.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">From Date</label>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">To Date</label>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>
          </div>
        </div>

        {/* Search and Export */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by restaurant name, phone, order ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors">
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleExport("csv")}>
                  <FileText className="w-4 h-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("excel")}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Export as Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("json")}>
                  <FileText className="w-4 h-4 mr-2" />
                  Export as JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Earnings Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">SI</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Restaurant</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Zone</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Order ID</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Earning</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Order Total</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {earnings.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <Store className="w-10 h-10 text-slate-300 mb-2" />
                        <p className="text-lg font-semibold text-slate-700 mb-1">No Restaurant Earnings Found</p>
                        <p className="text-sm text-slate-500">No earnings match your selected zone or filters</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  earnings.map((earning, index) => (
                    <tr key={earning.transactionId || earning.orderId || index} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {(currentPage - 1) * pageSize + index + 1}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                        {earning.restaurantName || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          {earning.zoneName || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 font-mono">
                        {earning.restaurantPhone || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm text-blue-600 font-medium">
                        {earning.orderId || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-emerald-600">
                        {formatCurrency(earning.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatCurrency(earning.orderTotal)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          earning.orderStatus === 'delivered' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {earning.orderStatus || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                        {formatDate(earning.createdAt)}
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
                localStorage.setItem("admin_restaurant_earnings_pageSize", String(size))
              } catch {
                /* ignore */
              }
            }}
            itemLabel="earnings"
          />
        </div>
      </div>
    </div>
  )
}
