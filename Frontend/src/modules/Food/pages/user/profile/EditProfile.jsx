import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, X, Pencil, Loader2, Camera, Upload, Trash2 } from "lucide-react"
import { Button } from "@food/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@food/components/ui/dropdown-menu"
import { getAvatarColor } from "@food/utils/avatarUtils"
import { ImageCropper } from "@food/components/ImageCropper"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import { Card, CardContent } from "@food/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@food/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { useProfile } from "@food/context/ProfileContext"
import { normalizeImageUrl } from "@food/utils/common"
import { userAPI } from "@food/api"
import { toast } from "sonner"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { compressImageForUpload, PROFILE_PRESET } from "@/shared/utils/imageCompressor"
import { EMAIL_REGEX } from "@/shared/utils/emailValidation"
import dayjs from 'dayjs'
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }
const NAME_MIN_LENGTH = 2
const NAME_MAX_LENGTH = 40
const EDIT_PROFILE_DRAFT_KEY = "user_edit_profile_draft"

// Gender options
const genderOptions = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer-not-to-say", label: "Prefer not to say" },
]

// Load profile data from localStorage (legacy + current keys)
const loadProfileFromStorage = () => {
  try {
    const candidates = ["user_user", "userProfile", "eatiefy_user_profile"]
    for (const key of candidates) {
      const stored = localStorage.getItem(key)
      if (stored) return JSON.parse(stored)
    }
  } catch (error) {
    debugError('Error loading profile from localStorage:', error)
  }
  return null
}

// Save profile data to localStorage (keep keys used by ProfileContext)
const saveProfileToStorage = (data) => {
  try {
    localStorage.setItem('user_user', JSON.stringify(data))
    localStorage.setItem('userProfile', JSON.stringify(data))
  } catch (error) {
    debugError('Error saving profile to localStorage:', error)
  }
}

const normalizePhoneToTenDigits = (value) =>
  String(value || "").replace(/\D/g, "").slice(-10)

// Cleans what the user types / pastes / autofills into the mobile field. A
// pasted "+91 98765 43210", "919876543210" or "09876543210" used to be cut to
// its first 10 digits ("9198765432"), keeping the country code and losing the
// real number's tail. Short input (typing in progress) is left untouched.
const sanitizeMobileInput = (value) => {
  let digits = String(value || "").replace(/\D/g, "")
  if (digits.length > 10) {
    if (digits.startsWith("91") && digits.length >= 12) digits = digits.slice(2)
    else if (digits.startsWith("0")) digits = digits.replace(/^0+/, "")
  }
  return digits.slice(0, 10)
}

const buildFormDataFromProfile = (profile = {}) => ({
  name: profile.name || "",
  mobile: sanitizeMobileInput(profile.mobile || profile.phone || ""),
  email: profile.email || "",
  dateOfBirth: profile.dateOfBirth
    ? (typeof profile.dateOfBirth === 'string'
      ? dayjs(profile.dateOfBirth)
      : dayjs(profile.dateOfBirth))
    : null,
  anniversary: profile.anniversary
    ? (typeof profile.anniversary === 'string'
      ? dayjs(profile.anniversary)
      : dayjs(profile.anniversary))
    : null,
  gender: profile.gender || "",
})

const clearEditProfileDraft = () => {
  try {
    localStorage.removeItem(EDIT_PROFILE_DRAFT_KEY)
  } catch (error) {
    debugError('Error clearing edit profile draft from localStorage:', error)
  }
}

