import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Trash2, AlertTriangle, User, BellRing, Loader2 } from "lucide-react";
import { Button } from "@food/components/ui/button";
import { authAPI, userAPI } from "@food/api";
import { enableWebPushFromUserGesture, getWebPushPromptState } from "@food/utils/firebaseMessaging";
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils";
import { clearModuleAuth } from "@food/utils/auth";
import { toast } from "sonner";
import { showAccountDeletedToast } from "@/shared/utils/customToasts";
import AnimatedPage from "@food/components/user/AnimatedPage";

export default function Settings() {
  const navigate = useNavigate();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteCaptcha, setDeleteCaptcha] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);

  // Sends a real push to this account's registered device(s) through the same
  // pipeline order / support notifications use.
  const handleSendTestPush = async () => {
    if (isSendingTestPush) return;
    setIsSendingTestPush(true);
    try {
      const inApp = isFlutterBridgeAvailable();
      if (!inApp) {
        // Say the real reason instead of a generic "not granted".
        const state = getWebPushPromptState();
        if (state === "ios-needs-install") {
          toast.error(
            "On iPhone, web push only works from the Home Screen app. Tap Share -> Add to Home Screen, open Eatiefy from there and try again.",
            { duration: 8000 },
          );
          return;
        }
        if (state === "unsupported") {
          toast.error(
            "This browser can't receive web push (needs HTTPS or localhost, service worker and Push support). If you are testing in DevTools phone mode, switch the device to an Android phone or use normal desktop mode.",
            { duration: 8000 },
          );
          return;
        }
        if (state === "denied") {
          toast.error("Notifications are blocked. Allow them in the browser's site settings, then try again.", { duration: 6000 });
          return;
        }
        // Registers this browser for push (asks permission on first use).
        const result = await enableWebPushFromUserGesture("user");
        if (result === "unsupported") {
          toast.error("This browser can't receive web push notifications.");
          return;
        }
        if (result !== "granted") {
          toast.error("You dismissed or declined the notification prompt. Click the lock icon next to the address bar, set Notifications to Allow, and try again.", { duration: 7000 });
          return;
        }
      }
      if (!inApp) {
        // A visible tab only gets an in-app banner; the OS notification appears
        // when the tab is in the background. Give time to switch away.
        toast.info("Sending in 5 seconds - switch to another tab or minimise the browser NOW to see the system notification.", { duration: 5500 });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      // Start listening before sending, so a fast push is not missed.
      let received = false;
      const onReceived = (event) => {
        if (String(event?.detail?.data?.type || "") === "test") received = true;
      };
      window.addEventListener("eatiefy-push-received", onReceived);
      let body = {};
      try {
        const response = await userAPI.testFcmNotification({ platform: inApp ? "mobile" : "web" });
        body = response?.data || {};
        if (body.success === false) {
          toast.error(body.message || "No push device is registered for this account.", { duration: 9000 });
          return;
        }
        if (!inApp) {
          for (let i = 0; i < 20 && !received; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      } finally {
        window.removeEventListener("eatiefy-push-received", onReceived);
      }

      if (inApp || received) {
        toast.success(`${body.message || "Test notification sent."} ${received ? "This browser received it." : ""}`.trim(), { duration: 6000 });
      } else {
        toast.error(
          "Firebase accepted the push but THIS browser did not receive it. Check: (1) chrome://settings/content/notifications - localhost:5180 must be Allow, (2) Windows Settings > System > Notifications - Chrome on and Focus assist/Do not disturb off, (3) DevTools > Application > Service Workers - firebase-messaging-sw.js should be 'activated and running'. Then send again.",
          { duration: 15000 },
        );
      }
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          "Could not send the test notification. Make sure notifications are enabled for this device.",
      );
    } finally {
      setIsSendingTestPush(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (isDeleting || deleteCaptcha !== "DELETE") return;
    setIsDeleting(true);
    try {
      await authAPI.deleteAccount("user");
      
      showAccountDeletedToast();
      
      // Clear user module authentication data
      clearModuleAuth("user");
      
      // Dispatch auth change event to notify other components
      window.dispatchEvent(new Event("userAuthChanged"));
      
      // Navigate to sign in page
      navigate("/user/auth/login", { replace: true });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
      setDeleteAccountOpen(false);
    }
  };

  return (
    <AnimatedPage className="min-h-screen bg-white dark:bg-[#141414]">
      <div className="max-w-md md:max-w-2xl mx-auto px-6 py-6 pb-20">
        
        {/* Header: Back Arrow & Title */}
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => navigate(-1)} 
            className="h-11 w-11 flex items-center justify-center bg-white/70 dark:bg-[#242424]/70 backdrop-blur-md rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:bg-white/90 dark:hover:bg-[#222]/90 active:scale-95 transition-all outline-none border border-black/10 dark:border-white/10"
          >
            <ArrowLeft className="h-6 w-6 text-black dark:text-white" />
          </button>
          <div>
            <h1 className="text-[22px] font-bold text-gray-900 dark:text-white tracking-tight leading-none">
              Settings
            </h1>
            <p className="text-[12px] text-gray-400 dark:text-gray-500 mt-1">
              Profile and account settings
            </p>
          </div>
        </div>

        {/* Settings List */}
        <div className="mt-6">
          
          {/* Edit Profile */}
          <Link to="/user/profile/edit" className="block group border-b border-gray-200/80 dark:border-gray-800/80 py-4">
            <div className="flex items-center gap-3 transition-all duration-150">
              <User className="h-5 w-5 text-gray-500 dark:text-gray-400 group-hover:text-red-500 transition-colors" />
              <div className="flex-1 min-w-0">
                <h3 className="text-[17px] font-semibold text-gray-900 dark:text-white group-hover:text-red-500 transition-colors">
                  Edit Profile
                </h3>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  Change your name, description and profile photo
                </p>
              </div>
            </div>
          </Link>

          {/* Test push notification */}
          <button
            type="button"
            onClick={handleSendTestPush}
            disabled={isSendingTestPush}
            className="block w-full text-left group border-b border-gray-200/80 dark:border-gray-800/80 py-4 disabled:opacity-60"
          >
            <div className="flex items-center gap-3 transition-all duration-150">
              {isSendingTestPush ? (
                <Loader2 className="h-5 w-5 animate-spin text-gray-500 dark:text-gray-400" />
              ) : (
                <BellRing className="h-5 w-5 text-gray-500 dark:text-gray-400 group-hover:text-red-500 transition-colors" />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-[17px] font-semibold text-gray-900 dark:text-white group-hover:text-red-500 transition-colors">
                  Send test notification
                </h3>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  Check that push notifications reach this device
                </p>
              </div>
            </div>
          </button>

          {/* Delete Account */}
          <div 
            onClick={() => {
              setDeleteCaptcha("");
              setDeleteAccountOpen(true);
            }}
            className="block group cursor-pointer border-b border-gray-200/80 dark:border-gray-800/80 py-4"
          >
            <div className="flex items-center gap-3 transition-all duration-150">
              <Trash2 className="h-5 w-5 text-[#FF3131]" />
              <div className="flex-1 min-w-0">
                <h3 className="text-[17px] font-semibold text-gray-900 dark:text-white group-hover:text-red-500 transition-colors">
                  Delete Account
                </h3>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  Tap to delete your account
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Delete Account Confirmation Dialog */}
      {deleteAccountOpen && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto bg-black/60 backdrop-blur-sm">
          <div className="flex min-h-screen items-center justify-center p-4 py-10">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#242424] shadow-2xl border border-red-100 dark:border-red-900/30 overflow-hidden p-6">
              
              <div className="flex flex-col items-center text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
                  <Trash2 className="h-7 w-7 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white">
                  Delete Your Account?
                </h3>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed text-center">
                Are you sure you want to delete your account?
              </p>

              <div className="mb-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-r-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <span className="text-sm font-bold text-red-700 dark:text-red-400">Warning</span>
                </div>
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                  Your account will be Deleted. Admin will keep your historical records for revenue reporting.
                </p>
              </div>
              
              <div className="mb-6">
                <input 
                  type="text" 
                  placeholder="Type DELETE to confirm" 
                  value={deleteCaptcha}
                  onChange={(e) => setDeleteCaptcha(e.target.value.toUpperCase())}
                  className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:border-red-500 focus:ring-4 focus:ring-red-50 dark:focus:ring-red-900/20 outline-none transition-all font-bold text-center tracking-widest placeholder:tracking-normal placeholder:font-medium placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 rounded-xl text-md font-bold ring-2 ring-gray-300 dark:ring-gray-600"
                  onClick={() => setDeleteAccountOpen(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1 h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white text-md font-bold disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-red-600/20"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting || deleteCaptcha !== "DELETE"}
                >
                  {isDeleting ? "Deleting..." : "Delete Account"}
                </Button>
              </div>
            </motion.div>
          </div>
        </div>
      )}

    </AnimatedPage>
  );
}
