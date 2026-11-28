import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Trophy, Search, Star, Loader2, Save, Bike, ShoppingBag, RotateCcw, ArrowLeftRight } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { TableSkeleton } from "@food/components/ui/loading-skeletons"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const MAX_TOP = 10
// Remembers the admin's selected zone across refreshes (cleared on logout).
const ZONE_KEY = "top_restaurants_selected_zone"

const PLACEHOLDER_40 =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40' fill='none'%3E%3Crect width='40' height='40' fill='%23F1F5F9'/%3E%3Cpath d='M13 11v6a2.5 2.5 0 0 0 2.5 2.5h0a2.5 2.5 0 0 0 2.5-2.5v-6M15.5 19.5V29M27 11v18M23 11v4.5a2.5 2.5 0 0 0 2.5 2.5H27' stroke='%2394A3B8' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"

const getLogo = (r) => {
  if (!r) return PLACEHOLDER_40
  const img =
    r?.profileImage ||
    r?.logo ||
    r?.restaurantImage ||
    r?.image ||
    (Array.isArray(r?.coverImages) && r.coverImages[0])
  if (!img) return PLACEHOLDER_40
  if (typeof img === "string") {
    const trimmed = img.trim()
    if (!trimmed || trimmed === "null" || trimmed === "undefined") return PLACEHOLDER_40
    return trimmed
  }
  const url = img.url || img.secure_url || img.path || ""
  if (typeof url === "string") {
    const trimmed = url.trim()
    if (!trimmed || trimmed === "null" || trimmed === "undefined") return PLACEHOLDER_40
    return trimmed
  }
  return PLACEHOLDER_40
}

const getZoneName = (r) =>
  r?.zoneId?.zoneName || r?.zoneId?.name || r?.zone || "—"

// Build a stable string of the rank map so we can detect unsaved changes.
const serializeRanks = (rankMap) =>
  Object.entries(rankMap)
    .filter(([, v]) => v)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([id, v]) => `${id}:${v}`)
    .join("|")