export default function EditProfile() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { userProfile, updateUserProfile } = useProfile()

  // Always start from saved profile — never hydrate unsaved drafts into the form
  useEffect(() => {
    clearEditProfileDraft()
  }, [])

  const storedProfile = loadProfileFromStorage()
  const initialProfile = storedProfile || userProfile || {}

  const initialFormData = buildFormDataFromProfile(initialProfile)

  const [formData, setFormData] = useState(initialFormData)
  const [initialData] = useState(initialFormData)
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [profileImage, setProfileImage] = useState(initialProfile?.profileImage || userProfile?.profileImage || "")
  const [imagePreview, setImagePreview] = useState(initialProfile?.profileImage || userProfile?.profileImage || "")
  const [pendingImageFile, setPendingImageFile] = useState(null)
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false)
  const [cropImageFile, setCropImageFile] = useState(null)
  const [isCropModalOpen, setIsCropModalOpen] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({
    mobile: "",
    email: "",
    dateOfBirth: "",
  })
  const fileInputRef = useRef(null)
  const mobileInputRef = useRef(null)
  const savedProfileImageRef = useRef(initialProfile?.profileImage || userProfile?.profileImage || "")

  // Sync form when real saved profile loads from context (not while user is editing)
  useEffect(() => {
    if (hasChanges) return
    const stored = loadProfileFromStorage()
    const profile = stored || userProfile || {}
    const nextForm = buildFormDataFromProfile(profile)
    setFormData(nextForm)
    if (profile.profileImage) {
      setProfileImage(profile.profileImage)
      setImagePreview(profile.profileImage)
      savedProfileImageRef.current = profile.profileImage
    }
  }, [userProfile, hasChanges])

  // Check if form has changes (including profile photo changes)
  useEffect(() => {
    const currentData = JSON.stringify(formData)
    const savedData = JSON.stringify(initialData)
    const originalImage = savedProfileImageRef.current || ""
    const isImageChanged = pendingImageFile !== null || profileImage !== originalImage
    setHasChanges(currentData !== savedData || isImageChanged)
  }, [formData, initialData, pendingImageFile, profileImage])

  const discardAndGoBack = () => {
    clearEditProfileDraft()
    goBack()
  }
  const validateEmail = (value) => {
    if (!value) return ""
    return EMAIL_REGEX.test(value) ? "" : "Please enter a valid email"
  }

  const validateName = (value) => {
    const v = String(value || "").trim()
    if (!v) return "Name is required"
    if (v.length < NAME_MIN_LENGTH) return `Name must be at least ${NAME_MIN_LENGTH} characters`
    return ""
  }

  const validateMobile = (value) => {
    if (!value) return ""
    if (!/^\d{10}$/.test(value)) return "Mobile number must be 10 digits"
    return /^[6-9]/.test(value) ? "" : "Enter a valid Indian mobile number (starts with 6-9)"
  }

  const validateDateOfBirth = (value) => {
    if (!value) return ""
    const dob = dayjs(value)
    if (!dob.isValid()) return "Please select a valid date of birth"
    return dob.isAfter(dayjs(), "day") ? "Date of birth cannot be in the future" : ""
  }

  const handleChange = (field, value) => {
    let normalizedValue = value
    let errorMessage = ""

    if (field === "name") {
      normalizedValue = String(value || "").replace(/[^a-zA-Z\s]/g, "").replace(/\s{2,}/g, " ").slice(0, NAME_MAX_LENGTH)
      errorMessage = validateName(normalizedValue)
    } else if (field === "mobile") {
      normalizedValue = sanitizeMobileInput(value)
      errorMessage = validateMobile(normalizedValue)
    } else if (field === "email") {
      normalizedValue = String(value || "").trim()
      errorMessage = validateEmail(normalizedValue)
    } else if (field === "dateOfBirth") {
      errorMessage = validateDateOfBirth(normalizedValue)
    }

    setFormData((prev) => ({
      ...prev,
      [field]: normalizedValue
    }))

    if (field === "name" || field === "mobile" || field === "email" || field === "dateOfBirth") {
      setFieldErrors((prev) => ({
        ...prev,
        [field]: errorMessage
      }))
    }
  }

  const handleClear = (field) => {
    setFormData(prev => ({
      ...prev,
      [field]: ""
    }))
  }

  const processProfileImageFile = async (file) => {
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file')
      return
    }

    const preparingToastId = toast.loading("Preparing photo...")
    try {
      const prepared = await compressImageForUpload(file, {
        ...PROFILE_PRESET,
        maxWidth: 1600,
        maxHeight: 1600,
      })
      setCropImageFile(prepared)
      setIsCropModalOpen(true)
    } catch (err) {
      console.error("Could not prepare selected image:", err)
      toast.error("Could not read this image. Please try another photo.")
    } finally {
      toast.dismiss(preparingToastId)
    }
  }

  const handleCropComplete = async (croppedFile) => {
    setIsCropModalOpen(false)
    setCropImageFile(null)

    if (!croppedFile) return

    try {
      const preparedFile = await compressImageForUpload(croppedFile, PROFILE_PRESET)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result)
        setPendingImageFile(preparedFile)
      }
      reader.readAsDataURL(preparedFile)
    } catch (err) {
      console.error("Profile image preparation failed:", err)
      toast.error("Could not prepare image. Please try another photo.")
    }
  }

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0]
    if (file) {
      await processProfileImageFile(file)
    }
    e.target.value = ""
  }

  const handleProfileImageAction = () => {
    if (isFlutterBridgeAvailable()) {
      setPhotoPickerOpen(true)
      return
    }

    fileInputRef.current?.click()
  }

  const validateForm = () => {
    const nextErrors = {
      name: validateName(formData.name),
      mobile: !formData.mobile
        ? "Mobile number is required"
        : validateMobile(formData.mobile),
      email: validateEmail(formData.email),
      dateOfBirth: validateDateOfBirth(formData.dateOfBirth),
    }
    setFieldErrors(nextErrors)
    return !Object.values(nextErrors).some(Boolean)
  }

  const handleUpdate = async () => {
    if (isSaving) return
    if (!validateForm()) {
      toast.error("Please fix the highlighted fields")
      return
    }

    try {
      setIsSaving(true)

      let finalImageUrl = profileImage
      if (pendingImageFile) {
        setIsUploadingImage(true)
        try {
          const uploadRes = await userAPI.uploadProfileImage(pendingImageFile)
          finalImageUrl =
            uploadRes?.data?.data?.profileImage ||
            uploadRes?.data?.profileImage ||
            uploadRes?.data?.data?.user?.profileImage ||
            profileImage

          if (!finalImageUrl) {
            throw new Error("Upload succeeded but profile image URL was missing")
          }
        } catch (uploadErr) {
          debugError('Error uploading image:', uploadErr)
          const uploadMessage =
            uploadErr?.response?.data?.error ||
            uploadErr?.response?.data?.message ||
            uploadErr?.message ||
            'Failed to upload image'
          toast.error(uploadMessage)
          setIsUploadingImage(false)
          setIsSaving(false)
          return
        }
        setIsUploadingImage(false)
      }

      // Prepare data for API — phone only persists when Update profile is clicked
      const updateData = {
        name: formData.name,
        phone: formData.mobile || undefined,
        email: formData.email || undefined,
        dateOfBirth: formData.dateOfBirth ? formData.dateOfBirth.format('YYYY-MM-DD') : undefined,
        anniversary: formData.anniversary ? formData.anniversary.format('YYYY-MM-DD') : undefined,
        gender: formData.gender || undefined,
        profileImage: finalImageUrl,
      }

      // Call API to update profile
      const response = await userAPI.updateProfile(updateData)
      const updatedUser = response?.data?.data?.user || response?.data?.user

      if (updatedUser) {
        // Update context with all fields including profileImage
        updateUserProfile({
          ...updatedUser,
          phone: updatedUser.phone || formData.mobile,
          profileImage: finalImageUrl,
          localImagePreview: imagePreview !== finalImageUrl ? imagePreview : undefined
        })

        // Save to localStorage with complete data
        saveProfileToStorage({
          name: updatedUser.name || formData.name,
          phone: updatedUser.phone || formData.mobile,
          mobile: updatedUser.phone || formData.mobile,
          email: updatedUser.email || formData.email,
          profileImage: updatedUser.profileImage || finalImageUrl,
          localImagePreview: imagePreview !== finalImageUrl ? imagePreview : undefined,
          dateOfBirth: updatedUser.dateOfBirth || formData.dateOfBirth?.format('YYYY-MM-DD'),
          anniversary: updatedUser.anniversary || formData.anniversary?.format('YYYY-MM-DD'),
          gender: updatedUser.gender || formData.gender,
        })
        clearEditProfileDraft()

        // Dispatch event to refresh profile from API
        window.dispatchEvent(new Event("userAuthChanged"))

        // Navigate back
        navigate("/user/profile")
      }
    } catch (error) {
      debugError('Error updating profile:', error)
      toast.error(error?.response?.data?.message || 'Failed to update profile')
      setIsSaving(false)
    }
  }

  const handleMobileChange = () => {
    setFormData((prev) => ({ ...prev, mobile: "" }))
    setFieldErrors((prev) => ({ ...prev, mobile: "" }))
    requestAnimationFrame(() => {
      mobileInputRef.current?.focus()
      mobileInputRef.current?.select?.()
    })
  }

  const handleEmailChange = () => {
    setFormData((prev) => ({ ...prev, email: "" }))
    setFieldErrors((prev) => ({ ...prev, email: "" }))
    requestAnimationFrame(() => {
      document.getElementById("email")?.focus()
    })
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#141414] pb-12">
      <style>{`
        /* MUI DatePicker overrides */
        .dark .MuiOutlinedInput-root fieldset {
          border-color: #4b5563 !important;
        }
        .dark .MuiOutlinedInput-root:hover fieldset {
          border-color: #9ca3af !important;
        }
        .dark .MuiOutlinedInput-root.Mui-focused fieldset {
          border-color: #1F6B45 !important;
        }
        .dark input,
        .dark .MuiInputBase-root,
        .dark .MuiInputBase-root *,
        .dark .MuiOutlinedInput-root,
        .dark .MuiOutlinedInput-root * {
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          opacity: 1 !important;
        }
        .dark input::placeholder,
        .dark input::-webkit-input-placeholder,
        .dark input::-moz-placeholder,
        .dark input:-ms-input-placeholder {
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          opacity: 0.9 !important;
        }
        .dark .MuiInputLabel-root {
          color: #9ca3af !important;
        }
        .dark .MuiIconButton-root {
          color: #9ca3af !important;
        }

        /* Date Selector Calendar Popper Overrides in Dark Mode */
        .dark .MuiPickersPopper-paper,
        .dark .MuiPaper-root,
        .dark .MuiPickersLayout-root {
          background-color: #1e1e1e !important;
          color: #ffffff !important;
          border: 1px solid #374151 !important;
        }
        .dark .MuiPickersCalendarHeader-label {
          color: #ffffff !important;
        }
        .dark .MuiPickersCalendarHeader-iconButton {
          color: #ffffff !important;
        }
        .dark .MuiDayCalendar-weekDayLabel {
          color: #9ca3af !important;
        }
        .dark .MuiPickersDay-root {
          color: #ffffff !important;
        }
        .dark .MuiPickersDay-root:hover {
          background-color: rgba(255, 255, 255, 0.08) !important;
        }
        .dark .MuiPickersDay-root.Mui-selected {
          background-color: #1F6B45 !important;
          color: #ffffff !important;
        }
        .dark .MuiPickersDay-root.MuiPickersDay-today {
          border-color: #1F6B45 !important;
        }
        .dark .MuiPickersYear-yearButton {
          color: #ffffff !important;
        }
        .dark .MuiPickersYear-yearButton.Mui-selected {
          background-color: #1F6B45 !important;
        }
        .dark .MuiPickersMonth-monthButton {
          color: #ffffff !important;
        }
        .dark .MuiPickersMonth-monthButton.Mui-selected {
          background-color: #1F6B45 !important;
        }

        /* Radix Select Trigger / Gender overrides */
        .dark [data-slot="select-trigger"] span,
        .dark [data-slot="select-value"] {
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
        }
        .dark [data-slot="select-trigger"][data-placeholder] span,
        .dark [data-slot="select-trigger"][data-placeholder] [data-slot="select-value"] {
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          opacity: 0.9 !important;
        }
        .dark [data-slot="select-trigger"] svg {
          color: #9ca3af !important;
          opacity: 1 !important;
        }
      `}</style>
      {/* Header */}
      <div className="bg-white dark:bg-[#242424] border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-7xl mx-auto flex items-center gap-3 px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 md:py-5 lg:py-6">
          <button
            type="button"
            onClick={discardAndGoBack}
            className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-white" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Your Profile</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8 pb-28 md:pb-12 mt-20">
        <div className="relative bg-white dark:bg-[#242424] rounded-[32px] pt-16 pb-8 px-4 sm:px-6 shadow-[0_2px_20px_rgb(0,0,0,0.04)] border border-gray-100/50 dark:border-gray-800">

          {/* SVG Hump overlapping top */}
          <div className="absolute -top-[49px] left-1/2 -translate-x-1/2 w-[320px] h-[50px] overflow-hidden pointer-events-none">
            <svg width="320" height="50" viewBox="0 0 320 50" fill="none" className="dark:hidden">
              <path d="M0 50 C 50 50, 70 0, 92 0 L 228 0 C 250 0, 270 50, 320 50 Z" fill="white" />
            </svg>
            <svg width="320" height="50" viewBox="0 0 320 50" fill="none" className="hidden dark:block">
              <path d="M0 50 C 50 50, 70 0, 92 0 L 228 0 C 250 0, 270 50, 320 50 Z" fill="#1a1a1a" />
            </svg>
          </div>

          {/* Avatar Section */}
          <div className="absolute -top-[105px] left-1/2 -translate-x-1/2 z-20 flex justify-center">
            <div className="relative">
              <Avatar className="h-28 w-28 border-4 border-white shadow-sm bg-transparent">
                {(imagePreview && typeof imagePreview === "string" && imagePreview.trim() !== "" && imagePreview !== "null" && imagePreview !== "undefined") ? (
                  <img
                    src={normalizeImageUrl(imagePreview)}
                    alt="Profile photo"
                    className="w-full h-full object-cover rounded-full text-[0px]"
                    onError={(e) => {
                      e.currentTarget.onerror = null
                      e.currentTarget.src = "/assets/images/profile_avatar.webp"
                    }}
                  />
                ) : (
                  <img
                    src="/assets/images/profile_avatar.webp"
                    alt={formData.name || 'User'}
                    className="w-full h-full object-cover rounded-full"
                  />
                )}
              </Avatar>
              {(imagePreview && typeof imagePreview === "string" && imagePreview.trim() !== "" && imagePreview !== "null" && imagePreview !== "undefined") ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isUploadingImage}
                      className="absolute -bottom-1 -right-1 z-30 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-md border-[1.5px] border-gray-100 hover:bg-gray-50 transition-colors touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUploadingImage ? (
                        <Loader2 className="h-4 w-4 text-[#1F6B45] animate-spin" />
                      ) : (
                        <Pencil className="h-[18px] w-[18px] text-[#1F6B45]" strokeWidth={2.5} />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" sideOffset={12} className="w-[220px] bg-white/70 backdrop-blur-2xl dark:bg-[#242424]/70 rounded-[28px] border border-gray-100/50 dark:border-gray-800 shadow-[0_8px_30px_rgb(0,0,0,0.12)] p-2 z-50 flex flex-col gap-2 relative">
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white/70 dark:bg-[#242424]/70 backdrop-blur-md rotate-45 rounded-sm z-[-1]" />
                    <DropdownMenuItem
                      onClick={() => {
                        setProfileImage("")
                        setImagePreview("")
                        setPendingImageFile(null)
                      }}
                      className="cursor-pointer text-[15.5px] font-medium py-3.5 px-4 rounded-[20px] bg-[#E5E7EB] dark:bg-[#333] text-[#1F6B45] focus:text-[#1F6B45] focus:bg-[#D1D5DB] dark:focus:bg-[#444] hover:bg-[#D1D5DB] dark:hover:bg-[#444] outline-none flex justify-center tracking-wide shadow-sm"
                    >
                      <span>Delete Photo</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={handleProfileImageAction}
                      className="cursor-pointer text-[15.5px] font-medium py-3.5 px-4 rounded-[20px] bg-[#E5E7EB] dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:bg-[#D1D5DB] dark:focus:bg-[#444] hover:bg-[#D1D5DB] dark:hover:bg-[#444] outline-none flex justify-center tracking-wide shadow-sm"
                    >
                      <span>Change photo</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  onClick={handleProfileImageAction}
                  disabled={isUploadingImage}
                  className="absolute -bottom-1 -right-1 z-30 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-md border-[1.5px] border-gray-100 hover:bg-gray-50 transition-colors touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploadingImage ? (
                    <Loader2 className="h-4 w-4 text-[#1F6B45] animate-spin" />
                  ) : (
                    <Pencil className="h-[18px] w-[18px] text-[#1F6B45]" strokeWidth={2.5} />
                  )}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
              />
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4 md:space-y-5 lg:space-y-6 pt-6">
            {/* Name Field */}
            <div className="relative">
              <fieldset className="border border-gray-300 dark:border-gray-700 rounded-[14px] px-3 pb-2 pt-0 transition-colors focus-within:border-[#1F6B45] focus-within:border-[1.5px]">
                <legend className="text-[13px] text-gray-400 dark:text-gray-500 px-1 font-normal tracking-wide">Name</legend>
                <div className="flex items-center justify-between">
                  <input
                    id="name"
                    type="text"
                    value={formData.name}
                    maxLength={NAME_MAX_LENGTH}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="w-full min-w-0 flex-1 bg-transparent border-none outline-none text-gray-800 dark:text-white text-[16px] font-medium pb-1 truncate"
                  />
                  {formData.name && (
                    <button type="button" onClick={() => handleClear('name')} className="shrink-0 ml-2 text-gray-400 hover:text-gray-600">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </fieldset>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-red-600">{fieldErrors.name || ""}</span>
                <span className="text-xs text-gray-400">{String(formData.name || "").length}/{NAME_MAX_LENGTH}</span>
              </div>
            </div>

            {/* Mobile Field */}
            <div>
              <fieldset className="border border-gray-300 dark:border-gray-700 rounded-[14px] px-3 pb-2 pt-0 transition-colors focus-within:border-[#1F6B45] focus-within:border-[1.5px]">
                <legend className="text-[13px] text-gray-400 dark:text-gray-500 px-1 font-normal tracking-wide">Mobile</legend>
                <div className="flex items-center justify-between">
                  <input
                    ref={mobileInputRef}
                    id="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={16}
                    value={formData.mobile}
                    onChange={(e) => handleChange('mobile', e.target.value)}
                    placeholder="Enter 10-digit mobile number (without +91)"
                    className="w-full bg-transparent border-none outline-none text-gray-800 dark:text-white text-[16px] font-medium pb-1 placeholder:text-gray-400"
                  />
                  <button
                    type="button"
                    onClick={handleMobileChange}
                    className="text-[#1F6B45] text-[13px] font-semibold tracking-wider shrink-0 px-1"
                  >
                    CHANGE
                  </button>
                </div>
              </fieldset>
              {fieldErrors.mobile && <p className="text-xs text-red-600 mt-1">{fieldErrors.mobile}</p>}
            </div>

            {/* Email Field */}
            <div>
              <fieldset className="border border-gray-300 dark:border-gray-700 rounded-[14px] px-3 pb-2 pt-0 transition-colors focus-within:border-[#1F6B45] focus-within:border-[1.5px]">
                <legend className="text-[13px] text-gray-400 dark:text-gray-500 px-1 font-normal tracking-wide">Email</legend>
                <div className="flex items-center justify-between">
                  <input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    className="w-full bg-transparent border-none outline-none text-gray-800 dark:text-white text-[16px] font-medium pb-1"
                  />
                  <button type="button" onClick={handleEmailChange} className="text-[#1F6B45] text-[13px] font-semibold tracking-wider shrink-0 px-1">
                    CHANGE
                  </button>
                </div>
              </fieldset>
              {fieldErrors.email && <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
            </div>

            {/* Date of Birth Field */}
            <div>
              <fieldset className="border border-gray-300 dark:border-gray-600 rounded-[14px] px-3 pb-2 pt-0 transition-colors focus-within:border-[#1F6B45] focus-within:border-[1.5px]">
                <legend className="text-[13px] text-gray-400 dark:text-gray-400 px-1 font-normal tracking-wide">Date of birth</legend>
                <input
                  id="dateOfBirth"
                  type="date"
                  value={formData.dateOfBirth ? formData.dateOfBirth.format('YYYY-MM-DD') : ''}
                  onChange={(e) => handleChange('dateOfBirth', e.target.value ? dayjs(e.target.value) : null)}
                  max={dayjs().format('YYYY-MM-DD')}
                  className="w-full bg-transparent border-none outline-none text-gray-800 dark:text-white text-[16px] font-medium pb-1 [color-scheme:light] dark:[color-scheme:dark]"
                />
              </fieldset>
              {fieldErrors.dateOfBirth && <p className="text-xs text-red-600 mt-1">{fieldErrors.dateOfBirth}</p>}
            </div>

            {/* Anniversary Field */}
            <div>
              <fieldset className="border border-gray-300 dark:border-gray-600 rounded-[14px] px-3 pb-2 pt-0 transition-colors focus-within:border-[#1F6B45] focus-within:border-[1.5px]">
                <legend className="text-[13px] text-gray-400 dark:text-gray-400 px-1 font-normal tracking-wide">Anniversary</legend>
                <input
                  id="anniversary"
                  type="date"
                  value={formData.anniversary ? formData.anniversary.format('YYYY-MM-DD') : ''}
                  onChange={(e) => handleChange('anniversary', e.target.value ? dayjs(e.target.value) : null)}
                  className="w-full bg-transparent border-none outline-none text-gray-800 dark:text-white text-[16px] font-medium pb-1 [color-scheme:light] dark:[color-scheme:dark]"
                />
              </fieldset>
            </div>

            {/* Gender Field */}
            <div>
              <fieldset className="border border-gray-300 dark:border-gray-600 rounded-[14px] px-3 pb-1 pt-0 transition-colors focus-within:border-[#1F6B45] focus-within:border-[1.5px]">
                <legend className="text-[13px] text-gray-400 dark:text-gray-500 px-1 font-normal tracking-wide">Gender</legend>
                <Select
                  value={formData.gender || ""}
                  onValueChange={(value) => handleChange('gender', value)}
                >
                  <SelectTrigger className="w-full border-none shadow-none focus:ring-0 px-0 h-8 text-[16px] font-medium text-gray-800 dark:text-white bg-transparent mb-1 -mt-1">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {genderOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-[15px] font-medium">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </fieldset>
            </div>
          </div>

          {/* Update Profile Button */}
          <div className="mt-8 mb-2">
            <Button
              onClick={handleUpdate}
              disabled={!hasChanges || isSaving || isUploadingImage}
              className={`w-full h-[52px] rounded-xl font-semibold text-[15px] transition-all ${isSaving || isUploadingImage || !hasChanges
                  ? 'bg-[#1F6B45]/70 text-white cursor-not-allowed'
                  : 'bg-[#1F6B45] hover:bg-[#14512F] text-white shadow-md shadow-red-500/20'
                }`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Update profile'
              )}
            </Button>
          </div>
        </div>

        <ImageSourcePicker
          isOpen={photoPickerOpen}
          onClose={() => setPhotoPickerOpen(false)}
          onFileSelect={processProfileImageFile}
          title="Update profile photo"
          description="Choose how you want to upload your profile photo."
          fileNamePrefix="profile-photo"
          galleryInputRef={fileInputRef}
        />

        <ImageCropper
          isOpen={isCropModalOpen}
          onClose={() => {
            setIsCropModalOpen(false)
            setCropImageFile(null)
          }}
          imageFile={cropImageFile}
          onCropComplete={handleCropComplete}
        />
      </div>
    </div>
  )
}
