import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save, Loader2, Settings, Clock, Truck, ShoppingBag, RotateCcw, MapPin } from "lucide-react";
import { Button } from "@food/components/ui/button";
import { Input } from "@food/components/ui/input";
import { Label } from "@food/components/ui/label";
import { adminAPI } from "@food/api";
import { toast } from "sonner";
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect";
import { getZoneId, getZoneLabel, useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter";
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

const ACCEPT_TIME_FIELDS = [
  {
    field: "deliveryAcceptOrderTimeMinutes",
    title: "Delivery Accept Order Time",
    shortTitle: "Delivery",
    label: "Delivery accept order time",
    scopeNote: "Delivery orders only.",
    placeholder: "e.g. 4",
    Icon: Truck,
    iconWrapClass: "bg-blue-50",
    iconClass: "text-blue-600",
  },
  {
    field: "takeawayAcceptOrderTimeMinutes",
    title: "Takeaway Accept Order Time",
    shortTitle: "Takeaway",
    label: "Takeaway accept order time",
    scopeNote: "Takeaway orders only.",
    placeholder: "e.g. 6",
    Icon: ShoppingBag,
    iconWrapClass: "bg-amber-50",
    iconClass: "text-amber-600",
  },
];

const EMPTY_DRAFTS = Object.fromEntries(ACCEPT_TIME_FIELDS.map(({ field }) => [field, ""]));

const clampMinutesString = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return String(Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Number(value))));
};

const sanitizeMinutesInput = (value) => {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (digits === "") return "";

  const withoutLeadingZeros = digits.replace(/^0+/, "");
  if (withoutLeadingZeros === "") return "";

  const num = Number(withoutLeadingZeros);
  if (!Number.isFinite(num)) return "";

  if (num > MAX_MINUTES) {
    let candidate = withoutLeadingZeros;
    while (candidate.length > 0) {
      candidate = candidate.slice(0, -1);
      if (!candidate) return "";
      const candidateNum = Number(candidate);
      if (candidateNum >= MIN_MINUTES && candidateNum <= MAX_MINUTES) {
        return candidate;
      }
    }
    return "";
  }

  if (num < MIN_MINUTES) return "";

  return withoutLeadingZeros;
};

const isValidMinutesValue = (value) => {
  if (value === "" || value == null) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= MIN_MINUTES && parsed <= MAX_MINUTES;
};

