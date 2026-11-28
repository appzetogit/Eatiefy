import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useSearchParams, Link, useNavigate, useNavigationType } from "react-router-dom"
import { 
  ArrowLeft, Star, Clock, Search, SlidersHorizontal, 
  ChevronDown, Bookmark, BadgePercent, Mic, Grid2x2,
  X, Utensils, Store, Loader2, History, MapPin
} from "lucide-react"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { useLocation as useGeoLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { searchAPI } from "@/services/api"
import { motion, AnimatePresence } from "framer-motion"
import OptimizedImage from "@food/components/OptimizedImage"
import { useVoiceSearch } from "@food/hooks/useVoiceSearch"
// Force HMR reload
import { RestaurantGridSkeleton } from "@food/components/ui/loading-skeletons"
import { Suspense, lazy } from "react"
import { useProfile } from "@food/context/ProfileContext"
import {
  buildVegModeQueryParams,
  filterCategoriesForVegMode,
  filterRestaurantsForVegMode,
  isVegMenuItem,
  matchesVegRestaurantFilter,
} from "@food/utils/vegMode"
const CategoryPage = lazy(() => import("../CategoryPage"))

// Helper to resolve media URLs consistently
const getMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('http')) return url;
  
  // Use VITE_API_BASE_URL to derive the backend origin
  const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1";
  const origin = apiBase.split('/api/v1')[0];
  
  return `${origin}${url.startsWith('/') ? url : '/' + url}`;
};

// Debounce hook for real-time search
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}

const SEARCH_HISTORY_KEY = "professional_search_history_v1"

