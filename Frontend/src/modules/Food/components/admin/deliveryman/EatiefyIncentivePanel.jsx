import { useEffect, useMemo, useState } from "react"
import { Award, Calculator, Loader2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const ORDER_VALUE_BASIS_OPTIONS = [
  { value: "subtotal", label: "Item subtotal (food value)" },
  { value: "total", label: "Order total (amount customer pays)" },
]

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100
const inr = (value) => `₹${roundMoney(value).toFixed(2)}`
const pct = (value) => `${roundMoney(value)}%`

/** Mirrors backend getRiderEarning + base payout fallback (riderEarning.service.js). */
function computeRiderBaseEarning(rules, distanceKm) {
  const active = (rules || []).filter((r) => r.status !== false)
  if (!active.length) return 0
  const sorted = [...active].sort((a, b) => (Number(a.minDistance) || 0) - (Number(b.minDistance) || 0))
  const baseRule = sorted.find((r) => Number(r.minDistance || 0) === 0)
  if (!baseRule) return 0
  const basePayout = Number(baseRule.basePayout || 0)
  const d = Number(distanceKm)
  if (!Number.isFinite(d) || d <= 0) return basePayout > 0 ? Math.round(basePayout) : 0

  let earning = basePayout
  for (const r of sorted) {
    const perKm = Number(r.commissionPerKm || 0)
    if (!Number.isFinite(perKm) || perKm <= 0) continue
    const min = Number(r.minDistance || 0)
    const max = r.maxDistance == null ? null : Number(r.maxDistance)
    if (d <= min) continue
    const upper = max == null ? d : Math.min(d, max)
    const km = Math.max(0, upper - min)
    if (km > 0) earning += km * perKm
  }
  if (!Number.isFinite(earning) || earning <= 0) return basePayout > 0 ? Math.round(basePayout) : 0
  return Math.round(earning)
}

/** Mirrors backend delivery fee resolution (order-pricing.service.js). */
function computeUserDeliveryFee(feeSettings, subtotal, distanceKm) {
  if (!feeSettings) return null
  const freeUpTo = Number(feeSettings.freeDeliveryUpTo || 0)
  if (freeUpTo > 0 && subtotal >= freeUpTo) return 0
  const ranges = Array.isArray(feeSettings.deliveryFeeRanges) ? [...feeSettings.deliveryFeeRanges] : []
  const d = Number(distanceKm)
  if (ranges.length > 0 && Number.isFinite(d)) {
    ranges.sort((a, b) => Number(a.min) - Number(b.min))
    for (let i = 0; i < ranges.length; i += 1) {
      const min = Number(ranges[i].min)
      const max = Number(ranges[i].max)
      const fee = Number(ranges[i].fee)
      if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(fee)) continue
      const isLast = i === ranges.length - 1
      const inRange = isLast ? d >= min && d <= max : d >= min && d < max
      if (inRange) return fee
    }
  }
  return Number(feeSettings.deliveryFee || 0)
}

