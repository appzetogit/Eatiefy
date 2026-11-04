import { useState, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { Tag, User, Soup, ShoppingCart, History, UtensilsCrossed, Cookie } from "lucide-react"
import { clearHomeScrollState } from "@food/utils/homeScrollRestore"
import { isFeatureEnabled } from "@food/services/publicAppConfig"
import { usePublicAppConfigOptional } from "@food/context/PublicAppConfigContext"
import useModuleAccess from "@food/hooks/useModuleAccess"

export default function BottomNavigation() {
  const location = useLocation()
  const pathname = location.pathname
  const publicConfig = usePublicAppConfigOptional()
  const [featureVersion, setFeatureVersion] = useState(0)

  useEffect(() => {
    const handleFeatureUpdate = () => {
      setFeatureVersion((v) => v + 1)
    }
    window.addEventListener("adminFeatureSettingUpdated", handleFeatureUpdate)
    window.addEventListener("businessSettingsUpdated", handleFeatureUpdate)
    window.addEventListener("storage", handleFeatureUpdate)
    return () => {
      window.removeEventListener("adminFeatureSettingUpdated", handleFeatureUpdate)
      window.removeEventListener("businessSettingsUpdated", handleFeatureUpdate)
      window.removeEventListener("storage", handleFeatureUpdate)
    }
  }, [])

  // Dining visibility follows the admin Customization Settings toggle. The older
  // `dining_control` feature setting still applies on top, so either switch can
  // hide the tab, but neither can show it once dining itself is turned off.
  const { diningEnabled: diningModuleEnabled, sweetsEnabled } = useModuleAccess()

  const getDiningFeatureEnabled = () => {
    try {
      const local = localStorage.getItem("food_feature_dining_control")
      if (local != null) return local === "true"
    } catch {}
    const diningFeature = (publicConfig?.featureSettings || []).find((f) => f.key === "dining_control")
    if (diningFeature != null) return Boolean(diningFeature.isEnabled)
    return isFeatureEnabled("dining_control", true)
  }
  const diningEnabled = diningModuleEnabled && getDiningFeatureEnabled()

  // Check active routes - support both /user/* and /* paths
  const isCart = pathname === "/food/cart" || pathname.startsWith("/food/user/cart")
  const isUnder250 = pathname === "/food/under-250" || pathname.startsWith("/food/user/under-250")
  const isReorder = pathname === "/food/reorder" || pathname.startsWith("/food/user/reorder")
  const isDining = pathname === "/food/dining" || pathname.startsWith("/food/user/dining") || pathname.startsWith("/food/dining")
  const isSweets = pathname === "/food/sweets" || pathname.startsWith("/food/user/sweets") || pathname.startsWith("/food/sweets")
  const isProfile = pathname.startsWith("/food/profile") || pathname.startsWith("/food/user/profile")
  const isDelivery =
    !isCart &&
    !isUnder250 &&
    !isReorder &&
    !isDining &&
    !isSweets &&
    !isProfile &&
    (pathname === "/food" ||
      pathname === "/food/" ||
      pathname === "/food/user" ||
      (pathname.startsWith("/food/user") &&
        !pathname.includes("/cart") &&
        !pathname.includes("/under-250") &&
        !pathname.includes("/reorder") &&
        !pathname.includes("/dining") &&
        !pathname.includes("/sweets") &&
        !pathname.includes("/profile")))

  const activeColor = "var(--module-theme-color, #E2AD4B)"
  const activeBg = "rgba(var(--module-theme-rgb, 226,173,75), 0.12)"
  const activeFill = "rgba(var(--module-theme-rgb, 226,173,75), 0.2)"

  const handleHomeNavClick = () => {
    // Explicit Home tab should start at top, not restore a prior restaurant leave position.
    clearHomeScrollState()
  }

  return (
    <div
      className="md:hidden fixed bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))] left-4 right-4 z-50 pointer-events-none transition-transform duration-300 ease-in-out"
      style={{ transform: "translateY(var(--bottom-nav-y, 0px))" }}
    >
      <div className="flex items-center justify-around h-auto px-1.5 py-1.5 bg-white/90 dark:bg-[#242424]/90 backdrop-blur-[20px] border border-white/50 dark:border-white/10 rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.15)] pointer-events-auto">
        
        {/* Food Tab */}
        <Link
          to="/food/user"
          onClick={handleHomeNavClick}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-all duration-300 relative rounded-full ${isDelivery
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isDelivery ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <Soup className={`h-5 w-5 transition-transform duration-300 ${isDelivery ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isDelivery ? 2.5 : 2} style={isDelivery ? { color: activeColor, fill: activeFill } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isDelivery ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Food
          </span>
        </Link>

        {/* Cart Tab */}
        <Link
          to="/food/user/cart"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-all duration-300 relative rounded-full ${isCart
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isCart ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <ShoppingCart className={`h-5 w-5 transition-transform duration-300 ${isCart ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isCart ? 2.5 : 2} style={isCart ? { color: activeColor } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isCart ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Cart
          </span>
        </Link>

        {/* Under 250 Tab */}
        <Link
          to="/food/user/under-250"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-all duration-300 relative rounded-full ${isUnder250
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isUnder250 ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <Tag className={`h-5 w-5 transition-transform duration-300 ${isUnder250 ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isUnder250 ? 2.5 : 2} style={isUnder250 ? { color: activeColor, fill: activeFill } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isUnder250 ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Eatiefy 99
          </span>
        </Link>

        {/* Reorder Tab */}
        <Link
          to="/food/user/reorder"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-all duration-300 relative rounded-full ${isReorder
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isReorder ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <History className={`h-5 w-5 transition-transform duration-300 ${isReorder ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isReorder ? 2.5 : 2} style={isReorder ? { color: activeColor } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isReorder ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Orders
          </span>
        </Link>

        {/* Dining Tab (Dynamic from Admin Toggle) */}
        {diningEnabled && (
          <Link
            to="/food/user/dining"
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-all duration-300 relative rounded-full ${isDining
                ? ""
                : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
              }`}
            style={isDining ? { color: activeColor, backgroundColor: activeBg } : undefined}
          >
            <div className="relative">
              <UtensilsCrossed className={`h-5 w-5 transition-transform duration-300 ${isDining ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isDining ? 2.5 : 2} style={isDining ? { color: activeColor, fill: activeFill } : undefined} />
            </div>
            <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isDining ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
              Dining
            </span>
          </Link>
        )}

        {/* Sweets & Bakery Tab (Dynamic from Admin Toggle) */}
        {sweetsEnabled && (
          <Link
            to="/food/user/sweets"
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-all duration-300 relative rounded-full ${isSweets
                ? ""
                : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
              }`}
            style={isSweets ? { color: activeColor, backgroundColor: activeBg } : undefined}
          >
            <div className="relative">
              <Cookie className={`h-5 w-5 transition-transform duration-300 ${isSweets ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isSweets ? 2.5 : 2} style={isSweets ? { color: activeColor, fill: activeFill } : undefined} />
            </div>
            <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isSweets ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
              Sweets
            </span>
          </Link>
        )}

      </div>
    </div>
  )
}