export default function ProfessionalSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const navigate = useNavigate()
  const { location: userCoords } = useGeoLocation()
  const { zoneId } = useZone(userCoords)
  const { vegMode, vegModeOption } = useProfile()
  const searchMode = searchParams.get("mode") || "delivery"
  const isTakeawaySearch = searchMode === "takeaway"
  
  const [query, setQuery] = useState(initialQuery)
  const debouncedQuery = useDebounce(query, 500)
  
  const [results, setResults] = useState({ restaurants: [], dishes: [] })
  const [loading, setLoading] = useState(false)
  const { isListening, startListening, stopListening } = useVoiceSearch((transcript) => {
    setQuery(transcript)
    addToHistory(transcript)
  })
  const [categories, setCategories] = useState([])
  const [selectedCategoryId, setSelectedCategoryId] = useState(searchParams.get("cat") || null)
  const [history, setHistory] = useState([])
  const resultsRef = useRef(null)

  // Load search history
  useEffect(() => {
    const savedHistory = localStorage.getItem(SEARCH_HISTORY_KEY)
    if (savedHistory) setHistory(JSON.parse(savedHistory))
    fetchCategories()
  }, [])

  const navType = useNavigationType()
  const prevQueryRef = useRef(query);
  const prevCategoryRef = useRef(selectedCategoryId);
  const hasInitialScrolledRef = useRef(false);

  // Auto-scroll to results only when query ACTUALLY changes OR on fresh navigation (not BACK/FORWARD)
  useEffect(() => {
    const queryChanged = prevQueryRef.current !== query;
    const isFreshMount = !hasInitialScrolledRef.current;
    
    if (!loading && query && resultsRef.current) {
      if (queryChanged || (isFreshMount && navType !== "POP")) {
        prevQueryRef.current = query;
        hasInitialScrolledRef.current = true;
        
        const timer = setTimeout(() => {
          if (resultsRef.current) {
            const topOffset = resultsRef.current.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: topOffset, behavior: 'smooth' });
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [loading, query, navType])

  // Auto-scroll to results when category changes
  useEffect(() => {
    if (selectedCategoryId) {
      const timer = setTimeout(() => {
        if (resultsRef.current) {
          const topOffset = resultsRef.current.getBoundingClientRect().top + window.scrollY - 80;
          window.scrollTo({ top: topOffset, behavior: 'smooth' });
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [selectedCategoryId])

  const fetchCategories = async () => {
    try {
      const res = await searchAPI.getAdminCategories({ zoneId })
      if (res.data?.success) setCategories(res.data.data.categories || [])
    } catch (err) {
      console.error("Failed to fetch categories", err)
    }
  }

  const visibleCategories = useMemo(
    () => filterCategoriesForVegMode(categories, vegMode),
    [categories, vegMode],
  )

  // If a non-veg category was selected before veg mode turned on, clear it
  useEffect(() => {
    if (!vegMode || !selectedCategoryId) return
    const stillVisible = visibleCategories.some(
      (c) => String(c._id || c.id) === String(selectedCategoryId),
    )
    if (!stillVisible) setSelectedCategoryId(null)
  }, [vegMode, selectedCategoryId, visibleCategories])

  const addToHistory = (term) => {
    const newHistory = [term, ...history.filter(h => h !== term)].slice(0, 5)
    setHistory(newHistory)
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory))
  }

  const performSearch = useCallback(async (searchTerm, catId) => {
    if (!searchTerm && !catId) {
      setResults({ restaurants: [], dishes: [] })
      return
    }

    if (!zoneId) {
      setResults({ restaurants: [], dishes: [] })
      return
    }
    
    setLoading(true)
    try {
      const res = await searchAPI.unifiedSearch({
        q: searchTerm,
        categoryId: catId,
        lat: userCoords?.latitude,
        lng: userCoords?.longitude,
        limit: 50,
        zoneId,
        orderType: searchMode,
        // isVeg was sent for every option, so the server returned veg
        // restaurants even when "Non-veg only" was selected.
        ...buildVegModeQueryParams({ vegMode, vegModeOption }),
      })

      const all = res.data?.success ? (res.data.data?.restaurants || []) : []
      const restaurantsRaw = all.filter(r => (r.matchType === 'restaurant' || !r.matchType) && r.hasDishes !== false && (r.totalMenuItems === undefined || r.totalMenuItems > 0))
      const dishesRaw = all.filter(r => r.matchType === 'food')

      const restaurants = filterRestaurantsForVegMode(restaurantsRaw, {
        vegMode,
        vegModeOption,
      })
      const dishes = dishesRaw
        .filter((r) => {
          if (!vegMode) return true
          const item = {
            foodType: r.matchedDishFoodType || r.foodType,
            isVeg: r.isVeg,
          }
          return isVegMenuItem(item)
        })
        .filter((r) => matchesVegRestaurantFilter(r, { vegMode, vegModeOption }))

      setResults({ restaurants, dishes })
    } catch (err) {
      console.error("Search failed", err)
      setResults({ restaurants: [], dishes: [] })
    } finally {
      setLoading(false)
    }
  }, [userCoords, zoneId, searchMode, vegMode, vegModeOption])

  useEffect(() => {
    performSearch(debouncedQuery, selectedCategoryId)
    if (debouncedQuery) {
        setSearchParams({ q: debouncedQuery, ...(selectedCategoryId ? { cat: selectedCategoryId } : {}) }, { replace: true })
    }
  }, [debouncedQuery, selectedCategoryId, performSearch, setSearchParams])

  // Speech Recognition Implementation
  const handleVoiceSearch = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }

  const handleClear = () => {
    setQuery("")
    setSelectedCategoryId(null)
    setSearchParams({}, { replace: true })
    setResults({ restaurants: [], dishes: [] })
  }

  const handleCategoryClick = (id) => {
    if (selectedCategoryId === id) {
      if (resultsRef.current) {
        const topOffset = resultsRef.current.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: topOffset, behavior: 'smooth' });
      }
    } else {
      setSelectedCategoryId(id)
      setSearchParams({ ...Object.fromEntries(searchParams), cat: id }, { replace: true })
    }
  }

  const selectedCategoryObj = categories.find(c => c._id === selectedCategoryId)
  const selectedCategorySlug = selectedCategoryObj?.slug || selectedCategoryObj?._id || selectedCategoryObj?.name?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#141414]">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-zinc-800 px-3 py-2 sm:px-4 sm:py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2 sm:gap-3">
          <button 
            onClick={() => navigate(-1)} 
            className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-all active:scale-90"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
          
          <div className="flex-1 relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1F6B45] transition-transform group-focus-within:scale-110" strokeWidth={2.5} />
            <Input 
              autoFocus
              placeholder={isTakeawaySearch ? "Search takeaway restaurants..." : "Search dishes or restaurants"} 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 pr-12 h-10 sm:h-12 bg-gray-50 dark:bg-zinc-800/50 border-gray-100 dark:border-zinc-700 focus:border-[#1F6B45] dark:focus:border-[#1F6B45] focus:ring-4 focus:ring-[#1F6B45]/5 rounded-2xl text-sm sm:text-base transition-all"
            />
            
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {query && (
                <button 
                  onClick={handleClear} 
                  className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <div className="w-[1px] h-4 bg-gray-200 dark:bg-zinc-700 mx-0.5" />
              <button 
                onClick={handleVoiceSearch}
                className={`p-1.5 rounded-xl transition-all active:scale-95 ${isListening ? 'bg-red-50 text-red-500 animate-pulse' : 'text-[#1F6B45]'}`}
              >
                <Mic className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4">
        {/* Categories */}
        {!query && !isTakeawaySearch && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-5 px-1">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Top Categories</h3>
              {visibleCategories.length > 8 && (
                <span className="text-[10px] font-bold text-[#1F6B45] uppercase tracking-tighter">Swipe for more</span>
              )}
            </div>
            {categories.length === 0 ? (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-x-3 gap-y-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center animate-pulse">
                    <div className="w-15 h-15 sm:w-16 sm:h-16 rounded-[22px] bg-gray-100 dark:bg-zinc-800 mb-2" />
                    <div className="h-3 w-12 bg-gray-100 dark:bg-zinc-800 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : visibleCategories.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 px-1">No veg categories available</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-x-3 gap-y-6">
                {visibleCategories.map((cat) => (
                  <button 
                    key={cat._id} 
                    onClick={() => handleCategoryClick(cat._id)}
                    className="flex flex-col items-center group active:scale-95"
                  >
                    <div className={`relative w-15 h-15 sm:w-16 sm:h-16 rounded-[22px] mb-2 shadow-sm border-2 transition-colors duration-150 ${selectedCategoryId === cat._id ? 'border-[#1F6B45] shadow-md shadow-[#1F6B45]/5' : 'border-gray-50 dark:border-zinc-800 bg-white dark:bg-zinc-900 group-hover:border-gray-200'}`}>
                      <div className="absolute inset-0 rounded-[20px] overflow-hidden">
                        {cat.image ? (
                          <OptimizedImage 
                            src={getMediaUrl(cat.image)} 
                            alt={cat.name} 
                            className="w-full h-full object-cover" 
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-50">
                            <Utensils className="w-6 h-6 text-gray-200" />
                          </div>
                        )}
                      </div>
                    </div>
                    <span className={`text-[10px] sm:text-[11px] font-bold text-center line-clamp-1 transition-colors duration-150 ${selectedCategoryId === cat._id ? 'text-[#1F6B45]' : 'text-gray-500 dark:text-zinc-400 group-hover:text-gray-800'}`}>
                      {cat.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && !selectedCategorySlug && (
          <div className="space-y-6 mt-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between mb-5 px-1">
              <div className="h-4 w-32 bg-gray-100 dark:bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-16 bg-gray-100 dark:bg-zinc-800 rounded animate-pulse" />
            </div>
            <RestaurantGridSkeleton count={4} />
          </div>
        )}

        {/* Recent History */}
        {!query && !loading && history.length > 0 && (
          <div className="mb-8">
             <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Recently Searched</h3>
             <div className="flex flex-wrap gap-2">
                {history.map((term, i) => (
                  <button 
                    key={i} 
                    onClick={() => setQuery(term)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-full text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-50 transition-colors"
                  >
                    <History className="w-3 h-3" />
                    {term}
                  </button>
                ))}
             </div>
          </div>
        )}

        {/* Search Results or Embedded Category Page */}
        {selectedCategorySlug ? (
           <div ref={resultsRef} className="mt-4 -mx-4 sm:mx-0 min-h-[85vh]">
             <Suspense fallback={<div className="p-4"><RestaurantGridSkeleton count={4} /></div>}>
               <CategoryPage 
                 key={selectedCategorySlug}
                 embeddedCategorySlug={selectedCategorySlug} 
                 hideHeader={true} 
                 hideCategoryCarousel={true}
                 hideFilters={true}
                 disableAutoScroll={true}
               />
             </Suspense>
           </div>
        ) : !loading && query && (
          <div ref={resultsRef} className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Dish Results Section */}
            {results.dishes.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-5 px-1">
                   <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">Matched Dishes</h2>
                   <span className="text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-zinc-900 px-2 py-0.5 rounded-full">{results.dishes.length} results</span>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  {results.dishes.map((r) => {
                    const isDishVeg = isVegMenuItem({
                      foodType: r.matchedDishFoodType || r.foodType,
                      isVeg: r.isVeg,
                      pureVegRestaurant: r.pureVegRestaurant,
                    })
                    return (
                    <Link to={`/food/user/restaurants/${r.slug || r._id}${r.matchedDishId ? `?dish=${r.matchedDishId}` : ''}`} key={r._id} className="flex gap-4 p-3 bg-white dark:bg-zinc-900 rounded-[24px] shadow-sm border border-gray-100 dark:border-zinc-800 hover:shadow-xl hover:shadow-gray-200/50 dark:hover:shadow-none transition-all group overflow-hidden active:scale-[0.98]">
                       <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gray-50 dark:bg-zinc-800 flex-shrink-0 relative">
                           <OptimizedImage 
                            src={getMediaUrl(r.matchedDishImage || r.profileImage || r.image || (Array.isArray(r.images) && r.images[0]))} 
                            className="w-full h-full object-cover group-hover:scale-115 transition-transform duration-500"
                            fallback="/placeholder-dish.jpg"
                          />
                          <div className={`absolute top-1.5 left-1.5 w-4 h-4 border ${isDishVeg ? 'border-green-600' : 'border-red-600'} p-[1.5px] bg-white rounded-sm shadow-sm flex items-center justify-center`}>
                             <div className={`w-full h-full ${isDishVeg ? 'bg-green-600' : 'bg-red-600'} rounded-full`} />
                          </div>
                       </div>
                       <div className="flex-1 min-w-0 py-1">
                          <div className="text-[#6BAF8C] text-[9px] font-black uppercase tracking-wider mb-1 px-2 py-0.5 bg-[#1F6B45]/5 rounded-full w-fit">
                             {r.matchedDish || query}
                          </div>
                          <h3 className="text-base font-black text-gray-900 dark:text-white line-clamp-1 group-hover:text-[#1F6B45] transition-colors">{r.restaurantName}</h3>
                          <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-zinc-400 mt-2 font-medium">
                             <div className="flex items-center gap-1">
                                <Star className="w-3 h-3 text-[#1F6B45] fill-[#1F6B45]" />
                                <span className="font-black text-gray-900 dark:text-white">{r.rating || "New"}</span>
                             </div>
                             <span className="text-gray-200">•</span>
                             <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>{r.estimatedDeliveryTime || "30-40 mins"}</span>
                             </div>
                             <span className="text-gray-200">•</span>
                             <span className="line-clamp-1">{r.cuisines?.slice(0, 2).join(", ")}</span>
                          </div>
                       </div>
                    </Link>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Restaurant Results Section */}
            {results.restaurants.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-5 px-1">
                   <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">Restaurants</h2>
                   <span className="text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-zinc-900 px-2 py-0.5 rounded-full">{results.restaurants.length} stores</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6">
                  {results.restaurants.map((r) => (
                    <Link to={`/food/user/restaurants/${r.slug || r._id}`} key={r._id} className="block group active:scale-[0.98] transition-all">
                      <div className="relative rounded-[32px] overflow-hidden aspect-[16/10] sm:aspect-[16/9] mb-4 bg-gray-100 dark:bg-zinc-800 shadow-xl shadow-gray-200/20">
                         <OptimizedImage 
                          src={getMediaUrl(r.profileImage || r.image || (Array.isArray(r.images) && r.images[0]))} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                          fallback="/placeholder-restaurant.jpg"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80" />
                        <div className="absolute bottom-4 left-5 right-5 flex justify-between items-end">
                           <div className="min-w-0 flex-1 mr-2">
                              <h3 className="text-xl sm:text-2xl font-black text-white mb-1.5 truncate">{r.restaurantName}</h3>
                              <p className="text-white/80 text-[11px] font-bold uppercase tracking-wider line-clamp-1">{r.cuisines?.join(", ")}</p>
                           </div>
                           <div className="bg-white/10 backdrop-blur-xl border border-white/20 px-3 py-1.5 rounded-2xl flex items-center gap-1.5 shadow-2xl">
                              <Star className="w-4 h-4 text-white fill-white" />
                              <span className="text-white text-sm font-black">{r.rating || "4.0"}</span>
                           </div>
                        </div>
                        {r.offer && (
                           <div className="absolute top-5 left-0 bg-[#1F6B45] text-white text-[10px] font-black px-4 py-2 rounded-r-2xl shadow-xl flex items-center gap-1.5 tracking-tighter uppercase whitespace-nowrap">
                              <BadgePercent className="w-3.5 h-3.5" />
                              {r.offer}
                           </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-2">
                         <div className="flex items-center gap-3 text-[12px] text-gray-500 dark:text-zinc-400 font-bold uppercase tracking-tight">
                            <div className="flex items-center gap-1.5">
                               <Clock className="w-3.5 h-3.5 text-[#1F6B45]" />
                               {r.estimatedDeliveryTime || "30 mins"}
                            </div>
                            <span className="text-gray-200">•</span>
                            <div className="flex items-center gap-1.5">
                               <MapPin className="w-3.5 h-3.5 text-[#1F6B45]" />
                               {r.location?.area || "Nearby"}
                            </div>
                         </div>
                         <div className="text-[10px] font-black text-white bg-gradient-to-r from-[#1F6B45] to-[#6BAF8C] px-3 py-1.5 rounded-full uppercase tracking-widest shadow-lg shadow-[#1F6B45]/20">
                            View Menu
                         </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Empty State */}
            {!loading && results.restaurants.length === 0 && results.dishes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                 <div className="w-20 h-20 bg-slate-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-slate-300" />
                 </div>
                 <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">We couldn't find any results</h2>
                 <p className="text-slate-500 text-sm max-w-xs">Maybe try searching for something else or check your spelling</p>
                 <Button variant="outline" onClick={handleClear} className="mt-6 rounded-xl border-rose-500 text-rose-500 hover:bg-rose-50">
                    Clear all filters
                 </Button>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