// Find the nearest vertically-scrollable ancestor of an element (the container
// whose scrollTop actually moves). Falls back to the document scroller.
const getScrollParent = (el) => {
  let node = el?.parentElement
  while (node) {
    const style = window.getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return document.scrollingElement || document.documentElement
}

export default function TopRestaurants() {
  const { canEdit } = useAdminPermissions()
  const [activeTab, setActiveTab] = useState("delivery") // 'delivery' | 'takeaway'
  const [zones, setZones] = useState([])
  const [selectedZone, setSelectedZone] = useState("")
  const [restaurants, setRestaurants] = useState([])
  const [ranks, setRanks] = useState({}) // restaurantId -> top number (slot)
  // When a taken slot is picked, we hold the pending replace here to confirm.
  const [replaceModal, setReplaceModal] = useState(null)
  const [savedRanksKey, setSavedRanksKey] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const isMountedRef = useRef(true)
  const tableWrapRef = useRef(null)
  // Holds the scroll position to restore after a re-sort, so the admin's view
  // stays put when a ranked restaurant jumps up the list.
  const scrollRestoreRef = useRef(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Load zones once; default to the first zone.
  useEffect(() => {
    const fetchZones = async () => {
      try {
        const response = await adminAPI.getZones({ page: 1, limit: 1000 })
        const zoneData = response?.data?.data
        const list = Array.isArray(zoneData?.zones)
          ? zoneData.zones
          : Array.isArray(zoneData)
            ? zoneData
            : []
        if (!isMountedRef.current) return
        // Sort zones alphabetically by name for the dropdown.
        const arr = (Array.isArray(list) ? [...list] : []).sort((a, b) =>
          String(a.zoneName || a.name || "").localeCompare(String(b.zoneName || b.name || ""))
        )
        setZones(arr)
        if (arr.length > 0) {
          setSelectedZone((prev) => {
            if (prev) return prev
            // Restore the previously selected zone if it still exists, else default
            // to the first zone alphabetically.
            let saved = null
            try {
              saved = localStorage.getItem(ZONE_KEY)
            } catch (e) {
              saved = null
            }
            const savedValid = saved && arr.some((z) => String(z._id || z.id) === saved)
            return savedValid ? saved : String(arr[0]._id || arr[0].id)
          })
        }
      } catch (error) {
        toast.error("Failed to load zones")
        setZones([])
      }
    }
    fetchZones()
  }, [])

  // Remember the selected zone across refreshes (cleared on logout).
  useEffect(() => {
    if (!selectedZone) return
    try {
      localStorage.setItem(ZONE_KEY, selectedZone)
    } catch (e) {
      /* ignore */
    }
  }, [selectedZone])

  // Load top restaurants whenever the zone or tab changes.
  useEffect(() => {
    if (!selectedZone) return
    let cancelled = false

    const fetchTop = async () => {
      try {
        setLoading(true)
        const response = await adminAPI.getTopRestaurants({
          zoneId: selectedZone,
          type: activeTab,
        })
        const data = response?.data?.data
        const list = Array.isArray(data?.restaurants)
          ? data.restaurants
          : Array.isArray(data)
            ? data
            : []
        if (cancelled || !isMountedRef.current) return

        // Always load the saved (DB) state. Unsaved edits are intentionally NOT
        // persisted — a refresh discards them and shows the last saved ranking.
        const initialRanks = {}
        list.forEach((r) => {
          if (r.rank) initialRanks[String(r._id)] = Number(r.rank)
        })

        setRestaurants(list)
        setRanks(initialRanks)
        setSavedRanksKey(serializeRanks(initialRanks))
        setSearchQuery("")
      } catch (error) {
        if (cancelled) return
        toast.error(error.response?.data?.message || "Failed to load top restaurants")
        setRestaurants([])
        setRanks({})
        setSavedRanksKey("")
      } finally {
        if (!cancelled && isMountedRef.current) setLoading(false)
      }
    }

    fetchTop()
    return () => {
      cancelled = true
    }
  }, [selectedZone, activeTab])

  const assignedCount = useMemo(
    () => Object.values(ranks).filter((v) => v).length,
    [ranks]
  )

  const isDirty = useMemo(
    () => serializeRanks(ranks) !== savedRanksKey,
    [ranks, savedRanksKey]
  )

  // Warn on accidental refresh / tab close while there are unsaved changes, so
  // the admin can cancel and Save instead of silently losing their selections.
  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = "" // required for the browser to show its native prompt
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  // Show the skeleton while zones are still resolving or restaurants are loading,
  // so a refresh never flashes half-loaded / empty data.
  const showSkeleton = loading || !selectedZone

  const filteredRestaurants = useMemo(() => {
    let list = restaurants
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((r) => {
        const name = String(r.restaurantName || "").toLowerCase()
        const owner = String(r.ownerName || "").toLowerCase()
        const phone = String(r.ownerPhone || "").toLowerCase()
        return name.includes(q) || owner.includes(q) || phone.includes(q)
      })
    }
    // Show ranked restaurants first (in rank order), then the rest by name.
    return [...list].sort((a, b) => {
      const ra = ranks[String(a._id)] || 999
      const rb = ranks[String(b._id)] || 999
      if (ra !== rb) return ra - rb
      return String(a.restaurantName || "").localeCompare(String(b.restaurantName || ""))
    })
  }, [restaurants, searchQuery, ranks])

  // Snapshot the current scroll position of the table's scroll container so the
  // layout effect can restore it after the list re-sorts. The list's total
  // height is unchanged by a re-sort, so restoring the exact scrollTop keeps the
  // admin's view fixed — only the edited restaurant moves up (out of view).
  const captureScroll = () => {
    const scroller = getScrollParent(tableWrapRef.current)
    scrollRestoreRef.current = scroller ? { scroller, top: scroller.scrollTop } : null
  }

  const nameById = (id) => {
    const r = restaurants.find((x) => String(x._id) === String(id))
    return r?.restaurantName || "this restaurant"
  }

  // Apply an edit to the in-memory ranks only. Nothing is persisted until the
  // admin clicks Save, so a refresh reverts to the last saved state.
  const applyRanks = (next) => {
    setRanks(next)
  }

  // Clear a restaurant's slot and compact the higher slots down so the list
  // stays continuous (…, remove #Top2 → old #Top3 becomes #Top2).
  const clearSlot = (id) => {
    const removed = ranks[id]
    if (!removed) return
    captureScroll()
    const next = {}
    Object.entries(ranks).forEach(([rid, v]) => {
      if (rid === id) return
      next[rid] = v > removed ? v - 1 : v
    })
    applyRanks(next)
  }

  // Assign a fresh slot to a restaurant (only the next number after the current
  // highest is allowed, so the list stays continuous).
  const assignSlot = (id, num) => {
    captureScroll()
    applyRanks({ ...ranks, [id]: num })
  }

  const handleSelectSlot = (restaurantId, rawValue) => {
    const id = String(restaurantId)

    // "—" clears the slot.
    if (rawValue === "") {
      clearSlot(id)
      return
    }

    const num = Number(rawValue)
    if (!Number.isInteger(num) || num < 1 || num > MAX_TOP) return
    if (ranks[id] === num) return

    // Is this slot already taken by another restaurant? → confirm a replace.
    const occupant = Object.entries(ranks).find(
      ([rid, v]) => Number(v) === num && rid !== id
    )
    if (occupant) {
      setReplaceModal({ editingId: id, targetSlot: num, occupantId: occupant[0] })
      return
    }

    // Free slot: only the next number (max + 1) may be assigned to a new
    // restaurant, so the top list stays continuous with no gaps.
    const maxSlot = Object.values(ranks).reduce((m, v) => Math.max(m, Number(v) || 0), 0)
    if (!ranks[id] && num === maxSlot + 1) {
      assignSlot(id, num)
    } else if (ranks[id]) {
      toast.error("To move this restaurant, pick an occupied number to swap, or clear it first")
    } else {
      toast.error(`Assign #Top${maxSlot + 1} first — top numbers must be filled in order`)
    }
  }

  const confirmReplace = () => {
    if (!replaceModal) return
    const { editingId, targetSlot, occupantId } = replaceModal
    const prevSlot = ranks[editingId] // may be undefined (un-ranked)

    const next = { ...ranks, [editingId]: targetSlot }
    if (prevSlot) {
      next[occupantId] = prevSlot // swap
    } else {
      delete next[occupantId] // occupant drops out of the top list
    }
    applyRanks(next)
    setReplaceModal(null)

    // On replace, take the admin to the top so they see the updated ranking.
    const scroller = getScrollParent(tableWrapRef.current)
    scrollRestoreRef.current = scroller ? { scroller, top: 0 } : null
  }

  const cancelReplace = () => setReplaceModal(null)

  const handleReset = () => {
    if (Object.keys(ranks).length === 0) return
    captureScroll()
    applyRanks({})
  }

  // After the list re-sorts, restore the exact scroll position (and re-assert on
  // the next frame to override any late scroll reset) so the view never jumps.
  useLayoutEffect(() => {
    const snap = scrollRestoreRef.current
    if (!snap) return
    scrollRestoreRef.current = null
    const { scroller, top } = snap
    if (!scroller) return
    scroller.scrollTop = top
    requestAnimationFrame(() => {
      scroller.scrollTop = top
    })
  }, [filteredRestaurants])

  const handleSave = async () => {
    // Build ordered list and validate continuity (no gaps, no duplicates).
    const entries = Object.entries(ranks).filter(([, v]) => v)
    const numbers = entries.map(([, v]) => Number(v)).sort((a, b) => a - b)

    if (numbers.length > MAX_TOP) {
      toast.error(`You can select a maximum of ${MAX_TOP} top restaurants`)
      return
    }
    // Continuous 1..N check.
    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i] !== i + 1) {
        toast.error("Top numbers must be continuous starting from 1 (no gaps or duplicates)")
        return
      }
    }

    const ordered = entries
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map(([id]) => id)

    try {
      setSaving(true)
      await adminAPI.saveTopRestaurants({
        zoneId: selectedZone,
        type: activeTab,
        restaurantIds: ordered,
      })
      setSavedRanksKey(serializeRanks(ranks))
      toast.success("Top restaurants saved successfully")
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save top restaurants")
    } finally {
      setSaving(false)
    }
  }

  const tabs = [
    { key: "delivery", label: "Delivery Top Restaurants", icon: Bike },
    { key: "takeaway", label: "Takeaway Top Restaurants", icon: ShoppingBag },
  ]

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 sm:p-6 mb-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Top Restaurants</h1>
              <p className="text-sm text-slate-600">
                Choose which restaurants appear at the top for users in each zone. Max {MAX_TOP} per zone.
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
            {tabs.map((t) => {
              const Icon = t.icon
              const active = activeTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                    active
                      ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                      : "text-slate-500 hover:bg-white hover:text-slate-800"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Controls: search + zone + save */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by restaurant, owner or phone..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-3">
              {canEdit && (
              <button
                onClick={handleReset}
                disabled={assignedCount === 0 || saving || loading}
                title="Clear all top selections for this zone"
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              )}
              <Select value={selectedZone} onValueChange={setSelectedZone}>
                <SelectTrigger className="min-w-[180px] border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent className="border-slate-200 bg-white text-slate-900">
                  {zones.map((zone) => (
                    <SelectItem key={zone._id || zone.id} value={String(zone._id || zone.id)}>
                      {zone.zoneName || zone.name || "Unnamed Zone"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {canEdit && (
              <button
                onClick={handleSave}
                disabled={!isDirty || saving || loading}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Top Restaurants
              </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {assignedCount}/{MAX_TOP} selected · Pick a number in the <strong>Top No.</strong> dropdown
            to promote a restaurant. Choosing a number that&apos;s already taken lets you replace it.
          </p>
        </div>

        {/* Table */}
        {showSkeleton ? (
          <TableSkeleton rows={8} columns={7} />
        ) : (
        <div ref={tableWrapRef} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">S.No</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Restaurant Info</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Owner Info</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Zone</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Rating</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Top No.</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {filteredRestaurants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">
                        {activeTab === "takeaway"
                          ? "No takeaway-enabled restaurants in this zone"
                          : "No restaurants in this zone"}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredRestaurants.map((r, index) => {
                    const id = String(r._id)
                    const rank = ranks[id] || ""
                    const hasRank = Boolean(rank)
                    return (
                      <tr key={id} className={`hover:bg-slate-50 transition-colors ${hasRank ? "bg-blue-50/50" : ""}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-slate-700">{index + 1}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 border border-slate-100">
                              <img
                                src={getLogo(r)}
                                alt={r.restaurantName}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  if (e.target.src !== PLACEHOLDER_40) {
                                    e.target.src = PLACEHOLDER_40
                                  }
                                }}
                              />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-slate-900">{r.restaurantName}</span>
                              <span className="text-xs text-slate-500">
                                {r.area || r.location?.area || r.city || r.location?.city || ""}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-slate-900">{r.ownerName || "—"}</span>
                            <span className="text-xs text-slate-500">{r.ownerPhone || ""}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-slate-700">{getZoneName(r)}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                            <span className="text-sm font-semibold text-slate-900">
                              {(Number(r.rating) || 0).toFixed(1)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-700">
                            Approved
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-2">
                            {hasRank && (
                              <span className="inline-flex items-center rounded-md bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
                                #Top{rank}
                              </span>
                            )}
                            <select
                              value={rank === "" ? "" : String(rank)}
                              onChange={(e) => handleSelectSlot(id, e.target.value)}
                              disabled={!canEdit}
                              title="Set top number"
                              className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">Select</option>
                              {Array.from({ length: MAX_TOP }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>
                                  #Top{n}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>

      {/* Replace confirmation modal */}
      {replaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                <ArrowLeftRight className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Replace with #Top{replaceModal.targetSlot}
              </h3>
            </div>
            <p className="mb-1 text-sm text-slate-600">
              <strong className="text-slate-900">{nameById(replaceModal.occupantId)}</strong> is
              currently at <strong>#Top{replaceModal.targetSlot}</strong>.
            </p>
            <p className="mb-6 text-sm text-slate-600">
              Replace it with <strong className="text-slate-900">{nameById(replaceModal.editingId)}</strong>?
              {ranks[replaceModal.editingId]
                ? ` The two restaurants will swap their top positions.`
                : ` The current one will be removed from the top list.`}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={cancelReplace}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmReplace}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:bg-blue-700"
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