const validateMinutes = (value, label) => {
  if (value === "" || value == null) {
    toast.error(`${label} is required (${MIN_MINUTES}–${MAX_MINUTES} minutes)`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_MINUTES || parsed > MAX_MINUTES) {
    toast.error(`${label} must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes (0 is not allowed)`);
    return null;
  }
  return parsed;
};

export default function RestaurantSettings() {
  const { canEdit } = useAdminPermissions()
  const { zones, zonesLoading, zoneId, setZoneId, selectedZone } = useAdminZoneFilter();
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState(null);
  // Last payload from the server for the selected scope (a zone, or the default).
  const [settings, setSettings] = useState(null);
  const [drafts, setDrafts] = useState(EMPTY_DRAFTS);
  // Only the newest request for the current scope may write state.
  const requestSeqRef = useRef(0);

  const zoneName = selectedZone ? getZoneLabel(selectedZone) : "";

  const zoneNameById = useMemo(
    () => new Map(zones.map((zone) => [getZoneId(zone), getZoneLabel(zone)])),
    [zones]
  );
  const overriddenZoneIds = useMemo(
    () => new Set((settings?.zoneOverrides || []).map((row) => row.zoneId)),
    [settings]
  );

  const fetchSettings = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      setLoading(true);
      const res = await adminAPI.getRestaurantSettings(zoneId ? { zoneId } : {});
      if (seq !== requestSeqRef.current) return;
      const data = res?.data?.data || {};
      setSettings(data);
      setDrafts(
        Object.fromEntries(
          ACCEPT_TIME_FIELDS.map(({ field }) => [field, clampMinutesString(data[field])])
        )
      );
    } catch (_error) {
      if (seq === requestSeqRef.current) toast.error("Failed to load restaurant settings");
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  /** `minutes === null` clears the zone override so the zone follows the default again. */
  const saveField = async ({ field, label }, minutes, successMessage) => {
    const seq = ++requestSeqRef.current;
    try {
      setSavingField(field);
      const res = await adminAPI.updateRestaurantSettings({
        ...(zoneId ? { zoneId } : {}),
        [field]: minutes,
      });
      if (!res?.data?.success) {
        toast.error(res?.data?.message || `Failed to save ${label.toLowerCase()}`);
        return;
      }
      if (seq === requestSeqRef.current) {
        const data = res.data.data || {};
        setSettings(data);
        // Only the saved field is reset; an unsaved edit in the other card stays.
        setDrafts((prev) => ({ ...prev, [field]: clampMinutesString(data[field]) }));
      }
      toast.success(successMessage);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to save ${label.toLowerCase()}`);
    } finally {
      setSavingField(null);
    }
  };

  const handleSave = (config) => {
    const parsed = validateMinutes(drafts[config.field], config.label);
    if (parsed == null) return;
    saveField(
      config,
      parsed,
      zoneId ? `${config.label} saved for ${zoneName || "this zone"}` : `${config.label} saved`
    );
  };

  const handleUseDefault = (config) => {
    saveField(config, null, `${zoneName || "This zone"} now follows the default ${config.label.toLowerCase()}`);
  };

  const isBusy = loading || savingField !== null;

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center">
                <Settings className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Restaurant Settings</h1>
            </div>
            <p className="text-sm text-slate-600">
              Configure restaurant behaviour for all zones, or pick a zone to give it its own values.
            </p>
          </div>
          <AdminZoneSelect
            value={zoneId}
            onChange={setZoneId}
            zones={zones}
            loading={zonesLoading}
            allLabel="All zones (default)"
            getOptionLabel={(zone) =>
              overriddenZoneIds.has(getZoneId(zone)) ? `${getZoneLabel(zone)} • Custom` : getZoneLabel(zone)
            }
            disabled={savingField !== null}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Accept Order Time</h2>
              <p className="text-sm text-slate-500 mt-1">
                {zoneId
                  ? `Accept windows for restaurants in ${zoneName || "this zone"}. A value you save here applies to this zone only; anything not overridden follows the default.`
                  : "Set separate accept windows for delivery and takeaway orders before auto-rejection. These defaults apply to every zone without its own value."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {ACCEPT_TIME_FIELDS.map((config) => {
              const { field, title, scopeNote, placeholder, Icon, iconWrapClass, iconClass } = config;
              const draft = drafts[field];
              const saved = clampMinutesString(settings?.[field]);
              const defaultMinutes = clampMinutesString(settings?.defaults?.[field]);
              const isOverridden = Boolean(zoneId && settings?.overridden?.[field]);
              const isSaving = savingField === field;
              const canSave = !isBusy && draft !== saved && isValidMinutesValue(draft);

              return (
                <div key={field} className="rounded-xl border border-slate-200 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg ${iconWrapClass} flex items-center justify-center`}>
                        <Icon className={`w-4 h-4 ${iconClass}`} />
                      </div>
                      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                    </div>
                    {zoneId && !loading && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          isOverridden
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-slate-50 text-slate-600"
                        }`}
                      >
                        <MapPin className="w-3 h-3" />
                        {isOverridden ? "Custom for this zone" : "Using default"}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={field}>Time limit (minutes)</Label>
                    <Input
                      id={field}
                      type="text"
                      inputMode="numeric"
                      pattern="[1-9][0-9]*"
                      value={draft}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [field]: sanitizeMinutesInput(e.target.value) }))
                      }
                      disabled={isBusy}
                      placeholder={saved ? undefined : placeholder}
                    />
                    <p className="text-xs text-slate-500">
                      {saved
                        ? `Currently set: ${saved} min. Click the field, clear it, then enter a new value.`
                        : "No time set yet. Enter a value between 1–60 minutes."}{" "}
                      Allowed range: {MIN_MINUTES}–{MAX_MINUTES} (0 not allowed). {scopeNote}
                    </p>
                    {zoneId && defaultMinutes && (
                      <p className="text-xs text-slate-500">
                        {isOverridden
                          ? `Default for other zones: ${defaultMinutes} min.`
                          : `This zone follows the default (${defaultMinutes} min). Saving a new value overrides it for this zone only.`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit && (
                    <Button
                      onClick={() => handleSave(config)}
                      disabled={!canSave}
                      className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-2"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Settings
                        </>
                      )}
                    </Button>
                    )}
                    {isOverridden && (
                      canEdit && (
                      <Button
                        variant="outline"
                        onClick={() => handleUseDefault(config)}
                        disabled={isBusy}
                        className="flex items-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Use default
                      </Button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!zoneId && settings?.zoneOverrides?.length > 0 && (
            <div className="mt-6 rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                <h3 className="text-sm font-semibold text-slate-900">Zone overrides</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  These zones use their own values; every other zone follows the defaults above.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Zone</th>
                      {ACCEPT_TIME_FIELDS.map(({ field, shortTitle }) => (
                        <th key={field} className="px-5 py-3">{shortTitle}</th>
                      ))}
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {settings.zoneOverrides.map((row) => (
                      <tr key={row.zoneId}>
                        <td className="px-5 py-3 font-medium text-slate-800">
                          {zoneNameById.get(row.zoneId) || "Unknown zone"}
                        </td>
                        {ACCEPT_TIME_FIELDS.map(({ field }) => (
                          <td key={field} className="px-5 py-3 text-slate-700">
                            {row[field] != null ? `${row[field]} min` : <span className="text-slate-400">Default</span>}
                          </td>
                        ))}
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setZoneId(row.zoneId)}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
