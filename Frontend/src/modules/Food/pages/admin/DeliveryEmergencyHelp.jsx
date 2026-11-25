import { useState } from "react"
import { Phone, Save, Loader2, AlertCircle, CheckCircle2, RotateCcw } from "lucide-react"
import { adminAPI } from "@food/api"
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect"
import ZoneOverridesTable from "@food/components/admin/zones/ZoneOverridesTable"
import { ZoneSettingBadge } from "@food/components/admin/zones/ZoneSettingStatus"
import { getZoneId, getZoneLabel } from "@food/hooks/useAdminZoneFilter"
import { useZoneScopedSettings } from "@food/hooks/useZoneScopedSettings"
import { toast } from "sonner"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const FIELD_LIMITS = {
  medicalEmergency: 3,
  accidentHelpline: 3,
  contactPolice: 3,
  insurance: 10,
}

const EMERGENCY_FIELDS = [
  {
    id: "medicalEmergency",
    label: "Medical Emergency",
    placeholder: "Enter medical emergency phone number",
    description: "Phone number for medical emergencies (e.g., 108)",
  },
  {
    id: "accidentHelpline",
    label: "Accident Helpline",
    placeholder: "Enter accident helpline phone number",
    description: "Phone number for accident helpline",
  },
  {
    id: "contactPolice",
    label: "Contact Police",
    placeholder: "Enter police emergency phone number",
    description: "Phone number for police emergency (e.g., 100)",
  },
  {
    id: "insurance",
    label: "Insurance",
    placeholder: "Enter insurance helpline phone number",
    description: "Phone number for insurance claims and policy help",
  },
]

const FIELDS = EMERGENCY_FIELDS.map(({ id }) => id)
const fetchSettings = (params) => adminAPI.getEmergencyHelp(params)
const saveSettings = (body) => adminAPI.createOrUpdateEmergencyHelp(body)

/**
 * For a zone, a box holds the zone's OWN number - blank means the zone uses
 * the default - so the default number is never copied into the zone by saving.
 */
const toDraft = (value, field, data) => {
  if (data?.zoneId && !data?.overridden?.[field]) return ""
  return value == null ? "" : String(value)
}

const digitsOf = (value) => String(value || "").replace(/[^\d]/g, "")

export default function DeliveryEmergencyHelp() {
  const { canEdit } = useAdminPermissions()
  const s = useZoneScopedSettings({
    fields: FIELDS,
    fetchSettings,
    saveSettings,
    label: "emergency help numbers",
    toDraft,
  })
  const [formErrors, setFormErrors] = useState({})
  const scopeLabel = s.zoneId ? s.zoneName || "this zone" : "All zones"
  const anyOverridden = FIELDS.some((field) => s.isOverridden(field))

  const validateForm = () => {
    const errors = {}
    for (const { id } of EMERGENCY_FIELDS) {
      const value = s.drafts[id]
      if (value && digitsOf(value).length !== FIELD_LIMITS[id]) {
        errors[id] = `Phone number must be exactly ${FIELD_LIMITS[id]} digits`
      }
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleInputChange = (field, value) => {
    s.setDraft(field, digitsOf(value).slice(0, FIELD_LIMITS[field] || 15))
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validateForm()) {
      toast.error("Please fix the errors in the form")
      return
    }
    // For a zone a blank box clears that number's override (the backend reads "" as "use default").
    const values = Object.fromEntries(FIELDS.map((field) => [field, String(s.drafts[field] || "").trim()]))
    s.save(
      "form",
      values,
      s.zoneId ? `Emergency numbers saved for ${scopeLabel}` : "Emergency help numbers saved successfully!",
    )
  }

  const handleUseDefaults = () => {
    s.save(
      "defaults",
      Object.fromEntries(FIELDS.map((field) => [field, null])),
      `${scopeLabel} now uses the default emergency numbers`,
    )
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <Phone className="w-6 h-6 text-slate-600" />
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Delivery Emergency Help</h1>
                <p className="text-sm text-slate-600 mt-1">
                  {s.zoneId
                    ? `Emergency numbers for delivery partners in ${scopeLabel}. Leave a box blank to use the default number.`
                    : "Manage the default emergency contact numbers for delivery partners, or pick a zone to give it its own."}
                </p>
              </div>
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

          {/* Info Card */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">Important Information</p>
                <p>
                  These phone numbers will be displayed to delivery partners in the emergency help section - each
                  partner sees the numbers of their own zone. When a delivery partner clicks on any emergency option,
                  it will automatically dial the corresponding number.
                </p>
              </div>
            </div>
          </div>

          {s.loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {EMERGENCY_FIELDS.map((field) => {
                const defaultNumber = s.defaultValue(field.id)
                return (
                  <div key={field.id} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-sm font-semibold text-slate-900">{field.label}</label>
                      <ZoneSettingBadge zoneId={s.zoneId} loading={s.loading} overridden={s.isOverridden(field.id)} />
                    </div>
                    <p className="text-xs text-slate-600 mb-2">{field.description}</p>
                    <div className="relative">
                      <input
                        type="text"
                        value={s.drafts[field.id]}
                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                        placeholder={
                          s.zoneId
                            ? defaultNumber
                              ? `Default: ${defaultNumber}`
                              : "No default number set"
                            : field.placeholder
                        }
                        inputMode="numeric"
                        maxLength={FIELD_LIMITS[field.id] || 15}
                        disabled={s.isBusy}
                        className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          formErrors[field.id] ? "border-red-300 focus:ring-red-500" : "border-slate-300"
                        }`}
                      />
                      {formErrors[field.id] && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                          <AlertCircle className="w-4 h-4" />
                          {formErrors[field.id]}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Submit Button */}
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-3">
                {canEdit && (
                <button
                  type="submit"
                  disabled={s.isBusy}
                  className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {s.savingKey === "form" ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      Save Emergency Numbers
                    </>
                  )}
                </button>
                )}
                {s.zoneId && anyOverridden && (
                  canEdit && (
                  <button
                    type="button"
                    onClick={handleUseDefaults}
                    disabled={s.isBusy}
                    className="w-full sm:w-auto px-6 py-3 border border-slate-300 bg-white text-slate-700 rounded-lg font-semibold hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-5 h-5" />
                    Use default numbers
                  </button>
                  )
                )}
              </div>
            </form>
          )}

          {!s.zoneId && (
            <ZoneOverridesTable
              rows={s.zoneOverrides}
              columns={EMERGENCY_FIELDS.map(({ id, label }) => ({ field: id, label }))}
              zoneNameById={s.zoneNameById}
              onEdit={s.setZoneId}
            />
          )}

          {!s.loading && s.savingKey === null && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle2 className="w-5 h-5" />
                <p className="text-sm font-medium">
                  {s.zoneId
                    ? `Changes will be reflected immediately for delivery partners in ${scopeLabel}`
                    : "Changes will be reflected immediately for all delivery partners without zone-specific numbers"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
