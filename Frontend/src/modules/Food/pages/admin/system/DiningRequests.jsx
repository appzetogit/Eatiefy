import { useState, useEffect } from "react"
import { CheckCircle, XCircle, Clock, UtensilsCrossed, Loader2, AlertCircle, CheckCircle2, ChevronRight, User, MapPin } from "lucide-react"
import { adminAPI } from "@food/api"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import { toast } from "sonner"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

const debugError = (...args) => {}

export default function DiningRequests() {
    const { canEdit } = useAdminPermissions()
    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(true)
    const [processingId, setProcessingId] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        fetchRequests()
    }, [])

    const fetchRequests = async () => {
        try {
            setLoading(true)
            const response = await adminAPI.getDiningRequests()
            if (response.data.success) {
                const data = response.data.data
                const list = Array.isArray(data?.requests)
                  ? data.requests
                  : Array.isArray(data)
                    ? data
                    : []
                setRequests(list)
            }
        } catch (err) {
            debugError("Error fetching dining requests:", err)
            setError("Failed to load requests")
        } finally {
            setLoading(false)
        }
    }

    const handleApprove = async (requestId) => {
        if (!window.confirm("Approve this dining settings update?")) return
        try {
            setProcessingId(requestId)
            const response = await adminAPI.approveDiningRequest(requestId)
            if (response.data.success) {
                toast.success("Request approved successfully")
                setRequests(requests.filter(r => r._id !== requestId))
            }
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to approve request")
        } finally {
            setProcessingId(null)
        }
    }

    const handleReject = async (requestId) => {
        const reason = window.prompt("Enter rejection reason (optional):")
        if (reason === null) return // Cancelled prompt
        
        try {
            setProcessingId(requestId)
            const response = await adminAPI.rejectDiningRequest(requestId, reason)
            if (response.data.success) {
                toast.success("Request rejected")
                setRequests(requests.filter(r => r._id !== requestId))
            }
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to reject request")
        } finally {
            setProcessingId(null)
        }
    }

    return (
        <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-plum-600 flex items-center justify-center">
                            <UtensilsCrossed className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Dining Category Requests</h1>
                            <p className="text-sm text-slate-600 mt-1">Review and approve restaurant dining setting updates</p>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center gap-2 max-w-2xl">
                        <AlertCircle className="w-5 h-5" />
                        {error}
                        <Button variant="link" onClick={fetchRequests} className="text-red-800 font-bold p-0 ml-auto">Retry</Button>
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col items-center justify-center p-20 bg-white rounded-xl border border-dashed border-slate-300">
                        <Loader2 className="w-10 h-10 animate-spin text-plum-600 mb-4" />
                        <p className="text-slate-500 font-medium">Loading pending requests...</p>
                    </div>
                ) : requests.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-20 bg-white rounded-xl border border-dashed border-slate-300">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                            <CheckCircle2 className="w-8 h-8 text-slate-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">No Pending Requests</h3>
                        <p className="text-slate-500 text-center max-w-xs mt-1">All dining settings updates have been processed.</p>
                    </div>
                ) : (
                    <div className="grid gap-6">
                        {requests.map((request) => (
                            <div key={request._id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="p-6">
                                    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                                        <div className="flex items-center gap-4">
                                            {request.restaurant?.profileImage?.url ? (
                                                <img 
                                                    src={request.restaurant.profileImage.url} 
                                                    alt={request.restaurant.name} 
                                                    className="w-14 h-14 rounded-lg object-cover border border-slate-100" 
                                                />
                                            ) : (
                                                <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center border border-slate-100">
                                                    <UtensilsCrossed className="w-6 h-6 text-slate-400" />
                                                </div>
                                            )}
                                            <div>
                                                <h3 className="text-lg font-bold text-slate-900">{request.restaurant?.name || "Unknown Restaurant"}</h3>
                                                <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {request.restaurant?.address || "No address provided"}
                                                </div>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1.5 py-1 px-3">
                                            <Clock className="w-3.5 h-3.5" />
                                            Pending
                                        </Badge>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 rounded-xl bg-slate-50 border border-slate-100">
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Dining Status</p>
                                            <p className="font-semibold text-slate-900 flex items-center gap-2">
                                                {request.requestedSettings?.isEnabled ? (
                                                    <><CheckCircle2 className="w-4 h-4 text-green-500" /> Enabled</>
                                                ) : (
                                                    <><XCircle className="w-4 h-4 text-slate-400" /> Disabled</>
                                                )}
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Requested Category</p>
                                            <p className="font-semibold text-slate-900">
                                                {(() => {
                                                    const raw = request.requestedSettings?.diningType
                                                    if (!raw) return "Not specified"
                                                    // Handle array or string by converting to string and splitting everything
                                                    const allSlugs = String(raw).split(",").map(s => s.trim())
                                                    return [...new Set(allSlugs)].filter(Boolean).join(", ")
                                                })()}
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Max Guests Limit</p>
                                            <p className="font-semibold text-slate-900">{request.requestedSettings?.maxGuests || "No limit"} Guests</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-100">
                                        <div className="text-sm text-slate-500 italic">
                                            Requested on: {new Date(request.createdAt).toLocaleString()}
                                        </div>
                                        {canEdit && (
                                            <div className="flex items-center gap-3">
                                                <Button 
                                                    variant="outline" 
                                                    onClick={() => handleReject(request._id)}
                                                    disabled={processingId === request._id}
                                                    className="border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all font-semibold"
                                                >
                                                    {processingId === request._id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reject"}
                                                </Button>
                                                <Button 
                                                    onClick={() => handleApprove(request._id)}
                                                    disabled={processingId === request._id}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 shadow-sm shadow-emerald-200 transition-all"
                                                >
                                                    {processingId === request._id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Approve Changes"}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
