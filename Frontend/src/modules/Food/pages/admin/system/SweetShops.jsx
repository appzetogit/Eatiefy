import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Gift, Loader2 } from "lucide-react"
import { adminAPI } from "@food/api"

/** Read-only roster of restaurants admin has tagged as a sweet shop/bakery (set from the restaurant edit screen). */
export default function SweetShops() {
  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const res = await adminAPI.getRestaurants({ isSweetShop: true })
        const list = res?.data?.data?.restaurants || res?.data?.restaurants || []
        if (!cancelled) setRestaurants(list)
      } catch (e) {
        if (!cancelled) setError("Failed to load sweet shops")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-400 to-pink-600 flex items-center justify-center">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Sweet Shops</h1>
        </div>
        <p className="text-sm text-slate-600">
          Restaurants tagged "Sweet Shop / Bakery" from the restaurant edit screen. They appear in the user app's Sweets & Bakery tab.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-pink-600" />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-red-600 py-12">{error}</p>
        ) : restaurants.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-12">
            No restaurant is tagged as a sweet shop yet. Tag one from the restaurant edit screen.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Restaurant</th>
                <th className="text-left px-4 py-3">Area</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Active</th>
                <th className="text-left px-4 py-3">Rating</th>
                <th className="text-right px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {restaurants.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.restaurantName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.area || r.location?.area || r.city || "-"}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{r.status}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.isActive !== false ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                      {r.isActive !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{Number(r.rating) || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/admin/food/restaurants/edit/${r._id}`} className="text-pink-600 hover:underline font-medium">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
