import { useEffect, useRef, useState } from "react";
import { Settings, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { adminAPI } from "@food/api";
import { Card, CardHeader, CardTitle, CardContent } from "@food/components/ui/card";
import { Label } from "@food/components/ui/label";
import { Switch } from "@food/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@food/components/ui/dialog";
import { isDiningEnabled } from "@food/config/featureFlags";
import AdminZoneSelect from "@food/components/admin/zones/AdminZoneSelect";
import { useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter";
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

// The checkout switches that can differ per zone (must match ZONE_CUSTOMIZATION_KEYS on the
// server). Module-level switches stay platform-wide.
const ZONE_TOGGLE_KEYS = new Set([
  "cod_enabled",
  "takeaway_cod_enabled",
  "takeaway_pay_at_pickup_enabled",
  "delivery_cod_enabled",
  "dining_cod_enabled",
  "wallet_payment_enabled",
  "online_payment_enabled",
]);

const CUSTOMIZATION_TOGGLES = [
  {
    key: "takeaway_enabled",
    label: "Takeaway Module",
    description:
      "When OFF, takeaway is hidden everywhere — nav tabs, entry points and direct URLs all redirect away.",
    defaultValue: true,
  },
  {
    key: "dining_enabled",
    label: "Dining Module",
    description:
      "When OFF, dining is hidden everywhere — nav tabs, table booking, restaurant reservations, admin dining pages and direct URLs all redirect away.",
    defaultValue: false,
  },
  {
    key: "sweets_enabled",
    label: "Sweets & Bakery Module",
    description:
      "When OFF, the Sweets & Bakery tab, listing page and admin page are hidden everywhere and direct URLs redirect away.",
    defaultValue: false,
  },
  {
    key: "cod_enabled",
    label: "Global COD",
    description:
      "Global toggle for COD visibility (Applies to Delivery, NOT Takeaway).",
    defaultValue: true,
  },
  {
    key: "takeaway_cod_enabled",
    label: "Takeaway COD",
    description:
      "When ON, customers can choose to pay cash at the restaurant when they collect a takeaway order. When OFF, takeaway is online-payment only.",
    defaultValue: false,
  },
  {
    key: "takeaway_pay_at_pickup_enabled",
    label: "Takeaway Pay at Pickup",
    description:
      "Master switch for takeaway Pay-at-Pickup (customer places the order, pays online at the counter). Each restaurant must also enable it.",
    defaultValue: true,
  },
  {
    key: "delivery_cod_enabled",
    label: "Delivery COD",
    description:
      "Controls Cash on Delivery (COD) visibility for delivery orders.",
    defaultValue: true,
  },
  ...(isDiningEnabled()
    ? [
        {
          key: "dining_cod_enabled",
          label: "Dining COD",
          description:
            "Controls Cash on Delivery (COD) visibility for dining orders.",
          defaultValue: true,
        },
      ]
    : []),
  {
    key: "wallet_payment_enabled",
    label: "Wallet Payment",
    description:
      "Controls visibility of wallet payment method at checkout.",
    defaultValue: true,
  },
  {
    key: "online_payment_enabled",
    label: "Online Payment",
    description:
      "Controls visibility of Razorpay online payment at checkout.",
    defaultValue: true,
  },
  {
    key: "default_location_enabled",
    label: "Default Location Mode",
    description:
      "Bypasses device location permissions and sets default location to Indore for all users.",
    defaultValue: false,
  },
  {
    key: "cod_blocking_feature_enabled",
    label: "Global COD Blocked",
    description:
      "Global toggle to enable/disable the automatic COD blocking feature (blocks COD for users with 4 consecutive COD cancellations).",
    defaultValue: true,
  },
  {
    key: "restaurant_onboarding_razorpay_enabled",
    label: "Restaurant Onboarding Payment",
    description:
      "Require restaurants to complete the one-time Razorpay payment during registration. When OFF, registration skips payment entirely — admin approval is still required. Customer, order, delivery and refund payments are unaffected.",
    defaultValue: true,
    // Changing how money is collected deserves an explicit confirmation.
    confirm: {
      on: {
        title: "Enable Restaurant Onboarding Payment?",
        body: "New restaurants will be required to complete Razorpay payment during onboarding.",
        action: "Enable Payment",
      },
      off: {
        title: "Disable Restaurant Onboarding Payment?",
        body: "New restaurants will no longer be required to make a Razorpay payment during onboarding. Admin approval will still be required.",
        action: "Disable Payment",
      },
    },
  },
  {
    key: "maintenance_mode_enabled",
    label: "Under Maintenance",
    description:
      "When ON, user / restaurant / delivery apps show the Under Maintenance screen. Admin panel stays available. Default is OFF.",
    defaultValue: false,
  },
];

const getAdminToastOffsetPx = () => {
  try {
    if (typeof window === "undefined") return 0;
    if (window.innerWidth < 1024) return 0;

    const raw = localStorage.getItem("admin_sidebar_state");
    const isCollapsed = raw ? Boolean(JSON.parse(raw)?.isCollapsed) : false;
    return isCollapsed ? 40 : 160; 
  } catch {
    return 0;
  }
};

export default function CustomizationSettings() {
  const { canEdit } = useAdminPermissions()
  const [loading, setLoading] = useState(true);
  const [savingByKey, setSavingByKey] = useState({});
  const loadToastShownRef = useRef(false);
  const inFlightReqRef = useRef({}); 
  const unlockTimersRef = useRef({}); 
  const [settings, setSettings] = useState(() => {
    const initial = {};
    for (const t of CUSTOMIZATION_TOGGLES) initial[t.key] = t.defaultValue;
    return initial;
  });

  // Zone scope: "" = platform-wide (the original page); a zone id edits only that zone's
  // payment switches, each of which either overrides the platform value or follows it.
  const { zones, zonesLoading, zoneId, setZoneId } = useAdminZoneFilter();
  const [zoneLoading, setZoneLoading] = useState(false);
  const [zoneState, setZoneState] = useState({ settings: {}, defaults: {}, overridden: {}, zonesWithOverrides: [] });

  const loadZoneSettings = async (targetZoneId) => {
    try {
      setZoneLoading(true);
      const res = await adminAPI.getZoneCustomizationSettings(targetZoneId);
      const data = res?.data?.data || {};
      setZoneState({
        settings: data.settings || {},
        defaults: data.defaults || {},
        overridden: data.overridden || {},
        zonesWithOverrides: Array.isArray(data.zonesWithOverrides) ? data.zonesWithOverrides : [],
      });
    } catch (_error) {
      toast.error("Failed to load zone settings", { duration: 2000 });
    } finally {
      setZoneLoading(false);
    }
  };

  useEffect(() => {
    // Always load: even in platform view the picker marks zones that override something.
    loadZoneSettings(zoneId || undefined);
  }, [zoneId]);

  /** Set (true/false) or clear (null) one switch for the selected zone. */
  const handleZoneToggle = async (key, value) => {
    setSavingByKey((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await adminAPI.updateZoneCustomizationSettings({ zoneId, [key]: value });
      const data = res?.data?.data || {};
      setZoneState({
        settings: data.settings || {},
        defaults: data.defaults || {},
        overridden: data.overridden || {},
        zonesWithOverrides: Array.isArray(data.zonesWithOverrides) ? data.zonesWithOverrides : [],
      });
      const label = CUSTOMIZATION_TOGGLES.find((t) => t.key === key)?.label || key;
      toast.success(
        value === null ? `${label}: now follows the platform default` : `${label} ${value ? "ON" : "OFF"} for this zone`,
        { duration: 2000 }
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update zone setting", { duration: 2500 });
    } finally {
      setSavingByKey((prev) => ({ ...prev, [key]: false }));
    }
  };

  const isZoneScope = Boolean(zoneId);
  const visibleToggles = isZoneScope
    ? CUSTOMIZATION_TOGGLES.filter((t) => ZONE_TOGGLE_KEYS.has(t.key))
    : CUSTOMIZATION_TOGGLES;
  const zoneOptionLabel = (zone) => {
    const base = zone?.name || zone?.zoneName || zone?.serviceLocation || "Unnamed Zone";
    return zoneState.zonesWithOverrides.includes(String(zone?._id || zone?.id)) ? `${base} • customised` : base;
  };

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        setLoading(true);
        const res = await adminAPI.getCustomizationSettings();
        if (!cancelled) {
          const next = {};
          const data = res?.data?.data || {};
          for (const t of CUSTOMIZATION_TOGGLES) {
            next[t.key] = data[t.key] !== undefined ? data[t.key] : t.defaultValue;
          }
          setSettings(next);
        }
      } catch (_error) {
        if (!cancelled) {
          if (!loadToastShownRef.current) {
            loadToastShownRef.current = true;
            toast.error("Failed to load customization settings", {
              duration: 2000,
              style: {
                width: "fit-content",
                maxWidth: "calc(100vw - 32px)",
                marginLeft: `${getAdminToastOffsetPx()}px`,
              },
            });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSettings();
    return () => {
      cancelled = true;
      try {
        for (const k of Object.keys(unlockTimersRef.current || {})) {
          if (unlockTimersRef.current[k]) clearTimeout(unlockTimersRef.current[k]);
        }
      } catch {}
    };
  }, []);

  // Toggles that declare `confirm` ask first; everything else is unchanged.
  const [pendingConfirm, setPendingConfirm] = useState(null);

  const requestToggle = (toggle, checked) => {
    if (toggle?.confirm) {
      setPendingConfirm({ toggle, checked });
      return;
    }
    handleToggle(toggle.key, checked);
  };

  const handleToggle = async (key, checked) => {
    const prevValue = settings[key];
    setSettings((prev) => ({ ...prev, [key]: checked }));

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    inFlightReqRef.current[key] = requestId;
    setSavingByKey((prev) => ({ ...prev, [key]: true }));

    if (unlockTimersRef.current[key]) clearTimeout(unlockTimersRef.current[key]);
    unlockTimersRef.current[key] = setTimeout(() => {
      if (inFlightReqRef.current[key] === requestId) {
        inFlightReqRef.current[key] = null;
        setSavingByKey((prev) => ({ ...prev, [key]: false }));
      }
    }, 6000);

    const meta = CUSTOMIZATION_TOGGLES.find((t) => t.key === key);
    const label = meta?.label || key;

    toast.success(`${label} ${checked ? "ON" : "OFF"}`, {
      duration: 2000,
      style: {
        width: "fit-content",
        maxWidth: "calc(100vw - 32px)",
        marginLeft: `${getAdminToastOffsetPx()}px`,
      },
    });

    try {
      await adminAPI.updateCustomizationSettings({ [key]: checked });

      // Takeaway / Dining gate routes and nav across the apps, so push the new
      // value into the shared cache and tell live tabs to re-read it.
      if (key === "takeaway_enabled" || key === "dining_enabled" || key === "sweets_enabled") {
        try {
          const raw = localStorage.getItem("ometto_customization_settings");
          const parsed = raw ? JSON.parse(raw) : {};
          localStorage.setItem(
            "ometto_customization_settings",
            JSON.stringify({ ...parsed, [key]: checked === true })
          );
        } catch {
          /* ignore */
        }
        window.dispatchEvent(new CustomEvent("customizationSettingsUpdated"));
      }

      if (key === "maintenance_mode_enabled") {
        try {
          const raw = localStorage.getItem("ometto_customization_settings");
          const parsed = raw ? JSON.parse(raw) : {};
          localStorage.setItem(
            "ometto_customization_settings",
            JSON.stringify({ ...parsed, maintenance_mode_enabled: checked === true })
          );
        } catch {
          /* ignore */
        }
        window.dispatchEvent(
          new CustomEvent("maintenanceModeChanged", {
            detail: { enabled: checked === true },
          })
        );
      }
    } catch (_error) {
      setSettings((prev) => ({ ...prev, [key]: prevValue }));
      toast.error("Failed to update setting", {
        duration: 2000,
        style: {
          width: "fit-content",
          maxWidth: "calc(100vw - 32px)",
          marginLeft: `${getAdminToastOffsetPx()}px`,
        },
      });
    } finally {
      if (inFlightReqRef.current[key] === requestId) {
        inFlightReqRef.current[key] = null;
        setSavingByKey((prev) => ({ ...prev, [key]: false }));
      }
      if (unlockTimersRef.current[key]) {
        clearTimeout(unlockTimersRef.current[key]);
        unlockTimersRef.current[key] = null;
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="inline-flex items-center">
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
            <Settings className="w-7 h-7 text-neutral-800 dark:text-neutral-200" />
            Customization Settings
          </h1>
        </div>
        <p className="text-neutral-600 dark:text-neutral-400 mt-1">
          {isZoneScope
            ? "Payment switches for the selected zone. A switch set here overrides the platform value for this zone only."
            : "Control global customization toggles for the platform."}
        </p>
      </div>

      {/* Scope: the whole platform, or one zone's payment switches */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Settings for</span>
        <AdminZoneSelect
          value={zoneId}
          onChange={setZoneId}
          zones={zones}
          loading={zonesLoading}
          allLabel="All zones (default)"
          getOptionLabel={zoneOptionLabel}
        />
        {isZoneScope && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Module switches (Takeaway, Dining, Sweets, Maintenance…) apply to every zone and are only editable under "All zones".
          </span>
        )}
      </div>

      <Card className="dark:bg-[#1a1a1a] dark:border-neutral-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-neutral-700 dark:text-neutral-300" />
            <CardTitle className="dark:text-white">Manage All Toggles Here</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {visibleToggles.map((t) => {
              const overridden = isZoneScope && zoneState.overridden[t.key] === true;
              const checked = isZoneScope ? zoneState.settings[t.key] === true : settings[t.key] === true;
              const busy = loading || (isZoneScope && zoneLoading);
              return (
                <div
                  key={t.key}
                  className="flex items-start justify-between gap-3 p-3 border rounded-lg bg-neutral-50/50 dark:bg-neutral-900/50 dark:border-neutral-800"
                >
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold dark:text-neutral-200">{t.label}</Label>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-snug">{t.description}</p>
                    {isZoneScope && !busy && (
                      <p className="text-[11px] leading-snug pt-1">
                        {overridden ? (
                          <>
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Set for this zone</span>
                            {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleZoneToggle(t.key, null)}
                              disabled={savingByKey[t.key] === true}
                              className="ml-2 underline text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 disabled:opacity-50"
                            >
                              Reset to default
                            </button>
                            )}
                          </>
                        ) : (
                          <span className="text-neutral-400">
                            Using platform default ({zoneState.defaults[t.key] ? "ON" : "OFF"})
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 pt-0.5">
                    {busy ? (
                      <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
                    ) : (
                      <Switch
                        checked={checked}
                        onCheckedChange={(next) => (isZoneScope ? handleZoneToggle(t.key, next) : requestToggle(t, next))}
                        disabled={!canEdit || savingByKey[t.key] === true}
                        className="scale-90 data-[state=checked]:bg-[#16a34a] data-[state=unchecked]:bg-zinc-400 shadow-sm"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation for settings that change how money is collected. */}
      <Dialog
        open={Boolean(pendingConfirm)}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        <DialogContent className="max-w-md bg-white p-0 overflow-hidden gap-0">
          {pendingConfirm ? (
            <>
              <DialogHeader className="px-5 pt-5 pb-3 pr-14 sm:px-6 sm:pt-6 border-b border-slate-100 text-left">
                <DialogTitle className="text-base font-bold text-slate-900">
                  {(pendingConfirm.checked
                    ? pendingConfirm.toggle.confirm.on
                    : pendingConfirm.toggle.confirm.off
                  ).title}
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm text-slate-600">
                  {(pendingConfirm.checked
                    ? pendingConfirm.toggle.confirm.on
                    : pendingConfirm.toggle.confirm.off
                  ).body}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 px-5 py-4 sm:px-6 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { toggle, checked } = pendingConfirm;
                    setPendingConfirm(null);
                    handleToggle(toggle.key, checked);
                  }}
                  className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${
                    pendingConfirm.checked
                      ? "bg-[#16a34a] hover:bg-[#15803d]"
                      : "bg-rose-600 hover:bg-rose-700"
                  }`}
                >
                  {(pendingConfirm.checked
                    ? pendingConfirm.toggle.confirm.on
                    : pendingConfirm.toggle.confirm.off
                  ).action}
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
