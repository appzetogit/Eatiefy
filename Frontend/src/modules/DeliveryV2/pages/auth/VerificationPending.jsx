import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Clock3, ShieldCheck, AlertTriangle, X } from "lucide-react"
import { clearModuleAuth } from "@food/utils/auth"
import {
  enablePendingVerificationPush,
  getWebNotificationPermission,
  isNativeAppWebView,
  persistModuleFcmToken,
  setupPendingVerificationPushListeners,
  syncNativeAppPushToken,
  syncPendingPartnerFcmQuick,
} from "@food/utils/firebaseMessaging"

const DELIVERY_PRIMARY_BTN =
  "h-12 w-full rounded-full text-base font-semibold bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] text-white shadow-[0_8px_20px_rgba(14,75,156,0.25)] active:scale-[0.98] transition-all duration-300"

const DELIVERY_OUTLINE_BTN =
  "h-12 w-full rounded-full text-base font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] transition-all duration-300"

export default function VerificationPending() {
  const navigate = useNavigate()
  const location = useLocation()

  const localStatus = useMemo(() => {
    if (location.state?.isRejected) return "rejected"
    return sessionStorage.getItem("delivery_pendingStatus") || "pending"
  }, [location.state?.isRejected])

  const localMessage = useMemo(() => {
    if (location.state?.message) return location.state.message
    return sessionStorage.getItem("delivery_pendingMessage") || ""
  }, [location.state?.message])

  const pendingPhone = useMemo(() => {
    return (
      location.state?.phone ||
      sessionStorage.getItem("delivery_pendingPhone") ||
      ""
    )
  }, [location.state?.phone])

  const rejectionReason = useMemo(() => {
    return (
      location.state?.rejectionReason ||
      sessionStorage.getItem("delivery_pendingRejectionReason") ||
      ""
    )
  }, [location.state?.rejectionReason])

  const parsedMessage = useMemo(() => {
    if (!localMessage) {
      return {
        text: "Your delivery partner application has been rejected. Please contact support.",
        reason: rejectionReason || "",
      }
    }

    const parts = localMessage.split(/Reason:\s*/i)
    if (parts.length > 1) {
      return { text: parts[0].trim(), reason: parts[1].trim() }
    }

    return { text: localMessage, reason: rejectionReason || "" }
  }, [localMessage, rejectionReason])

  const isRejected = localStatus === "rejected"
  const [pushPermission, setPushPermission] = useState(() => getWebNotificationPermission())
  const [enablingPush, setEnablingPush] = useState(false)

  useEffect(() => {
    let cancelled = false

    const syncPushToken = async () => {
      if (!pendingPhone) return
      await setupPendingVerificationPushListeners("delivery")

      if (cancelled) return

      if (isNativeAppWebView()) {
        void syncNativeAppPushToken("delivery", pendingPhone)
      } else {
        syncPendingPartnerFcmQuick("delivery", pendingPhone)
      }

      if (typeof localStorage !== "undefined" && localStorage.getItem("delivery_accessToken")) {
        void persistModuleFcmToken("delivery").catch(() => {})
      }

      if (!cancelled) {
        setPushPermission(getWebNotificationPermission())
      }
    }

    void syncPushToken()

    return () => {
      cancelled = true
    }
  }, [pendingPhone])

  const handleEnablePush = async () => {
    if (!pendingPhone || enablingPush) return
    setEnablingPush(true)
    try {
      const saved = await enablePendingVerificationPush("delivery", pendingPhone)
      setPushPermission(getWebNotificationPermission())
      if (!saved && getWebNotificationPermission() === "denied") {
        // silent — delivery page uses minimal UI
      }
    } finally {
      setEnablingPush(false)
    }
  }

  const clearPendingState = () => {
    sessionStorage.removeItem("delivery_pendingPhone")
    sessionStorage.removeItem("delivery_pendingStatus")
    sessionStorage.removeItem("delivery_pendingMessage")
    sessionStorage.removeItem("delivery_pendingRejectionReason")
    sessionStorage.removeItem("deliverySignupDetails")
    sessionStorage.removeItem("deliveryNeedsRegistration")
  }

  const handleBackToLogin = () => {
    if (pendingPhone) {
      syncPendingPartnerFcmQuick("delivery", pendingPhone)
    }
    clearModuleAuth("delivery")
    clearPendingState()
    navigate("/food/delivery/login", { replace: true })
  }

  const handleReapply = () => {
    const digits = String(pendingPhone || "").replace(/\D/g, "").slice(-10)
    sessionStorage.setItem("deliveryNeedsRegistration", "true")
    sessionStorage.setItem(
      "deliverySignupDetails",
      JSON.stringify({
        name: "",
        phone: digits,
        countryCode: "+91",
      }),
    )
    clearPendingState()
    navigate("/food/delivery/signup/details", { replace: true })
  }

  return (
    <div
      className={`min-h-[100dvh] overflow-y-auto overscroll-contain px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10 font-['Poppins'] transition-all duration-300 ${
        isRejected
          ? "bg-gradient-to-br from-[#FFF5F5] via-[#FFEBEB] to-[#FEF2F2]"
          : "bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100"
      }`}
    >
      <div className="mx-auto flex w-full max-w-md min-h-[calc(100dvh-2rem)] flex-col justify-center py-2 sm:py-0">
        <div className="w-full rounded-[20px] sm:rounded-[28px] border border-slate-200 bg-white p-5 sm:p-8 shadow-[0_24px_70px_rgba(14,75,156,0.08)]">
          <div className="mb-4 sm:mb-6 flex items-center justify-center">
            {isRejected ? (
              <div className="flex items-center justify-center my-2 select-none">
                <div className="relative flex items-center" style={{ height: "36px" }}>
                  <div
                    className="bg-[#0E4B9C] text-white pl-8 pr-10 py-1.5 rounded-l-md font-black uppercase tracking-widest text-[13px] flex items-center justify-center shadow-[0_4px_10px_rgba(14,75,156,0.3)]"
                    style={{
                      clipPath: "polygon(0% 0%, 82% 0%, 100% 50%, 82% 100%, 0% 100%)",
                      height: "100%",
                    }}
                  >
                    <span className="font-extrabold tracking-[0.2em] text-[13px] leading-none">
                      REJECTED
                    </span>
                  </div>
                  <div
                    className="absolute left-[-16px] top-1/2 -translate-y-1/2 w-8 h-8 bg-[#0E4B9C] border-[3px] border-white rotate-45 flex items-center justify-center shadow-lg"
                    style={{ zIndex: 10 }}
                  >
                    <X className="w-4 h-4 text-white" style={{ transform: "rotate(-45deg)" }} strokeWidth={4} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <Clock3 className="h-8 w-8" />
              </div>
            )}
          </div>

          <div className="mb-4 sm:mb-6 text-center">
            {isRejected ? (
              <>
                <h1 className="text-xl font-extrabold text-slate-950">Application Rejected</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">{parsedMessage.text}</p>
                {parsedMessage.reason ? (
                  <div className="mt-4 text-sm font-semibold text-left p-3.5 rounded-2xl border border-red-100 bg-red-50/50">
                    <span className="text-red-600 block text-xs uppercase tracking-widest font-extrabold mb-1">
                      Reason for Rejection:
                    </span>
                    <span className="text-slate-800 font-medium leading-relaxed block">
                      {parsedMessage.reason}
                    </span>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.32em] text-amber-600">
                  Verification Pending
                </p>
                <h1 className="mx-auto max-w-[19rem] text-center text-[14px] font-extrabold leading-5 text-slate-950 sm:text-[17px] sm:leading-tight">
                  <span className="block">Your delivery account is</span>
                  <span className="block">under{"\u00A0"}review</span>
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Admin received your onboarding details successfully. Our team will verify your delivery account and activate your dashboard once approval is complete.
                </p>
              </>
            )}
          </div>

          <div className="mb-4 sm:mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 sm:p-4">
            <div className="flex items-start gap-3">
              {isRejected ? (
                <>
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                  <div className="text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">What to do next</p>
                    <p className="mt-1">
                      Please review the reason above or reach out to support. You can register a new account if you need to submit new details.
                    </p>
                    {pendingPhone ? (
                      <p className="mt-2 text-slate-500">
                        Registered phone:{" "}
                        <span className="font-medium text-slate-700">{pendingPhone}</span>
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-[#0E4B9C]" />
                  <div className="text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">What happens next</p>
                    <p className="mt-1">We will notify you by email and push notification once verification is approved.</p>
                    {pendingPhone ? (
                      <p className="mt-2 text-slate-500">
                        Registered phone:{" "}
                        <span className="font-medium text-slate-700">{pendingPhone}</span>
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {isRejected ? (
              <>
                <button type="button" className={DELIVERY_PRIMARY_BTN} onClick={handleReapply}>
                  Re-apply
                </button>
                <button type="button" className={DELIVERY_OUTLINE_BTN} onClick={handleBackToLogin}>
                  Back to login
                </button>
              </>
            ) : (
              <>
                {pushPermission !== "granted" && pushPermission !== "unsupported" && !isNativeAppWebView() ? (
                  <button
                    type="button"
                    className="h-12 w-full rounded-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white active:scale-[0.98] transition-all duration-300 disabled:opacity-70"
                    disabled={enablingPush}
                    onClick={handleEnablePush}
                  >
                    {enablingPush ? "Enabling..." : "Enable Notifications"}
                  </button>
                ) : null}
                <button type="button" className={DELIVERY_PRIMARY_BTN} onClick={handleBackToLogin}>
                  Back to login
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
