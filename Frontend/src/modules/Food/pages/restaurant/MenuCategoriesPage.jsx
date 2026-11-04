import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  BadgeCheck,
  Clock3,
  Edit2,
  Eye,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { restaurantAPI, uploadAPI } from "@food/api"
import { toast } from "sonner"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { useKeyboardAwareSheet } from "@food/hooks/useIsKeyboardOpen"

const defaultFormData = {
  name: "",
  type: "",
  image: "",
  isActive: true,
  sortOrder: 0,
  foodTypeScope: "Veg",
}

const approvalBadgeClass = (status) => {
  const value = String(status || "pending").toLowerCase()
  if (value === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (value === "rejected") return "bg-rose-50 text-rose-700 border-rose-200"
  return "bg-amber-50 text-amber-700 border-amber-200"
}

const scopePillClass = (scope) => {
  if (scope === "Veg") return "bg-green-50 text-green-700 border-green-200"
  if (scope === "Non-Veg") return "bg-red-50 text-red-700 border-red-200"
  return "bg-slate-100 text-slate-700 border-slate-200"
}

export default function MenuCategoriesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useRestaurantBackNavigation()
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [restaurantFoodType, setRestaurantFoodType] = useState("Mixed")
  const [showModal, setShowModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [formData, setFormData] = useState(defaultFormData)
  const [selectedImageFile, setSelectedImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const [viewingCategory, setViewingCategory] = useState(null)
  const [loadError, setLoadError] = useState("")
  // Category ids whose on/off switch is saving, so a double tap cannot race.
  const [togglingIds, setTogglingIds] = useState(() => new Set())
  const fileInputRef = useRef(null)
  const refreshInFlightRef = useRef(false)
  // Keeps the create/edit sheet above the on-screen keyboard.
  const { sheetProps: categorySheetProps } = useKeyboardAwareSheet()

  const isPureVegRestaurant = restaurantFoodType === "Veg"

  useEffect(() => {
    fetchCategories()
  }, [])

  useEffect(() => {
    const fetchRestaurantDietType = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const profile =
          response?.data?.data?.restaurant ||
          response?.data?.restaurant ||
          response?.data?.data ||
          null
        const ft =
          profile?.foodType ||
          (profile?.pureVegRestaurant === true ? "Veg" : "Mixed")
        setRestaurantFoodType(ft)
        if (ft === "Veg") {
          setFormData((prev) => ({ ...prev, foodTypeScope: "Veg" }))
        } else if (ft === "Non-Veg") {
          setFormData((prev) => ({ ...prev, foodTypeScope: "Non-Veg" }))
        }
      } catch {
        /* ignore — keep full diet options */
      }
    }
    fetchRestaurantDietType()
  }, [])

  useEffect(() => {
    const draftCategoryName = String(location.state?.draftCategoryName || "").trim()
    if (!draftCategoryName) return
    setEditingCategory(null)
    setFormData((prev) => ({ ...prev, ...defaultFormData, name: draftCategoryName }))
    setSelectedImageFile(null)
    setImagePreview(null)
    setShowModal(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  // Includes global/admin-owned categories too: the card below already renders
  // a "Global" badge and disables edit/delete for them (canEdit === false), so
  // a food filed under a shared category like "wings" is still visible here -
  // just not editable.
  const ownCategories = useMemo(
    () =>
      (Array.isArray(categories) ? categories : []).filter(
        (category) => category && typeof category === "object" && (category.ownedByRestaurant || category.isGlobal),
      ),
    [categories],
  )

  /**
   * @param {{ mode?: "initial" | "refresh" }} options
   *   "refresh" keeps the existing list on screen (and any open modal untouched)
   *   while the request is in flight, so only the button shows a spinner.
   */
  const fetchCategories = async ({ mode = "initial" } = {}) => {
    const isRefresh = mode === "refresh"
    // A refresh already in flight must not be queued up again.
    if (isRefresh && refreshInFlightRef.current) return
    if (isRefresh) refreshInFlightRef.current = true

    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)

      const response = await restaurantAPI.getAllCategories()
      const list = response?.data?.data?.categories || []
      setCategories(Array.isArray(list) ? list : [])
      setLoadError("")
      if (isRefresh) toast.success("Categories updated")
    } catch (error) {
      const message = error?.response?.data?.message || "Failed to load categories"
      toast.error(message)
      // Keep whatever is already on screen when a manual refresh fails.
      if (!isRefresh) {
        setCategories([])
        setLoadError(message)
      }
    } finally {
      if (isRefresh) {
        refreshInFlightRef.current = false
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }

  const handleRefresh = () => fetchCategories({ mode: "refresh" })

  const resetModal = () => {
    setShowModal(false)
    setEditingCategory(null)
    setFormData(defaultFormData)
    setSelectedImageFile(null)
    setImagePreview(null)
    setUploadingImage(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const openCreateModal = () => {
    setEditingCategory(null)
    setFormData({
      ...defaultFormData,
      foodTypeScope: isPureVegRestaurant ? "Veg" : defaultFormData.foodTypeScope,
    })
    setSelectedImageFile(null)
    setImagePreview(null)
    setShowModal(true)
  }

  /**
   * Opens the read-only details view for one category. Resolves the row against
   * the loaded list by id so the modal always shows the current record rather
   * than a stale copy captured in the click handler, and refuses to open on a
   * row with no usable id instead of rendering an empty sheet.
   */
  const openViewModal = (category) => {
    const categoryId = String(category?._id || category?.id || "")
    if (!categoryId) {
      toast.error("This category is missing its details")
      return
    }
    const current =
      categories.find((item) => String(item?._id || item?.id || "") === categoryId) || category
    setViewingCategory(current)
  }

  const closeViewModal = () => setViewingCategory(null)

  const openEditModal = (category) => {
    if (!category?.canEdit) {
      toast.error("Admin controls this category now")
      return
    }
    setEditingCategory(category)
    const scope = category?.foodTypeScope || "Veg"
    setFormData({
      name: category?.name || "",
      type: category?.type || "",
      image: category?.image || "",
      isActive: category?.isActive !== false,
      sortOrder: Number.isFinite(Number(category?.sortOrder)) ? Number(category.sortOrder) : 0,
      foodTypeScope: isPureVegRestaurant ? "Veg" : scope,
    })
    setSelectedImageFile(null)
    setImagePreview(category?.image || null)
    setShowModal(true)
  }

  const handleImageFileChange = (file) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size exceeds 5MB limit.")
      return
    }
    setSelectedImageFile(file)
    try {
      setImagePreview(URL.createObjectURL(file))
    } catch {
      setImagePreview(null)
    }
  }

  const handleImageClick = () => {
    setIsPhotoPickerOpen(true)
  }

  const handleSaveCategory = async () => {
    if (!String(formData.name || "").trim()) {
      toast.error("Category name is required")
      return
    }

    try {
      setUploadingImage(true)
      let imageUrl = String(formData.image || "").trim()

      if (selectedImageFile) {
        const res = await uploadAPI.uploadMedia(selectedImageFile, { folder: "food/categories" })
        const url = res?.data?.data?.url || res?.data?.url
        if (url) imageUrl = String(url)
      }

      const payload = {
        name: String(formData.name || "").trim(),
        type: String(formData.type || "").trim(),
        image: imageUrl,
        isActive: formData.isActive !== false,
        sortOrder: Number.isFinite(Number(formData.sortOrder)) ? Number(formData.sortOrder) : 0,
        foodTypeScope: isPureVegRestaurant ? "Veg" : formData.foodTypeScope,
      }

      if (editingCategory) {
        await restaurantAPI.updateCategory(editingCategory._id || editingCategory.id, payload)
        toast.success("Category updated and sent for admin approval")
      } else {
        await restaurantAPI.createCategory(payload)
        toast.success("Category created and sent for admin approval")
      }

      resetModal()
      fetchCategories()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save category")
    } finally {
      setUploadingImage(false)
    }
  }

  const handleDeleteCategory = async (category) => {
    if (!category?.canDelete) {
      toast.error(category?.canEdit ? "Remove foods from this category before deleting it" : "Admin controls this category now")
      return
    }
    if (!window.confirm(`Delete "${category.name}"?`)) return

    try {
      await restaurantAPI.deleteCategory(category._id || category.id)
      toast.success("Category deleted successfully")
      fetchCategories()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete category")
    }
  }

  /**
   * Turns a category on or off.
   *
   * This used to go through the full edit endpoint, which always sent the
   * category back for admin approval and never hid anything from customers, so
   * the switch looked like it did nothing. It now uses a dedicated status call:
   * the switch flips instantly, rolls back if the save fails, keeps the approval
   * status, and the category's dishes disappear from / return to the customer
   * menu, search and cart.
   */
  const handleToggleActive = async (category) => {
    const categoryId = String(category?._id || category?.id || "")
    if (!categoryId) return
    if (!category?.canEdit) {
      toast.error("Admin controls this category now")
      return
    }
    if (togglingIds.has(categoryId)) return

    const nextActive = category?.isActive === false
    const applyActive = (value) =>
      setCategories((prev) =>
        prev.map((item) =>
          String(item?._id || item?.id || "") === categoryId
            ? { ...item, isActive: value, status: value }
            : item,
        ),
      )

    setTogglingIds((prev) => new Set(prev).add(categoryId))
    applyActive(nextActive)
    try {
      const response = await restaurantAPI.setCategoryActive(categoryId, nextActive)
      const saved = response?.data?.data?.category
      if (saved) {
        setCategories((prev) =>
          prev.map((item) =>
            String(item?._id || item?.id || "") === categoryId ? { ...item, ...saved } : item,
          ),
        )
      }
      toast.success(
        nextActive
          ? `"${category.name}" is on. Its dishes are visible to customers.`
          : `"${category.name}" is off. Its dishes are hidden from customers.`,
      )
    } catch (error) {
      applyActive(!nextActive)
      toast.error(error?.response?.data?.message || "Could not update category. Please try again.")
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(categoryId)
        return next
      })
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="rounded-full p-1 hover:bg-slate-100">
            <ArrowLeft className="h-5 w-5 text-slate-700" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900">Menu Categories</h1>
            <p className="text-xs text-slate-500">Create categories, track approvals, and resubmit edits safely.</p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            aria-label="Refresh categories"
            title="Refresh categories"
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">How this works</p>
          <p className="mt-2 text-sm text-slate-600">
            New categories stay pending until admin approval. Editing an approved category sends it back for review.
            Only approved categories can be used for food uploads.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] px-4 py-3 font-semibold text-white"
        >
          <Plus className="h-5 w-5" />
          Add Category
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : loadError ? (
          /* A failed load is not the same as "you have none" — say so and let
             the restaurant retry instead of showing a misleading empty state. */
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-12 text-center">
            <p className="text-lg font-semibold text-rose-900">Could not load categories</p>
            <p className="mt-2 text-sm text-rose-700">{loadError}</p>
            <button
              type="button"
              onClick={() => fetchCategories()}
              className="mt-5 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white active:scale-95"
            >
              Try again
            </button>
          </div>
        ) : ownCategories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="text-lg font-semibold text-slate-900">No restaurant categories yet</p>
            <p className="mt-2 text-sm text-slate-500">
              Start with a category
              {isPureVegRestaurant
                ? " for your pure veg menu."
                : " and choose whether it should accept veg, non-veg, or both kinds of dishes."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {ownCategories.map((category) => {
              const status = String(category?.approvalStatus || "pending")
              const isEditable = category?.canEdit
              const isGlobal = category?.isGlobal
              const categoryKey = String(category?._id || category?.id || "")
              const isOn = category?.isActive !== false
              const isToggling = togglingIds.has(categoryKey)

              return (
                <motion.div
                  key={category._id || category.id}
                  layout
                  className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-opacity ${isOn ? "" : "opacity-75"}`}
                >
                  <div className="flex gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                      {category?.image ? (
                        <img src={category.image} alt={category.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-lg font-bold text-slate-500">
                          {String(category?.name || "C").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-900">{category.name}</h3>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${approvalBadgeClass(status)}`}>
                          {status === "approved" ? <BadgeCheck className="mr-1 h-3.5 w-3.5" /> : <Clock3 className="mr-1 h-3.5 w-3.5" />}
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${scopePillClass(category?.foodTypeScope)}`}>
                          {category?.foodTypeScope || "Both"}
                        </span>
                        {!isOn && (
                          <span className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                            Off
                          </span>
                        )}
                        {isGlobal && (
                          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                            <Globe className="mr-1 h-3.5 w-3.5" />
                            Global
                          </span>
                        )}
                      </div>

                      <div className="mt-2 space-y-1 text-sm text-slate-500">
                        <p>{category?.itemCount || 0} item(s) linked</p>
                        {isGlobal ? (
                          <p>Admin controls this category now, so you can use it but not rename or delete it.</p>
                        ) : status === "approved" ? (
                          <p>Editing this category will send it back for admin approval.</p>
                        ) : (
                          <p>Foods can be added only after approval.</p>
                        )}
                        {!isOn && (
                          <p className="text-slate-600">Turned off: its dishes are hidden from customers.</p>
                        )}
                        {status === "rejected" && category?.rejectionReason && (
                          <p className="text-rose-600">Reason: {category.rejectionReason}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    {/* View: opens this category's details. It used to be wired to
                        the activate/deactivate toggle, so tapping it silently
                        changed the category instead of showing it — and it was
                        disabled for admin-owned categories, which read as broken.
                        Viewing needs no edit rights, so it is never disabled. */}
                    <button
                      type="button"
                      onClick={() => openViewModal(category)}
                      className="rounded-xl bg-slate-100 p-2 text-slate-700 active:scale-95 transition-transform"
                      title="View category details"
                      aria-label={`View details for ${category?.name || "category"}`}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOn}
                      onClick={() => handleToggleActive(category)}
                      disabled={!isEditable || isToggling}
                      title={isOn ? "Turn off: hide dishes from customers" : "Turn on: show dishes to customers"}
                      aria-label={`${isOn ? "Turn off" : "Turn on"} ${category?.name || "category"}`}
                      className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-60 ${
                        isOn ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <span
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          isOn ? "bg-[#2E7D52]" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`absolute h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            isOn ? "translate-x-[18px]" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                      {isToggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isOn ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(category)}
                      className="rounded-xl bg-blue-50 p-2 text-blue-700 disabled:opacity-50"
                      disabled={!isEditable}
                      aria-label={`Edit ${category?.name || "category"}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(category)}
                      className="rounded-xl bg-rose-50 p-2 text-rose-700 disabled:opacity-50"
                      disabled={!category?.canDelete}
                      aria-label={`Delete ${category?.name || "category"}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Category details (read-only). Sits above the bottom nav and below the
          create/edit sheet, and never blocks the page when closed. */}
      <AnimatePresence>
        {viewingCategory && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeViewModal}
              className="fixed inset-0 z-50 bg-black/50"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 260 }}
              className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[85vh] flex-col rounded-t-3xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between p-4 pb-2">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-slate-900">
                    {viewingCategory?.name || "Category"}
                  </h2>
                  <p className="text-xs text-slate-500">Category details</p>
                </div>
                <button type="button" onClick={closeViewModal} aria-label="Close details" className="p-1">
                  <X className="h-5 w-5 text-slate-600" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {viewingCategory?.image ? (
                  <img
                    src={viewingCategory.image}
                    alt={viewingCategory?.name || "Category"}
                    className="mb-4 h-40 w-full rounded-2xl object-cover"
                  />
                ) : (
                  <div className="mb-4 flex h-24 w-full items-center justify-center rounded-2xl bg-slate-100 text-sm font-medium text-slate-400">
                    No image
                  </div>
                )}

                <dl className="space-y-3">
                  {[
                    { label: "Name", value: viewingCategory?.name },
                    { label: "Type", value: viewingCategory?.type },
                    { label: "Diet Scope", value: viewingCategory?.foodTypeScope || "Both" },
                    {
                      label: "Approval Status",
                      value: String(viewingCategory?.approvalStatus || "pending"),
                    },
                    {
                      label: "Visibility",
                      value: viewingCategory?.isActive !== false ? "Active" : "Inactive",
                    },
                    { label: "Items Linked", value: String(viewingCategory?.itemCount ?? 0) },
                    { label: "Sort Order", value: String(viewingCategory?.sortOrder ?? 0) },
                    { label: "Owner", value: viewingCategory?.isGlobal ? "Admin (global)" : "This restaurant" },
                    { label: "Rejection Reason", value: viewingCategory?.rejectionReason },
                  ].map((row) => {
                    const value = String(row.value ?? "").trim()
                    return (
                      <div key={row.label} className="flex flex-col gap-0.5">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          {row.label}
                        </dt>
                        <dd className={`text-sm font-medium capitalize ${value ? "text-slate-800" : "text-slate-400 italic"}`}>
                          {value || "Not set"}
                        </dd>
                      </div>
                    )
                  })}
                </dl>

                <div className="mt-5 flex gap-3 pb-2">
                  <button
                    type="button"
                    onClick={closeViewModal}
                    className="flex-1 rounded-xl border border-slate-300 py-3 font-medium text-slate-700"
                  >
                    Close
                  </button>
                  {viewingCategory?.canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = viewingCategory
                        closeViewModal()
                        openEditModal(target)
                      }}
                      className="flex-1 rounded-xl bg-blue-600 py-3 font-medium text-white"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetModal}
              className="fixed inset-0 z-50 bg-black/50"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              {...categorySheetProps}
              className="fixed bottom-0 left-0 right-0 z-50 max-h-[90vh] overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {editingCategory ? "Edit Category" : "Create Category"}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {editingCategory
                      ? "Any edit sends this category back for admin approval."
                      : "Choose the diet scope carefully before sending it for approval."}
                  </p>
                </div>
                <button onClick={resetModal}>
                  <X className="h-5 w-5 text-slate-600" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Category Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter category name"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#2E7D52]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Diet Scope</label>
                  {restaurantFoodType === "Veg" ? (
                    <div className="w-full rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                      Veg (Veg restaurant)
                    </div>
                  ) : restaurantFoodType === "Non-Veg" ? (
                    <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                      Non-Veg (Non-veg restaurant)
                    </div>
                  ) : (
                    <select
                      value={formData.foodTypeScope}
                      onChange={(e) => setFormData((prev) => ({ ...prev, foodTypeScope: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#2E7D52]"
                    >
                      <option value="Veg">Veg</option>
                      <option value="Non-Veg">Non-Veg</option>
                      <option value="Both">Both (Mixed)</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Optional Type Label</label>
                  <input
                    type="text"
                    value={formData.type}
                    onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value }))}
                    placeholder="Examples: Starters, Desserts, Drinks"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#2E7D52]"
                  />
                </div>

                <div className="flex items-center gap-3">
                  {(imagePreview || formData.image) && (
                    <img
                      src={imagePreview || formData.image}
                      alt="Category preview"
                      className="h-16 w-16 rounded-2xl object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={handleImageClick}
                    className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
                  >
                    <Upload className="h-4 w-4" />
                    Upload Image
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(e) => handleImageFileChange(e.target.files?.[0])}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={() => setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))}
                  />
                  Keep category on (dishes visible to customers)
                </label>
              </div>

              <div className="mt-6 flex gap-3">
                <button onClick={resetModal} className="flex-1 rounded-xl border border-slate-300 py-3 font-medium text-slate-700">
                  Cancel
                </button>
                <button
                  onClick={handleSaveCategory}
                  disabled={uploadingImage}
                  className="flex-1 rounded-xl bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] py-3 font-medium text-white disabled:opacity-60"
                >
                  {uploadingImage ? "Uploading..." : editingCategory ? "Save & Resubmit" : "Create"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handleImageFileChange}
        title="Category Image"
        description="Choose how to upload your category image"
        fileNamePrefix="category-photo"
        galleryInputRef={fileInputRef}
      />
    </div>
  )
}








