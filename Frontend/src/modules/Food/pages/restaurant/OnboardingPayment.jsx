import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertCircle, ArrowLeft, BadgeCheck, CheckCircle2, Loader2, MapPin, ShieldCheck, Store, Tag } from "lucide-react"
import OnboardingHeader from "@food/components/restaurant/OnboardingHeader"
import { toast } from "sonner"
import { restaurantAPI } from "@food/api"
import { Button } from "@food/components/ui/button"
import { initRazorpayPayment, preloadRazorpayScript } from "@food/utils/razorpay"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { setRestaurantRegistrationToken } from "@food/utils/auth"

const ONBOARDING_TOKEN_KEY = "restaurant_onboardingToken"
const ONBOARDING_RESTAURANT_ID_KEY = "restaurant_onboardingRestaurantId"

const readOnboardingToken = () => {
  try {
    return localStorage.getItem(ONBOARDING_TOKEN_KEY) || ""
  } catch {
    return ""
  }
}

const clearOnboardingSession = () => {
  try {
    localStorage.removeItem(ONBOARDING_TOKEN_KEY)
    localStorage.removeItem(ONBOARDING_RESTAURANT_ID_KEY)
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

const formatMoney = (amount, currency = "INR") => {
  const value = Number(amount)
  if (!Number.isFinite(value)) return "—"
  const symbol = currency === "INR" ? "₹" : `${currency} `
  return `${symbol}${value.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

const SummaryRow = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3 py-2.5">
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2E7D52]/10 text-[#2E7D52]">
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="truncate text-sm font-semibold text-gray-900">{value || "—"}</p>
    </div>
  </div>
)

/**
 * Final onboarding step: shows the server-calculated one-time fee and takes payment.
 *
 * Every amount rendered here comes from the backend quote — nothing is computed in
 * the browser, and the Razorpay order is created for the server's own figure, so a
 * tampered page cannot change what is charged.
 */
export default function OnboardingPayment() {
  const navigate = useNavigate()
  const companyName = useCompanyName()

  const [token] = useState(readOnboardingToken)
  const [loading, setLoading] = useState(true)
  const [quote, setQuote] = useState(null)
  const [restaurant, setRestaurant] = useState(null)
  const [gatewayConfigured, setGatewayConfigured] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [paymentError, setPaymentError] = useState("")
  const [processing, setProcessing] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [paidSummary, setPaidSummary] = useState(null)
  const payInFlightRef = useRef(false)

  useEffect(() => {
    preloadRazorpayScript()
  }, [])

  /*
   * Once paid, the hardware/browser back button must not land on the onboarding
   * form. This page is entered with { replace: true }, so the entry behind it is
   * whatever preceded onboarding; a back press there dropped the restaurant into
   * a form it had already paid to submit. Holding one entry and redirecting on
   * popstate sends them to the verification screen instead. Navigation only - no
   * payment call is repeated.
   */
  useEffect(() => {
    if (!succeeded) return undefined
    window.history.pushState(null, "", window.location.href)
    const onPopState = () => navigate("/food/restaurant/pending-verification", { replace: true })
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [succeeded, navigate])

  // The server found no fee due (onboarding payment switched off, or no admin pricing
  // rule for this zone and type) and has already submitted the restaurant for approval.
  const finishWithoutFee = useCallback(() => {
    clearOnboardingSession()
    toast.success("No onboarding fee is due. Your restaurant has been sent for approval.")
    navigate("/food/restaurant/pending-verification", { replace: true })
  }, [navigate])

  const loadQuote = useCallback(async () => {
    if (!token) {
      setLoading(false)
      setLoadError("Your onboarding session has expired. Please sign in again to finish payment.")
      return
    }
    try {
      setLoading(true)
      setLoadError("")
      const response = await restaurantAPI.getOnboardingPaymentQuote(token)
      const data = response?.data?.data || {}

      if (data.alreadyPaid) {
        setSucceeded(true)
        setPaidSummary(data.payment || null)
        return
      }
      if (data.submitted) {
        finishWithoutFee()
        return
      }

      setQuote(data.quote || null)
      setRestaurant(data.restaurant || null)
      setGatewayConfigured(data.gatewayConfigured !== false)
    } catch (error) {
      const message =
        error?.response?.data?.message || error?.message || "Could not load your onboarding fee."
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [token, finishWithoutFee])

  useEffect(() => {
    loadQuote()
  }, [loadQuote])

  /**
   * Report a closed/failed checkout so the reserved offer slot goes back.
   *
   * The browser cannot actually tell a cancellation from "the user hopped to a UPI
   * app and is still paying", so the server re-checks with the gateway. If it comes
   * back paid, this attempt really succeeded and we show success instead of an error.
   *
   * @returns {Promise<boolean>} true when the server confirmed the payment went through
   */
  const releaseAttempt = useCallback(
    async (razorpayOrderId, status, reason) => {
      try {
        const response = await restaurantAPI.cancelOnboardingPayment(token, {
          razorpayOrderId,
          status,
          reason,
        })
        const data = response?.data?.data || {}
        if (data.paid) {
          setPaidSummary(data.payment || null)
          setSucceeded(true)
          setPaymentError("")
          clearOnboardingSession()
          toast.success("Payment confirmed. Your restaurant is now with our team for approval.")
          return true
        }
      } catch {
        // Best-effort: the webhook and the reservation timeout both settle this too.
      }
      return false
    },
    [token],
  )

  const handlePay = async () => {
    if (payInFlightRef.current || processing || succeeded) return
    payInFlightRef.current = true
    setProcessing(true)
    setPaymentError("")

    let orderId = ""
    try {
      const orderResponse = await restaurantAPI.createOnboardingPaymentOrder(token)
      const orderData = orderResponse?.data?.data || {}

      if (orderData.alreadyPaid) {
        setSucceeded(true)
        setPaidSummary(orderData.payment || null)
        return
      }
      if (orderData.submitted) {
        finishWithoutFee()
        return
      }

      const rzp = orderData.razorpay || {}
      orderId = rzp.orderId || ""
      const payable = orderData.payment?.finalAmount

      if (!rzp.key || !orderId) {
        throw new Error("Payment could not be started. Please try again in a moment.")
      }

      await initRazorpayPayment({
        key: rzp.key,
        amount: rzp.amount,
        currency: rzp.currency || "INR",
        order_id: orderId,
        name: companyName || "Eatiefy",
        description: `One-time onboarding fee${payable ? ` — ${formatMoney(payable, rzp.currency)}` : ""}`,
        prefill: {
          name: restaurant?.ownerName || "",
          email: restaurant?.ownerEmail || "",
          contact: restaurant?.ownerPhone || "",
        },
        notes: { purpose: "restaurant_onboarding" },
        handler: async (response) => {
          try {
            const verifyResponse = await restaurantAPI.verifyOnboardingPayment(token, {
              razorpayOrderId: response?.razorpay_order_id || orderId,
              razorpayPaymentId: response?.razorpay_payment_id,
              razorpaySignature: response?.razorpay_signature,
            })
            const verified = verifyResponse?.data?.data || {}
            if (verified.registrationToken) {
              setRestaurantRegistrationToken(verified.registrationToken)
            }
            setPaidSummary(verified.payment || null)
            setSucceeded(true)
            clearOnboardingSession()
            toast.success("Payment successful. Your restaurant is now with our team for approval.")
          } catch (error) {
            // The webhook is the authoritative confirmation, so a failure here may
            // still resolve server-side — reload the quote rather than assuming failure.
            const message =
              error?.response?.data?.message ||
              "We could not confirm your payment yet. If money was debited it will reflect shortly."
            setPaymentError(message)
            toast.error(message)
            try {
              const res = await restaurantAPI.getOnboardingPaymentQuote(token)
              const data = res?.data?.data || {}
              if (data.alreadyPaid) {
                setSucceeded(true)
                setPaidSummary(data.payment || null)
              } else if (data.submitted) {
                finishWithoutFee()
              } else if (data.quote) {
                setQuote(data.quote)
              }
            } catch {}
          } finally {
            setProcessing(false)
            payInFlightRef.current = false
          }
        },
        onError: async (error) => {
          const desc = error?.description || error?.message || "Payment failed. Please retry."
          setPaymentError(desc)
          toast.error(desc)
          const wasActuallyPaid = await releaseAttempt(
            orderId,
            "failed",
            desc,
          )
          setProcessing(false)
          payInFlightRef.current = false
          if (wasActuallyPaid) return
          try {
            const res = await restaurantAPI.getOnboardingPaymentQuote(token)
            const data = res?.data?.data || {}
            if (data.alreadyPaid) {
              setSucceeded(true)
              setPaidSummary(data.payment || null)
            } else if (data.submitted) {
              finishWithoutFee()
            } else if (data.quote) {
              setQuote(data.quote)
            }
          } catch {}
        },
        onClose: async () => {
          const cancelMsg = "Payment was cancelled, please retry."
          setPaymentError(cancelMsg)
          toast.info(cancelMsg)
          const wasActuallyPaid = await releaseAttempt(
            orderId,
            "cancelled",
            "Checkout closed by user",
          )
          setProcessing(false)
          payInFlightRef.current = false
          if (wasActuallyPaid) return
          try {
            const res = await restaurantAPI.getOnboardingPaymentQuote(token)
            const data = res?.data?.data || {}
            if (data.alreadyPaid) {
              setSucceeded(true)
              setPaidSummary(data.payment || null)
            } else if (data.submitted) {
              finishWithoutFee()
            } else if (data.quote) {
              setQuote(data.quote)
            }
          } catch {}
        },
      })
    } catch (error) {
      const message =
        error?.response?.data?.message || error?.message || "Could not start the payment."
      if (orderId) await releaseAttempt(orderId, "failed", message)
      setPaymentError(message)
      toast.error(message)
      setProcessing(false)
      payInFlightRef.current = false
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F4F4]">
        <Loader2 className="h-7 w-7 animate-spin text-[#2E7D52]" />
      </div>
    )
  }

  if (succeeded) {
    return (
      <div className="min-h-screen bg-[#F4F4F4]">
        {/* Paid: back belongs on the verification screen, never on the form the
            restaurant has already paid to submit. */}
        <OnboardingHeader
          title="Payment successful"
          subtitle="Your registration is with our team"
          onBack={() => navigate("/food/restaurant/pending-verification", { replace: true })}
          backLabel="Go to verification status"
        />
        <div className="mx-auto mt-10 max-w-lg rounded-2xl bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#2E7D52]/10">
            <CheckCircle2 className="h-8 w-8 text-[#2E7D52]" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">Payment successful</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your onboarding request has been sent to our team. You will be notified once it is
            reviewed.
          </p>

          {paidSummary && (
            <div className="mt-5 space-y-2 rounded-xl bg-gray-50 p-4 text-left text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Amount paid</span>
                <span className="font-semibold text-gray-900">
                  {formatMoney(paidSummary.finalAmount, paidSummary.currency)}
                </span>
              </div>
              {paidSummary.offerApplied && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Offer applied</span>
                  <span className="font-medium text-[#2E7D52]">{paidSummary.offerName || "Yes"}</span>
                </div>
              )}
              {paidSummary.transactionReference && (
                <div className="flex justify-between gap-3">
                  <span className="shrink-0 text-gray-500">Transaction</span>
                  <span className="truncate font-mono text-xs text-gray-700">
                    {paidSummary.transactionReference}
                  </span>
                </div>
              )}
            </div>
          )}

          <Button
            className="mt-6 w-full bg-[#2E7D52] hover:bg-[#1B5E3F]"
            onClick={() => navigate("/food/restaurant/pending-verification", { replace: true })}
          >
            Continue
          </Button>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#F4F4F4] px-4 py-10">
        <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="mt-3 text-lg font-bold text-gray-900">We could not load your fee</h1>
          <p className="mt-2 text-sm text-gray-600">{loadError}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={loadQuote}>
              Try again
            </Button>
            <Button
              className="flex-1 bg-[#2E7D52] hover:bg-[#1B5E3F]"
              onClick={() => navigate("/food/restaurant/login", { replace: true })}
            >
              Sign in again
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const hasOffer = Boolean(quote?.offer && quote?.offerPrice != null)
  const currency = quote?.currency || "INR"

  return (
    <div className="min-h-screen bg-[#F4F4F4] pb-28">
      {/*
        Back goes to the onboarding route explicitly. This page is always entered
        with { replace: true } (from the last step, and from OTP on relaunch), so
        no onboarding entry is left in history and navigate(-1) fell through to
        whatever preceded onboarding, or left the app after a refresh. The route
        restores the saved step and previously entered data; `replace` swaps this
        page rather than stacking, so back/forward cannot loop between the two.
      */}
      <OnboardingHeader
        title="Onboarding payment"
        subtitle="Final step — pay once and submit for approval"
        onBack={() => navigate("/food/restaurant/onboarding", { replace: true })}
        backLabel="Go back to onboarding"
      />

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-bold text-gray-900">Your registration</h2>
          <div className="mt-2 divide-y divide-gray-100">
            <SummaryRow icon={Store} label="Restaurant" value={restaurant?.restaurantName} />
            <SummaryRow icon={BadgeCheck} label="Restaurant type" value={quote?.restaurantTypeLabel} />
            <SummaryRow icon={MapPin} label="Service zone" value={quote?.zoneName} />
          </div>
        </section>

        {hasOffer && (
          <section className="rounded-2xl border border-[#2E7D52]/30 bg-[#2E7D52]/5 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <Tag className="mt-0.5 h-5 w-5 shrink-0 text-[#2E7D52]" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#1B5E3F]">
                  Promotional offer applied — you save {formatMoney(quote.savings, currency)}
                </p>
                <p className="mt-0.5 text-xs text-[#2E7D52]">{quote.offer.name}</p>
                {quote.offer.remainingSlots > 0 && (
                  <p className="mt-1 text-[11px] text-gray-600">
                    Only {quote.offer.remainingSlots} of {quote.offer.maxRedemptions} slots left —
                    the offer is confirmed when your payment succeeds.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-bold text-gray-900">One-time onboarding fee</h2>
          <p className="mt-1 text-xs text-gray-500">
            A single payment — not a subscription and never charged again.
          </p>

          <div className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Original price</span>
              <span className={hasOffer ? "text-gray-400 line-through" : "font-semibold text-gray-900"}>
                {formatMoney(quote?.originalPrice, currency)}
              </span>
            </div>
            {hasOffer && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Offer price</span>
                <span className="font-semibold text-[#2E7D52]">
                  {formatMoney(quote.offerPrice, currency)}
                </span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-dashed border-gray-200 pt-3">
              <span className="text-base font-bold text-gray-900">Amount payable</span>
              <span className="text-xl font-extrabold text-gray-900">
                {formatMoney(quote?.finalAmount, currency)}
              </span>
            </div>
          </div>

          {!gatewayConfigured && (
            <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800">
              Payments are running in test mode on this environment.
            </p>
          )}
        </section>

        {paymentError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4 text-sm text-red-800 shadow-sm"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-red-900">Payment Not Completed</p>
              <p className="mt-0.5 text-xs text-red-700 leading-relaxed">{paymentError}</p>
            </div>
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          Payment is verified on our servers before your restaurant is submitted.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white p-4">
        <div className="mx-auto max-w-2xl">
          <Button
            className="h-12 w-full bg-[#2E7D52] text-base font-semibold hover:bg-[#1B5E3F] disabled:opacity-70"
            disabled={processing || !quote?.finalAmount}
            onClick={handlePay}
          >
            {processing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing payment…
              </span>
            ) : (
              `Pay ${formatMoney(quote?.finalAmount, currency)} & submit for approval`
            )}
          </Button>
          {paymentError && !processing ? (
            <p className="mt-2 text-center text-[11px] text-gray-500">
              You can safely retry — you are only charged once.
            </p>
          ) : (
            <p className="mt-2 text-center text-[11px] text-gray-500">
              Scan the UPI QR in the payment window, or pay with a UPI app, card or net banking.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
