import React, { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Star, CheckCircle2, MessageSquare, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { userAPI, deliveryAPI, adminAPI } from "@food/api"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"

export default function FeedbackBottomSheet({
  isOpen,
  onClose,
  module = "user",
  title = "How was your experience?",
  subtitle,
  onSuccess
}) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // Prevent background scrolling completely while open (desktop + mobile iOS/Android safe)
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY
      const prevOverflow = document.body.style.overflow
      const prevPosition = document.body.style.position
      const prevTop = document.body.style.top
      const prevWidth = document.body.style.width

      document.body.style.overflow = "hidden"
      document.body.style.position = "fixed"
      document.body.style.top = `-${scrollY}px`
      document.body.style.width = "100%"

      return () => {
        document.body.style.overflow = prevOverflow
        document.body.style.position = prevPosition
        document.body.style.top = prevTop
        document.body.style.width = prevWidth
        window.scrollTo(0, scrollY)
      }
    }
  }, [isOpen])

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setRating(5)
      setComment("")
      setIsSuccess(false)
      setSubmitting(false)
    }
  }, [isOpen])

  const ratingOptions = [
    { value: 1, label: "Very Bad", color: "text-red-500", bg: "bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800" },
    { value: 2, label: "Bad", color: "text-orange-500", bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-800" },
    { value: 3, label: "Average", color: "text-yellow-500", bg: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/40 dark:border-yellow-800" },
    { value: 4, label: "Good", color: "text-blue-500", bg: "bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800" },
    { value: 5, label: "Very Good", color: "text-emerald-500", bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800" },
  ]

  const handleSubmit = async () => {
    if (!rating) {
      toast.error("Please select a rating")
      return
    }

    try {
      setSubmitting(true)
      const payload = {
        rating,
        comment: comment.trim() || `User rated ${rating}/5 overall experience`,
        module
      }

      let res
      if (module === "delivery") {
        res = await deliveryAPI.submitFeedbackExperience(payload)
      } else if (module === "user") {
        res = await userAPI.submitFeedbackExperience(payload)
      } else {
        res = await api.post(API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE_CREATE, payload)
      }

      if (res?.data?.success) {
        setIsSuccess(true)
        if (onSuccess) onSuccess()
        setTimeout(() => {
          onClose()
        }, 1500)
      } else {
        throw new Error(res?.data?.message || "Failed to submit feedback")
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Failed to submit feedback")
    } finally {
      setSubmitting(false)
    }
  }

  const defaultSubtitle =
    module === "delivery"
      ? "Tell us about your delivery partner app experience. We value your feedback."
      : "Your thoughts help us improve the overall experience for everyone."

  const content = (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
          />

          {/* Bottom Sheet Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="relative z-10 w-full sm:max-w-md bg-white dark:bg-[#1a1a1a] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col border-t border-slate-200 dark:border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Pull Bar Handle */}
            <div className="pt-3 pb-1 flex justify-center">
              <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-zinc-700" />
            </div>

            {/* Header */}
            <div className="px-6 pt-2 pb-3 flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 pb-8 sm:pb-6 overflow-y-auto space-y-6">
              {isSuccess ? (
                <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center animate-bounce">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                    Thank You for Your Feedback!
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-xs">
                    Your response has been saved. We use your insights to continually improve the app.
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-center space-y-1">
                    <p className="text-xs text-slate-500 dark:text-zinc-400">
                      {subtitle || defaultSubtitle}
                    </p>
                  </div>

                  {/* Star Rating Controls */}
                  <div className="flex items-center justify-center gap-2 py-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="p-1 focus:outline-none transition-transform hover:scale-125 active:scale-95"
                      >
                        <Star
                          className={`w-9 h-9 transition-colors ${
                            star <= rating
                              ? "fill-amber-400 text-amber-400 drop-shadow-sm"
                              : "text-slate-200 dark:text-zinc-700"
                          }`}
                        />
                      </button>
                    ))}
                  </div>

                  {/* Sentiment Pill */}
                  <div className="flex justify-center">
                    {ratingOptions.map(
                      (opt) =>
                        rating === opt.value && (
                          <span
                            key={opt.value}
                            className={`text-xs font-bold px-3.5 py-1 rounded-full border transition-all ${opt.bg} ${opt.color}`}
                          >
                            {opt.label} ({opt.value}/5)
                          </span>
                        )
                    )}
                  </div>

                  {/* Comment Box */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider">
                      Feedback or suggestions (optional)
                    </label>
                    <textarea
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Share what worked well or what we can improve..."
                      className="w-full text-sm rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-white p-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white dark:focus:bg-zinc-800 transition-all resize-none placeholder:text-slate-400"
                    />
                  </div>

                  {/* Action Button */}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleSubmit}
                    className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-sm transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      "Submit Feedback"
                    )}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  if (typeof document !== "undefined") {
    return createPortal(content, document.body)
  }

  return content
}
