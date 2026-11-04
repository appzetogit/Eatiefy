import { useEffect, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Cookie, Loader2 } from "lucide-react"
import { Button } from "@food/components/ui/button"
import AnimatedPage from "@food/components/user/AnimatedPage"
import RestaurantCard from "@food/components/user/RestaurantCard"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { useLocation as useLocationHook } from "@food/hooks/useLocation"
import { restaurantAPI } from "@food/api"

/** Browse-only list of restaurants admin has tagged as a sweet shop / bakery. */
export default function SweetsBakery() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { effectiveLocation } = useLocationHook()
  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchSweetShops = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const params = { isSweetShop: "true", limit: 100 }
      if (Number.isFinite(effectiveLocation?.latitude) && Number.isFinite(effectiveLocation?.longitude)) {
        params.lat = effectiveLocation.latitude
        params.lng = effectiveLocation.longitude
      }

      const res = await restaurantAPI.getRestaurants(params)
      const list = res?.data?.data?.restaurants || res?.data?.restaurants || []

      setRestaurants(
        list.map((r) => ({
          id: r.restaurantId || r._id,
          mongoId: r._id,
          name: r.restaurantName || r.name || "",
          slug: r.slug,
          cuisine: Array.isArray(r.cuisines) && r.cuisines.length > 0 ? r.cuisines[0] : "Sweets & Bakery",
          rating: Number(r.rating) || 0,
          deliveryTime:
            r.estimatedDeliveryTime ||
            (r.estimatedDeliveryTimeMinutes ? `${r.estimatedDeliveryTimeMinutes} mins` : "25-30 mins"),
          avgPrice: r.featuredPrice ? `₹${r.featuredPrice} for one` : undefined,
          image: r.profileImage || r.coverImages?.[0] || "",
          images: Array.isArray(r.coverImages) ? r.coverImages : [],
          offer: r.offer || r.activeOffers?.[0]?.summary || null,
        }))
      )
    } catch (err) {
      setError("Failed to load sweet shops")
      setRestaurants([])
    } finally {
      setLoading(false)
    }
  }, [effectiveLocation?.latitude, effectiveLocation?.longitude])

  useEffect(() => {
    fetchSweetShops()
  }, [fetchSweetShops])

  const handleOpenRestaurant = (restaurant) => {
    navigate(`/food/user/restaurants/${restaurant.slug || restaurant.id}`)
  }

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#141414]">
      <div className="max-w-5xl mx-auto px-4 py-4 pb-24">
        <div className="flex items-center gap-3 mb-5">
          <Button variant="ghost" size="icon" className="h-9 w-9 p-0" onClick={goBack}>
            <ArrowLeft className="h-5 w-5 text-black dark:text-white" />
          </Button>
          <div className="flex items-center gap-2">
            <Cookie className="h-5 w-5 text-[#1F6B45]" />
            <h1 className="text-xl font-bold text-black dark:text-white">Sweets & Bakery</h1>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#1F6B45]" />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-20">{error}</p>
        ) : restaurants.length === 0 ? (
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-20">
            No sweet shops or bakeries available in your area yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {restaurants.map((restaurant) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                isFavorite={false}
                onFavoriteClick={() => {}}
                onClick={() => handleOpenRestaurant(restaurant)}
              />
            ))}
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}
