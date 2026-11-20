import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Clock3, ShieldCheck, XCircle, AlertTriangle, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import {
  clearRestaurantPendingPhone,
  getModuleToken,
  getRestaurantPendingPhone,
  clearModuleAuth,
  clearRestaurantRegistrationToken,
  getRestaurantRegistrationToken,
  setAuthData,
} from "@food/utils/auth"
import { clearOnboardingFromLocalStorage, clearAllFilesFromDB } from "@food/utils/onboardingUtils"
import {
  enablePendingVerificationPush,
  getWebNotificationPermission,
  isNativeAppWebView,
  persistModuleFcmToken,
  setupPendingVerificationPushListeners,
  syncNativeAppPushToken,
  syncPendingPartnerFcmQuick,
} from "@food/utils/firebaseMessaging"

export default function VerificationPending() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [pushPermission, setPushPermission] = useState(() => getWebNotificationPermission())
  const [enablingPush, setEnablingPush] = useState(false)

  const [localStatus, setLocalStatus] = useState(() => {
    if (location.state?.isDisabled) {
      return "banned"
    }
    if (location.state?.isRejected !== undefined) {
      return location.state.isRejected ? "rejected" : "pending"
    }
    return localStorage.getItem("restaurant_pendingStatus") || "pending"
  })

  const [localMessage, setLocalMessage] = useState(() => {
    if (location.state?.message) {
      return location.state.message
    }
    return localStorage.getItem("restaurant_pendingMessage") || ""
  })

  const pendingPhone = useMemo(() => {
    return (
      location.state?.phone ||
      getRestaurantPendingPhone() ||
      ""
    )
  }, [location.state?.phone])

  const parsedMessage = useMemo(() => {
    if (localStatus === "banned") {
      return {
        text: "Your restaurant has been disabled.",
        reason: "Disabled by admin"
      }
    }

    if (!localMessage) {
      return { text: "Your restaurant registration has been rejected. Please contact support.", reason: "" }
    }

    const parts = localMessage.split(/Reason:\s*/i)
    if (parts.length > 1) {
      return {
        text: parts[0].trim(),
        reason: parts[1].trim()
      }
    }
    const colonParts = localMessage.split(/:\s*/)
    if (colonParts.length > 1 && colonParts[0].toLowerCase().includes("rejected")) {
      return {
        text: colonParts[0].trim() + ".",
        reason: colonParts[1].trim()
      }
    }
    return {
      text: localMessage,
      reason: ""
    }
  }, [localMessage, localStatus])

  const isDisabledByAdmin = localStatus === "banned"

  const syncFcmBeforeLeave = () => {
    const phone = pendingPhone || getRestaurantPendingPhone() || ""
    if (phone) syncPendingPartnerFcmQuick("restaurant", phone)
  }

  // Ensure any previous registration draft or cached files are completely wiped on mount
  useEffect(() => {
    clearOnboardingFromLocalStorage()
    clearRestaurantRegistrationToken()
    clearAllFilesFromDB().catch(() => {})
  }, [])

  // Trap back button on pending verification so it exits the registration flow properly
  useEffect(() => {
    try {
      window.history.pushState({ pendingVerification: true }, "", window.location.href)
    } catch {}

    const onPopState = () => {
      syncFcmBeforeLeave()
      clearModuleAuth("restaurant")
      clearRestaurantPendingPhone()
      localStorage.removeItem("restaurant_pendingStatus")
      localStorage.removeItem("restaurant_pendingMessage")
      navigate("/food/restaurant/login", { replace: true })
    }

    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("popstate", onPopState)
    }
  }, [navigate, pendingPhone])

  useEffect(() => {
    let cancelled = false

    const syncPushToken = async () => {
      const phone =
        pendingPhone ||
        getRestaurantPendingPhone() ||
        ""

      await setupPendingVerificationPushListeners("restaurant")

      if (cancelled) return

      if (phone) {
        if (isNativeAppWebView()) {
          void syncNativeAppPushToken("restaurant", phone)
        } else {
          syncPendingPartnerFcmQuick("restaurant", phone)
        }
      }

      if (getModuleToken("restaurant")) {
        void persistModuleFcmToken("restaurant").catch(() => {})
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
    const phone = pendingPhone || getRestaurantPendingPhone() || ""
    if (!phone || enablingPush) return
    setEnablingPush(true)
    try {
      const saved = await enablePendingVerificationPush("restaurant", phone)
      setPushPermission(getWebNotificationPermission())
      if (saved) {
        toast.success("Push notifications enabled")
      } else if (getWebNotificationPermission() === "denied") {
        toast.error("Notifications blocked. Enable them in browser settings.")
      }
    } finally {
      setEnablingPush(false)
    }
  }

  const isTransitioningRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let pollInterval = null

    const checkApprovalStatus = async () => {
      if (isTransitioningRef.current || cancelled) return

      const token = getModuleToken("restaurant")
      const regToken = getRestaurantRegistrationToken()
      const phone = pendingPhone || getRestaurantPendingPhone() || ""

      // If we have neither a token, registration token, nor phone, we can't check
      if (!token && !regToken && !phone) {
        if (!cancelled) setCheckingStatus(false)
        return
      }

      try {
        let status = null
        let restaurant = null
        let rejectionReason = null
        let accessToken = null
        let refreshToken = null
        let user = null
        let needsLogin = false

        // Primary: use the dedicated verification-status endpoint
        try {
          const res = await restaurantAPI.getVerificationStatus({ phone }, regToken)
          const data = res?.data?.data || res?.data || {}
          status = String(data.status || "").toLowerCase()
          rejectionReason = data.rejectionReason || null
          accessToken = data.accessToken || data.token || null
          refreshToken = data.refreshToken || null
          user = data.user || null
          needsLogin = Boolean(data.needsLogin)
        } catch (statusErr) {
          // If verification-status endpoint failed and we have an existing bearer token, fallback
          if (token) {
            const response = await restaurantAPI.getCurrentRestaurant()
            restaurant =
              response?.data?.data?.restaurant ||
              response?.data?.restaurant ||
              response?.data?.data?.user ||
              response?.data?.user
            status = String(restaurant?.status || "").toLowerCase()
            rejectionReason = restaurant?.rejectionReason || null
          } else {
            throw statusErr
          }
        }

        if (cancelled || isTransitioningRef.current) return

        if (status === "approved") {
          isTransitioningRef.current = true
          if (pollInterval) clearInterval(pollInterval)

          if (accessToken && user) {
            setAuthData("restaurant", accessToken, user, refreshToken)
          } else {
            // Update local stored user if present
            const storedUser = localStorage.getItem("restaurant_user")
            if (storedUser) {
              try {
                const parsed = JSON.parse(storedUser)
                parsed.status = "approved"
                localStorage.setItem("restaurant_user", JSON.stringify(parsed))
              } catch (e) {}
            }
          }

          clearRestaurantPendingPhone()
          clearRestaurantRegistrationToken()
          localStorage.removeItem("restaurant_pendingStatus")
          localStorage.removeItem("restaurant_pendingMessage")
          window.dispatchEvent(new Event("restaurantAuthChanged"))

          if (needsLogin && !accessToken) {
            toast.success("Your restaurant has been approved! Please sign in to open your dashboard.")
            navigate("/food/restaurant/login", { replace: true, state: { phone } })
          } else {
            toast.success("Congratulations! Your restaurant has been approved.")
            navigate("/food/restaurant", { replace: true })
          }
          return
        }

        // Sync back to stored user status to keep ProtectedRoute up-to-date
        const storedUser = localStorage.getItem("restaurant_user")
        if (storedUser && status) {
          try {
            const parsed = JSON.parse(storedUser)
            parsed.status = status
            if (rejectionReason) {
              parsed.rejectionReason = rejectionReason
            }
            localStorage.setItem("restaurant_user", JSON.stringify(parsed))
          } catch (e) {}
        }

        if (status === "banned") {
          setLocalStatus("banned")
          const msg = "Your restaurant has been disabled. Reason: Disabled by admin"
          setLocalMessage(msg)
          localStorage.setItem("restaurant_pendingStatus", "banned")
          localStorage.setItem("restaurant_pendingMessage", msg)
        } else if (status === "rejected") {
          setLocalStatus("rejected")
          const msg = rejectionReason
            ? `Your restaurant registration has been rejected. Reason: ${rejectionReason}`
            : "Your restaurant registration has been rejected. Please contact support."
          setLocalMessage(msg)
          localStorage.setItem("restaurant_pendingStatus", "rejected")
          localStorage.setItem("restaurant_pendingMessage", msg)
        } else if (status === "pending") {
          setLocalStatus("pending")
          localStorage.setItem("restaurant_pendingStatus", "pending")
        }
      } catch (_) {
        // Keep the pending screen visible if the status check fails.
      } finally {
        if (!cancelled) setCheckingStatus(false)
      }
    }

    // Run check immediately on mount
    void checkApprovalStatus()

    // Poll every 4 seconds while on pending verification screen
    pollInterval = setInterval(() => {
      void checkApprovalStatus()
    }, 4000)

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        void checkApprovalStatus()
      }
    }

    const handleApprovalPushEvent = () => {
      void checkApprovalStatus()
    }

    window.addEventListener("focus", handleVisibilityOrFocus)
    document.addEventListener("visibilitychange", handleVisibilityOrFocus)
    window.addEventListener("restaurantApprovalStatusChanged", handleApprovalPushEvent)

    return () => {
      cancelled = true
      if (pollInterval) clearInterval(pollInterval)
      window.removeEventListener("focus", handleVisibilityOrFocus)
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus)
      window.removeEventListener("restaurantApprovalStatusChanged", handleApprovalPushEvent)
    }
  }, [navigate, pendingPhone])

  return (
    <div className={`min-h-[100dvh] overflow-y-auto overscroll-contain px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10 transition-all duration-300 ${isDisabledByAdmin
        ? "bg-gradient-to-br from-[#FFF5F5] via-[#FFEBEB] to-[#FEF2F2]"
        : "bg-gradient-to-br from-slate-50 via-slate-100 to-zinc-100"
      }`}>
      <div className="mx-auto flex w-full max-w-md min-h-[calc(100dvh-2rem)] flex-col justify-center py-2 sm:py-0">
        <div className="w-full rounded-[20px] sm:rounded-[28px] border border-slate-200 bg-white p-5 sm:p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <div className="mb-4 sm:mb-6 flex items-center justify-center">
            {localStatus === "rejected" || localStatus === "banned" ? (
              <div className="flex items-center justify-center my-2 select-none">
                {/* Normal parent container to prevent clipping of absolute children */}
                <div className="relative flex items-center" style={{ height: "36px" }}>
                  {/* The red arrow banner */}
                  <div
                    className="bg-[#E51A21] text-white pl-8 pr-10 py-1.5 rounded-l-md font-black uppercase tracking-widest text-[13px] flex items-center justify-center shadow-[0_4px_10px_rgba(229,26,33,0.3)]"
                    style={{
                      clipPath: "polygon(0% 0%, 82% 0%, 100% 50%, 82% 100%, 0% 100%)",
                      height: "100%",
                      fontFamily: "'Outfit', 'Poppins', sans-serif"
                    }}
                  >
                    <span className="font-extrabold tracking-[0.2em] text-[13px] leading-none">
                      {isDisabledByAdmin ? "DISABLED" : "REJECTED"}
                    </span>
                  </div>

                  {/* Diamond shape on the left - overlaps without clipping! */}
                  <div
                    className="absolute left-[-16px] top-1/2 -translate-y-1/2 w-8 h-8 bg-[#E51A21] border-[3px] border-white rotate-45 flex items-center justify-center shadow-lg"
                    style={{
                      zIndex: 10
                    }}
                  >
                    {/* White X rotated back */}
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
            {localStatus === "rejected" || localStatus === "banned" ? (
              <>
                <h1 className="text-xl font-extrabold text-slate-950">
                  {isDisabledByAdmin ? "Restaurant Disabled" : "Registration Rejected"}
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {isDisabledByAdmin ? "Your restaurant has been disabled." : parsedMessage.text}
                </p>
                {parsedMessage.reason && !isDisabledByAdmin && (
                  <div className="mt-4 text-sm font-semibold text-left p-3.5 rounded-2xl border border-red-100 bg-red-50/50">
                    <span className="text-red-600 block text-xs uppercase tracking-widest font-extrabold mb-1">
                      Reason for Rejection:
                    </span>
                    <span className="text-slate-800 font-medium leading-relaxed block">
                      {parsedMessage.reason}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.32em] text-amber-600">
                  Verification Pending
                </p>
                <h1 className="mx-auto max-w-[19rem] text-center text-[15px] font-extrabold leading-5 text-slate-950 sm:text-xl sm:leading-tight">
                  <span className="block">Your restaurant is</span>
                  <span className="block">under{"\u00A0"}review</span>
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Admin received your onboarding details successfully. Our team will verify your restaurant and activate your dashboard once approval is complete.
                </p>
              </>
            )}
            {checkingStatus ? (
              <p className="mt-3 min-h-[1rem] text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Checking latest approval status...
              </p>
            ) : (
              <div className="mt-3 min-h-[1rem]" aria-hidden="true" />
            )}
          </div>

          <div className="mb-4 sm:mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 sm:p-4">
            <div className="flex items-start gap-3">
              {localStatus === "rejected" || localStatus === "banned" ? (
                <>
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                  <div className="text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">What to do next</p>
                    <p className="mt-1">
                      {isDisabledByAdmin
                        ? "Please reach out to support for more details or assistance regarding your account status."
                        : "Please review the reason above or reach out to support. You can register a new account if you need to submit new details."}
                    </p>
                    {pendingPhone ? (
                      <p className="mt-2 text-slate-500">
                        Registered phone: <span className="font-medium text-slate-700">{pendingPhone}</span>
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
                  <div className="text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">What happens next</p>
                    <p className="mt-1">We will notify you by email and push notification once verification is approved.</p>
                    {pendingPhone ? (
                      <p className="mt-2 text-slate-500">
                        Registered phone: <span className="font-medium text-slate-700">{pendingPhone}</span>
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {isDisabledByAdmin ? (
              <>
                <Button
                  className="h-12 w-full rounded-xl text-base font-semibold bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 hover:from-blue-600 hover:via-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-500/20 border border-blue-500/20 active:scale-[0.98] transition-all duration-300"
                  onClick={() => navigate("/food/restaurant/help-content")}
                >
                  Contact Support
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-xl text-base font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] transition-all duration-300"
                  onClick={() => {
                    syncFcmBeforeLeave()
                    clearModuleAuth("restaurant")
                    clearRestaurantPendingPhone()
                    localStorage.removeItem("restaurant_pendingStatus")
                    localStorage.removeItem("restaurant_pendingMessage")
                    navigate("/food/restaurant/login", { replace: true })
                  }}
                >
                  Back to login
                </Button>
              </>
            ) : localStatus === "rejected" ? (
              <>
                <Button
                  className="h-12 w-full rounded-xl text-base font-semibold transition-all duration-300 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] hover:opacity-90 text-white active:scale-[0.98]"
                  onClick={() => {
                    clearOnboardingFromLocalStorage()
                    localStorage.removeItem("restaurant_pendingStatus")
                    localStorage.removeItem("restaurant_pendingMessage")
                    navigate("/food/restaurant/onboarding?step=1", { replace: true })
                  }}
                >
                  Re-apply
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-xl text-base font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] transition-all duration-300"
                  onClick={() => {
                    syncFcmBeforeLeave()
                    clearModuleAuth("restaurant")
                    clearRestaurantPendingPhone()
                    localStorage.removeItem("restaurant_pendingStatus")
                    localStorage.removeItem("restaurant_pendingMessage")
                    navigate("/food/restaurant/login", { replace: true })
                  }}
                >
                  Back to login
                </Button>
              </>
            ) : (
              <>
                {pushPermission !== "granted" && pushPermission !== "unsupported" && !isNativeAppWebView() ? (
                  <Button
                    className="h-12 w-full rounded-xl text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white active:scale-[0.98] transition-all duration-300"
                    disabled={enablingPush}
                    onClick={handleEnablePush}
                  >
                    {enablingPush ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Enabling...
                      </span>
                    ) : (
                      "Enable Notifications"
                    )}
                  </Button>
                ) : null}
                <Button
                  className="h-12 w-full rounded-xl text-base font-semibold transition-all duration-300 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] hover:opacity-90 text-white active:scale-[0.98]"
                  onClick={() => {
                    syncFcmBeforeLeave()
                    clearModuleAuth("restaurant")
                    clearRestaurantPendingPhone()
                    localStorage.removeItem("restaurant_pendingStatus")
                    localStorage.removeItem("restaurant_pendingMessage")
                    navigate("/food/restaurant/login", { replace: true })
                  }}
                >
                  Back to login
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}







