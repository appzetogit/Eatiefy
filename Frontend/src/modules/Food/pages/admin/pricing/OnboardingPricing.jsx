import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Edit, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const TABS = [
  { id: "pricing", label: "Pricing Rules" },
  { id: "offers", label: "Promotional Offers" },
  { id: "payments", label: "Onboarding Payments" },
]

const GLOBAL_ZONE = "global"

const emptyRule = () => ({
  id: "",
  zoneId: GLOBAL_ZONE,
  restaurantType: "",
  basePrice: "",
  isActive: true,
  notes: "",
})

const emptyOffer = () => ({
  id: "",
  name: "",
  zoneId: "",
  restaurantType: "",
  originalPrice: "",
  offerPrice: "",
  maxRedemptions: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
})

const money = (value, currency = "INR") => {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return `${currency === "INR" ? "₹" : `${currency} `}${n.toLocaleString("en-IN")}`
}

const toDateTimeLocal = (value) => {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDate = (value) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

const statusPill = (active) =>
  active
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-600 border-slate-200"

const paymentStatusPill = (status) => {
  if (status === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (status === "failed") return "bg-rose-50 text-rose-700 border-rose-200"
  if (status === "cancelled") return "bg-amber-50 text-amber-700 border-amber-200"
  return "bg-slate-100 text-slate-600 border-slate-200"
}

const Field = ({ label, children, hint }) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-600">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
  </label>
)

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"

const timeOf = (value) => {
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

// Mirrors the backend's isLive rule; only paints an optimistic toggle until the
// server's copy of the row arrives.
const wouldBeLive = (offer, now = Date.now()) =>
  timeOf(offer.startsAt) <= now && now <= timeOf(offer.endsAt) && offer.remainingSlots > 0

// Same resolution as the backend's resolveBasePrice: an active rule for the zone, else an
// active "All zones" rule, else no fee. Display only; checkout always recomputes it.
const feeFor = (rules, zoneId, restaurantType) => {
  const active = rules.filter((rule) => rule.isActive && rule.restaurantType === restaurantType)
  const rule = active.find((r) => r.zoneId && r.zoneId === zoneId) || active.find((r) => !r.zoneId)
  return rule ? Number(rule.basePrice) || 0 : 0
}

/** Why an enabled offer cannot reach restaurants, or "" when it can apply. */
const offerBlockedReason = (offer, rules) => {
  const fee = feeFor(rules, offer.zoneId, offer.restaurantType)
  if (fee <= 0) return "No active pricing rule for this zone and type, so there is no fee to discount."
  if (Number(offer.offerPrice) >= fee) return `Offer price is not below the ${money(fee)} fee.`
  return ""
}

/**
 * Fold a fetched list into the rows on screen, matching by id. Server order wins, but a
 * snapshot taken before one of this page's writes landed must not undo it: rows with an
 * action in flight keep their local value, a row already held in a newer version
 * (updatedAt) keeps it, and rows deleted here stay deleted.
 */
const mergeFetchedRows = (fetched, current, inFlight, deleted) => {
  const currentById = new Map(current.map((row) => [row.id, row]))
  return fetched
    .filter((row) => !deleted.has(row.id))
    .map((row) => {
      const local = currentById.get(row.id)
      if (!local) return row
      if (inFlight.has(row.id) || timeOf(local.updatedAt) > timeOf(row.updatedAt)) return local
      return row
    })
}

/**
 * Server-owned rows edited in place by per-row actions (toggle, delete).
 *
 * Every action is addressed by row id and settled with the document the API returns,
 * so rows never reorder under the admin's cursor and no list reload races the write.
 * A row runs one action at a time; a settle that is no longer current for its row, or
 * lands after unmount, leaves state alone.
 */
function useServerRows() {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState({})
  const inFlightRef = useRef(new Map())
  const deletedRef = useRef(new Set())
  const tokenRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const replaceAll = useCallback((fetched) => {
    setRows((current) => mergeFetchedRows(fetched, current, inFlightRef.current, deletedRef.current))
  }, [])

  const replaceRow = useCallback((row) => {
    if (!row?.id) return
    setRows((current) => current.map((item) => (item.id === row.id ? row : item)))
  }, [])

  /**
   * @param {string} id row id the request targets
   * @param {"toggle"|"delete"|"save"} action
   * @param {{ request: () => Promise<object|undefined>, optimistic?: { apply: object, revert: object }, remove?: boolean }} options
   *   `request` resolves to the server's copy of the row (unused when `remove`).
   * @returns {Promise<{ ok: boolean, row?: object, gone?: boolean, error?: unknown, skipped?: boolean }>}
   */
  const run = useCallback(async (id, action, { request, optimistic, remove = false }) => {
    if (!id || inFlightRef.current.has(id)) return { ok: false, skipped: true }
    const token = ++tokenRef.current
    inFlightRef.current.set(id, token)
    const isCurrent = () => mountedRef.current && inFlightRef.current.get(id) === token
    const patchRow = (patch) =>
      setRows((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    const dropRow = () => {
      deletedRef.current.add(id)
      setRows((current) => current.filter((item) => item.id !== id))
    }

    setBusy((prev) => ({ ...prev, [id]: action }))
    if (optimistic) patchRow(optimistic.apply)

    try {
      const row = await request()
      if (isCurrent()) {
        if (remove) dropRow()
        // Without a usable body the optimistic patch already holds the value the server accepted.
        else if (row?.id === id) replaceRow(row)
      }
      return { ok: true, row }
    } catch (error) {
      const gone = error?.response?.status === 404
      if (isCurrent()) {
        if (gone) dropRow()
        else if (optimistic) patchRow(optimistic.revert)
      }
      return { ok: false, gone, error }
    } finally {
      if (inFlightRef.current.get(id) === token) {
        inFlightRef.current.delete(id)
        if (mountedRef.current) {
          setBusy(({ [id]: _settled, ...rest }) => rest)
        }
      }
    }
  }, [replaceRow])

  return { rows, busy, replaceAll, run }
}

/**
 * Admin console for the one-time restaurant onboarding fee: zone/type pricing rules,
 * limited promotional offers, and a read-only review of collected payments.
 *
 * Everything here is configuration only — the payable amount is always recalculated
 * by the backend at checkout, and historical payments keep their own price snapshot.
 */
export default function OnboardingPricing() {
  const { canCreate, canEdit, canDelete } = useAdminPermissions()
  // Deep link support, e.g. the dashboard's Onboarding Earning box opens ?tab=payments.
  const [tab, setTab] = useState(() => {
    try {
      const requested = new URLSearchParams(window.location.search).get("tab")
      return ["pricing", "offers", "payments"].includes(requested) ? requested : "pricing"
    } catch {
      return "pricing"
    }
  })
  const [bootstrap, setBootstrap] = useState({ restaurantTypes: [], zones: [] })
  const ruleRows = useServerRows()
  const offerRows = useServerRows()
  const rules = ruleRows.rows
  const offers = offerRows.rows
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [ruleForm, setRuleForm] = useState(emptyRule)
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [offerForm, setOfferForm] = useState(emptyOffer)
  const [showOfferForm, setShowOfferForm] = useState(false)

  const zoneNameById = useMemo(() => {
    const map = new Map()
    bootstrap.zones.forEach((zone) => map.set(zone.id, zone.name))
    return map
  }, [bootstrap.zones])

  const { zones: filterZones, zonesLoading: filterZonesLoading, zoneId, setZoneId } = useAdminZoneFilter()
  // Rules and offers stay loaded in full because the fee shown for an offer
  // (feeFor) needs every rule; the zone filter only narrows what is listed.
  // A zone's list includes the "All zones" rules it falls back to.
  const visibleRules = useMemo(
    () => (zoneId ? rules.filter((rule) => !rule.zoneId || rule.zoneId === zoneId) : rules),
    [rules, zoneId],
  )
  const visibleOffers = useMemo(
    () => (zoneId ? offers.filter((offer) => offer.zoneId === zoneId) : offers),
    [offers, zoneId],
  )
  // New rules/offers start in the filtered zone when the forms can offer it.
  const formDefaultZoneId = zoneId && zoneNameById.has(zoneId) ? zoneId : ""

  // Only the newest load may write state: a newer one aborts the older, and an older
  // response that still resolves is ignored by its sequence number.
  const loadSeqRef = useRef(0)
  const loadAbortRef = useRef(null)
  const replaceRules = ruleRows.replaceAll
  const replaceOffers = offerRows.replaceAll

  const load = useCallback(async ({ silent = false } = {}) => {
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const seq = ++loadSeqRef.current
    const isLatest = () => seq === loadSeqRef.current && !controller.signal.aborted

    try {
      if (silent) setRefreshing(true)
      else setLoading(true)

      const config = { signal: controller.signal }
      const [bootstrapRes, rulesRes, offersRes, paymentsRes] = await Promise.all([
        adminAPI.getOnboardingPricingBootstrap(config),
        adminAPI.getOnboardingPricingRules({}, config),
        adminAPI.getOnboardingOffers({}, config),
        // Payments are paged, so the zone filter has to run on the server.
        adminAPI.getOnboardingPayments({ limit: 50, ...(zoneId ? { zoneId } : {}) }, config),
      ])
      if (!isLatest()) return

      setBootstrap(bootstrapRes?.data?.data || { restaurantTypes: [], zones: [] })
      replaceRules(rulesRes?.data?.data?.rules || [])
      replaceOffers(offersRes?.data?.data?.offers || [])
      setPayments(paymentsRes?.data?.data?.payments || [])
    } catch (error) {
      if (!isLatest()) return
      toast.error(error?.response?.data?.message || "Failed to load onboarding pricing")
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [replaceRules, replaceOffers, zoneId])

  // After the first load, a zone switch refreshes in place instead of blanking the page.
  const loadedOnceRef = useRef(false)
  useEffect(() => {
    load({ silent: loadedOnceRef.current })
    loadedOnceRef.current = true
    return () => loadAbortRef.current?.abort()
  }, [load])

  // ---- Pricing rules ----

  const openRuleForm = (rule = null) => {
    setRuleForm(
      rule
        ? {
            id: rule.id,
            zoneId: rule.zoneId || GLOBAL_ZONE,
            restaurantType: rule.restaurantType,
            basePrice: String(rule.basePrice ?? ""),
            isActive: rule.isActive,
            notes: rule.notes || "",
          }
        : { ...emptyRule(), zoneId: formDefaultZoneId || GLOBAL_ZONE },
    )
    setShowRuleForm(true)
  }

  const saveRule = async () => {
    if (!ruleForm.restaurantType) return toast.error("Select a restaurant type")
    if (ruleForm.basePrice === "" || Number(ruleForm.basePrice) < 0) {
      return toast.error("Enter a valid base price")
    }
    try {
      setSaving(true)
      const body = {
        zoneId: ruleForm.zoneId,
        restaurantType: ruleForm.restaurantType,
        basePrice: Number(ruleForm.basePrice),
        isActive: ruleForm.isActive,
        notes: ruleForm.notes,
      }
      const editingId = ruleForm.id
      if (editingId) {
        // Runs under the row's lock so it cannot interleave with a toggle/delete of the same rule,
        // and settles the row in place from the saved document.
        const result = await ruleRows.run(editingId, "save", {
          request: async () =>
            (await adminAPI.updateOnboardingPricingRule(editingId, body))?.data?.data?.rule,
        })
        if (result.skipped) return
        if (!result.ok) throw result.error
      } else {
        await adminAPI.createOnboardingPricingRule(body)
      }
      toast.success(editingId ? "Pricing rule updated" : "Pricing rule created")
      setShowRuleForm(false)
      // A new rule needs the server's ordering.
      if (!editingId) await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save the pricing rule")
    } finally {
      setSaving(false)
    }
  }

  const toggleRule = async (rule) => {
    const nextActive = !rule.isActive
    const result = await ruleRows.run(rule.id, "toggle", {
      request: async () =>
        (await adminAPI.toggleOnboardingPricingRule(rule.id, nextActive))?.data?.data?.rule,
      optimistic: { apply: { isActive: nextActive }, revert: { isActive: rule.isActive } },
    })
    if (result.skipped) return
    if (result.ok) {
      const isActive = result.row?.id === rule.id ? result.row.isActive : nextActive
      // An open edit form for this rule must not save the pre-toggle status back.
      setRuleForm((form) => (form.id === rule.id ? { ...form, isActive } : form))
      toast.success(isActive ? "Rule enabled" : "Rule disabled")
      // Enabling switches off the rule that covered the same zone and type; refresh
      // so that row shows as inactive too.
      if (isActive) await load({ silent: true })
    } else if (result.gone) {
      toast.error("This pricing rule no longer exists")
    } else {
      toast.error(result.error?.response?.data?.message || "Could not update the rule")
    }
  }

  const deleteRule = async (rule) => {
    if (!window.confirm(`Delete the ${rule.restaurantTypeLabel} rule for ${rule.zoneName}?`)) return
    const result = await ruleRows.run(rule.id, "delete", {
      remove: true,
      request: () => adminAPI.deleteOnboardingPricingRule(rule.id),
    })
    if (result.skipped) return
    if (result.ok) toast.success("Pricing rule deleted")
    else if (result.gone) toast.info("This pricing rule was already deleted")
    else toast.error(result.error?.response?.data?.message || "Could not delete the rule")
  }

  // ---- Offers ----

  const openOfferForm = (offer = null) => {
    setOfferForm(
      offer
        ? {
            id: offer.id,
            name: offer.name,
            zoneId: offer.zoneId || "",
            restaurantType: offer.restaurantType,
            originalPrice: String(offer.originalPrice ?? ""),
            offerPrice: String(offer.offerPrice ?? ""),
            maxRedemptions: String(offer.maxRedemptions ?? ""),
            startsAt: toDateTimeLocal(offer.startsAt),
            endsAt: toDateTimeLocal(offer.endsAt),
            isActive: offer.isActive,
          }
        : { ...emptyOffer(), zoneId: formDefaultZoneId },
    )
    setShowOfferForm(true)
  }

  const saveOffer = async () => {
    if (!offerForm.name.trim()) return toast.error("Give the offer a name")
    if (!offerForm.zoneId) return toast.error("Select a zone")
    if (!offerForm.restaurantType) return toast.error("Select a restaurant type")
    if (Number(offerForm.offerPrice) >= Number(offerForm.originalPrice)) {
      return toast.error("Offer price must be lower than the original price")
    }
    if (!offerForm.startsAt || !offerForm.endsAt) return toast.error("Set the start and end date")

    try {
      setSaving(true)
      const body = {
        name: offerForm.name.trim(),
        zoneId: offerForm.zoneId,
        restaurantType: offerForm.restaurantType,
        originalPrice: Number(offerForm.originalPrice),
        offerPrice: Number(offerForm.offerPrice),
        maxRedemptions: Number(offerForm.maxRedemptions),
        startsAt: new Date(offerForm.startsAt).toISOString(),
        endsAt: new Date(offerForm.endsAt).toISOString(),
        isActive: offerForm.isActive,
      }
      const editingId = offerForm.id
      if (editingId) {
        // Runs under the row's lock so it cannot interleave with a toggle/delete of the same offer,
        // and settles the row in place from the saved document.
        const result = await offerRows.run(editingId, "save", {
          request: async () =>
            (await adminAPI.updateOnboardingOffer(editingId, body))?.data?.data?.offer,
        })
        if (result.skipped) return
        if (!result.ok) throw result.error
      } else {
        await adminAPI.createOnboardingOffer(body)
      }
      toast.success(editingId ? "Offer updated" : "Offer created")
      setShowOfferForm(false)
      // A new offer needs the server's ordering.
      if (!editingId) await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save the offer")
    } finally {
      setSaving(false)
    }
  }

  const toggleOffer = async (offer) => {
    const nextActive = !offer.isActive
    const result = await offerRows.run(offer.id, "toggle", {
      request: async () =>
        (await adminAPI.toggleOnboardingOffer(offer.id, nextActive))?.data?.data?.offer,
      optimistic: {
        apply: { isActive: nextActive, isLive: nextActive && wouldBeLive(offer) },
        revert: { isActive: offer.isActive, isLive: offer.isLive },
      },
    })
    if (result.skipped) return
    if (result.ok) {
      const isActive = result.row?.id === offer.id ? result.row.isActive : nextActive
      // The offer form has no status field, so an open edit would silently save the old one back.
      setOfferForm((form) => (form.id === offer.id ? { ...form, isActive } : form))
      toast.success(isActive ? "Offer enabled" : "Offer disabled")
    } else if (result.gone) {
      toast.error("This offer no longer exists")
    } else {
      toast.error(result.error?.response?.data?.message || "Could not update the offer")
    }
  }

  const deleteOffer = async (offer) => {
    const inUse = [
      offer.usedSlots > 0 && `${offer.usedSlots} restaurant(s) already paid with it`,
      offer.heldSlots > 0 && `${offer.heldSlots} restaurant(s) are in checkout with it`,
    ].filter(Boolean)
    const message = inUse.length
      ? `Delete the offer "${offer.name}"?\n\n${inUse.join(" and ")}. It stops immediately and ` +
        "disappears from this list; their payments keep the offer price and stay in Onboarding Payments."
      : `Delete the offer "${offer.name}"?`
    if (!window.confirm(message)) return
    const result = await offerRows.run(offer.id, "delete", {
      remove: true,
      request: async () => (await adminAPI.deleteOnboardingOffer(offer.id))?.data?.data,
    })
    if (result.skipped) return
    if (result.ok) toast.success(result.row?.archived ? "Offer deleted — payment history kept" : "Offer deleted")
    else if (result.gone) toast.info("This offer was already deleted")
    else toast.error(result.error?.response?.data?.message || "Could not delete the offer")
  }

  const offerFormFee =
    offerForm.zoneId && offerForm.restaurantType
      ? feeFor(rules, offerForm.zoneId, offerForm.restaurantType)
      : null
  const offerFormFeeHint =
    offerFormFee == null
      ? undefined
      : offerFormFee > 0
        ? `Current fee for this zone and type: ${money(offerFormFee)}`
        : "No pricing rule for this zone and type yet; the offer applies once one is added."

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Restaurant Onboarding Pricing</h1>
          <p className="text-xs text-slate-500">
            One-time joining fee per zone and restaurant type, plus limited promotional offers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminZoneSelect
            value={zoneId}
            onChange={setZoneId}
            zones={filterZones}
            loading={filterZonesLoading}
          />
          <Button
            variant="outline"
            onClick={() => load({ silent: true })}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === item.id
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ---------- Pricing rules ---------- */}
      {tab === "pricing" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              A zone rule wins over the “All zones” rule. Without either, restaurants join without
              an onboarding fee.
            </p>
            {canCreate && (
            <Button onClick={() => openRuleForm()} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add pricing rule
            </Button>
            )}
          </div>

          {showRuleForm && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  {ruleForm.id ? "Edit pricing rule" : "New pricing rule"}
                </h2>
                <button type="button" onClick={() => setShowRuleForm(false)}>
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Zone">
                  <select
                    className={inputClass}
                    value={ruleForm.zoneId}
                    onChange={(e) => setRuleForm({ ...ruleForm, zoneId: e.target.value })}
                  >
                    <option value={GLOBAL_ZONE}>All zones (default)</option>
                    {bootstrap.zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Restaurant type">
                  <select
                    className={inputClass}
                    value={ruleForm.restaurantType}
                    onChange={(e) => setRuleForm({ ...ruleForm, restaurantType: e.target.value })}
                  >
                    <option value="">Select type</option>
                    {bootstrap.restaurantTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Base price (₹)">
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={ruleForm.basePrice}
                    onChange={(e) => setRuleForm({ ...ruleForm, basePrice: e.target.value })}
                  />
                </Field>
                <Field label="Status">
                  <select
                    className={inputClass}
                    value={ruleForm.isActive ? "active" : "inactive"}
                    onChange={(e) =>
                      setRuleForm({ ...ruleForm, isActive: e.target.value === "active" })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={saveRule}
                  disabled={saving || Boolean(ruleRows.busy[ruleForm.id])}
                  className="gap-1.5"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save rule
                </Button>
                <Button variant="outline" onClick={() => setShowRuleForm(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Restaurant type</th>
                  <th className="px-4 py-3">Base price</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      {zoneId
                        ? "No pricing rule applies to this zone — restaurants here join without an onboarding fee."
                        : "No pricing rules yet — restaurants join without an onboarding fee."}
                    </td>
                  </tr>
                ) : (
                  visibleRules.map((rule) => {
                    const busyAction = ruleRows.busy[rule.id]
                    return (
                      <tr
                        key={rule.id}
                        aria-busy={Boolean(busyAction)}
                        className={busyAction === "delete" ? "opacity-50" : undefined}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {rule.zoneId ? zoneNameById.get(rule.zoneId) || rule.zoneName : "All zones (default)"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{rule.restaurantTypeLabel}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {money(rule.basePrice, rule.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusPill(rule.isActive)}`}
                          >
                            {rule.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            {canEdit && (
                            <button
                              type="button"
                              onClick={() => openRuleForm(rule)}
                              className="rounded-lg bg-blue-50 p-2 text-blue-700 disabled:opacity-40"
                              disabled={Boolean(busyAction)}
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            )}
                            {canEdit && (
                            <button
                              type="button"
                              onClick={() => toggleRule(rule)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                              disabled={Boolean(busyAction)}
                            >
                              {busyAction === "toggle" && <Loader2 className="h-3 w-3 animate-spin" />}
                              {rule.isActive ? "Disable" : "Enable"}
                            </button>
                            )}
                            {canDelete && (
                            <button
                              type="button"
                              onClick={() => deleteRule(rule)}
                              className="rounded-lg bg-rose-50 p-2 text-rose-700 disabled:opacity-40"
                              disabled={Boolean(busyAction)}
                              title="Delete"
                            >
                              {busyAction === "delete" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- Offers ---------- */}
      {tab === "offers" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Slots are consumed only by verified payments; failed or cancelled attempts are
              released automatically.
            </p>
            {canCreate && (
            <Button onClick={() => openOfferForm()} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add offer
            </Button>
            )}
          </div>

          {showOfferForm && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  {offerForm.id ? "Edit offer" : "New promotional offer"}
                </h2>
                <button type="button" onClick={() => setShowOfferForm(false)}>
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Offer name">
                  <input
                    className={inputClass}
                    placeholder="First 10 Family Restaurants"
                    value={offerForm.name}
                    onChange={(e) => setOfferForm({ ...offerForm, name: e.target.value })}
                  />
                </Field>
                <Field label="Zone">
                  <select
                    className={inputClass}
                    value={offerForm.zoneId}
                    onChange={(e) => setOfferForm({ ...offerForm, zoneId: e.target.value })}
                  >
                    <option value="">Select zone</option>
                    {bootstrap.zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Restaurant type">
                  <select
                    className={inputClass}
                    value={offerForm.restaurantType}
                    onChange={(e) => setOfferForm({ ...offerForm, restaurantType: e.target.value })}
                  >
                    <option value="">Select type</option>
                    {bootstrap.restaurantTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Max eligible restaurants">
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    value={offerForm.maxRedemptions}
                    onChange={(e) => setOfferForm({ ...offerForm, maxRedemptions: e.target.value })}
                  />
                </Field>
                <Field label="Original price (₹)">
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={offerForm.originalPrice}
                    onChange={(e) => setOfferForm({ ...offerForm, originalPrice: e.target.value })}
                  />
                </Field>
                <Field label="Offer price (₹)" hint={offerFormFeeHint}>
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={offerForm.offerPrice}
                    onChange={(e) => setOfferForm({ ...offerForm, offerPrice: e.target.value })}
                  />
                </Field>
                <Field label="Starts at">
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={offerForm.startsAt}
                    onChange={(e) => setOfferForm({ ...offerForm, startsAt: e.target.value })}
                  />
                </Field>
                <Field label="Ends at">
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={offerForm.endsAt}
                    onChange={(e) => setOfferForm({ ...offerForm, endsAt: e.target.value })}
                  />
                </Field>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={saveOffer}
                  disabled={saving || Boolean(offerRows.busy[offerForm.id])}
                  className="gap-1.5"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save offer
                </Button>
                <Button variant="outline" onClick={() => setShowOfferForm(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Offer</th>
                  <th className="px-4 py-3">Zone / Type</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Slots</th>
                  <th className="px-4 py-3">Window</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleOffers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      {zoneId ? "No promotional offers for this zone." : "No promotional offers configured."}
                    </td>
                  </tr>
                ) : (
                  visibleOffers.map((offer) => {
                    const busyAction = offerRows.busy[offer.id]
                    const blocked = offer.isActive ? offerBlockedReason(offer, rules) : ""
                    return (
                      <tr
                        key={offer.id}
                        aria-busy={Boolean(busyAction)}
                        className={busyAction === "delete" ? "opacity-50" : undefined}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800">{offer.name}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {offer.zoneName || zoneNameById.get(offer.zoneId) || "—"}
                          <span className="block text-[11px] text-slate-500">
                            {offer.restaurantTypeLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-slate-400 line-through">{money(offer.originalPrice)}</span>{" "}
                          <span className="font-semibold text-emerald-700">{money(offer.offerPrice)}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <span className="font-semibold text-slate-900">{offer.usedSlots}</span> used
                          {offer.heldSlots > 0 && (
                            <span className="block text-[11px] text-amber-600">
                              {offer.heldSlots} in checkout
                            </span>
                          )}
                          <span className="block text-[11px] text-slate-500">
                            {offer.remainingSlots} of {offer.maxRedemptions} left
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-slate-600">
                          {formatDate(offer.startsAt)}
                          <span className="block">→ {formatDate(offer.endsAt)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                              blocked ? "border-amber-200 bg-amber-50 text-amber-700" : statusPill(offer.isLive)
                            }`}
                          >
                            {blocked
                              ? "Not applied"
                              : offer.isLive
                                ? "Live"
                                : offer.isActive
                                  ? "Scheduled / Exhausted"
                                  : "Inactive"}
                          </span>
                          {blocked && (
                            <span className="mt-1 block max-w-[220px] text-[11px] text-amber-700">{blocked}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            {canEdit && (
                            <button
                              type="button"
                              onClick={() => openOfferForm(offer)}
                              className="rounded-lg bg-blue-50 p-2 text-blue-700 disabled:opacity-40"
                              disabled={Boolean(busyAction)}
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            )}
                            {canEdit && (
                            <button
                              type="button"
                              onClick={() => toggleOffer(offer)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                              disabled={Boolean(busyAction)}
                            >
                              {busyAction === "toggle" && <Loader2 className="h-3 w-3 animate-spin" />}
                              {offer.isActive ? "Disable" : "Enable"}
                            </button>
                            )}
                            {canDelete && (
                            <button
                              type="button"
                              onClick={() => deleteOffer(offer)}
                              className="rounded-lg bg-rose-50 p-2 text-rose-700 disabled:opacity-40"
                              disabled={Boolean(busyAction)}
                              title="Delete"
                            >
                              {busyAction === "delete" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- Payments ---------- */}
      {tab === "payments" && (
        <section className="space-y-3">
          <p className="text-xs text-slate-500">
            Historical records keep the price that applied at payment time — later pricing changes
            never rewrite them.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">Type / Zone</th>
                  <th className="px-4 py-3">Original</th>
                  <th className="px-4 py-3">Offer</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      {zoneId ? "No onboarding payments for this zone yet." : "No onboarding payments yet."}
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-800">{payment.restaurantName || "—"}</span>
                        <span className="block text-[11px] text-slate-500">
                          {payment.ownerName} · {payment.ownerPhone}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {payment.restaurantTypeLabel}
                        <span className="block text-[11px] text-slate-500">{payment.zoneName || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {money(payment.originalPrice, payment.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {payment.offerPrice != null ? (
                          <>
                            {money(payment.offerPrice, payment.currency)}
                            <span className="block text-[11px] text-emerald-700">{payment.offerName}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {money(payment.finalAmount, payment.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${paymentStatusPill(payment.status)}`}
                        >
                          {payment.status}
                        </span>
                        <span className="mt-1 block text-[11px] text-slate-500">
                          {formatDate(payment.paidAt || payment.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block font-mono text-[11px] text-slate-700">
                          {payment.transactionReference || "—"}
                        </span>
                        {payment.confirmedVia && (
                          <span className="text-[11px] text-slate-400">via {payment.confirmedVia}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
