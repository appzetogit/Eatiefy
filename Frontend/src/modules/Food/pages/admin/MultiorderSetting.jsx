import { Package, Loader2, Bike, RotateCcw } from "lucide-react"
import { adminAPI } from "@food/api"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import ZoneOverridesTable from "@food/components/admin/zones/ZoneOverridesTable"
import { ZoneDefaultHint, ZoneSettingBadge } from "@food/components/admin/zones/ZoneSettingStatus"
import { getZoneId, getZoneLabel } from "@food/hooks/useAdminZoneFilter"
import { useZoneScopedSettings } from "@food/hooks/useZoneScopedSettings"
import { toast } from "sonner"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const FIELD = "maxConcurrentOrders"
const FIELDS = [FIELD]
const formatOrders = (value) => `${value} order${Number(value) === 1 ? "" : "s"}`
const fetchSettings = (params) => adminAPI.getDeliveryCashLimit(params)
const saveSettings = (body) => adminAPI.updateDeliveryCashLimit(body)

export default function MultiorderSetting() {
  const { canEdit } = useAdminPermissions()
  const s = useZoneScopedSettings({
    fields: FIELDS,
    fetchSettings,
    saveSettings,
    label: "multiorder setting",
  })
  const scopeLabel = s.zoneId ? s.zoneName || "this zone" : "All zones"
  const overridden = s.isOverridden(FIELD)
  const draft = s.drafts[FIELD]
  const saved = s.savedValue(FIELD)
  const isSaving = s.savingKey === FIELD
  const canSave = !s.isBusy && draft !== "" && String(saved ?? "") !== draft
  const defaultValue = s.defaultValue(FIELD)

  const handleSave = () => {
    const value = Number(draft)
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      toast.error("Concurrent order limit must be between 1 and 5")
      return
    }
    s.save(
      FIELD,
      { [FIELD]: value },
      s.zoneId ? `Concurrent order limit saved for ${scopeLabel}` : "Concurrent order limit updated successfully",
    )
  }

  const handleUseDefault = () => {
    s.save(FIELD, { [FIELD]: null }, `${scopeLabel} now follows the default concurrent order limit`)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Package className="w-5 h-5 text-slate-700" />
                <h1 className="text-2xl font-bold text-slate-900">Multiorder Setting</h1>
              </div>
              <p className="text-sm text-slate-600">
                {s.zoneId ? (
                  <>
                    How many orders a delivery partner in <strong>{scopeLabel}</strong> can handle at the same time. A
                    value saved here applies to this zone only.
                  </>
                ) : (
                  <>
                    Configure how many orders a delivery partner can handle at the same time. This is the
                    <strong> default for every zone</strong>; pick a zone to give it its own limit.
                  </>
                )}
              </p>
            </div>
            <AdminZoneSelect
              value={s.zoneId}
              onChange={s.setZoneId}
              zones={s.zones}
              loading={s.zonesLoading}
              allLabel="All zones (default)"
              getOptionLabel={(zone) =>
                s.overriddenZoneIds.has(getZoneId(zone)) ? `${getZoneLabel(zone)} • Custom` : getZoneLabel(zone)
              }
              disabled={s.savingKey !== null}
            />
          </div>

          <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/40 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600/10 text-blue-700">
                  <Bike className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-blue-950">Delivery Boy Order Limit</h2>
                  <p className="text-xs text-blue-700/70">
                    {s.zoneId ? `${scopeLabel} · delivery partners of this zone` : "Default · applies to every zone without its own limit"}
                  </p>
                </div>
              </div>
              <ZoneSettingBadge zoneId={s.zoneId} loading={s.loading} overridden={overridden} />
            </div>

            <p className="text-sm text-blue-900/70 mb-4">
              Maximum number of orders a delivery partner can accept and work on at the same time.
              Allowed range is <strong>1 to 5</strong>.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-blue-900/80">
                  Order limit per delivery boy
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={draft}
                  onChange={(e) => s.setDraft(FIELD, e.target.value)}
                  className="w-full rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={s.loading ? "Loading..." : "e.g., 3"}
                  disabled={s.isBusy}
                />
                {s.loading && (
                  <p className="mt-1 flex items-center gap-2 text-xs text-blue-700/80">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading current setting...
                  </p>
                )}
                <ZoneDefaultHint
                  zoneId={s.zoneId}
                  overridden={overridden}
                  defaultLabel={defaultValue != null ? formatOrders(defaultValue) : null}
                />
              </div>
              <div className="flex gap-2 sm:mt-5">
                {canEdit && (
                <button
                  onClick={handleSave}
                  disabled={!canSave}
                  className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
                )}
                {overridden && (
                  canEdit && (
                  <button
                    type="button"
                    onClick={handleUseDefault}
                    disabled={s.isBusy}
                    className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Use default
                  </button>
                  )
                )}
              </div>
            </div>
          </div>

          {!s.zoneId && (
            <ZoneOverridesTable
              rows={s.zoneOverrides}
              columns={[{ field: FIELD, label: "Order limit", format: formatOrders }]}
              zoneNameById={s.zoneNameById}
              onEdit={s.setZoneId}
            />
          )}
        </div>
      </div>
    </div>
  )
}
