import { useEffect, useRef, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import {
  User,
  ChevronRight,
  Bike,
  Ticket,
  Star,
  Share2,
  LogOut,
  X,
  Briefcase,
  Trash2,
  AlertTriangle,
  MessageSquare
} from "lucide-react"
import { deliveryAPI, authAPI } from "@food/api"
import { toast } from "sonner"
import { showUserFacingApiError } from "@/shared/utils/apiError"
import { showAccountDeletedToast } from "@/shared/utils/customToasts"
import { clearModuleAuth } from "@food/utils/auth"
import FeedbackBottomSheet from "@food/components/common/FeedbackBottomSheet"

/**
 * ProfileV2 - 1:1 EXACT Restoration of the Legacy Profile Hub.
 * Matches ProfilePage.jsx exactly.
 */
export const ProfileV2 = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [referralReward, setReferralReward] = useState(0)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [logoutSubmitting, setLogoutSubmitting] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [deleteCaptcha, setDeleteCaptcha] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [showBalanceWarning, setShowBalanceWarning] = useState(false)
  const [balanceData, setBalanceData] = useState({ balance: 0, type: "Wallet" })
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [feedbackSheetOpen, setFeedbackSheetOpen] = useState(false)

  // Lock scroll when any popup is open
  useEffect(() => {
    const isPopupOpen = showLogoutConfirm || deleteAccountOpen || showBalanceWarning || feedbackSheetOpen;
    if (isPopupOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showLogoutConfirm, deleteAccountOpen, showBalanceWarning, feedbackSheetOpen]);

  // Fetch profile data
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true)
        const response = await deliveryAPI.getProfile()
        if (response?.data?.success && response?.data?.data?.profile) {
          setProfile(response.data.data.profile)
        }
      } catch (error) {
        toast.error("Failed to load profile data")
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])

  useEffect(() => {
    deliveryAPI.getReferralStats().then((res) => {
      const reward = res?.data?.data?.stats?.rewardAmount
      setReferralReward(Number(reward) || 0)
    }).catch(() => {})
  }, [])

  const refId = profile?._id || profile?.id || profile?.referralCode || ""
  const referralLink = refId ? `${window.location.origin}/food/delivery/signup?ref=${encodeURIComponent(String(refId))}` : ""

  const handleShareReferral = async () => {
    if (!referralLink) return
    const rewardText = referralReward > 0 ? `₹${referralReward}` : "rewards"
    const shareText = `Join as a delivery partner and earn ${rewardText}.`
    try {
      if (navigator.share) {
        await navigator.share({ title: "Delivery referral", text: shareText, url: referralLink })
      } else {
        const fallbackUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`
        window.open(fallbackUrl, "_blank", "noopener,noreferrer")
      }
    } catch (e) {}
  }

  const handleLogout = async () => {
    if (logoutSubmitting) return
    try {
      setLogoutSubmitting(true)
      await deliveryAPI.logout()
    } catch (error) {}
    clearModuleAuth("delivery")
    localStorage.removeItem("app:isOnline")
    navigate("/food/delivery/login", { replace: true })
    setLogoutSubmitting(false)
  }

  const handleLogoutAllDevices = async () => {
    if (logoutSubmitting) return
    try {
      setLogoutSubmitting(true)
      await authAPI.logoutFromAllDevices("delivery")
    } catch (error) {}
    clearModuleAuth("delivery")
    localStorage.removeItem("app:isOnline")
    navigate("/food/delivery/login", { replace: true })
    setLogoutSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center font-poppins">
        <div className="flex items-center gap-2 text-gray-700">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-600 rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading profile...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-poppins pb-24">
      {/* Profile Header Block */}
      <div className="bg-white p-4 w-full shadow-sm">
        <div 
          onClick={() => navigate("/food/delivery/profile/details")}
          className="flex items-start justify-between cursor-pointer"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl md:text-3xl font-bold">{profile?.name || ""}</h2>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-gray-600 text-sm md:text-base mb-3 font-medium">{profile?.deliveryId || ""}</p>
          </div>
          <div className="relative shrink-0 ml-4">
            {profile?.profileImage?.url ? (
              <img src={profile.profileImage.url} alt="Profile" className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border-2 border-gray-200" />
            ) : (
              <img src="/assets/images/profile_avatar.webp" alt="Profile" className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border-2 border-gray-200" />
            )}
            <div className="absolute bottom-0 right-0 bg-white rounded-full p-2 shadow-md border-2 border-white">
              <Briefcase className="w-4 h-4 text-gray-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
        {/* Navigation Buttons */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => navigate("/food/delivery/history")}
            className="bg-white rounded-xl p-4 flex flex-col items-center gap-2 border border-transparent active:bg-gray-50 transition-colors"
          >
            <div className="rounded-full bg-gray-50 p-3">
              <Bike className="w-6 h-6 text-gray-700" />
            </div>
            <span className="text-sm font-bold text-gray-900">Trips history</span>
          </button>
          <button
            onClick={() => navigate("/food/delivery/profile/reviews")}
            className="bg-white rounded-xl p-4 flex flex-col items-center gap-2 border border-transparent active:bg-gray-50 transition-colors"
          >
            <div className="rounded-full bg-gray-50 p-3">
              <Star className="w-6 h-6 text-orange-500" />
            </div>
            <span className="text-sm font-bold text-gray-900">My reviews</span>
          </button>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {/* Support Section */}
          <div>
            <h3 className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em] mb-3 px-1">Support</h3>
            <div className="space-y-2">
              <div 
                onClick={() => navigate("/food/delivery/help/tickets")}
                className="bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Ticket className="w-5 h-5 text-gray-700" />
                  <span className="text-sm font-bold text-gray-900">Support tickets</span>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </div>

              <div 
                onClick={() => setFeedbackSheetOpen(true)}
                className="bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-gray-700" />
                  <span className="text-sm font-bold text-gray-900">Share Feedback</span>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </div>
            </div>
          </div>

          {/* Logout Section */}
          <div className="pt-2">
            <div 
              onClick={() => setShowLogoutConfirm(true)}
              className="bg-white rounded-[1.2rem] p-4 flex items-center justify-between cursor-pointer border border-red-100 hover:bg-red-50 active:bg-red-100 transition-all shadow-[0_4px_20px_-4px_rgba(220,38,38,0.05)]"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="flex h-[3.2rem] w-[3.2rem] items-center justify-center rounded-full bg-red-50 shrink-0">
                  <LogOut className="w-5 h-5 text-[#FF3131] ml-0.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[17px] font-bold text-[#FF3131] mb-0.5">Logout</p>
                  <p className="text-[13px] text-gray-500 font-medium">Tap to logout from this device</p>
                </div>
              </div>
              <ChevronRight className="w-[18px] h-[18px] text-gray-300 shrink-0" />
            </div>
          </div>

          {/* Delete Account */}
          <div className="pt-0">
            <div
              onClick={() => { 
                setDeleteCaptcha(""); 
                setDeleteAccountOpen(true);
              }}
              className="bg-white rounded-[1.2rem] p-4 flex items-center justify-between cursor-pointer border border-red-50 hover:bg-red-50 active:bg-red-100 transition-all active:scale-[0.99]"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="flex h-[3.2rem] w-[3.2rem] items-center justify-center rounded-full bg-[#FFF1F2] shrink-0">
                  {isCheckingBalance ? (
                    <div className="w-5 h-5 border-2 border-[#FF3131]/30 border-t-[#FF3131] rounded-full animate-spin" />
                  ) : (
                    <Trash2 className="w-5 h-5 text-[#FF3131]" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[17px] font-bold text-[#FF3131] mb-0.5">Delete Account</p>
                  <p className="text-[13px] text-gray-500 font-medium">Tap to delete your account</p>
                </div>
              </div>
              <ChevronRight className="w-[18px] h-[18px] text-[#FF3131]/30 shrink-0" />
            </div>
          </div>
        </div>
      </div>

      {/* Logout Confirm Popup */}
      {showLogoutConfirm && (
        <div 
          className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center px-4 backdrop-blur-sm overflow-y-auto py-10"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div 
            className="w-full max-w-[340px] rounded-[1.8rem] bg-white p-7 shadow-2xl flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative mb-3">
              {profile?.profileImage?.url ? (
                <img src={profile.profileImage.url} alt="Profile" className="w-[84px] h-[84px] rounded-full object-cover shadow-sm ring-4 ring-gray-50" />
              ) : (
                <img src="/assets/images/profile_avatar.webp" alt="Profile" className="w-[84px] h-[84px] rounded-full object-cover shadow-sm ring-4 ring-gray-50" />
              )}
            </div>
            
            <h3 className="text-[19px] font-black text-[#1F2937] leading-tight mb-1">{profile?.name || "Delivery Partner"}</h3>
            {profile?.deliveryId && <p className="text-[13px] font-medium text-gray-500 mb-6">{profile.deliveryId}</p>}

            <div className="w-full space-y-3">
              <button
                type="button"
                onClick={handleLogout}
                disabled={logoutSubmitting}
                className="w-full rounded-[14px] bg-[#DC2626] py-[14px] text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {logoutSubmitting ? "Logging out..." : "Logout"}
              </button>
              <button
                type="button"
                onClick={handleLogoutAllDevices}
                disabled={logoutSubmitting}
                className="w-full rounded-[14px] border-[1.5px] border-[#DC2626] bg-white py-[14px] text-[15px] font-bold text-[#DC2626] transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {logoutSubmitting ? "Logging out..." : "Logout from all devices"}
              </button>
            </div>
            
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(false)}
              disabled={logoutSubmitting}
              className="mt-5 text-[15px] font-bold text-[#6B7280] hover:text-[#374151] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Balance Warning Popup */}
      {showBalanceWarning && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center px-4 backdrop-blur-sm overflow-y-auto py-10">
          <div 
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mb-3">
                <AlertTriangle className="w-8 h-8 text-orange-600" />
              </div>
              <h3 className="text-xl font-black text-gray-900">Wait! Balance Found</h3>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-5 text-center">
              <p className="text-xs text-gray-500 uppercase font-black tracking-widest mb-1">{balanceData.type}</p>
              <p className="text-3xl font-black text-black">₹{balanceData.balance.toLocaleString('en-IN')}</p>
            </div>

            <p className="text-sm text-gray-600 mb-6 text-center leading-relaxed">
              You still have money in your account. Do you want to continue deleting your account or go back and withdraw?
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowBalanceWarning(false);
                  setDeleteCaptcha("");
                  setDeleteAccountOpen(true);
                }}
                className="w-full h-12 rounded-xl bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors"
              >
                Continue Anyway
              </button>
              <button
                onClick={() => setShowBalanceWarning(false)}
                className="w-full h-12 rounded-xl bg-black text-white font-bold hover:bg-gray-900 transition-colors"
              >
                Cancel & Withdraw
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteAccountOpen && (
        <div 
          className="fixed inset-0 z-[1000] overflow-y-auto bg-black/80 backdrop-blur-sm"
        >
          <div className="flex min-h-screen items-center justify-center p-4 py-10">
            <div 
              className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Icon + Title centered */}
              <div className="flex flex-col items-center text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-3">
                  <Trash2 className="w-7 h-7 text-red-600" />
                </div>
                <h3 className="text-xl font-black text-gray-900">Delete Your Account?</h3>
              </div>

              <p className="text-sm text-gray-600 mb-4 leading-relaxed text-center">
                Are you sure you want to delete your account?
              </p>

              <div className="mb-4 bg-red-50 border-l-4 border-red-500 rounded-r-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <span className="text-sm font-bold text-red-700">Warning</span>
                </div>
                <p className="text-xs text-red-700 leading-relaxed">
                  Your account will be Deleted. Admin will keep your historical records for revenue reporting.
                </p>
              </div>
              
              <div className="mb-6">
                <input 
                  type="text" 
                  placeholder="Type DELETE to confirm" 
                  value={deleteCaptcha}
                  onChange={(e) => setDeleteCaptcha(e.target.value.toUpperCase())}
                  className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 focus:border-red-500 focus:ring-4 focus:ring-red-50 outline-none transition-all font-bold text-center tracking-widest placeholder:tracking-normal placeholder:font-medium placeholder:text-gray-400"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDeleteAccountOpen(false)}
                  className="flex-1 h-12 rounded-xl border-2 border-gray-300 text-gray-700 font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (isDeleting || deleteCaptcha !== "DELETE") return;
                    setIsDeleting(true);
                    try {
                      await authAPI.deleteAccount("delivery");
                      showAccountDeletedToast();
                      clearModuleAuth("delivery");
                      navigate("/food/delivery/login", { replace: true });
                    } catch (err) {
                      showUserFacingApiError(err, "Failed to delete account");
                    } finally {
                      setIsDeleting(false);
                      setDeleteAccountOpen(false);
                    }
                  }}
                  disabled={isDeleting || deleteCaptcha !== "DELETE"}
                  className="flex-1 h-12 rounded-xl bg-red-600 text-white font-bold disabled:opacity-60 disabled:cursor-not-allowed hover:bg-red-700 active:bg-red-800 transition-colors shadow-lg shadow-red-600/20"
                >
                  {isDeleting ? "Deleting..." : "Delete Account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Experience Feedback Bottom Sheet */}
      <FeedbackBottomSheet
        isOpen={feedbackSheetOpen}
        onClose={() => setFeedbackSheetOpen(false)}
        module="delivery"
        title="Delivery App Experience"
      />
    </div>
  )
}

export default ProfileV2;
