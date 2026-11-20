import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react"
import { Link, useLocation, useNavigationType } from "react-router-dom"
import {
  Search,
  FileText,
  Calendar,
  Clock,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Link as LinkIcon,
  UtensilsCrossed,
  Building2,
  FolderTree,
  Plus,
  Utensils,
  Megaphone,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  LayoutDashboard,
  Gift,
  DollarSign,
  Image,
  Bell,
  MessageSquare,
  Mail,
  Users,
  Wallet,
  Award,
  Truck,
  Package,
  CreditCard,
  Settings,
  UserCog,
  User,
  Globe,
  Palette,
  Camera,
  LogIn,
  Database,
  Zap,
  Phone,
  IndianRupee,
  PiggyBank,
  Lock,
  UserX,
  Headset,
  FileX,
} from "lucide-react"
import { cn } from "@food/utils/utils"
import { Input } from "@food/components/ui/input"
import { adminSidebarMenu } from "@food/utils/adminSidebarMenu"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import { filterSidebarMenuByPermissions } from "@food/utils/subAdminPermissions"
import { getCurrentUser } from "@food/utils/auth"
import { adminAPI } from "@food/api"
import { dispatchAdminNotificationsUpdated } from "@food/hooks/useAdminNotifications"
import eatiefyLogo from "@food/assets/logo.png"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


// Icon mapping
const iconMap = {
  LayoutDashboard,
  UtensilsCrossed,
  Building2,
  FileText,
  Calendar,
  Clock,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Link: LinkIcon,
  FolderTree,
  Plus,
  Utensils,
  Megaphone,
  Gift,
  DollarSign,
  Image,
  Bell,
  MessageSquare,
  Mail,
  Users,
  Wallet,
  Award,
  Truck,
  Package,
  CreditCard,
  Settings,
  UserCog,
  User,
  Globe,
  Palette,
  Camera,
  LogIn,
  Database,
  Zap,
  Phone,
  IndianRupee,
  PiggyBank,
  Lock,
  X,
  FileX,
  UserX,
  Headset,
}

