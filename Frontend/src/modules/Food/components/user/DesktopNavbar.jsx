import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useState, useRef, useMemo } from "react"
import { ChevronDown, ShoppingCart, Wallet, Search, Mic } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Switch } from "@food/components/ui/switch"
import { useLocation as useLocationHook } from "@food/hooks/useLocation"
import { useCart } from "@food/context/CartContext"
import { useLocationSelector, useSearchOverlay } from "./UserLayout"
import { useProfile } from "@food/context/ProfileContext"
import { FaLocationDot } from "react-icons/fa6"
import { AnimatePresence, motion } from "framer-motion"
import eatiefyLogo from "@food/assets/logo.png"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import api from "@food/api"
import { isModuleAuthenticated } from "@food/utils/auth"
import {
  getCachedUnder250PriceLimit,
  getLandingSettingsPublic,
} from "@food/utils/foodPageCache"
import useModuleAccess from "@food/hooks/useModuleAccess";
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function DesktopNavbar({ showLogo = true }) {
  const { diningEnabled, takeawayEnabled, sweetsEnabled } = useModuleAccess();
    const location = useLocation()
    const navigate = useNavigate()
    const { location: userLocation, loading: locationLoading } = useLocationHook()
    const { getCartCount } = useCart()
    const { openLocationSelector } = useLocationSelector()
    const { setSearchValue } = useSearchOverlay()
    const { vegMode, setVegMode, vegModeOption } = useProfile()
    const [heroSearch, setHeroSearch] = useState("")
    const [logoUrl, setLogoUrl] = useState(null)
    const [companyName, setCompanyName] = useState(null)
    const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false)
    const [under250PriceLimit, setUnder250PriceLimit] = useState(() =>
      getCachedUnder250PriceLimit(250),
    )
    const navRef = useRef(null)
    const cartCount = getCartCount()


    // Show area if available, otherwise show city
    const areaName = userLocation?.area && userLocation?.area.trim() ? userLocation.area.trim() : null
    const cityName = userLocation?.city || "Indore"
    const fullAddress = userLocation?.address || userLocation?.formattedAddress || ""
    
    // Main location name: Show area
    const mainLocationName = useMemo(() => {
        let name = areaName || "Select Location"
        if (/^-?\d+(\.\d+)?$/.test(name.trim())) {
            return "Current Location"
        }
        return name
    }, [areaName])
    
    // Middle location: Show full address (base address) - Cleaned up
    const baseAddress = useMemo(() => {
        let addr = fullAddress || ""
        if (cityName) {
            addr = addr.replace(new RegExp(`,?\\s*${cityName}\\s*`, 'gi'), '').trim()
        }
        if (areaName && areaName.length > 3) {
            addr = addr.replace(new RegExp(`^${areaName},?\\s*`, 'i'), '').trim()
        }
        if (/^-?\d+\.\d+,\s*-?\\s*\d+\.\d+$/.test(fullAddress.trim()) || /^-?\d+\.\d+,\s*-?\\s*\d+\.\d+$/.test(addr.trim()) || !addr || addr === ",") {
            return "Pinpoint location"
        }
        return addr
    }, [fullAddress, cityName, areaName])
    
    // Bottom location: Show city
    const bottomCity = cityName

    const handleLocationClick = () => {
        // Open location selector overlay
        openLocationSelector()
    }

    const isDining = location.pathname === "/food/user/dining" || location.pathname === "/food/dining"
    const isSweets = location.pathname === "/food/user/sweets" || location.pathname === "/food/sweets"
    const isTakeaway = location.pathname === "/food/user/takeaway" || location.pathname === "/food/takeaway"
    const isUnder250 = location.pathname === "/food/user/under-250" || location.pathname === "/food/under-250"
    const isProfile = location.pathname.startsWith("/food/user/profile") || location.pathname.startsWith("/food/profile")
    const isDelivery = !isDining && !isSweets && !isTakeaway && !isUnder250 && !isProfile && (location.pathname === "/food/user" || location.pathname === "/food" || (location.pathname.startsWith("/food/user") && !location.pathname.includes("/dining") && !location.pathname.includes("/sweets") && !location.pathname.includes("/takeaway") && !location.pathname.includes("/under-250") && !location.pathname.includes("/profile")))
    const isBannerRoute =
        location.pathname === "/food/user" ||
        location.pathname === "/food" ||
        location.pathname === "/food/user/takeaway" ||
        location.pathname === "/food/takeaway" ||
        location.pathname === "/food/user/under-250" ||
        location.pathname === "/food/under-250"

    // Load business settings logo
    useEffect(() => {
        const loadLogo = async () => {
            try {
                const cached = getCachedSettings()
                if (cached) {
                    if (cached.logo?.url) {
                        setLogoUrl(cached.logo.url)
                    }
                    if (cached.companyName) {
                        setCompanyName(cached.companyName)
                    }
                } else {
                    const settings = await loadBusinessSettings()
                    if (settings) {
                        if (settings.logo?.url) {
                            setLogoUrl(settings.logo.url)
                        }
                        if (settings.companyName) {
                            setCompanyName(settings.companyName)
                        }
                    }
                }
            } catch (error) {
                debugError('Error loading logo:', error)
            }
        }
        loadLogo()

        // Listen for business settings updates
        const handleSettingsUpdate = () => {
            const cached = getCachedSettings()
            if (cached) {
                if (cached.logo?.url) {
                    setLogoUrl(cached.logo.url)
                }
                if (cached.companyName) {
                    setCompanyName(cached.companyName)
                }
            }
        }
        window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)

        return () => {
            window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
        }
    }, [])

    useEffect(() => {
        if (!isBannerRoute) {
            setHasScrolledPastBanner(true)
            return
        }

        const handleScroll = () => {
            const heroShell =
                document.querySelector('[data-home-hero-shell="true"]') ||
                document.querySelector('[data-banner-shell="true"]')
            const navElement = navRef.current

            if (!heroShell || !navElement) {
                setHasScrolledPastBanner(false)
                return
            }

            const heroRect = heroShell.getBoundingClientRect()
            const navHeight = navElement.getBoundingClientRect().height || 0
            setHasScrolledPastBanner(heroRect.bottom <= navHeight)
        }

        handleScroll()
        window.addEventListener("scroll", handleScroll, { passive: true })
        window.addEventListener("resize", handleScroll)

        return () => {
            window.removeEventListener("scroll", handleScroll)
            window.removeEventListener("resize", handleScroll)
        }
    }, [isBannerRoute])

    // Fetch landing settings to get dynamic price limit (shared cache)
    useEffect(() => {
        let cancelled = false
        getLandingSettingsPublic(() => api.get("/food/landing/settings/public"))
            .then((settings) => {
                if (cancelled) return
                if (settings && typeof settings.under250PriceLimit === "number") {
                    setUnder250PriceLimit(settings.under250PriceLimit)
                }
            })
            .catch(() => {
                if (!cancelled) setUnder250PriceLimit(250)
            })
        return () => {
            cancelled = true
        }
    }, [])

    return (
        <nav
            ref={navRef}
            className="hidden md:flex flex-col fixed top-0 left-0 right-0 z-50 py-2 transition-all duration-300 bg-white dark:bg-[#242424] border-b border-gray-200 dark:border-gray-800 shadow-sm"
        >
            {/* Top Row: Location - Search - Icons */}
            <div className="w-full border-b border-gray-100 dark:border-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16 gap-4">
                        {/* Left: Logo & Location */}
                        <div className="flex items-center gap-4 lg:gap-6 flex-shrink-0">
                            {/* Logo */}
                            {showLogo && (
                                <Link to="/food/user" className="flex items-center justify-center flex-shrink-0">
                                    {logoUrl || companyName ? (
                                        <img
                                            src={logoUrl || eatiefyLogo}
                                            alt={companyName || "Company Logo"}
                                            className="h-10 w-auto md:h-14 lg:h-16 object-contain"
                                            onError={(e) => {
                                                    e.currentTarget.onerror = null
                                                    if (eatiefyLogo && e.currentTarget.src !== eatiefyLogo) {
                                                      e.currentTarget.src = eatiefyLogo
                                                    } else {
                                                      e.currentTarget.style.display = 'none'
                                                }
                                            }}
                                        />
                                    ) : (
                                        <img src={eatiefyLogo} alt={companyName || "Logo"} className="h-10 w-auto md:h-14 lg:h-16 object-contain" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
                                    )}
                                </Link>
                            )}

                            {/* Location only editable on Delivery home; other tabs show static heading */}
                            {isDelivery ? (
                              <Button
                                variant="ghost"
                                onClick={handleLocationClick}
                                disabled={locationLoading}
                                className="h-auto px-0 py-0 hover:bg-transparent transition-colors flex-shrink-0"
                              >
                                {locationLoading ? (
                                    <span className="text-sm font-bold text-black dark:text-white">
                                        Loading...
                                    </span>
                                ) : (
                                    <div className="flex flex-col items-start min-w-0">
                                        <div className="flex items-center gap-1.5 lg:gap-2">
                                            <FaLocationDot
                                                className="h-5 w-5 lg:h-6 lg:w-6 text-black dark:text-white flex-shrink-0"
                                                fill="currentColor"
                                                strokeWidth={2}
                                            />
                                            <span className="text-sm lg:text-base font-bold text-black dark:text-white whitespace-nowrap">
                                                {mainLocationName}
                                            </span>
                                            <ChevronDown className="h-4 w-4 lg:h-5 lg:w-5 text-black dark:text-white flex-shrink-0" strokeWidth={2.5} />
                                        </div>
                                        {baseAddress && (
                                            <span className="text-[10px] lg:text-xs font-medium text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                                                {baseAddress}
                                            </span>
                                        )}
                                        <span className="text-[9px] lg:text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest leading-none">
                                            {bottomCity}
                                        </span>
                                    </div>
                                )}
                              </Button>
                            ) : (
                              <div className="flex flex-col items-start min-w-0 px-1">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.18em]">
                                  {isTakeaway ? "Self-Pickup" : isDining ? "Table Booking" : isUnder250 ? "Budget Meals" : "Account"}
                                </span>
                                <span className="text-sm lg:text-base font-bold text-black dark:text-white">
                                  {isTakeaway ? "Takeaway" : isDining ? "Dining" : isUnder250 ? `Under ₹${under250PriceLimit}` : "Profile"}
                                </span>
                              </div>
                            )}
                        </div>

                        {/* Center: Search Bar & Veg Mode */}
                        <div className="flex-1 max-w-3xl mx-4 flex items-center gap-4">
                            {/* Search Bar */}
                            <div className="relative flex-1">
                                <div className="relative bg-gray-100 dark:bg-[#2a2a2a] rounded-lg transition-all duration-300 focus-within:ring-2 focus-within:ring-[#1F6B45] focus-within:bg-white dark:focus-within:bg-[#242424] border border-transparent focus-within:border-[#1F6B45]/20">
                                    <div className="flex items-center px-3 py-2">
                                        <Search className="h-4 w-4 text-gray-500 flex-shrink-0 mr-3" />
                                        <Input
                                            value={heroSearch}
                                            onChange={(e) => {
                                                const nextValue = e.target.value
                                                setHeroSearch(nextValue)
                                                setSearchValue(nextValue)
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && heroSearch.trim()) {
                                                    navigate(`/food/search?q=${encodeURIComponent(heroSearch.trim())}`)
                                                }
                                            }}
                                            className="h-6 p-0 border-0 bg-transparent text-sm font-medium placeholder:text-gray-500 focus-visible:ring-0 focus-visible:ring-offset-0"
                                            placeholder="Search for restaurants, food..."
                                        />
                                        {heroSearch && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full ml-1"
                                                onClick={() => setHeroSearch("")}
                                            >
                                                <span className="sr-only">Clear</span>
                                                <span aria-hidden="true">�</span>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* VEG MODE Toggle - Moved here */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 leading-none">
                                      VEG
                                    </span>
                                    <span className="text-[8px] font-bold text-gray-500 dark:text-gray-400 leading-none">MODE</span>
                                </div>
                                <Switch
                                    checked={vegMode}
                                    onCheckedChange={setVegMode}
                                    className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-gray-300 dark:data-[state=unchecked]:bg-gray-600 h-5 w-9"
                                />
                            </div>
                        </div>

                        {/* Right: Wallet and Cart Icons */}
                        <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
                            {/* Wallet Icon */}
                            <Link 
                                to="/food/user/wallet"
                                onClick={(e) => {
                                    if (!isModuleAuthenticated('user')) {
                                        e.preventDefault();
                                        window.dispatchEvent(new CustomEvent('show-login-required'));
                                    }
                                }}
                            >
                                <Button
                                    variant="ghost"
                                    className="h-12 w-12 lg:h-14 lg:w-14 rounded-full p-0 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    title="Wallet"
                                >
                                    <Wallet className="!h-5 !w-5 lg:!h-6 lg:!w-6 text-gray-700 dark:text-gray-300" strokeWidth={2} />
                                </Button>
                            </Link>

                            {/* Cart Icon */}
                            <Link to="/food/user/cart" state={{ from: location.pathname }}>
                                <Button
                                    variant="ghost"
                                    className="relative h-12 w-12 lg:h-14 lg:w-14 rounded-full p-0 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    title="Cart"
                                >
                                    <ShoppingCart className="!h-5 !w-5 lg:!h-6 lg:!w-6 text-gray-700 dark:text-gray-300" strokeWidth={2} />
                                    {cartCount > 0 && (
                                        <span className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center ring-2 ring-white dark:ring-gray-800">
                                            <span className="text-xs font-bold text-white">{cartCount > 99 ? "99+" : cartCount}</span>
                                        </span>
                                    )}
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Row: Navigation Tabs & Veg Mode */}
            <div className="w-full pb-3 bg-white dark:bg-[#242424]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-center h-12">
                        {/* Navigation Tabs - Centered with spacing */}
                        <div className="flex items-center space-x-12 lg:space-x-16 xl:space-x-20">
                            {/* Delivery Tab */}
                            <Link
                                to="/food/user"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isDelivery
                                    ? "text-[#1F6B45]"
                                    : "text-gray-600 dark:text-gray-400 hover:text-[#1F6B45]"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Delivery</span>
                                {isDelivery && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-[#1F6B45]"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>

                            {/* Takeaway Tab */}
                            {takeawayEnabled && (
                            <Link
                                to="/food/user/takeaway"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isTakeaway
                                    ? "text-[#1F6B45]"
                                    : "text-gray-600 dark:text-gray-400 hover:text-[#1F6B45]"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Takeaway</span>
                                {isTakeaway && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-[#1F6B45]"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>
                            )}

                            {/* Under 250 Tab */}
                            <Link
                                to="/food/user/under-250"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isUnder250
                                    ? "text-[#1F6B45]"
                                    : "text-gray-600 dark:text-gray-400 hover:text-[#1F6B45]"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Under ₹{under250PriceLimit}</span>
                                {isUnder250 && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-[#1F6B45]"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>

                            {/* Dining Tab — gated by diningEnabled */}
                            {diningEnabled && (
                            <Link
                                to="/food/user/dining"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isDining
                                    ? "text-[#1F6B45]"
                                    : "text-gray-600 dark:text-gray-400 hover:text-[#1F6B45]"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Dining</span>
                                {isDining && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-[#1F6B45]"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>
                            )}

                            {/* Sweets & Bakery Tab — gated by sweetsEnabled */}
                            {sweetsEnabled && (
                            <Link
                                to="/food/user/sweets"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isSweets
                                    ? "text-[#1F6B45]"
                                    : "text-gray-600 dark:text-gray-400 hover:text-[#1F6B45]"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Sweets</span>
                                {isSweets && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-[#1F6B45]"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>
                            )}

                            {/* Profile Tab */}
                            <Link
                                to="/food/user/profile"
                                state={{ from: location.pathname }}
                                onClick={(e) => {
                                    if (!isModuleAuthenticated('user')) {
                                        e.preventDefault();
                                        window.dispatchEvent(new CustomEvent('show-login-required'));
                                    }
                                }}
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isProfile
                                    ? "text-[#1F6B45]"
                                    : "text-gray-600 dark:text-gray-400 hover:text-[#1F6B45]"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Profile</span>
                                {isProfile && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-[#1F6B45]"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    )
}


