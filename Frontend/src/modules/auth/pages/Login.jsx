import React, { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Phone, Loader2, X, User, Pencil } from "lucide-react"
import { toast } from "sonner"
import { authAPI, userAPI } from "@food/api"
import { setAuthData } from "@food/utils/auth"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"


export default function UnifiedOTPFastLogin() {
  const RESEND_COOLDOWN_SECONDS = 59
  const defaultTestPhone =
    import.meta.env.VITE_USE_DEFAULT_TEST_PHONE === "true"
      ? String(import.meta.env.VITE_DEFAULT_TEST_PHONE || "").replace(/\D/g, "").slice(0, 10)
      : ""
  // const [phoneNumber, setPhoneNumber] = useState("")
  const [phoneNumber, setPhoneNumber] = useState(defaultTestPhone)
  const [otp, setOtp] = useState("")
  const [otpError, setOtpError] = useState("")
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [showNameModal, setShowNameModal] = useState(false)
  const [newName, setNewName] = useState("")
  const [isUpdatingName, setIsUpdatingName] = useState(false)
  const [tempAuth, setTempAuth] = useState(null)
  const [pendingVerify, setPendingVerify] = useState(null)
  const [showRestorePopup, setShowRestorePopup] = useState(false)
  const [deletedAccountData, setDeletedAccountData] = useState(null)
  const [blockTimer, setBlockTimer] = useState(0)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const referralCode = String(searchParams.get("ref") || "").trim() || null
  const submitting = useRef(false)
  // iOS only opens the soft-keyboard from a focus() that happens *inside* a
  // user gesture. This hidden input is focused synchronously on the "Log in"
  // tap so the keyboard opens, then focus is transferred to the OTP boxes once
  // they mount (focus transfer keeps the keyboard up on iOS).
  const focusKeeperRef = useRef(null)
  const keyboardPrimedRef = useRef(false)

  // --- PERSISTENCE LOGIC START ---
  const SESSION_KEY = "user_auth_session_data";

  // Rehydrate state on mount
  useEffect(() => {
    const savedState = sessionStorage.getItem(SESSION_KEY);
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.phoneNumber) setPhoneNumber(parsed.phoneNumber);
        if (parsed.step) setStep(parsed.step);
        if (parsed.showNameModal !== undefined) setShowNameModal(parsed.showNameModal);
        if (parsed.newName) setNewName(parsed.newName);
        if (parsed.tempAuth) setTempAuth(parsed.tempAuth);
        if (parsed.pendingVerify) setPendingVerify(parsed.pendingVerify);
        if (parsed.showRestorePopup !== undefined) setShowRestorePopup(parsed.showRestorePopup);
        if (parsed.deletedAccountData) setDeletedAccountData(parsed.deletedAccountData);

        // Resume Resend Timer
        if (parsed.resendExpiresAt) {
          const remaining = Math.max(0, Math.floor((parsed.resendExpiresAt - Date.now()) / 1000));
          if (remaining > 0) setResendTimer(remaining);
        }

        // Resume Block Timer
        if (parsed.blockExpiresAt) {
          const remaining = Math.max(0, Math.floor((parsed.blockExpiresAt - Date.now()) / 1000));
          if (remaining > 0) {
            setBlockTimer(remaining);
            if (parsed.step === 1) setStep(2); // Ensure we show step 2 if blocked
          }
        }
      } catch (e) {
        console.error("Failed to rehydrate login state", e);
      }
    }
  }, []);

  // Persist state on change
  useEffect(() => {
    if (step === 1 && !phoneNumber && !blockTimer && !showNameModal && !showRestorePopup) {
      // Don't save empty initial state
      return;
    }

    const stateToSave = {
      phoneNumber,
      step,
      showNameModal,
      newName,
      tempAuth,
      pendingVerify,
      showRestorePopup,
      deletedAccountData,
      // Save expiration timestamps instead of seconds
      resendExpiresAt: resendTimer > 0 ? Date.now() + (resendTimer * 1000) : null,
      blockExpiresAt: blockTimer > 0 ? Date.now() + (blockTimer * 1000) : null,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(stateToSave));
  }, [phoneNumber, step, showNameModal, newName, tempAuth, pendingVerify, showRestorePopup, deletedAccountData, resendTimer === 0, blockTimer === 0]);

  // Combined cleanup helper
  const clearSessionData = () => {
    sessionStorage.removeItem(SESSION_KEY);
  };
  // --- PERSISTENCE LOGIC END ---

  const normalizedPhone = () => {
    const digits = String(phoneNumber).replace(/\D/g, "").slice(-15)
    return digits.length >= 8 ? digits : ""
  }

  const handleSendOTP = async (e) => {
    e.preventDefault()
    const phone = normalizedPhone()
    if (phone.length < 10) {
      toast.error("Please enter a valid 10-digit phone number")
      return
    }
    if (submitting.current) return
    // Prime the keyboard inside the tap gesture so iOS keeps it open while we
    // navigate to the OTP step (Android focuses fine on mount).
    if (focusKeeperRef.current) {
      focusKeeperRef.current.focus()
      keyboardPrimedRef.current = true
    }
    submitting.current = true
    setLoading(true)
    try {
      await authAPI.sendOTP(phoneNumber, "login", null)
      setOtp("")
      setOtpError("")
      setBlockTimer(0)
      setStep(2)
      setResendTimer(RESEND_COOLDOWN_SECONDS)
      toast.success("OTP sent successfully!")
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to send OTP."
      const lowerMsg = msg.toLowerCase();
      const isBlocked = lowerMsg.includes("blocked") ||
        lowerMsg.includes("too many attempts") ||
        lowerMsg.includes("try again after");

      if (isBlocked) {
        let totalSeconds = 180; // default 3 mins
        const timeMatch = msg.match(/(\d+)(?::(\d+))?/);
        if (timeMatch) {
          const mins = parseInt(timeMatch[1]);
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          totalSeconds = (mins * 60) + secs;
        }

        setBlockTimer(totalSeconds);
        setStep(2);
        return;
      }
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleResendOTP = async () => {
    const phone = normalizedPhone()
    if (phone.length < 10) {
      toast.error("Please enter a valid phone number")
      return
    }
    if (resendTimer > 0 || blockTimer > 0 || submitting.current) return
    submitting.current = true
    setLoading(true)
    try {
      await authAPI.sendOTP(phoneNumber, "login", null)
      setOtp("")
      setResendTimer(RESEND_COOLDOWN_SECONDS)
      toast.success("OTP resent successfully.")
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to resend OTP."
      const lowerMsg = msg.toLowerCase();
      const isBlocked = lowerMsg.includes("blocked") ||
        lowerMsg.includes("too many attempts") ||
        lowerMsg.includes("try again after");

      if (isBlocked) {
        let totalSeconds = 180;
        const timeMatch = msg.match(/(\d+)(?::(\d+))?/);
        if (timeMatch) {
          const mins = parseInt(timeMatch[1]);
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          totalSeconds = (mins * 60) + secs;
        }

        setBlockTimer(totalSeconds);
        return;
      }
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleEditNumber = () => {
    setShowNameModal(false)
    setShowRestorePopup(false)
    setDeletedAccountData(null)
    setPendingVerify(null)
    setBlockTimer(0) // Clear block timer when changing number
    setOtpError("") // Clear error
    setOtp("") // Clear inputs
    setStep(1)
    setResendTimer(0)

    if (step === 2) {
      // This naturally triggers the popstate listener which pops the navigation state
      window.history.back()
    }
  }

  const handleVerifyOTP = async (e, customOtp = null) => {
    if (e && e.preventDefault) e.preventDefault()
    const code = typeof customOtp === "string" ? customOtp : otp
    const otpDigits = String(code).replace(/\D/g, "").slice(0, 4)
    if (otpDigits.length !== 4) {
      toast.error("Please enter the 4-digit OTP")
      return
    }
    await processVerify(phoneNumber, otpDigits)
  }

  const processVerify = async (phone, otpCode, confirmAction = null) => {
    if (submitting.current) return
    submitting.current = true
    setLoading(true)
    let fcmToken = null
    let platform = "web"
    try {
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile";
            // Optimization: Try only the most common handler to save time
            try {
              const t = await window.flutter_inappwebview.callHandler("getFcmToken", { module: "user" });
              if (t && typeof t === "string" && t.length > 20) fcmToken = t.trim();
            } catch (e) { }
          } else {
            fcmToken = localStorage.getItem("fcm_web_registered_token_user") || null;
          }
        }
      } catch (e) {
        console.warn("Failed to get FCM token during login", e);
      }

      const response = await authAPI.verifyOTP(phone, otpCode, "login", null, null, "user", null, referralCode, fcmToken, platform, null, confirmAction)
      const data = response?.data?.data || response?.data || {}

      // Handle deleted account found
      if (data.deletedAccountFound) {
        setDeletedAccountData(data)
        setShowRestorePopup(true)
        setLoading(false)
        submitting.current = false
        return
      }

      // Handle name required (Success response with flag)
      if (data.needsName) {
        setShowRestorePopup(false)
        setPendingVerify({
          phone: phoneNumber,
          otp: otpCode,
          fcmToken,
          platform,
          referralCode,
          confirmAction // Preserve the action (new) for the subsequent name submission
        })
        setShowNameModal(true)
        setLoading(false)
        submitting.current = false
        return
      }

      const accessToken = data.accessToken
      const refreshToken = data.refreshToken || null
      const user = data.user

      if (!accessToken || !user) {
        throw new Error("Invalid parameters from server")
      }

      setAuthData("user", accessToken, user, refreshToken)

      // If user has no name, show name modal instead of immediate navigation
      if (!user.name || user.name.trim() === "") {
        setTempAuth({ accessToken, user, refreshToken })
        setShowNameModal(true)
      } else {
        clearSessionData()
        navigate("/food/user", { replace: true })
      }
    } catch (err) {
      const status = err?.response?.status
      let msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Invalid OTP. Please try again."

      // Clear OTP inputs on failure
      setOtp("")
      setTimeout(() => {
        document.getElementById("otp-0")?.focus()
      }, 50)

      if (msg.toLowerCase().includes("blocked") || msg.toLowerCase().includes("too many attempts")) {
        const timeMatch = msg.match(/(\d+)(?::(\d+))?/);
        if (timeMatch) {
          const mins = parseInt(timeMatch[1]);
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          setBlockTimer((mins * 60) + secs);
          msg = ""; // Clear msg so only block UI displays
        }
      }

      // Legacy check for string-based name requirement (backward compatibility)
      const nameRequired = /name\s+is\s+required.*first[- ]?time|first[- ]?time.*name\s+is\s+required|first[- ]?time\s*sign\s*up/i.test(String(msg))
      if (nameRequired) {
        setShowRestorePopup(false)
        setPendingVerify({
          phone: phoneNumber,
          otp: otpCode,
          fcmToken,
          platform,
          referralCode,
          confirmAction
        })
        setShowNameModal(true)
        return
      }

      if (status === 401 && msg) {
        if (/deactivat(ed|e)/i.test(String(msg))) {
          msg = "Your account is deactivated. Please contact support."
          toast.error(msg)
        } else {
          setOtpError("Invalid OTP")
        }
      } else if (msg) {
        toast.error(msg)
      }
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleNameSubmit = async (e) => {
    e.preventDefault()
    if (!newName.trim()) {
      toast.error("Please enter your name")
      return
    }

    try {
      setIsUpdatingName(true)
      if (pendingVerify) {
        const response = await authAPI.verifyOTP(
          pendingVerify.phone,
          pendingVerify.otp,
          "login",
          newName.trim(),
          null,
          "user",
          null,
          pendingVerify.referralCode,
          pendingVerify.fcmToken,
          pendingVerify.platform,
          null, // _token
          pendingVerify.confirmAction // Pass the preserved action
        )
        const data = response?.data?.data || response?.data || {}
        const accessToken = data.accessToken
        const refreshToken = data.refreshToken || null
        const user = data.user

        setAuthData("user", accessToken, user, refreshToken)
        setPendingVerify(null)
        clearSessionData()
        setShowNameModal(false)
        navigate("/food/user", { replace: true })
        return
      }

      // Call update profile API
      await userAPI.updateProfile({ name: newName.trim() })

      // Update local storage and auth data with the new name
      const updatedUser = { ...tempAuth.user, name: newName.trim() }
      setAuthData("user", tempAuth.accessToken, updatedUser, tempAuth.refreshToken)

      clearSessionData()
      setShowNameModal(false)
      navigate("/food/user", { replace: true })
    } catch (err) {
      toast.error("Failed to update name. You can skip this for now or try again.")
      console.error(err)
    } finally {
      setIsUpdatingName(false)
    }
  }

  useEffect(() => {
    if (step !== 2 || resendTimer <= 0) return
    const intervalId = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(intervalId)
  }, [step, resendTimer])

  useEffect(() => {
    if (blockTimer <= 0) return
    const intervalId = setInterval(() => {
      setBlockTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(intervalId)
  }, [blockTimer])

  useEffect(() => {
    if (step === 2) {
      const focusFirst = () => {
        const el = document.getElementById("otp-0");
        if (el) {
          el.focus();
          // In mobile WebView the soft keyboard often won't open on a
          // programmatic focus alone, so also trigger a click to force it.
          el.click();
        }
      };
      // If the keyboard was primed on the "Log in" tap (iOS), transfer focus
      // ASAP so the already-open keyboard stays up instead of closing.
      if (keyboardPrimedRef.current) {
        keyboardPrimedRef.current = false;
        requestAnimationFrame(focusFirst);
        return;
      }
      setTimeout(focusFirst, 250);
    }
  }, [step]);

  // Intercept hardware back button to return to step 1 instead of leaving the page
  useEffect(() => {
    const handlePopState = () => {
      if (step === 2) {
        if (blockTimer > 0) {
          // Push state again to keep user locked on step 2
          window.history.pushState({ otpStep: true }, "")
          return
        }
        setStep(1)
        setOtp("")
        setResendTimer(0)
      }
    }

    if (step === 2) {
      window.history.pushState({ otpStep: true }, "")
      window.addEventListener("popstate", handlePopState)
    }

    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [step, blockTimer > 0])

  const formatResendTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  const primaryColor = "#1F6B45" // Rebranded Red color

  // When an input is focused the mobile soft-keyboard opens and shrinks the
  // viewport. Scroll the focused field into the centre of the remaining space
  // so the submit button / logo never get hidden behind the keyboard.
  const handleInputFocusScroll = (e) => {
    const el = e.currentTarget
    setTimeout(() => {
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 300)
  }

  return (
    <div className="min-h-[100dvh] bg-white dark:bg-[#141414] flex flex-col relative overflow-hidden font-['Poppins']">

      <style>
        {`
          @keyframes floatDish1 {
            0%, 100% { transform: translateX(0vw) translateY(0px) rotate(0deg); }
            50% { transform: translateX(25vw) translateY(-15px) rotate(8deg); }
          }
          @keyframes floatDish2 {
            0%, 100% { transform: translateX(0vw) translateY(0px) rotate(0deg); }
            50% { transform: translateX(-25vw) translateY(-15px) rotate(-8deg); }
          }
          .animate-float-dish-1 {
            animation: floatDish1 12s ease-in-out infinite;
          }
          .animate-float-dish-2 {
            animation: floatDish2 12s ease-in-out infinite;
          }
        `}
      </style>

      {/* Top Wave (Log In style) */}
      <div className="absolute top-0 left-0 w-full h-[40vh] pointer-events-none z-0 transform scale-[1.05] origin-center">
        <svg viewBox="0 0 1440 320" className="w-full h-full block" preserveAspectRatio="none" overflow="visible">
          <defs>
            <linearGradient id="topRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1F6B45" />
              <stop offset="100%" stopColor="#66001D" />
            </linearGradient>
          </defs>
          <path fill="url(#topRedGrad)" d="M -50,-50 L -50,280 C 200,100 800,100 1490,100 L 1490,-50 Z" filter="drop-shadow(0px 5px 15px rgba(0,0,0,0.15))" />
        </svg>
        <img
          src="/assets/images/food_dish.png"
          alt="Delicious food"
          className="absolute top-[8%] left-[5%] w-[14vh] h-[14vh] md:w-[120px] md:h-[120px] object-contain animate-float-dish-1 drop-shadow-xl"
        />
      </div>

      {/* Bottom Wave (Log In style) */}
      <div className="absolute bottom-0 left-0 w-full h-[50vh] pointer-events-none z-0 transform scale-[1.05] origin-center">
        <svg viewBox="0 0 1440 320" className="w-full h-full block" preserveAspectRatio="none" overflow="visible">
          <defs>
            <linearGradient id="botRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1F6B45" />
              <stop offset="100%" stopColor="#66001D" />
            </linearGradient>
          </defs>
          <path fill="url(#botRedGrad)" d="M -50,370 L -50,220 C 640,220 1240,220 1490,40 L 1490,370 Z" filter="drop-shadow(0px -5px 15px rgba(0,0,0,0.15))" />
        </svg>
        <img
          src="/assets/images/food_dish_2.png"
          alt="Delicious food"
          className="absolute bottom-[8%] right-[5%] w-[18vh] h-[18vh] md:w-[150px] md:h-[150px] object-contain animate-float-dish-2 drop-shadow-2xl"
        />
      </div>

      {/* Hidden keyboard-keeper: focused on the "Log in" tap so iOS keeps the
          soft-keyboard open while transitioning to the OTP step. */}
      <input
        ref={focusKeeperRef}
        type="tel"
        inputMode="numeric"
        tabIndex={-1}
        aria-label="Keyboard focus keeper"
        readOnly
        className="absolute opacity-0 w-px h-px -z-10 pointer-events-none"
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-13 pb-40 relative z-10 overflow-y-auto">
        <div className={`w-full max-w-sm flex flex-col my-auto ${step === 2 ? "relative -top-8" : ""}`}>

          {/* Main Title (Design Reference: Log In text) */}
          <div className="mb-8 mt-6 text-center flex flex-col items-center">
            <img
              src="/assets/images/eatiefy_logo.png"
              alt="Eatiefy Logo"
              className="h-28 sm:h-32 object-contain drop-shadow-md rounded-2xl"
            />
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-2 font-medium flex items-center justify-center gap-1.5">
              {step === 1 ? (
                <span>Login or signup with your phone number</span>
              ) : (
                <>
                  <span>We've sent a code to +91 {phoneNumber}</span>
                  <button
                    onClick={handleEditNumber}
                    className="p-1.5 ml-1 bg-gradient-to-r from-[#1F6B45] to-[#66001D] hover:from-[#90082E] hover:to-[#4A0014] rounded-[10px] text-white shadow-md shadow-[#1F6B45]/20 transition-all hover:scale-105 active:scale-95"
                    aria-label="Edit phone number"
                  >
                    <Pencil className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="relative">

            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.form
                  key="step-1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onSubmit={handleSendOTP}
                  className="space-y-6"
                >
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400 pr-3 border-r border-gray-300 dark:border-gray-600">+91</span>
                    </div>
                    <input
                      type="tel"
                      required
                      autoFocus
                      onFocus={handleInputFocusScroll}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      maxLength={10}
                      className="block w-full pl-20 pr-6 py-3.5 bg-gray-50 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 shadow-sm text-gray-900 dark:text-white rounded-full outline-none transition-all duration-300 placeholder:text-gray-400 font-medium text-base focus:bg-white dark:focus:bg-gray-900 focus:border-[#1F6B45] focus:ring-4 focus:ring-[#1F6B45]/10 hover:border-gray-400"
                      placeholder="Mobile number"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || phoneNumber.length < 10}
                    className="w-full py-3.5 bg-gradient-to-r from-[#1F6B45] to-[#66001D] hover:from-[#A10935] hover:to-[#4F0016] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(184,11,61,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      "Log in"
                    )}
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="step-2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handleVerifyOTP}
                  className="space-y-6"
                >
                  {otpError && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-red-600 dark:text-red-500 text-[15px] font-bold text-center tracking-wide -mt-7 mb-6"
                    >
                      {otpError}
                    </motion.div>
                  )}

                  <div className="flex justify-between gap-3">
                    {[0, 1, 2, 3].map((index) => (
                      <input
                        key={index}
                        id={`otp-${index}`}
                        type="tel"
                        inputMode="numeric"
                        required
                        disabled={loading || blockTimer > 0}
                        autoFocus={index === 0}
                        value={otp[index] || ""}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "").slice(-1);
                          if (index === 0 && val) {
                            setOtpError("");
                          }
                          if (!val) return;
                          const newOtp = otp.split("");
                          newOtp[index] = val;
                          const combined = newOtp.join("").slice(0, 4);
                          setOtp(combined);
                          if (index < 3 && val) {
                            document.getElementById(`otp-${index + 1}`)?.focus();
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace") {
                            if (!otp[index] && index > 0) {
                              document.getElementById(`otp-${index - 1}`)?.focus();
                            } else {
                              const newOtp = otp.split("");
                              newOtp[index] = "";
                              setOtp(newOtp.join(""));
                            }
                          }
                        }}
                        className={`w-14 h-14 sm:w-16 sm:h-16 text-center text-2xl font-bold bg-gray-50 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 shadow-sm rounded-[20px] outline-none transition-all duration-300 text-gray-900 dark:text-white focus:bg-white dark:focus:bg-gray-900 focus:border-[#1F6B45] focus:ring-4 focus:ring-[#1F6B45]/10 hover:border-gray-400 ${blockTimer > 0 ? "opacity-50 cursor-not-allowed border-red-400 bg-red-50 text-red-800" : ""
                          }`}
                        placeholder="•"
                      />
                    ))}
                  </div>

                  <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      {blockTimer > 0 ? (
                        <span className="text-gray-400 uppercase tracking-wider font-extrabold">Resend SMS</span>
                      ) : resendTimer > 0 ? (
                        <span className="text-gray-400 font-extrabold">Resend SMS in <span className="text-slate-800 dark:text-slate-200 font-black">{formatResendTimer(resendTimer)}</span></span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendOTP}
                          className="text-slate-800 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white hover:underline font-extrabold"
                        >
                          Didn't receive SMS? Resend SMS
                        </button>
                      )}
                    </div>

                  </div>

                  <button
                    type="submit"
                    disabled={loading || otp.length < 4 || blockTimer > 0}
                    className="w-full py-3.5 bg-gradient-to-r from-[#1F6B45] to-[#66001D] hover:from-[#A10935] hover:to-[#4F0016] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(184,11,61,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Verifying...
                      </span>
                    ) : (
                      "Verify & Continue"
                    )}
                  </button>

                  {blockTimer > 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center w-fit mx-auto px-6 py-2.5 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/50 mt-4">
                      <p className="text-[11px] font-bold text-[#1F6B45] uppercase tracking-wider">
                        Too many failed attempts
                      </p>
                      <p className="text-sm font-bold text-[#1F6B45]">
                        Try again after {Math.floor((blockTimer - 1) / 60)}:{String((blockTimer - 1) % 60).padStart(2, '0')}
                      </p>
                    </motion.div>
                  )}
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {/* Skip Now Button - only on login step, not OTP */}
          {step === 1 && blockTimer <= 0 && (
            <div className="mt-5 flex justify-center w-full">
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem("user_authenticated", "false");
                  clearSessionData();
                  navigate('/food/user');
                }}
                className="flex items-center justify-center gap-1.5 px-8 py-[7.5px] bg-gradient-to-r from-[#1F6B45] to-[#66001D] hover:from-[#A10935] hover:to-[#4F0016] text-white rounded-full shadow-[0_4px_14px_rgba(184,11,61,0.3)] hover:shadow-[0_6px_20px_rgba(184,11,61,0.45)] transition-all duration-200 active:scale-95 cursor-pointer group"
              >
                <span className="text-[13px] font-semibold tracking-wide" style={{ fontFamily: "'Poppins', sans-serif" }}>Skip for now</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-75 group-hover:translate-x-0.5 transition-transform duration-150 mt-px"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
              </button>
            </div>
          )}

          {/* Footer Info - only on login step, not OTP */}
          {step === 1 && (
            <div className="mt-8 text-center">
              <p className="text-[11px] text-gray-400/80 font-medium leading-relaxed max-w-[320px] mx-auto">
                By continuing, you agree to our <br />
                <Link to="/user/profile/terms" state={{ from: "/user/auth/login" }} className="text-gray-400 hover:text-[#1F6B45] transition-colors uppercase tracking-wider font-semibold">TERMS</Link>
                <span className="mx-2 text-gray-400/80 font-bold">•</span>
                <Link to="/user/profile/privacy" state={{ from: "/user/auth/login" }} className="text-gray-400 hover:text-[#1F6B45] transition-colors uppercase tracking-wider font-semibold">PRIVACY</Link>
                <span className="mx-2 text-gray-400/80 font-bold">•</span>
                <Link to="/user/profile/support-info" state={{ from: "/user/auth/login" }} className="text-gray-400 hover:text-[#1F6B45] transition-colors uppercase tracking-wider font-semibold">SUPPORT</Link>
              </p>
            </div>
          )}

        </div>
      </div>

      {/* Name Collection Modal */}
      <Dialog
        open={showNameModal}
        onOpenChange={(open) => {
          // Prevent closing on backdrop click or escape key
          if (!open) return;
          setShowNameModal(true);
        }}
      >
        <DialogContent
          className="sm:max-w-[425px] rounded-3xl border-none p-0 overflow-hidden bg-white dark:bg-[#242424]"
          showCloseButton={false}
        >
          <div className="bg-gradient-to-br from-[#1F6B45] to-[#66001D] p-8 text-center relative">
            <button
              onClick={handleEditNumber}
              className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-xl text-white transition-all active:scale-95 z-20"
              aria-label="Close and return to login"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-white/10 rounded-full blur-2xl" />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center mx-auto mb-4 border border-white/30"
            >
              <User className="w-10 h-10 text-white" />
            </motion.div>
            <DialogTitle className="text-2xl font-bold text-white mb-2">Almost there!</DialogTitle>
            <DialogDescription className="text-white/80">
              We'd love to know your name to personalize your experience.
            </DialogDescription>
          </div>

          <form onSubmit={handleNameSubmit} className="p-8 pt-6 space-y-6">
            <div className="space-y-4">
              <Label htmlFor="name" className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">
                Full Name
              </Label>
              <div className="relative group">
                <Input
                  id="name"
                  value={newName}
                  onChange={(e) => {
                    const filteredValue = e.target.value.replace(/[^a-zA-Z\s]/g, "");
                    setNewName(filteredValue);
                  }}
                  placeholder="Enter your name"
                  className="pl-4 h-14 bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-[#1F6B45] transition-all group-hover:border-[#1F6B45]/30"
                  autoFocus
                />
              </div>
            </div>

            {pendingVerify && (
              <div className="space-y-4">
                <Label htmlFor="referralCode" className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">
                  Referral code (optional)
                </Label>
                <div className="relative group">
                  <Input
                    id="referralCode"
                    value={pendingVerify.referralCode || ""}
                    onChange={(e) => {
                      const v = e.target.value.trim()
                      setPendingVerify((prev) => (prev ? { ...prev, referralCode: v || null } : prev))
                    }}
                    placeholder="Enter code if a friend referred you"
                    className="pl-4 h-14 bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-[#1F6B45] transition-all group-hover:border-[#1F6B45]/30"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <Button
                type="submit"
                disabled={isUpdatingName}
                className="w-full h-14 bg-gradient-to-r from-[#1F6B45] to-[#66001D] hover:from-[#90082E] hover:to-[#4A0014] text-white rounded-2xl font-bold text-lg shadow-lg shadow-[#1F6B45]/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {isUpdatingName ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Complete Profile"
                )}
              </Button>
              {!pendingVerify ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowNameModal(false)
                    navigate("/food/user", { replace: true })
                  }}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors py-2"
                >
                  Skip for now
                </button>
              ) : (
                <p className="text-xs text-gray-400 text-center">Name is required to complete signup.</p>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Restore/New Account Popup */}
      <AnimatePresence>
        {showRestorePopup && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            // Removed onClick to prevent closing on backdrop click
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm bg-white dark:bg-[#242424] rounded-3xl shadow-2xl overflow-hidden p-8 text-center border border-gray-100 dark:border-gray-800 relative z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleEditNumber}
                className="absolute top-4 right-4 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl text-gray-400 hover:text-gray-600 transition-all active:scale-95"
                aria-label="Close and return to login"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-20 h-20 bg-[#1F6B45]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Phone className="h-10 w-10 text-[#1F6B45]" />
              </div>

              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Account Found!</h3>
              <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                A deleted account for <span className="font-bold text-gray-900 dark:text-white">+91 {phoneNumber}</span> was found.
                Do you want to restore your old data or start fresh with a new account?
              </p>

              <div className="space-y-4">
                <button
                  onClick={async () => {
                    await processVerify(phoneNumber, otp, "restore");
                    setShowRestorePopup(false);
                  }}
                  className="w-full h-14 bg-[#1F6B45] hover:bg-[#1A5C3B] text-white font-bold rounded-2xl shadow-xl shadow-[#1F6B45]/20 transition-all active:scale-[0.98]"
                >
                  Restore My Account
                </button>
                <button
                  onClick={async () => {
                    await processVerify(phoneNumber, otp, "new");
                    setShowRestorePopup(false);
                  }}
                  className="w-full h-14 border-2 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 font-bold rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all active:scale-[0.98]"
                >
                  Create New Account
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