// Sidebar Skeleton Loader Component
const SidebarSkeleton = ({ isCollapsed }) => {
  return (
    <div className="space-y-6 px-3 py-4 animate-pulse">
      {[1, 2, 3].map((sectionIndex) => (
        <div key={sectionIndex} className="space-y-3">
          {/* Section Header Skeleton */}
          {!isCollapsed && (
            <div className="h-4 w-24 bg-neutral-800/60 rounded mb-2 ml-3" />
          )}
          {/* Section Items Skeletons */}
          {[1, 2, 3, 4].map((itemIndex) => (
            <div
              key={itemIndex}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg bg-neutral-900/40",
                isCollapsed ? "justify-center" : ""
              )}
            >
              {/* Icon Placeholder */}
              <div className="w-4 h-4 bg-neutral-800/80 rounded-full shrink-0" />
              {/* Text Placeholder */}
              {!isCollapsed && (
                <div 
                  className="h-3 bg-neutral-800/70 rounded flex-1" 
                  style={{ width: `${Math.floor(Math.random() * 40) + 40}%` }} 
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}


/** Dispatch refresh for sidebar notification badges. Optional key optimistically decrements before refetch. */
export function refreshSidebarBadges(decrement, options = {}) {
  window.dispatchEvent(
    new CustomEvent("refresh-sidebar-badges", {
      detail: decrement ? { decrement } : undefined,
    }),
  )
  if (options.reloadNotifications !== false) {
    dispatchAdminNotificationsUpdated()
  }
}

function dispatchAdminListRefresh(counts, changedKeys) {
  if (!changedKeys?.length) return
  window.dispatchEvent(
    new CustomEvent("admin-list-refresh", {
      detail: { counts, changedKeys },
    }),
  )
}

function getBadgeKeyForPath(path = "") {
  const p = String(path || "").toLowerCase()
  if (p.includes("food-approval")) return "foodApprovals"
  if (p.endsWith("/admin/food/categories")) return "categories"
  if (p.includes("restaurants/joining-request")) return "restaurants"
  if (p.includes("delivery-partners/join-request")) return "deliveryPartners"
  if (p.includes("orders/pending")) return "orders"
  return null
}

function refreshAdminListForPath(path = "") {
  const key = getBadgeKeyForPath(path)
  if (key) {
    dispatchAdminListRefresh({}, [key])
  }
}

export default function AdminSidebar({ isOpen = false, onClose, onCollapseChange }) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const [searchQuery, setSearchQuery] = useState("")
  const [badges, setBadges] = useState({})
  const isInitialRender = useRef(true)
  const sidebarNavRef = useRef(null)
  const lastScrolledPathname = useRef(null)
  const hasScrolledOnMount = useRef(false)
  const badgeCountsRef = useRef({})
  const pendingNavScrollPath = useRef(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const res = await adminAPI.getSidebarBadges()
        if (res?.data?.success) {
          const nextCounts = res.data.counts || {}
          const prevCounts = badgeCountsRef.current || {}
          const changedKeys = Object.keys({ ...prevCounts, ...nextCounts }).filter(
            (key) => (prevCounts[key] ?? 0) !== (nextCounts[key] ?? 0),
          )
          badgeCountsRef.current = nextCounts
          setBadges(nextCounts)
          if (changedKeys.length > 0) {
            dispatchAdminListRefresh(nextCounts, changedKeys)
          }
        }
      } catch (error) {
        debugError("Error fetching sidebar badges:", error)
      } finally {
        setIsLoading(false)
      }
    }

    const handleRefreshBadges = (event) => {
      const decrement = event?.detail?.decrement
      if (decrement) {
        setBadges((prev) => ({
          ...prev,
          [decrement]: Math.max(0, (prev[decrement] ?? 0) - 1),
        }))
      }
      fetchBadges()
    }

    fetchBadges()
    const timer = setInterval(fetchBadges, 15000)

    window.addEventListener("refresh-sidebar-badges", handleRefreshBadges)

    // Fallback timer to turn off loading in case network hangs or is slow
    const fallbackTimer = setTimeout(() => {
      setIsLoading(false)
    }, 700)

    return () => {
      clearInterval(timer)
      clearTimeout(fallbackTimer)
      window.removeEventListener("refresh-sidebar-badges", handleRefreshBadges)
    }
  }, [])

  const getBadgeCount = (label = "", path = "") => {
    const l = label.toLowerCase()
    const p = path?.toLowerCase() || ""

    // Path-based (sub-menu items & direct links)
    if (p.includes("food-approval")) return badges.foodApprovals ?? 0
    if (p.endsWith("/admin/food/categories")) return badges.categories ?? 0
    if (p.includes("restaurants/joining-request")) return badges.restaurants ?? 0
    if (p.includes("restaurants/complaints")) return badges.restaurantComplaints ?? 0
    if (p.includes("orders/pending")) return badges.orders ?? 0
    if (p.includes("offline-payments")) return badges.offlinePayments ?? 0
    if (p.includes("delivery-support-tickets")) return badges.deliverySupportTickets ?? 0
    if (p.includes("/support-tickets")) return badges.userSupportTickets ?? 0
    if (p.includes("delivery-withdrawal")) return badges.deliveryWithdrawals ?? 0
    if (p.includes("cash-confirmations")) return badges.cashConfirmations ?? 0
    if (p.includes("restaurant-withdraws")) return badges.restaurantWithdrawals ?? 0
    if (p.includes("delivery-emergency-help")) return badges.emergencyHelp ?? 0
    if (p.includes("earning-addon-history")) return badges.earningAddons ?? 0
    if (p.includes("safety-emergency-reports")) return badges.safetyReports ?? 0
    if (p.includes("delivery-partners/join-request")) return badges.deliveryPartners ?? 0
    if (p.includes("contact-messages")) return badges.contactMessages ?? 0
    // Restaurant offers waiting for approval are reviewed on the coupons page.
    if (p.includes("/admin/food/coupons")) return badges.restaurantOffers ?? 0

    // Label-based (expandable parents without paths)
    if (l.includes("food approval")) return badges.foodApprovals ?? 0
    if (l === "categories" || l === "category") return badges.categories ?? 0
    if (l === "restaurants" || l.includes("new joining request")) return badges.restaurants ?? 0
    if (l.includes("restaurant complaints")) return badges.restaurantComplaints ?? 0
    if (l.includes("support tickets")) return l.includes("delivery") ? (badges.deliverySupportTickets ?? 0) : (badges.userSupportTickets ?? 0)
    if (l.includes("withdrawal") || l.includes("withdraws")) return l.includes("delivery") ? (badges.deliveryWithdrawals ?? 0) : (badges.restaurantWithdrawals ?? 0)
    if (l.includes("cash confirmations")) return badges.cashConfirmations ?? 0
    if (l.includes("emergency help")) return badges.emergencyHelp ?? 0
    if (l.includes("earning addon history")) return badges.earningAddons ?? 0
    if (l.includes("safety emergency reports")) return badges.safetyReports ?? 0
    if (l === "deliveryman" || l.includes("join request") || l.includes("join-request")) return badges.deliveryPartners ?? 0
    if (l === "user feedback") return badges.contactMessages ?? 0
    if (l === "orders") return badges.orders ?? 0

    return 0
  }
  const [logoUrl, setLogoUrl] = useState(() => getCachedSettings()?.logo?.url || null)
  const [companyName, setCompanyName] = useState(() => getCachedSettings()?.companyName || null)

  // Load business settings logo
  useEffect(() => {
    const loadLogo = async () => {
      try {
        // First check cache
        let cached = getCachedSettings()
        if (cached) {
          if (cached.logo?.url) {
            setLogoUrl(cached.logo.url)
          }
          if (cached.companyName) {
            setCompanyName(cached.companyName)
          }
        }

        // Always try to load fresh data to ensure we have the latest
        const settings = await loadBusinessSettings()
        if (settings) {
          if (settings.logo?.url) {
            setLogoUrl(settings.logo.url)
          }
          if (settings.companyName) {
            setCompanyName(settings.companyName)
          }
        }
      } catch (error) {
        debugError('Error loading logo:', error)
      }
    }

    // Load immediately
    loadLogo()

    // Also try after a small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      loadLogo()
    }, 100)

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
      clearTimeout(timeoutId)
      window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
    }
  }, [])

  // Get initial states from consolidated admin_sidebar_state
  const getInitialStates = () => {
    try {
      const saved = localStorage.getItem('admin_sidebar_state')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {
      debugError('Error loading sidebar state:', e)
    }
    return { isCollapsed: false, expandedSections: {} }
  }

  const [isCollapsed, setIsCollapsed] = useState(() => getInitialStates().isCollapsed)
  const [expandedSections, setExpandedSections] = useState(() => {
    const initialState = getInitialStates().expandedSections || {}
    
    // Generate defaults if empty, but also pre-expand matching path synchronously
    const state = { ...initialState }
    adminSidebarMenu.forEach((item) => {
      if (item.type === "section") {
        item.items.forEach((subItem) => {
          if (subItem.type === "expandable") {
            const key = subItem.label.toLowerCase().replace(/\s+/g, "")
            if (typeof state[key] === "undefined") {
              state[key] = false
            }
          }
        })
      }
    })

    // Pre-expand section for current path synchronously on reload
    const currentPath = window.location.pathname.replace(/\/+$/, "") || "/"
    adminSidebarMenu.forEach((item) => {
      if (item.type === "section") {
        item.items.forEach((menuItem) => {
          if (menuItem.type === "expandable" && menuItem.subItems) {
            const hasMatchingSubItem = menuItem.subItems.some((subItem) => {
              const subPath = String(subItem.path || "").replace(/\/+$/, "")
              return currentPath === subPath || currentPath.startsWith(`${subPath}/`)
            })
            if (hasMatchingSubItem) {
              const key = menuItem.label.toLowerCase().replace(/\s+/g, "")
              state[key] = true
            }
          }
        })
      }
    })

    return state
  })

  // Save states to consolidated localStorage and notify parent
  useEffect(() => {
    try {
      const currentState = JSON.parse(localStorage.getItem('admin_sidebar_state') || '{}')
      localStorage.setItem('admin_sidebar_state', JSON.stringify({
        ...currentState,
        isCollapsed
      }))
      if (onCollapseChange) {
        onCollapseChange(isCollapsed)
      }
    } catch (e) {
      debugError('Error saving sidebar collapsed state:', e)
    }
  }, [isCollapsed, onCollapseChange])

  // Notify parent on initial load
  useEffect(() => {
    if (onCollapseChange) {
      onCollapseChange(isCollapsed)
    }
  }, [])

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev)
  }

  // expandedSections state is initialized above in getInitialStates consolidation


  // Permission-filtered base menu (full ADMIN sees all; SUB_ADMIN sees allowed only)
  // Do NOT depend on location.pathname — remounting menu on every route break expandable submenus.
  const adminUser = getCurrentUser("admin")
  const permissionSyncKey = `${adminUser?.role || ""}:${JSON.stringify(adminUser?.permissions || {})}`
  const permissionMenuData = useMemo(() => {
    return filterSidebarMenuByPermissions(adminSidebarMenu, getCurrentUser("admin"))
  }, [permissionSyncKey])

  // Filter menu items based on search query
  const filteredMenuData = useMemo(() => {
    if (!searchQuery.trim()) {
      return permissionMenuData
    }

    const query = searchQuery.toLowerCase().trim()
    const filtered = []

    permissionMenuData.forEach((item) => {
      if (item.type === "link") {
        if (item.label.toLowerCase().includes(query)) {
          filtered.push(item)
        }
      } else if (item.type === "section") {
        const filteredItems = []

        item.items.forEach((subItem) => {
          if (subItem.type === "link") {
            if (subItem.label.toLowerCase().includes(query)) {
              filteredItems.push(subItem)
            }
          } else if (subItem.type === "expandable") {
            const matchesLabel = subItem.label.toLowerCase().includes(query)
            const matchingSubItems = subItem.subItems?.filter(
              (si) => si.label.toLowerCase().includes(query)
            ) || []

            if (matchesLabel || matchingSubItems.length > 0) {
              filteredItems.push({
                ...subItem,
                subItems: matchesLabel ? subItem.subItems : matchingSubItems,
              })
            }
          }
        })

        if (filteredItems.length > 0) {
          filtered.push({
            ...item,
            items: filteredItems,
          })
        }
      }
    })

    return filtered
  }, [searchQuery, permissionMenuData])

  // Auto-expand sections with matches when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()

      setExpandedSections((prev) => {
        const newExpandedState = { ...prev }

        adminSidebarMenu.forEach((item) => {
          if (item.type === "section") {
            item.items.forEach((subItem) => {
              if (subItem.type === "expandable") {
                const matchesLabel = subItem.label.toLowerCase().includes(query)
                const hasMatchingSubItems = subItem.subItems?.some(
                  (si) => si.label.toLowerCase().includes(query)
                )

                if (matchesLabel || hasMatchingSubItems) {
                  const sectionKey = subItem.label.toLowerCase().replace(/\s+/g, "")
                  newExpandedState[sectionKey] = true
                }
              }
            })
          }
        })

        return newExpandedState
      })
    }
  }, [searchQuery])

  const isActive = (path, allPaths = []) => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/"
    const targetPath = String(path || "").replace(/\/+$/, "") || "/"
    const matchesPath = (candidatePath) =>
      currentPath === candidatePath || currentPath.startsWith(`${candidatePath}/`)

    if (targetPath === "/admin" || targetPath === "/admin/food") {
      return currentPath === targetPath
    }

    // For subItems, check if this is the most specific match
    if (allPaths.length > 0) {
      // Sort paths by length (longest first) to find most specific match
      const sortedPaths = [...allPaths].sort((a, b) => b.length - a.length)
      const bestMatch = sortedPaths.find((candidatePath) =>
        matchesPath(String(candidatePath || "").replace(/\/+$/, "") || "/")
      )
      return (String(bestMatch || "").replace(/\/+$/, "") || "/") === targetPath
    }

    return matchesPath(targetPath)
  }

  useEffect(() => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/"
    let foundSectionKey = null
    
    adminSidebarMenu.forEach((item) => {
      if (item.type === "section") {
        item.items.forEach((menuItem) => {
          if (menuItem.type === "expandable" && menuItem.subItems) {
            const hasMatchingSubItem = menuItem.subItems.some((subItem) => {
              const subPath = String(subItem.path || "").replace(/\/+$/, "")
              return currentPath === subPath || currentPath.startsWith(`${subPath}/`)
            })
            if (hasMatchingSubItem) {
              foundSectionKey = menuItem.label.toLowerCase().replace(/\s+/g, "")
            }
          }
        })
      }
    })

    if (foundSectionKey) {
      setExpandedSections((prev) => {
        if (prev[foundSectionKey]) return prev
        return {
          ...prev,
          [foundSectionKey]: true
        }
      })
    }
  }, [location.pathname])

  // Helper to scroll active item to the center of the sidebar scrollable container
  const scrollToActiveItem = (behavior = "auto") => {
    if (typeof document === "undefined" || !sidebarNavRef.current) return
    const container = sidebarNavRef.current
    const activeElements = container.querySelectorAll('[data-active="true"]')
    const activeElement = activeElements.length
      ? activeElements[activeElements.length - 1]
      : null
    if (activeElement) {
      const containerRect = container.getBoundingClientRect()
      const activeRect = activeElement.getBoundingClientRect()
      
      const relativeTop = activeRect.top - containerRect.top + container.scrollTop
      const targetScrollTop = relativeTop - (containerRect.height / 2) + (activeRect.height / 2)
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
      const clampedTop = Math.max(0, Math.min(targetScrollTop, maxScroll))
      
      container.scrollTo({
        top: clampedTop,
        behavior: behavior
      })
      lastScrolledPathname.current = location.pathname
    }
  }

  // Helper to scroll toggled sections safely without scrolling the parent window
  const scrollToElement = (element, behavior = "smooth") => {
    if (typeof document === "undefined" || !sidebarNavRef.current || !element) return
    const container = sidebarNavRef.current
    const containerRect = container.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    
    const relativeTop = elementRect.top - containerRect.top + container.scrollTop
    const relativeBottom = relativeTop + elementRect.height
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    
    if (relativeTop < container.scrollTop) {
      container.scrollTo({
        top: Math.max(0, relativeTop - 8),
        behavior: behavior
      })
    } else if (relativeBottom > container.scrollTop + containerRect.height) {
      const nextTop = relativeBottom - containerRect.height + 8
      container.scrollTo({
        top: Math.min(maxScroll, nextTop),
        behavior: behavior
      })
    }
  }

  // 1. Initial mount/refresh scroll: Position the active tab centered INSTANTLY on load/refresh
  // Runs after skeleton loading is finished and menu items are rendered in the DOM.
  useLayoutEffect(() => {
    if (!isLoading && !hasScrolledOnMount.current) {
      hasScrolledOnMount.current = true
      lastScrolledPathname.current = location.pathname
      
      scrollToActiveItem("auto")
      const timer = setTimeout(() => {
        scrollToActiveItem("auto")
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isLoading])

  // 2. Smoothly scroll active sidebar item into the center on route navigation.
  useEffect(() => {
    if (!hasScrolledOnMount.current) {
      return
    }

    if (location.pathname === lastScrolledPathname.current) {
      return
    }

    pendingNavScrollPath.current = location.pathname

    const timer1 = setTimeout(() => {
      scrollToActiveItem("smooth")
    }, 180)

    const timer2 = setTimeout(() => {
      if (pendingNavScrollPath.current === location.pathname) {
        scrollToActiveItem("smooth")
        pendingNavScrollPath.current = null
      }
    }, 420)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
    }
  }, [location.pathname])

  // After expandable section opens for the new route, center the active link again.
  useLayoutEffect(() => {
    if (!hasScrolledOnMount.current || !pendingNavScrollPath.current) return
    if (pendingNavScrollPath.current !== location.pathname) return

    const frame = requestAnimationFrame(() => {
      scrollToActiveItem("auto")
    })
    return () => cancelAnimationFrame(frame)
  }, [location.pathname, expandedSections])

  useEffect(() => {
    try {
      const currentState = JSON.parse(localStorage.getItem('admin_sidebar_state') || '{}')
      localStorage.setItem('admin_sidebar_state', JSON.stringify({
        ...currentState,
        expandedSections
      }))
    } catch (e) {
      debugError('Error saving sidebar state:', e)
    }
  }, [expandedSections])

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => {
      const isCurrentlyOpen = Boolean(prev[sectionKey])

      // Accordion behavior:
      // 1) If current section is open -> close it.
      // 2) If current section is closed -> open it and close all others.
      if (isCurrentlyOpen) {
        return {
          ...prev,
          [sectionKey]: false,
        }
      }

      const next = {}
      Object.keys(prev).forEach((key) => {
        next[key] = key === sectionKey
      })
      return next
    })
  }

  const renderMenuItem = (item, index, isInSection = false) => {
    if (item.type === "link") {
      const Icon = iconMap[item.icon] || Utensils
      return (
        <Link
          key={index}
          to={item.path}
          data-active={isActive(item.path) ? "true" : undefined}
          onClick={() => {
            if (isActive(item.path)) {
              refreshAdminListForPath(item.path)
            }
            if (window.innerWidth < 1024 && onClose) {
              onClose()
            }
          }}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg menu-item-animate text-left outline-none focus:outline-none",
            isInSection ? "text-sm font-semibold" : "text-sm",
            isActive(item.path)
              ? "bg-white/10 text-white border border-white/15 font-semibold"
              : "text-neutral-300 hover:bg-white/5 hover:text-white transition-colors duration-200",
            isCollapsed && "justify-center px-2"
          )}
          style={{ animationDelay: `${index * 0.01}s` }}
          title={isCollapsed ? item.label : undefined}
        >
          <Icon className={cn(
            "shrink-0 text-left",
            isInSection ? "w-4 h-4" : "w-4 h-4",
            isActive(item.path) ? "text-white scale-110" : "text-neutral-300"
          )} />
          {!isCollapsed && (
            <div className="flex-1 flex items-center justify-between overflow-hidden">
              <span className={cn("text-left truncate", isInSection ? "font-semibold" : "font-medium")}>
                {item.label}
              </span>
              {getBadgeCount(item.label, item.path) > 0 && (
                <span className="shrink-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                  {getBadgeCount(item.label, item.path) > 99 ? "99+" : getBadgeCount(item.label, item.path)}
                </span>
              )}
            </div>
          )}
          {isCollapsed && getBadgeCount(item.label, item.path) > 0 && (
            <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-neutral-950 animate-pulse" />
          )}
        </Link>
      )
    }

    if (item.type === "expandable") {
      const Icon = iconMap[item.icon] || Utensils
      const sectionKey = item.label.toLowerCase().replace(/\s+/g, "")
      const isExpanded = expandedSections[sectionKey] || false

      if (isCollapsed) {
        return (
          <div key={index} className="menu-item-animate" style={{ animationDelay: `${index * 0.01}s` }}>
            <button
              onClick={(e) => {
                toggleSection(sectionKey)
                scrollToElement(e.currentTarget, "smooth")
              }}
              className={cn(
                "w-full flex items-center justify-center px-2 py-2 rounded-lg transition-all duration-300 ease-out text-sm font-medium outline-none focus:outline-none",
                "text-white hover:bg-white/5"
              )}
              title={item.label}
            >
              <div className="relative">
                <Icon className="w-4 h-4 shrink-0 text-neutral-300 transition-transform duration-300" />
                {getBadgeCount(item.label, item.path) > 0 && (
                  <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-neutral-950 animate-pulse" />
                )}
              </div>
            </button>
          </div>
        )
      }

      return (
        <div key={index} className="menu-item-animate" style={{ animationDelay: `${index * 0.01}s` }}>
          <button
            onClick={(e) => {
              toggleSection(sectionKey)
              scrollToElement(e.currentTarget, "smooth")
            }}
            className={cn(
              "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all duration-300 ease-out text-sm font-medium text-left outline-none focus:outline-none",
              "text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center gap-2.5 text-left flex-1 min-w-0">
              <Icon className="w-4 h-4 shrink-0 text-neutral-300 transition-transform duration-300" />
              <span className="font-medium text-left truncate">{item.label}</span>
              {getBadgeCount(item.label, item.path) > 0 && (
                <span className="shrink-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                  {getBadgeCount(item.label, item.path) > 99 ? "99+" : getBadgeCount(item.label, item.path)}
                </span>
              )}
            </div>
            <div className="transition-transform duration-300 shrink-0" style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
              <ChevronDown className="w-4 h-4 shrink-0 text-neutral-300" />
            </div>
          </button>
          {isExpanded && item.subItems && item.subItems.length > 0 && (
            <div className="ml-5 mt-1 space-y-1 border-neutral-800/60 pl-3 submenu-animate">
              {item.subItems.map((subItem) => {
                const allSubPaths = item.subItems.map(si => si.path)
                return (
                  <Link
                    key={subItem.path || subItem.label}
                    to={subItem.path}
                    data-active={isActive(subItem.path, allSubPaths) ? "true" : undefined}
                    onClick={() => {
                      if (isActive(subItem.path, allSubPaths)) {
                        refreshAdminListForPath(subItem.path)
                      }
                      if (window.innerWidth < 1024 && onClose) {
                        onClose()
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-normal text-left outline-none focus:outline-none",
                      isActive(subItem.path, allSubPaths)
                        ? "bg-white/10 text-white font-semibold"
                        : "text-neutral-300 hover:bg-white/5 hover:text-white transition-colors duration-200"
                    )}
                  >
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      isActive(subItem.path, allSubPaths) ? "bg-white scale-125" : "bg-neutral-400"
                    )}></span>
                    <span className="text-left flex-1 truncate">{subItem.label}</span>
                    {getBadgeCount(subItem.label, subItem.path) > 0 && (
                      <span className="shrink-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                        {getBadgeCount(subItem.label, subItem.path) > 99 ? "99+" : getBadgeCount(subItem.label, subItem.path)}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        @keyframes expandDown {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .menu-item-animate {
          animation: slideIn 0.25s ease-out forwards;
        }
        
        .submenu-animate {
          animation: expandDown 0.2s ease-out forwards;
        }
        
        .admin-sidebar-scroll {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
        }
        
        .admin-sidebar-scroll::-webkit-scrollbar {
          width: 2px;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-track {
          background: rgba(17, 24, 39, 0.4);
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
          transition: background 0.2s ease;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.35);
        }
        .admin-sidebar-scroll:hover::-webkit-scrollbar {
          width: 6px;
        }
        .admin-sidebar-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.25) rgba(17, 24, 39, 0.4);
        }
      `}</style>
      <div
        className={cn(
          "bg-neutral-950 border-r border-neutral-800/60 h-screen fixed left-0 top-0 z-50 flex flex-col overflow-hidden",
          "transform transition-all duration-300 ease-in-out",
          "lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "w-20" : "w-80"
        )}
      >
        {/* Header with Logo and Brand */}
        <div className="shrink-0 px-3 py-3 border-b border-neutral-800/60 bg-neutral-900 animate-[fadeIn_0.4s_ease-out]">
          <div className="flex items-center justify-between mb-3">
            {!isCollapsed && (
              <div className="flex items-center gap-2 animate-[slideIn_0.3s_ease-out]">
                <div className="w-24 h-12 rounded-lg flex items-center justify-center shadow-black/20">
                  {logoUrl ? (
                    <img
                      src={logoUrl || eatiefyLogo}
                      alt={companyName || "Company"}
                      className="w-24 h-10 object-contain"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null
                        if (eatiefyLogo && e.currentTarget.src !== eatiefyLogo) {
                          e.currentTarget.src = eatiefyLogo
                        } else {
                          e.currentTarget.style.display = 'none'
                        }
                      }}
                    />
                  ) : companyName ? (
                    <span className="text-xs font-semibold text-white px-2 truncate">
                      {companyName}
                    </span>
                  ) : (
                    <img src={eatiefyLogo} alt="Company" className="w-24 h-10 object-contain" loading="lazy" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
                  )}
                </div>
              </div>
            )}
            {isCollapsed && (
              <div className="w-full flex items-center justify-center">
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shadow-lg shadow-black/20 ring-1 ring-white/10">
                  {logoUrl || companyName ? (
                    <img
                      src={logoUrl || eatiefyLogo}
                      alt={companyName || "Company"}
                      className="w-10 h-10 object-contain"
                      loading="lazy"
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
                    <img src={eatiefyLogo} alt="Company" className="w-10 h-10 object-contain" loading="lazy" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleCollapse}
                className="text-neutral-300 hover:text-white transition-all duration-200 hover:scale-110 p-1.5 rounded-lg hover:bg-white/5"
                title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={onClose}
                className="lg:hidden text-neutral-300 hover:text-white transition-all duration-200 hover:scale-110"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Admin Panel Label */}
          {!isCollapsed && (
            <div className="mb-3 animate-[slideIn_0.4s_ease-out_0.1s_both]">
              <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider text-left">
                Admin Panel
              </h2>
            </div>
          )}

          {/* Search Bar */}
          {!isCollapsed && (
            <div className="relative animate-[slideIn_0.4s_ease-out_0.2s_both]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400 w-4 h-4 z-10 transition-colors duration-200" />
              <Input
                type="text"
                placeholder="Search Menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn(
                  "w-full pl-9 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/40 transition-all duration-200 text-left",
                  searchQuery ? "pr-9" : "pr-3"
                )}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-neutral-400 hover:text-white transition-all duration-200 hover:scale-110 z-10"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <nav ref={sidebarNavRef} className="admin-sidebar-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-3 space-y-2">
          {isLoading ? (
            <SidebarSkeleton isCollapsed={isCollapsed} />
          ) : filteredMenuData.length === 0 && searchQuery.trim() ? (
            <div className="px-3 py-12 text-left animate-[fadeIn_0.4s_ease-out]">
              <p className="text-neutral-300 text-sm font-medium text-left">No menu items found</p>
              <p className="text-neutral-500 text-sm mt-2 text-left">Try a different search term</p>
            </div>
          ) : (
            filteredMenuData.map((item, index) => {
              if (item.type === "link") {
                return renderMenuItem(item, item.path || item.label)
              }

              if (item.type === "section") {
                return (
                  <div
                    key={item.label || index}
                    className={cn(
                      index > 0 ? "mt-4 pt-4 border-t border-neutral-800/60" : "",
                      "animate-[fadeIn_0.4s_ease-out]"
                    )}
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                      <div className="px-3 py-2 mb-2 flex items-center justify-between">
                        <span className="text-neutral-400 font-bold text-sm uppercase tracking-wider text-left">
                          {item.label}
                        </span>
                        {item.items.some(subItem => {
                          const count = getBadgeCount(subItem.label, subItem.path);
                          if (count > 0) return true;
                          if (subItem.type === "expandable" && subItem.subItems) {
                            return subItem.subItems.some(si => getBadgeCount(si.label, si.path) > 0);
                          }
                          return false;
                        }) && (
                          <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.5)]" />
                        )}
                      </div>
                    <div className="space-y-1">
                      {item.items.map((subItem, subIndex) =>
                        renderMenuItem(
                          subItem,
                          subItem.path || subItem.label || `${item.label}-${subIndex}`,
                          true
                        )
                      )}
                    </div>
                  </div>
                )
              }

              return null
            })
          )}
        </nav>
      </div>
    </>
  )
}

