import { useState, useEffect, useMemo } from "react"
import { Save, Loader2, DollarSign, Plus, Trash2, Edit, Check, X } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const emptyFeeSettings = () => ({
  deliveryFee: "",
  deliveryFeeRanges: [],
  freeDeliveryUpTo: "",
  platformFee: "",
  packagingFee: "",
  gstRate: "",
})

const normalizeFeeSettings = (settings) => ({
  deliveryFee: settings?.deliveryFee === "" || settings?.deliveryFee == null ? "" : Number(settings.deliveryFee),
  freeDeliveryUpTo: settings?.freeDeliveryUpTo === "" || settings?.freeDeliveryUpTo == null ? "" : Number(settings.freeDeliveryUpTo),
  platformFee: settings?.platformFee === "" || settings?.platformFee == null ? "" : Number(settings.platformFee),
  packagingFee: settings?.packagingFee === "" || settings?.packagingFee == null ? "" : Number(settings.packagingFee),
  gstRate: settings?.gstRate === "" || settings?.gstRate == null ? "" : Number(settings.gstRate),
  deliveryFeeRanges: Array.isArray(settings?.deliveryFeeRanges)
    ? settings.deliveryFeeRanges
        .map((r) => ({
          min: Number(r.min),
          max: Number(r.max),
          fee: Number(r.fee),
        }))
        .sort((a, b) => a.min - b.min)
    : [],
})

const feeSettingsEqual = (a, b) =>
  JSON.stringify(normalizeFeeSettings(a)) === JSON.stringify(normalizeFeeSettings(b))

