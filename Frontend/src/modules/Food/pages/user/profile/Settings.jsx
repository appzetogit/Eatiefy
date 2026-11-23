import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Trash2, AlertTriangle, User } from "lucide-react";
import { Button } from "@food/components/ui/button";
import { authAPI } from "@food/api";
import { clearModuleAuth } from "@food/utils/auth";
import { toast } from "sonner";
import { showAccountDeletedToast } from "@/shared/utils/customToasts";
import AnimatedPage from "@food/components/user/AnimatedPage";

export default function Settings() {
  const navigate = useNavigate();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteCaptcha, setDeleteCaptcha] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

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