export default function EatiefyIncentivePanel({ zoneId, zoneName, rules }) {
  const { canEdit } = useAdminPermissions()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isEnabled, setIsEnabled] = useState(false)
  const [incentivePercent, setIncentivePercent] = useState("")
  const [orderValueBasis, setOrderValueBasis] = useState("subtotal")
  const [feeSettings, setFeeSettings] = useState(null)

  const [calcOrderValue, setCalcOrderValue] = useState("")
  const [calcDistance, setCalcDistance] = useState("")
  const [calcCommissionPercent, setCalcCommissionPercent] = useState("")

  useEffect(() => {
    if (!zoneId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [incentiveRes, feeRes] = await Promise.allSettled([
          adminAPI.getDeliveryIncentiveSettings(zoneId),
          adminAPI.getFeeSettings({ zoneId }),
        ])
        if (cancelled) return
        if (incentiveRes.status === "fulfilled") {
          const data = incentiveRes.value?.data?.data || {}
          setIsEnabled(Boolean(data.isEnabled))
          setIncentivePercent(data.isConfigured ? String(data.incentivePercent ?? "") : "")
          setOrderValueBasis(data.orderValueBasis === "total" ? "total" : "subtotal")
        } else {
          setIsEnabled(false)
          setIncentivePercent("")
          setOrderValueBasis("subtotal")
          toast.error(incentiveRes.reason?.response?.data?.message || "Failed to load Eatiefy incentive")
        }
        setFeeSettings(feeRes.status === "fulfilled" ? feeRes.value?.data?.data?.feeSettings || null : null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [zoneId])

  const handleSave = async () => {
    const percent = incentivePercent === "" ? 0 : Number(incentivePercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("Eatiefy incentive must be between 0 and 100%")
      return
    }
    if (isEnabled && percent <= 0) {
      toast.error("Enter a percentage greater than 0 to enable the Eatiefy incentive")
      return
    }
    try {
      setSaving(true)
      const res = await adminAPI.updateDeliveryIncentiveSettings({
        zoneId,
        isEnabled,
        incentivePercent: percent,
        orderValueBasis,
      })
      const data = res?.data?.data || {}
      setIsEnabled(Boolean(data.isEnabled))
      setIncentivePercent(String(data.incentivePercent ?? percent))
      setOrderValueBasis(data.orderValueBasis === "total" ? "total" : "subtotal")
      toast.success("Eatiefy incentive saved. It applies to new orders in this zone.")
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save Eatiefy incentive")
    } finally {
      setSaving(false)
    }
  }

  const calc = useMemo(() => {
    const orderValue = Number(calcOrderValue)
    const distance = Number(calcDistance)
    if (!Number.isFinite(orderValue) || orderValue <= 0 || !Number.isFinite(distance) || distance <= 0) return null

    const percent = Number(incentivePercent)
    const incentive = isEnabled && Number.isFinite(percent) && percent > 0 ? roundMoney((orderValue * percent) / 100) : 0
    const riderBase = computeRiderBaseEarning(rules, distance)
    const userDeliveryFee = computeUserDeliveryFee(feeSettings, orderValue, distance)

    const commissionPercent = Number(calcCommissionPercent)
    const hasCommission = calcCommissionPercent !== "" && Number.isFinite(commissionPercent) && commissionPercent >= 0
    const commission = hasCommission ? roundMoney((orderValue * commissionPercent) / 100) : null
    const netCommission = hasCommission ? roundMoney(commission - incentive) : null

    return {
      orderValue,
      incentive,
      riderBase,
      riderTotal: roundMoney(riderBase + incentive),
      userDeliveryFee,
      deliveryMargin: userDeliveryFee == null ? null : roundMoney(userDeliveryFee - riderBase),
      commissionPercent: hasCommission ? commissionPercent : null,
      commission,
      netCommission,
      netCommissionPercent: hasCommission ? roundMoney((netCommission / orderValue) * 100) : null,
    }
  }, [calcOrderValue, calcDistance, calcCommissionPercent, incentivePercent, isEnabled, rules, feeSettings])

  const disabled = !zoneId || loading || saving
  const inputClass =
    "w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"

  return (
    <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Settings */}
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-emerald-700" />
            <p className="font-semibold text-emerald-900">
              Eatiefy Incentive{zoneName ? ` · ${zoneName}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled((v) => !v)}
            disabled={disabled || !canEdit}
            aria-label="Toggle Eatiefy incentive"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
              isEnabled ? "bg-emerald-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-3">
          Extra amount paid to the delivery boy <strong>on top of</strong> this zone&apos;s payout rules, as a % of the
          order value. Saved on each order when it is placed, so changes apply to new orders only.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Incentive (% of order value)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={incentivePercent}
              onChange={(e) => setIncentivePercent(e.target.value)}
              className={inputClass}
              placeholder={loading ? "Loading..." : "Enter %"}
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Calculate % on</label>
            <select
              value={orderValueBasis}
              onChange={(e) => setOrderValueBasis(e.target.value)}
              className={inputClass}
              disabled={disabled}
            >
              {ORDER_VALUE_BASIS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-3">
          <span className={`text-xs font-medium ${isEnabled ? "text-emerald-700" : "text-slate-500"}`}>
            {isEnabled ? "Enabled for this zone" : "Disabled — delivery boy gets payout rules only"}
          </span>
          {canEdit && (
          <button
            onClick={handleSave}
            disabled={disabled}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Incentive
          </button>
          )}
        </div>
      </div>

      {/* Calculator */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="flex items-center gap-2 mb-1">
          <Calculator className="w-5 h-5 text-slate-700" />
          <p className="font-semibold text-slate-900">Order Earning Calculator</p>
        </div>
        <p className="text-sm text-slate-600 mb-3">
          Uses this zone&apos;s payout rules, Delivery &amp; Platform Fee settings and the incentive above. Nothing is
          saved.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {orderValueBasis === "total" ? "Order total (₹)" : "Order value (₹)"}
            </label>
            <input type="number" min="0" step="0.01" value={calcOrderValue} onChange={(e) => setCalcOrderValue(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Distance (km)</label>
            <input type="number" min="0" step="0.1" value={calcDistance} onChange={(e) => setCalcDistance(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Restaurant commission (%)</label>
            <input type="number" min="0" max="100" step="0.01" value={calcCommissionPercent} onChange={(e) => setCalcCommissionPercent(e.target.value)} className={inputClass} placeholder="Optional" />
          </div>
        </div>

        {calc ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-slate-600">User pays for delivery</span>
              <span className="font-semibold text-slate-900">
                {calc.userDeliveryFee == null ? "Fee settings not configured" : inr(calc.userDeliveryFee)}
              </span>
            </div>
            <div className="flex justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-slate-600">Delivery boy</span>
              <span className="font-semibold text-slate-900">
                {inr(calc.riderBase)} <span className="text-emerald-700">+ {inr(calc.incentive)} Eatiefy</span> ={" "}
                {inr(calc.riderTotal)}
              </span>
            </div>
            {calc.deliveryMargin != null && (
              <div className="flex justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-slate-600">Delivery fee margin (user fee − payout rules)</span>
                <span className="font-semibold text-slate-900">{inr(calc.deliveryMargin)}</span>
              </div>
            )}
            {calc.commission != null && (
              <div className="flex justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-slate-600">
                  Commission {pct(calc.commissionPercent)} ({inr(calc.commission)}) − Eatiefy incentive
                </span>
                <span className="font-semibold text-slate-900">
                  {inr(calc.netCommission)} ({pct(calc.netCommissionPercent)})
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Enter order value and distance to see the breakdown.</p>
        )}
      </div>
    </div>
  )
}
