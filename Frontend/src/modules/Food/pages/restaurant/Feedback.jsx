import { useState, useEffect, useRef } from "react"
import { useNavigate, useSearchParams, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Bell, HelpCircle, Menu, Search, SlidersHorizontal, Calendar, ChevronLeft, X, Loader2, ChevronRight, Star, ArrowLeft } from "lucide-react"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { DateRangeCalendar } from "@food/components/ui/date-range-calendar"
import BottomNavOrders from "@food/components/restaurant/BottomNavOrders"
import { restaurantAPI } from "@food/api"
import { applyReviewFilters } from "@food/utils/reviewFilters"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const REVIEWS_STORAGE_KEY = "restaurant_reviews_data"

const tabs = [
  { id: "complaints", label: "Complaints" },
  { id: "reviews", label: "Reviews" },
]

const normalizeOrderStatus = (order) =>
  String(order?.status || order?.orderStatus || "").toLowerCase()

const normalizeRating = (value) => {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed <= 0) return null
  return Math.min(5, Math.round(parsed * 10) / 10)
}

const extractReviewRating = (order) =>
  normalizeRating(
    order?.review?.rating ??
      order?.ratings?.restaurant?.rating ??
      order?.ratings?.restaurantRating ??
      order?.restaurantRating ??
      order?.feedback?.rating ??
      order?.rating
  )

const extractReviewText = (order) => {
  const raw =
    order?.review?.comment ??
    order?.review?.text ??
    order?.ratings?.restaurant?.comment ??
    order?.ratings?.restaurantComment ??
    order?.restaurantComment ??
    order?.feedback?.comment ??
    order?.feedback?.text ??
    ""
  const normalized = String(raw || "").trim()
  return normalized || "No review text"
}

const toComparableId = (value) =>
  String(value?._id || value || "").trim()


