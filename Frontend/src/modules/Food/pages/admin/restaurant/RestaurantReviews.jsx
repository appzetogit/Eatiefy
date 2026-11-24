import { useState, useEffect, useRef } from "react"
import { Search, Download, ChevronDown, Star, ArrowUpDown, Settings, FileText, FileSpreadsheet, Code, Check, Columns, Loader2, Eye, Utensils } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import {
  exportRestaurantReviewsToCSV,
  exportRestaurantReviewsToExcel,
  exportRestaurantReviewsToPDF,
  exportRestaurantReviewsToJSON,
} from "@food/components/admin/restaurant/restaurantReviewsExportUtils"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

export default function RestaurantReviews() {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_restaurant_reviews_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [reviews, setReviews] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
  const [selectedReview, setSelectedReview] = useState(null)
  const [visibleColumns, setVisibleColumns] = useState({
    si: true,
    orderId: true,
    restaurant: true,
    customer: true,
    review: true,
    rating: true,
    date: true,
  })

  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter()
  // Only the newest fetch may write state, so a quick filter change cannot be
  // overwritten by a slower earlier response.
  const fetchSeqRef = useRef(0)

  const filteredReviews = reviews

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, zoneId])

  useEffect(() => {
    const seq = ++fetchSeqRef.current
    const isLatest = () => seq === fetchSeqRef.current
    const fetchReviews = async () => {
      try {
        setIsLoading(true)
        const response = await adminAPI.getRestaurantReviews({
          zoneId: zoneId || undefined,
          search: debouncedSearch || undefined,
          page: currentPage,
          limit: pageSize,
        })
        if (!isLatest()) return
        if (response?.data?.success && response?.data?.data?.reviews) {
          setReviews(response.data.data.reviews)
          setTotalItems(
            response?.data?.data?.total ??
            response?.data?.total ??
            response.data.data.reviews.length,
          )
        } else {
          setReviews([])
          setTotalItems(0)
        }
      } catch (error) {
        debugError('Error fetching restaurant reviews:', error)
        if (!isLatest()) return
        setReviews([])
        setTotalItems(0)
        toast.error('Failed to load restaurant reviews')
      } finally {
        if (isLatest()) setIsLoading(false)
      }
    }

    fetchReviews()
  }, [debouncedSearch, currentPage, pageSize, zoneId])

  const handleExport = (format) => {
    if (filteredReviews.length === 0) {
      alert("No data to export")
      return
    }
    switch (format) {
      case "csv": exportRestaurantReviewsToCSV(filteredReviews); break
      case "excel": exportRestaurantReviewsToExcel(filteredReviews); break
      case "pdf": exportRestaurantReviewsToPDF(filteredReviews); break
      case "json": exportRestaurantReviewsToJSON(filteredReviews); break
    }
  }

  const toggleColumn = (columnKey) => {
    setVisibleColumns(prev => ({ ...prev, [columnKey]: !prev[columnKey] }))
  }

  const resetColumns = () => {
    setVisibleColumns({
      si: true,
      orderId: true,
      restaurant: true,
      customer: true,
      review: true,
      rating: true,
      date: true,
    })
  }

  const columnsConfig = {
    si: "Serial Number",
    orderId: "Order ID",
    restaurant: "Restaurant",
    customer: "Customer",
    review: "Review",
    rating: "Rating",
    date: "Date & Time",
  }

  const getRatingBadge = (rating) => {
    const stars = []
    const count = Math.floor(rating || 0)
    for (let i = 0; i < count; i++) {
      stars.push(<Star key={i} className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />)
    }
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg w-fit">
        <div className="flex items-center gap-0.5">
          {stars}
        </div>
        <span className="text-xs font-bold text-amber-700 leading-none">{rating}</span>
      </div>
    )
  }

  const renderStars = (rating) => {
    const stars = []
    const count = Math.floor(rating || 0)
    for (let i = 0; i < count; i++) {
      stars.push(<Star key={i} className="w-5 h-5 fill-amber-500 text-amber-500" />)
    }
    return stars
  }

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A'
    try {
      const date = new Date(dateString)
      const day = date.getDate().toString().padStart(2, '0')
      const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
      const year = date.getFullYear()
      const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      return `${day} ${month} ${year}, ${time}`
    } catch (e) {
      return 'Invalid Date'
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <Utensils className="w-5 h-5 text-emerald-500" />
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">Restaurant Reviews</h1>
                <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700 flex items-center justify-center min-w-[2.5rem] h-7">
                  {isLoading ? (
                    <span className="w-5 h-3 rounded bg-slate-300/80 animate-pulse" />
                  ) : (
                    totalItems
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <AdminZoneSelect
                value={zoneId}
                onChange={setZoneId}
                zones={zones}
                loading={zonesLoading}
              />
              <div className="relative flex-1 sm:flex-initial min-w-[250px]">
                <input
                  type="text"
                  placeholder="Search by restaurant or customer"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all">
                    <Download className="w-4 h-4" />
                    <span className="text-black font-bold">Export</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50 animate-in fade-in-0 zoom-in-95 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
                  <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("csv")} className="cursor-pointer">
                    <FileText className="w-4 h-4 mr-2" />
                    Export as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("excel")} className="cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Export as Excel
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")} className="cursor-pointer">
                    <FileText className="w-4 h-4 mr-2" />
                    Export as PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("json")} className="cursor-pointer">
                    <Code className="w-4 h-4 mr-2" />
                    Export as JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-all"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                <span className="ml-2 text-sm text-slate-600">Loading reviews...</span>
              </div>
            ) : filteredReviews.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-500">No reviews found</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {visibleColumns.si && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">SI</th>
                    )}
                    {visibleColumns.orderId && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Order ID</th>
                    )}
                    {visibleColumns.restaurant && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Restaurant</th>
                    )}
                    {visibleColumns.customer && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Customer</th>
                    )}
                    {visibleColumns.review && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Review</th>
                    )}
                    {visibleColumns.rating && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Rating</th>
                    )}
                    {visibleColumns.date && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Date & Time</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredReviews.map((review) => (
                    <tr key={review.sl || review.orderId} className="hover:bg-slate-50 transition-colors">
                      {visibleColumns.si && <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{review.sl}</td>}
                      {visibleColumns.orderId && <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-700">{review.orderId}</td>}
                      {visibleColumns.restaurant && <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-emerald-600">{review.restaurant}</td>}
                      {visibleColumns.customer && <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">{review.customer}</td>}
                      {visibleColumns.review && (
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-700 truncate max-w-xs">{review.review || 'No review'}</span>
                            <button onClick={() => { setSelectedReview(review); setIsReviewModalOpen(true); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"><Eye className="w-4 h-4" /></button>
                          </div>
                        </td>
                      )}
                      {visibleColumns.rating && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getRatingBadge(review.rating)}
                        </td>
                      )}
                      {visibleColumns.date && <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{formatDateTime(review.submittedAt)}</td>}
                    </tr>
                  ))}
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
                localStorage.setItem("admin_restaurant_reviews_pageSize", String(size))
              } catch {}
              setCurrentPage(1)
            }}
            itemLabel="reviews"
          />
        </div>
      </div>

      <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
        <DialogContent className="max-w-2xl bg-white p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="flex items-center gap-2 text-xl"><Eye className="w-5 h-5 text-slate-600" />Review Details</DialogTitle>
          </DialogHeader>
          {selectedReview && (
            <div className="px-6 py-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4"><p className="text-xs text-slate-500 mb-1">Order ID</p><p className="text-sm font-semibold text-slate-900 font-mono">{selectedReview.orderId}</p></div>
                <div className="bg-emerald-50 rounded-lg p-4"><p className="text-xs text-emerald-600 mb-1">Restaurant</p><p className="text-sm font-semibold text-emerald-700">{selectedReview.restaurant}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-purple-50 rounded-lg p-4"><p className="text-xs text-purple-600 mb-1">Customer</p><p className="text-sm font-semibold text-purple-700">{selectedReview.customer}</p></div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <p className="text-xs text-orange-600 mb-2 font-semibold">Rating</p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {renderStars(selectedReview.rating)}
                    </div>
                    <span className="text-lg font-bold text-orange-700">
                      {selectedReview.rating} / 5
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-4"><p className="text-xs text-slate-600 mb-2 font-semibold">Review Feedback</p><p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{selectedReview.review || 'No review text provided'}</p></div>
              <div className="bg-slate-50 rounded-lg p-4"><p className="text-xs text-slate-600 mb-1">Submitted At</p><p className="text-sm font-medium text-slate-900">{formatDateTime(selectedReview.submittedAt)}</p></div>
            </div>
          )}
          <DialogFooter className="px-6 pb-6 pt-4 border-t border-slate-200"><button onClick={() => setIsReviewModalOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all">Close</button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-lg bg-white p-0 overflow-hidden">
          <DialogHeader className="border-b border-slate-200 px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-xl text-slate-900">
              <Columns className="w-5 h-5 text-slate-600" />
              Review Table Settings
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 px-6 py-5 sm:grid-cols-2">
            {Object.entries(columnsConfig).map(([columnKey, label]) => (
              <button
                key={columnKey}
                type="button"
                onClick={() => toggleColumn(columnKey)}
                className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <span className="text-sm font-medium text-slate-700">{label}</span>
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded border ${visibleColumns[columnKey] ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-transparent"}`}>
                  <Check className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
          <DialogFooter className="border-t border-slate-200 px-6 py-4 gap-2">
            <button
              type="button"
              onClick={resetColumns}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-all"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
