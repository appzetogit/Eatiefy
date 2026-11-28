import { IndianRupee, Loader2, RotateCcw, Wallet } from "lucide-react"
import { adminAPI } from "@food/api"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import ZoneOverridesTable from "@food/components/admin/zones/ZoneOverridesTable"
import { ZoneDefaultHint, ZoneSettingBadge } from "@food/components/admin/zones/ZoneSettingStatus"
import { getZoneId, getZoneLabel } from "@food/hooks/useAdminZoneFilter"
import { useZoneScopedSettings } from "@food/hooks/useZoneScopedSettings"
import { toast } from "sonner"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const FIELDS = ["deliveryCashLimit", "deliveryWithdrawalLimit"]
const formatRupees = (value) => `₹${Number(value).toLocaleString("en-IN")}`
const fetchSettings = (params) => adminAPI.getDeliveryCashLimit(params)
const saveSettings = (body) => adminAPI.updateDeliveryCashLimit(body)

const CARDS = [
  {
    field: "deliveryCashLimit",
    title: "Delivery Boy Available Cash Limit",
    description: "When COD cash is collected, delivery partner's remaining limit will decrease automatically.",
    label: "Cash limit",
    placeholder: "e.g., 2000",
    Icon: IndianRupee,
    tone: {
      box: "bg-emerald-50 border-emerald-200",
      icon: "text-emerald-700",
      title: "text-emerald-900",
      text: "text-emerald-800/80",
      input: "focus:ring-emerald-500 border-emerald-200",
      button: "bg-emerald-600 hover:bg-emerald-700",
    },
  },
  {
    field: "deliveryWithdrawalLimit",
    title: "Minimum Withdrawal Amount",
    description: "Delivery boy can withdraw only when withdrawable amount is above this value.",
    label: "Minimum withdrawal",
    placeholder: "e.g., 100",
    Icon: Wallet,
    tone: {
      box: "bg-amber-50 border-amber-200",
      icon: "text-amber-700",
      title: "text-amber-900",
      text: "text-amber-800/80",
      input: "focus:ring-amber-500 border-amber-200",
      button: "bg-amber-600 hover:bg-amber-700",
    },
  },
]

export default function DeliveryCashLimit() {
  const { canEdit } = useAdminPermissions()
  const s = useZoneScopedSettings({
    fields: FIELDS,
    fetchSettings,
    saveSettings,
    label: "delivery cash limit",
  })
  const scopeLabel = s.zoneId ? s.zoneName || "this zone" : "All zones"

  const handleSave = ({ field, label }) => {
    const value = Number(s.drafts[field])
    if (s.drafts[field] === "" || !Number.isFinite(value) || value < 0) {
      toast.error(`${label} must be a number (>= 0)`)
      return
    }
    s.save(field, { [field]: value }, s.zoneId ? `${label} saved for ${scopeLabel}` : `${label} updated successfully`)
  }

  const handleUseDefault = ({ field, label }) => {
    s.save(field, { [field]: null }, `${scopeLabel} now follows the default ${label.toLowerCase()}`)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <IndianRupee className="w-5 h-5 text-slate-700" />
                <h1 className="text-2xl font-bold text-slate-900">Delivery Cash Limit</h1>
              </div>
              <p className="text-sm text-slate-600">
                {s.zoneId ? (
                  <>
                    COD cash limit and minimum withdrawal for delivery partners in <strong>{scopeLabel}</strong>. A value
                    saved here applies to this zone only; anything not set follows the default.
                  </>
                ) : (
                  <>
                    Set the <strong>default COD cash limit</strong> and <strong>minimum withdrawal amount</strong> for
                    delivery partners, or pick a zone to give it its own values. Cash limit is used for Available cash
                    limit in the delivery app; withdrawal is allowed only when withdrawable amount is above the
                    withdrawal limit.
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

          <div className="space-y-6">
            {CARDS.map((card) => {
              const { field, title, description, placeholder, Icon, tone } = card
              const overridden = s.isOverridden(field)
              const saved = s.savedValue(field)
              const draft = s.drafts[field]
              const isSaving = s.savingKey === field
              const canSave = !s.isBusy && draft !== "" && String(saved ?? "") !== draft
              const defaultValue = s.defaultValue(field)

              return (
                <div key={field} className={`p-4 border rounded-lg ${tone.box}`}>
                  <div className="flex items-start gap-3">
                    <Icon className={`w-5 h-5 mt-0.5 ${tone.icon}`} />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className={`font-semibold ${tone.title}`}>
                          {title} ({scopeLabel})
                        </div>
                        <ZoneSettingBadge zoneId={s.zoneId} loading={s.loading} overridden={overridden} />
                      </div>
                      <div className={`text-sm mb-3 ${tone.text}`}>{description}</div>

                      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <div className="flex-1">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={draft}
                            onChange={(e) => s.setDraft(field, e.target.value)}
                            className={`w-full px-4 py-2.5 border rounded-lg bg-white focus:outline-none focus:ring-2 text-sm ${tone.input}`}
                            placeholder={s.loading ? "Loading..." : placeholder}
                            disabled={s.isBusy}
                          />
                          {s.loading && (
                            <p className={`text-xs mt-1 flex items-center gap-2 ${tone.text}`}>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Loading current value...
                            </p>
                          )}
                          <ZoneDefaultHint
                            zoneId={s.zoneId}
                            overridden={overridden}
                            defaultLabel={defaultValue != null ? formatRupees(defaultValue) : null}
                          />
                        </div>
                        <div className="flex gap-2">
                          {canEdit && (
                          <button
                            onClick={() => handleSave(card)}
                            disabled={!canSave}
                            className={`px-4 py-2.5 text-sm font-medium rounded-lg text-white transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${tone.button}`}
                          >
                            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                            Save
                          </button>
                          )}
                          {overridden && (
                            canEdit && (
                            <button
                              type="button"
                              onClick={() => handleUseDefault(card)}
                              disabled={s.isBusy}
                              className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
                            >
                              <RotateCcw className="w-4 h-4" />
                              Use default
                            </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {!s.zoneId && (
            <ZoneOverridesTable
              rows={s.zoneOverrides}
              columns={[
                { field: "deliveryCashLimit", label: "Cash limit", format: formatRupees },
                { field: "deliveryWithdrawalLimit", label: "Min. withdrawal", format: formatRupees },
              ]}
              zoneNameById={s.zoneNameById}
              onEdit={s.setZoneId}
            />
          )}
        </div>
      </div>
    </div>
  )
}