export default function Feedback() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState(tabFromUrl === "complaints" ? "complaints" : "reviews")
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useRestaurantBackNavigation()
  const showBack = location.state?.from
  const [isTransitioning, setIsTransitioning] = useState(false)
  
  // Update active tab when URL param changes
  useEffect(() => {
    if (tabFromUrl === "complaints") {
      setActiveTab("complaints")
    } else {
      setActiveTab("reviews")
    }
  }, [tabFromUrl])
  
  // Swipe gesture refs
  const touchStartX = useRef(0)
  const touchEndX = useRef(0)
  const touchStartY = useRef(0)
  const isSwiping = useRef(false)
  
  const feedbackTabs = ["complaints", "reviews"]
  const [reviews, setReviews] = useState([])
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [selectedFilterCategory, setSelectedFilterCategory] = useState("duration")
  const [filterValues, setFilterValues] = useState({
    duration: null,
    sortBy: "newest",
    reviewType: []
  })
  const [isFilterLoading, setIsFilterLoading] = useState(false)
  const [displayedReviews, setDisplayedReviews] = useState([])
  const [reviewsSearchQuery, setReviewsSearchQuery] = useState("")
  
  const [isComplaintsFilterOpen, setIsComplaintsFilterOpen] = useState(false)
  const [selectedComplaintsFilterCategory, setSelectedComplaintsFilterCategory] = useState("issueType")
  const [complaintsFilterValues, setComplaintsFilterValues] = useState({
    issueType: [],
    reasons: []
  })
  const [complaintsSearchQuery, setComplaintsSearchQuery] = useState("")
  
  const [isDateSelectorOpen, setIsDateSelectorOpen] = useState(false)
  const [selectedDateRange, setSelectedDateRange] = useState("last5days") 
  const [customDateRange, setCustomDateRange] = useState({ start: null, end: null })
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false)
  const [isComplaintsLoading, setIsComplaintsLoading] = useState(false)
  const [complaints, setComplaints] = useState([])

  const [restaurantData, setRestaurantData] = useState(null)
  const [isLoadingRestaurant, setIsLoadingRestaurant] = useState(true)
  const [isLoadingReviews, setIsLoadingReviews] = useState(true)
  const [ratingSummary, setRatingSummary] = useState({
    averageRating: 0,
    totalRatings: 0,
    totalReviews: 0
  })

  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setIsLoadingRestaurant(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        if (response.data?.success && response.data.data?.restaurant) {
          setRestaurantData(response.data.data.restaurant)
        }
      } catch (error) {
        debugError("Error fetching restaurant data:", error)
      } finally {
        setIsLoadingRestaurant(false)
      }
    }
    fetchRestaurantData()
  }, [])

  useEffect(() => {
    const fetchComplaints = async () => {
      if (activeTab !== 'complaints') return
      
      try {
        setIsComplaintsLoading(true)
        const dateRanges = getDateRanges()
        let fromDate = null
        let toDate = null

        switch (selectedDateRange) {
          case 'today':
            fromDate = dateRanges.today
            toDate = new Date()
            break
          case 'yesterday':
            fromDate = dateRanges.yesterday
            toDate = new Date(dateRanges.yesterday)
            toDate.setHours(23, 59, 59, 999)
            break
          case 'thisWeek':
            fromDate = dateRanges.thisWeekStart
            toDate = dateRanges.thisWeekEnd
            break
          case 'lastWeek':
            fromDate = dateRanges.lastWeekStart
            toDate = dateRanges.lastWeekEnd
            break
          case 'thisMonth':
            fromDate = dateRanges.thisMonthStart
            toDate = dateRanges.thisMonthEnd
            break
          case 'lastMonth':
            fromDate = dateRanges.lastMonthStart
            toDate = dateRanges.lastMonthEnd
            break
          case 'last5days':
            fromDate = dateRanges.last5DaysStart
            toDate = dateRanges.last5DaysEnd
            break
          case 'custom':
            if (customDateRange.start && customDateRange.end) {
              fromDate = customDateRange.start
              toDate = customDateRange.end
            }
            break
        }

        const params = {}
        if (fromDate) params.fromDate = fromDate.toISOString()
        if (toDate) params.toDate = toDate.toISOString()
        if (complaintsFilterValues.issueType?.length > 0) {
          params.complaintType = complaintsFilterValues.issueType[0]
        }
        if (complaintsSearchQuery) params.search = complaintsSearchQuery

        const response = await restaurantAPI.getComplaints(params)
        if (response?.data?.success && response.data.data?.complaints) {
          setComplaints(response.data.data.complaints)
        } else {
          setComplaints([])
        }
      } catch (error) {
        debugError('Error fetching complaints:', error)
        setComplaints([])
      } finally {
        setIsComplaintsLoading(false)
      }
    }

    fetchComplaints()
  }, [activeTab, selectedDateRange, customDateRange, complaintsFilterValues, complaintsSearchQuery])

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setIsLoadingReviews(true)
        let allOrders = []
        let page = 1
        let hasMore = true
        const limit = 1000
        const maxPages = 50

        while (hasMore && page <= maxPages) {
          try {
            const response = await restaurantAPI.getOrders({ 
              page, 
              limit,
              status: 'delivered'
            })
            
            if (response.data?.success && response.data.data?.orders) {
              const orders = response.data.data.orders
              allOrders = [...allOrders, ...orders]
              const totalPages = response.data.data.pagination?.totalPages || response.data.data.totalPages || 1
              if (orders.length < limit || (totalPages > 0 && page >= totalPages)) {
                hasMore = false
              } else {
                page++
              }
            } else {
              hasMore = false
            }
          } catch (pageError) {
            hasMore = false
          }
        }

        const transformedReviews = allOrders
          .filter(order => normalizeOrderStatus(order) === 'delivered')
          .map((order, index) => {
            const orderDate = new Date(order.createdAt || order.deliveredAt || Date.now())
            const day = orderDate.getDate()
            const month = orderDate.toLocaleDateString('en-GB', { month: 'short' })
            const year = orderDate.getFullYear()
            const formattedDate = `${day} ${month}, ${year}`

            const userName = order.userId?.name || order.customerName || 'Customer'
            const userImage = order.userId?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random`
            const outlet = order.restaurantName || (restaurantData?.name) || 'Restaurant'

            const rating = extractReviewRating(order)
            const reviewText = extractReviewText(order)

            const userOrdersCount = allOrders.filter(o => toComparableId(o.userId) === toComparableId(order.userId)).length

            return {
              id: order._id || order.orderId || `review-${index}`,
              orderNumber: order.orderId || order.orderNumber || String(index),
              outlet: outlet,
              userName: userName,
              userImage: userImage,
              ordersCount: userOrdersCount,
              rating: rating,
              date: formattedDate,
              // `date` is a display string ("5 Sep, 2025") and loses the time of
              // day, so sorting keeps the original timestamp separately.
              sortTimestamp: orderDate.getTime(),
              reviewText: reviewText,
              orderData: order
            }
          })
          .filter(review => review.rating !== null || (review.reviewText && review.reviewText !== 'No review text'))

        const ratings = transformedReviews.map(r => r.rating).filter(r => r !== null)
        const averageRating = ratings.length > 0 ? (ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1) : 0
        
        setRatingSummary({
          averageRating: parseFloat(averageRating),
          totalRatings: ratings.length,
          totalReviews: transformedReviews.length
        })
        setReviews(transformedReviews)
      } catch (error) {
        debugError("Error fetching reviews:", error)
      } finally {
        setIsLoadingReviews(false)
      }
    }

    if (!isLoadingRestaurant) fetchReviews()
  }, [isLoadingRestaurant, restaurantData])

  // Reviews are fully loaded client-side above, so search and filters are one
  // pass over that data — no extra API round-trip per keystroke.
  useEffect(() => {
    setDisplayedReviews(
      applyReviewFilters(reviews, { search: reviewsSearchQuery, filters: filterValues })
    )
  }, [reviews, filterValues, reviewsSearchQuery])

  const hasActiveReviewFilters =
    filterValues.reviewType.length > 0 || filterValues.sortBy !== "newest"

  const handleFilterReset = () => { setFilterValues({ duration: null, sortBy: "newest", reviewType: [] }); setIsFilterLoading(true); setIsFilterOpen(false); setTimeout(() => setIsFilterLoading(false), 200) }
  const handleFilterApply = () => { setIsFilterLoading(true); setIsFilterOpen(false); setTimeout(() => setIsFilterLoading(false), 200) }

  const formatDate = (date) => {
    const day = date.getDate()
    const month = date.toLocaleString('en-US', { month: 'short' })
    const year = date.getFullYear()
    return `${day} ${month} ${year}`
  }
  const formatDateShort = (date) => {
    const day = date.getDate()
    const month = date.toLocaleString('en-US', { month: 'short' })
    return `${day} ${month}`
  }

  const getDateRanges = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    const last5DaysStart = new Date(today)
    last5DaysStart.setDate(last5DaysStart.getDate() - 4)
    
    const thisWeekStart = new Date(today)
    const day = today.getDay()
    const diff = today.getDate() - day + (day === 0 ? -6 : 1)
    thisWeekStart.setDate(diff)
    
    const lastWeekStart = new Date(thisWeekStart)
    lastWeekStart.setDate(lastWeekStart.getDate() - 7)
    const lastWeekEnd = new Date(thisWeekStart)
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1)
    lastWeekEnd.setHours(23, 59, 59, 999)
    
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
    lastMonthEnd.setHours(23, 59, 59, 999)
    
    return { 
      today, 
      yesterday, 
      thisWeekStart, 
      thisWeekEnd: new Date(), 
      lastWeekStart, 
      lastWeekEnd, 
      thisMonthStart, 
      thisMonthEnd: new Date(), 
      lastMonthStart, 
      lastMonthEnd, 
      last5DaysStart, 
      last5DaysEnd: new Date() 
    }
  }

  const handleComplaintsFilterApply = () => { setIsComplaintsLoading(true); setIsComplaintsFilterOpen(false); setTimeout(() => setIsComplaintsLoading(false), 200) }
  const handleComplaintsFilterReset = () => { setComplaintsFilterValues({ issueType: [], reasons: [] }); setComplaintsSearchQuery(""); setIsComplaintsLoading(true); setTimeout(() => setIsComplaintsLoading(false), 200) }

  const handleDateRangeSelect = (range) => {
    setSelectedDateRange(range)
    if (range === "custom") setIsCustomDateOpen(true)
    else { setIsDateSelectorOpen(false); setIsComplaintsLoading(true); setTimeout(() => setIsComplaintsLoading(false), 200) }
  }

  const handleCustomDateApply = () => { setIsCustomDateOpen(false); setIsDateSelectorOpen(false); setIsComplaintsLoading(true); setTimeout(() => setIsComplaintsLoading(false), 200) }

  // Any open bottom sheet owns the gesture. Without this the page-level swipe
  // handler still reads touches made inside the sheet and switches tabs behind
  // it, which on Android makes the filter feel unresponsive.
  const isOverlayOpen =
    isFilterOpen || isComplaintsFilterOpen || isDateSelectorOpen || isCustomDateOpen

  const handleTouchStart = (e) => {
    if (isOverlayOpen) { isSwiping.current = false; return }
    touchStartX.current = e.touches[0].clientX; touchStartY.current = e.touches[0].clientY; isSwiping.current = false
  }
  const handleTouchMove = (e) => {
    if (isOverlayOpen) return
    const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current)
    const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current)
    if (deltaX > deltaY && deltaX > 10) isSwiping.current = true
    if (isSwiping.current) touchEndX.current = e.touches[0].clientX
  }
  const handleTouchEnd = () => {
    if (isOverlayOpen) return
    if (!isSwiping.current) return
    const swipeDistance = touchStartX.current - touchEndX.current
    if (Math.abs(swipeDistance) > 50) {
      if (swipeDistance > 0) setActiveTab("reviews")
      else setActiveTab("complaints")
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#141414] flex flex-col" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="sticky bg-white dark:bg-[#141414] top-0 z-40 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {showBack && (
              <button
                onClick={goBack}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5 text-gray-900" />
              </button>
            )}
            <div>
              <p className="text-[10px] tracking-wider text-gray-500 uppercase">Showing data for</p>
              <p className="text-md font-bold text-gray-900 dark:text-white">{restaurantData?.name || "Restaurant"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/food/restaurant/help-centre/support", { state: { from: location.pathname } })}
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95 transition-all"
              aria-label="Open support"
            >
              <HelpCircle className="w-6 h-6 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
        
        <div className="flex gap-2 mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-2 rounded-full text-sm font-bold transition-all relative ${
                activeTab === tab.id ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white" : "bg-white dark:bg-[#242424] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800"
              }`}
            >
              {tab.label}
              {tab.id === 'complaints' && complaints.length > 0 && activeTab !== 'complaints' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-full border-2 border-white dark:border-[#141414]" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-4">
        {activeTab === "complaints" ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button onClick={() => setIsDateSelectorOpen(true)} className="flex-1 bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] p-3 rounded-xl border border-gray-200 dark:border-gray-800 flex justify-between items-center">
                <div className="text-left">
                  <p className="text-xs font-bold text-gray-900 dark:text-white">{selectedDateRange}</p>
                  <p className="text-[10px] text-gray-500">Select date range</p>
                </div>
                <Calendar className="w-4 h-4 text-gray-400" />
              </button>
              <button onClick={() => setIsComplaintsFilterOpen(true)} className="bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] p-3 rounded-xl border border-gray-200 dark:border-gray-800">
                <SlidersHorizontal className="w-4 h-4 text-gray-900 dark:text-white" />
              </button>
            </div>

            <AnimatePresence mode="wait">
              {isComplaintsLoading ? (
                <div className="flex justify-center p-10"><Loader2 className="animate-spin text-gray-400" /></div>
              ) : complaints.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                  <p className="text-sm text-gray-500 font-medium">No complaints found</p>
                </div>
              ) : (
                <div className="space-y-4 pb-20">
                  {complaints.map((complaint) => (
                    <div key={complaint._id} className="bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm space-y-3">
                      <div className="flex justify-between items-center">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter ${
                          complaint.status === 'open' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600'
                        }`}>{complaint.status || 'open'}</span>
                        <span className="text-[10px] text-gray-400 font-bold">{new Date(complaint.createdAt).toLocaleDateString()}</span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center font-bold text-gray-400 shrink-0">
                          {complaint.userId?.name?.[0] || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-900 dark:text-white text-sm break-words">{complaint.userId?.name || 'Customer'}</p>
                          <p className="text-[10px] text-gray-500 font-bold uppercase truncate">Order #{complaint.orderId?.orderId || 'N/A'}</p>
                        </div>
                      </div>
 
                      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 relative">
                        <p className="text-[10px] font-black text-[#2E7D52] uppercase mb-1">{complaint.issueType}</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 font-semibold leading-relaxed">{complaint.description}</p>
                      </div>
 
                      {complaint.adminResponse && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-900/30">
                          <p className="text-[9px] font-black text-[#2E7D52] dark:text-blue-400 uppercase mb-1">Admin Response</p>
                          <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">{complaint.adminResponse}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] p-3 rounded-xl border border-gray-200 dark:border-gray-800 flex items-center gap-2">
                <Search className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="text"
                  value={reviewsSearchQuery}
                  onChange={(e) => setReviewsSearchQuery(e.target.value)}
                  placeholder="Search reviews, customer or order"
                  aria-label="Search reviews"
                  className="flex-1 min-w-0 text-sm bg-transparent focus:outline-none dark:text-white"
                />
                {reviewsSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setReviewsSearchQuery("")}
                    aria-label="Clear review search"
                    className="p-1 -mr-1 shrink-0 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 active:scale-95 transition-all"
                  >
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsFilterOpen(true)}
                aria-label="Filter reviews"
                aria-expanded={isFilterOpen}
                className={`relative shrink-0 p-3 rounded-xl border active:scale-95 transition-all ${
                  hasActiveReviewFilters
                    ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] border-transparent"
                    : "bg-white dark:bg-gradient-to-br dark:from-[#2E7D52] dark:to-[#1B5E3F] border-gray-200 dark:border-gray-800"
                }`}
              >
                <SlidersHorizontal className={`w-4 h-4 ${hasActiveReviewFilters ? "text-white" : "text-gray-900 dark:text-white"}`} />
                {hasActiveReviewFilters && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-white dark:border-[#141414]" />
                )}
              </button>
            </div>

            {isLoadingReviews || isFilterLoading ? (
              <div className="flex justify-center p-10"><Loader2 className="animate-spin text-gray-400" /></div>
            ) : displayedReviews.length === 0 ? (
              <div className="text-center py-20 bg-gray-50 dark:bg-[#242424] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800 px-6">
                <p className="text-sm text-gray-500 font-medium">
                  {reviewsSearchQuery.trim()
                    ? `No reviews match "${reviewsSearchQuery.trim()}"`
                    : hasActiveReviewFilters
                      ? "No reviews match the selected filters"
                      : "No reviews yet"}
                </p>
                {(reviewsSearchQuery.trim() || hasActiveReviewFilters) && (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewsSearchQuery("")
                      setFilterValues({ duration: null, sortBy: "newest", reviewType: [] })
                    }}
                    className="mt-3 text-xs font-bold text-[#2E7D52] underline underline-offset-4"
                  >
                    Clear search and filters
                  </button>
                )}
              </div>
            ) : (
            <div className="space-y-4 pb-20">
              {displayedReviews.map((review) => (
                <div key={review.id} className="bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase">
                    <span>Order #{review.orderNumber}</span>
                    <span>{review.date}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <img
                      src={review.userImage}
                      alt={review.userName}
                      className="w-8 h-8 rounded-full border border-gray-100 dark:border-gray-800 shrink-0 object-cover"
                    />
                    <p className="font-bold text-gray-900 dark:text-white text-sm flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
                      {review.userName}
                    </p>
                    {review.rating != null ? (
                      <div className={`ml-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold text-white ${
                        review.rating >= 4 ? "bg-green-600" : review.rating >= 3 ? "bg-amber-500" : "bg-red-500"
                      }`}>
                        {review.rating} <Star className="w-3 h-3 fill-current" />
                      </div>
                    ) : (
                      <span className="ml-auto shrink-0 text-[10px] text-gray-400 font-medium italic">No rating</span>
                    )}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                    <p className="text-sm text-gray-800 dark:text-gray-200 font-medium italic break-words">"{review.reviewText}"</p>
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        )}
      </div>

      {/* Date Selector Popup */}
      <AnimatePresence>
        {isDateSelectorOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setIsDateSelectorOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-t-3xl shadow-2xl z-50 p-4"
            >
              <div className="flex justify-center mb-4">
                <div className="h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-700" />
              </div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold dark:text-white">Select Date Range</h3>
                <button onClick={() => setIsDateSelectorOpen(false)}><X className="w-5 h-5 dark:text-white" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "last5days", "custom"].map((range) => (
                  <button
                    key={range}
                    onClick={() => handleDateRangeSelect(range)}
                    className={`py-3 rounded-xl border-2 text-sm font-bold capitalize transition-all ${
                      selectedDateRange === range ? "border-black dark:border-white bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] dark:bg-white text-white dark:text-black" : "border-gray-100 dark:border-gray-800 bg-white dark:bg-[#141414] text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {range === "last5days" ? "Last 5 Days" : range.replace(/([A-Z])/g, ' $1').trim()}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Custom Date Range Picker */}
      <AnimatePresence>
        {isCustomDateOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[60]"
              onClick={() => setIsCustomDateOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="fixed inset-0 m-auto w-[90%] max-w-sm h-fit bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-3xl shadow-2xl z-[60] p-6"
            >
              <DateRangeCalendar
                startDate={customDateRange.start}
                endDate={customDateRange.end}
                onDateRangeChange={(start, end) => {
                  setCustomDateRange({ start, end });
                }}
                onClose={() => setIsCustomDateOpen(false)}
              />
              <button
                onClick={handleCustomDateApply}
                className="w-full bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] dark:bg-white text-white dark:text-black py-4 rounded-2xl font-bold mt-4 shadow-xl active:scale-[0.98] transition-all"
              >
                Apply Custom Range
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Complaints Filter Popup */}
      <AnimatePresence>
        {isComplaintsFilterOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50/40 z-50 backdrop-blur-sm"
              onClick={() => setIsComplaintsFilterOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] rounded-t-[32px] shadow-2xl z-50 overflow-hidden"
              style={{ maxHeight: "80vh" }}
            >
              <div className="p-6 flex flex-col h-full">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold font-primary text-slate-900 dark:text-white">Filters</h3>
                  <button onClick={() => setIsComplaintsFilterOpen(false)} className="p-2 hover:bg-slate-50 dark:hover:bg-gray-800 rounded-full transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-6 mb-6">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Issue Type</h4>
                    <div className="flex flex-wrap gap-2">
                      {["Missing Item", "Wrong Item", "Quality Issue", "Delivery Delay", "Other"].map((type) => (
                        <button
                          key={type}
                          onClick={() => {
                            const current = complaintsFilterValues.issueType || [];
                            setComplaintsFilterValues({
                              ...complaintsFilterValues,
                              issueType: current.includes(type) ? [] : [type]
                            });
                          }}
                          className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                            complaintsFilterValues.issueType?.includes(type)
                              ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] dark:bg-white text-white dark:text-black shadow-lg shadow-slate-200 dark:shadow-none"
                              : "bg-slate-50 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-auto">
                  <button
                    onClick={handleComplaintsFilterReset}
                    className="flex-1 py-4 rounded-2xl font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleComplaintsFilterApply}
                    className="flex-[2] bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] dark:bg-white text-white dark:text-black py-4 rounded-2xl font-bold shadow-xl shadow-slate-200 dark:shadow-none active:scale-[0.98] transition-all"
                  >
                    Apply Filters
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reviews Filter Popup */}
      <AnimatePresence>
        {isFilterOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm"
              onClick={() => setIsFilterOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#242424] rounded-t-[32px] shadow-2xl z-50 overflow-hidden flex flex-col"
              style={{ maxHeight: "85vh" }}
            >
              {/* flex column + min-h-0 on the scroll area keeps the action row
                  on screen instead of letting it overflow past the clip on
                  short Android viewports. */}
              <div className="p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col min-h-0">
                <div className="flex justify-between items-center mb-6 shrink-0">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">Filter Reviews</h3>
                  <button type="button" onClick={() => setIsFilterOpen(false)} className="p-2 hover:bg-slate-50 dark:hover:bg-gray-800 rounded-full transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2 -mr-2 space-y-6 mb-6">
                  {/* Sort By */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Sort By</h4>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "newest", label: "Newest First" },
                        { value: "oldest", label: "Oldest First" },
                        { value: "bestRated", label: "Best Rated" },
                        { value: "worstRated", label: "Worst Rated" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFilterValues(prev => ({ ...prev, sortBy: option.value }))}
                          aria-pressed={filterValues.sortBy === option.value}
                          className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                            filterValues.sortBy === option.value
                              ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white shadow-lg shadow-slate-200 dark:shadow-none"
                              : "bg-slate-50 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Star Rating */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Star Rating</h4>
                    <div className="flex flex-wrap gap-2">
                      {[5, 4, 3, 2, 1].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => {
                            // Single-select: tapping a rating replaces the previous
                            // one, tapping the active one clears it. Appending here
                            // stacked ratings and made the list look unresponsive.
                            setFilterValues(prev => ({
                              ...prev,
                              reviewType: prev.reviewType.includes(star) ? [] : [star]
                            }))
                          }}
                          aria-pressed={filterValues.reviewType.includes(star)}
                          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                            filterValues.reviewType.includes(star)
                              ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white shadow-lg shadow-slate-200 dark:shadow-none"
                              : "bg-slate-50 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          {star} <Star className="w-3 h-3 fill-current" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-auto shrink-0">
                  <button
                    type="button"
                    onClick={handleFilterReset}
                    className="flex-1 py-4 rounded-2xl font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={handleFilterApply}
                    className="flex-[2] bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white py-4 rounded-2xl font-bold shadow-xl shadow-slate-200 dark:shadow-none active:scale-[0.98] transition-all"
                  >
                    Apply Filters
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <BottomNavOrders />
    </div>
  )
}