// Fee Settings Component - Range-based delivery fee configuration
export default function FeeSettings() {
  const { canCreate, canEdit, canDelete } = useAdminPermissions()
  const [feeSettings, setFeeSettings] = useState(emptyFeeSettings)
  const [savedFeeSettings, setSavedFeeSettings] = useState(emptyFeeSettings)
  const [zones, setZones] = useState([])
  const [selectedZoneId, setSelectedZoneId] = useState("")
  const [zonesLoading, setZonesLoading] = useState(true)
  const [loadingFeeSettings, setLoadingFeeSettings] = useState(false)
  const [savingFeeSettings, setSavingFeeSettings] = useState(false)
  const [editingRangeIndex, setEditingRangeIndex] = useState(null)
  const [newRange, setNewRange] = useState({ min: '', max: '', fee: '' })

  const isDirty = useMemo(
    () => !feeSettingsEqual(feeSettings, savedFeeSettings),
    [feeSettings, savedFeeSettings]
  )

  // Fetch fee settings for selected zone
  const fetchFeeSettings = async (zoneId) => {
    if (!zoneId) {
      const empty = emptyFeeSettings()
      setFeeSettings(empty)
      setSavedFeeSettings(empty)
      return
    }
    try {
      setLoadingFeeSettings(true)
      const response = await adminAPI.getFeeSettings({ zoneId })
      if (response.data.success && response.data.data.feeSettings) {
        const next = {
          deliveryFee: response.data.data.feeSettings.deliveryFee ?? "",
          deliveryFeeRanges: response.data.data.feeSettings.deliveryFeeRanges || [],
          freeDeliveryUpTo: response.data.data.feeSettings.freeDeliveryUpTo ?? "",
          platformFee: response.data.data.feeSettings.platformFee ?? "",
          packagingFee: response.data.data.feeSettings.packagingFee ?? "",
          gstRate: response.data.data.feeSettings.gstRate ?? "",
        }
        setFeeSettings(next)
        setSavedFeeSettings(next)
      } else if (response.data.success && response.data.data.feeSettings === null) {
        // Not configured yet - keep empty fields (no defaults).
        const empty = emptyFeeSettings()
        setFeeSettings(empty)
        setSavedFeeSettings(empty)
      }
    } catch (error) {
      debugError('Error fetching fee settings:', error)
      toast.error('Failed to load fee settings')
    } finally {
      setLoadingFeeSettings(false)
    }
  }

  useEffect(() => {
    const fetchZones = async () => {
      try {
        setZonesLoading(true)
        const res = await adminAPI.getZones({ limit: 1000 })
        const zoneData = res?.data?.data
        const list = Array.isArray(zoneData?.zones)
          ? zoneData.zones
          : Array.isArray(zoneData)
            ? zoneData
            : []
        setZones(list)
        if (list.length > 0) {
          setSelectedZoneId(String(list[0]._id || list[0].id))
        }
      } catch (error) {
        debugError("Error fetching zones:", error)
        toast.error("Failed to load zones")
        setZones([])
      } finally {
        setZonesLoading(false)
      }
    }
    fetchZones()
  }, [])

  useEffect(() => {
    if (!selectedZoneId) return
    fetchFeeSettings(selectedZoneId)
    setEditingRangeIndex(null)
    setNewRange({ min: '', max: '', fee: '' })
  }, [selectedZoneId])

  // Save fee settings
  const handleSaveFeeSettings = async () => {
    if (!selectedZoneId) {
      toast.error('Please select a zone first')
      return
    }
    if (!isDirty) return
    try {
      setSavingFeeSettings(true)
      const response = await adminAPI.createOrUpdateFeeSettings({
        zoneId: selectedZoneId,
        deliveryFee: feeSettings.deliveryFee === "" ? undefined : Number(feeSettings.deliveryFee),
        deliveryFeeRanges: feeSettings.deliveryFeeRanges,
        freeDeliveryUpTo: feeSettings.freeDeliveryUpTo === "" ? undefined : Number(feeSettings.freeDeliveryUpTo),
        platformFee: feeSettings.platformFee === "" ? undefined : Number(feeSettings.platformFee),
        packagingFee: feeSettings.packagingFee === "" ? undefined : Number(feeSettings.packagingFee),
        gstRate: feeSettings.gstRate === "" ? undefined : Number(feeSettings.gstRate),
        isActive: true,
      })

      if (response.data.success) {
        toast.success('Fee settings saved successfully')
        // Avoid an extra API call; update local state from response
        const saved = response?.data?.data?.feeSettings
        if (saved) {
          const next = {
            deliveryFee: saved.deliveryFee ?? "",
            deliveryFeeRanges: saved.deliveryFeeRanges ?? [],
            freeDeliveryUpTo: saved.freeDeliveryUpTo ?? "",
            platformFee: saved.platformFee ?? "",
            packagingFee: saved.packagingFee ?? "",
            gstRate: saved.gstRate ?? "",
          }
          setFeeSettings(next)
          setSavedFeeSettings(next)
        } else {
          setSavedFeeSettings(feeSettings)
        }
      } else {
        toast.error(response.data.message || 'Failed to save fee settings')
      }
    } catch (error) {
      debugError('Error saving fee settings:', error)
      toast.error(error.response?.data?.message || 'Failed to save fee settings')
    } finally {
      setSavingFeeSettings(false)
    }
  }

  // Add new delivery fee range
  const handleAddRange = () => {
    if (newRange.min === '' || newRange.max === '' || newRange.fee === '') {
      toast.error('Please fill all fields (Min, Max, Fee)')
      return
    }

    const min = Number(newRange.min)
    const max = Number(newRange.max)
    const fee = Number(newRange.fee)

    if (min < 0 || max < 0 || fee < 0) {
      toast.error('All values must be positive numbers')
      return
    }

    if (min >= max) {
      toast.error('Min value must be less than Max value')
      return
    }

    // Check for overlapping ranges
    const ranges = [...feeSettings.deliveryFeeRanges]
    for (const range of ranges) {
      if ((min >= range.min && min < range.max) || (max > range.min && max <= range.max) || (min <= range.min && max >= range.max)) {
        toast.error('This range overlaps with an existing range')
        return
      }
    }

    setFeeSettings({
      ...feeSettings,
      deliveryFeeRanges: [...ranges, { min, max, fee }].sort((a, b) => a.min - b.min)
    })
    setNewRange({ min: '', max: '', fee: '' })
    toast.success('Range added successfully')
  }

  // Delete delivery fee range
  const handleDeleteRange = (index) => {
    const newRanges = feeSettings.deliveryFeeRanges.filter((_, i) => i !== index)
    setFeeSettings({
      ...feeSettings,
      deliveryFeeRanges: newRanges
    })
    toast.success('Range deleted successfully')
  }

  // Edit delivery fee range
  const handleEditRange = (index) => {
    const range = feeSettings.deliveryFeeRanges[index]
    setNewRange({ min: range.min, max: range.max, fee: range.fee })
    setEditingRangeIndex(index)
  }

  // Save edited range
  const handleSaveEditRange = () => {
    if (newRange.min === '' || newRange.max === '' || newRange.fee === '') {
      toast.error('Please fill all fields')
      return
    }

    const min = Number(newRange.min)
    const max = Number(newRange.max)
    const fee = Number(newRange.fee)

    if (min < 0 || max < 0 || fee < 0) {
      toast.error('All values must be positive numbers')
      return
    }

    if (min >= max) {
      toast.error('Min value must be less than Max value')
      return
    }

    const ranges = [...feeSettings.deliveryFeeRanges]
    // Remove the range being edited
    ranges.splice(editingRangeIndex, 1)

    // Check for overlapping ranges
    for (const range of ranges) {
      if ((min >= range.min && min < range.max) || (max > range.min && max <= range.max) || (min <= range.min && max >= range.max)) {
        toast.error('This range overlaps with an existing range')
        return
      }
    }

    // Add updated range
    ranges.push({ min, max, fee })
    ranges.sort((a, b) => a.min - b.min)

    setFeeSettings({
      ...feeSettings,
      deliveryFeeRanges: ranges
    })
    setNewRange({ min: '', max: '', fee: '' })
    setEditingRangeIndex(null)
    toast.success('Range updated successfully')
  }

  // Cancel edit
  const handleCancelEdit = () => {
    setNewRange({ min: '', max: '', fee: '' })
    setEditingRangeIndex(null)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      {/* Header Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Delivery & Platform Fee</h1>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="fee-zone-select" className="text-sm font-medium text-slate-700 whitespace-nowrap">
              Zone:
            </label>
            <select
              id="fee-zone-select"
              value={selectedZoneId}
              onChange={(e) => setSelectedZoneId(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm min-w-[10rem]"
              disabled={zonesLoading || zones.length === 0}
            >
              {zones.length === 0 ? (
                <option value="">No zones</option>
              ) : (
                zones.map((zone) => (
                  <option key={zone._id || zone.id} value={zone._id || zone.id}>
                    {zone.name || zone.zoneName || "Unnamed Zone"}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Configure delivery fee, platform fee, and GST settings for the selected zone
        </p>
      </div>

      {/* Fee Settings Panel */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Fee Configuration</h2>
              <p className="text-sm text-slate-500 mt-1">
                Set the fees and charges that will be applied to orders in this zone
              </p>
            </div>
            {canEdit && (
              <Button
                onClick={handleSaveFeeSettings}
                disabled={savingFeeSettings || loadingFeeSettings || !selectedZoneId || !isDirty}
                className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingFeeSettings ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Settings
                  </>
                )}
              </Button>
            )}
          </div>

          {loadingFeeSettings ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : (
            <>
              {/* Delivery Fee Ranges Section */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Delivery Fee by Distance Range (km)</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Set delivery fees based on distance slabs
                    </p>
                  </div>
                </div>

                {/* Ranges Table */}
                {feeSettings.deliveryFeeRanges.length > 0 && (
                  <div className="mb-4 overflow-x-auto">
                    <table className="w-full border border-slate-200 rounded-lg">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 border-b border-slate-200">Min (km)</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 border-b border-slate-200">Max (km)</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 border-b border-slate-200">Delivery Fee (₹)</th>
                          <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700 border-b border-slate-200">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feeSettings.deliveryFeeRanges
                          .map((range, originalIndex) => ({ range, originalIndex }))
                          .sort((a, b) => a.range.min - b.range.min)
                          .map(({ range, originalIndex }) => {
                            const isEditing = editingRangeIndex === originalIndex;
                            return (
                              <tr key={originalIndex} className={`${isEditing ? 'bg-blue-50' : 'hover:bg-slate-50'} transition-colors`}>
                                <td className="px-4 py-3 text-sm text-slate-900 border-b border-slate-100">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      value={newRange.min}
                                      onChange={(e) => setNewRange({ ...newRange, min: e.target.value })}
                                      className="w-24 px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                  ) : (
                                    <>{range.min} km</>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-900 border-b border-slate-100">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      value={newRange.max}
                                      onChange={(e) => setNewRange({ ...newRange, max: e.target.value })}
                                      className="w-24 px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                  ) : (
                                    <>{range.max} km</>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm font-medium text-green-600 border-b border-slate-100">
                                  {isEditing ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-slate-400">₹</span>
                                      <input
                                        type="number"
                                        value={newRange.fee}
                                        onChange={(e) => setNewRange({ ...newRange, fee: e.target.value })}
                                        className="w-24 px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-green-600 font-medium"
                                      />
                                    </div>
                                  ) : (
                                    <>₹{range.fee}</>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center border-b border-slate-100">
                                  <div className="flex items-center justify-center gap-2">
                                    {isEditing ? (
                                      <>
                                        <button
                                          onClick={handleSaveEditRange}
                                          className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors"
                                          title="Save"
                                        >
                                          <Check className="w-4 h-4" />
                                        </button>
                                        <button
                                          onClick={handleCancelEdit}
                                          className="p-1.5 text-red-600 hover:bg-red-100 rounded transition-colors"
                                          title="Cancel"
                                        >
                                          <X className="w-4 h-4" />
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        {canEdit && (
                                          <button
                                            onClick={() => handleEditRange(originalIndex)}
                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                            title="Edit"
                                          >
                                            <Edit className="w-4 h-4" />
                                          </button>
                                        )}
                                        {canDelete && (
                                          <button
                                            onClick={() => handleDeleteRange(originalIndex)}
                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Delete"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Add New Range Form - Only show when NOT editing */}
                {editingRangeIndex === null && (canCreate || canEdit) && (
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2 mb-3">
                      <Plus className="w-4 h-4 text-green-600" />
                      <h4 className="text-sm font-semibold text-slate-700">Add Distance Range</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Min Distance (km)</label>
                        <input
                          type="number"
                          value={newRange.min}
                          onChange={(e) => setNewRange({ ...newRange, min: e.target.value })}
                          min="0"
                          step="1"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Max Distance (km)</label>
                        <input
                          type="number"
                          value={newRange.max}
                          onChange={(e) => setNewRange({ ...newRange, max: e.target.value })}
                          min="0"
                          step="1"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                          placeholder="5"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Delivery Fee (₹)</label>
                        <input
                          type="number"
                          value={newRange.fee}
                          onChange={(e) => setNewRange({ ...newRange, fee: e.target.value })}
                          min="0"
                          step="1"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                          placeholder="50"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          onClick={handleAddRange}
                          className="bg-green-600 hover:bg-green-700 text-white text-sm w-full flex items-center justify-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Add Range
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 italic">
                      Example: Orders between 0 km and 5 km will have ₹50 delivery fee.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-slate-200 pt-6 mt-6">

                {/* Free Delivery Up To */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Free Delivery Up To (₹)
                  </label>
                  <input
                    type="number"
                    value={feeSettings.freeDeliveryUpTo}
                    onChange={(e) => setFeeSettings({ ...feeSettings, freeDeliveryUpTo: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="500"
                  />
                  <p className="text-xs text-slate-500">
                    Orders at or above this amount get free delivery
                  </p>
                </div>

                {/* Default Delivery Fee (Fallback) */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Default Delivery Fee (₹) <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="number"
                    value={feeSettings.deliveryFee}
                    onChange={(e) => setFeeSettings({ ...feeSettings, deliveryFee: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="Leave empty to disable fallback"
                  />
                  <p className="text-xs text-slate-500">
                    Used only when no delivery fee range matches and free delivery threshold is not met
                  </p>
                </div>

                {/* Platform Fee */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Platform Fee (₹)
                  </label>
                  <input
                    type="number"
                    value={feeSettings.platformFee}
                    onChange={(e) => setFeeSettings({ ...feeSettings, platformFee: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="5"
                  />
                  <p className="text-xs text-slate-500">
                    Platform service fee per order
                  </p>
                </div>
                {/* Packaging Fee */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Packaging Charges Fee (₹)
                  </label>
                  <input
                    type="number"
                    value={feeSettings.packagingFee}
                    onChange={(e) => setFeeSettings({ ...feeSettings, packagingFee: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="10"
                  />
                  <p className="text-xs text-slate-500">
                    Packaging charges fee per order
                  </p>
                </div>

                {/* GST Rate */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    value={feeSettings.gstRate}
                    onChange={(e) => setFeeSettings({ ...feeSettings, gstRate: e.target.value })}
                    min="0"
                    max="100"
                    step="0.1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="5"
                  />
                  <p className="text-xs text-slate-500">
                    GST percentage applied on order subtotal
                  </p>
                </div>
              </div>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
