import { Link, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { ArrowLeft, ArrowRight, Heart, Users, Shield, Clock, Star, Award, FileText, Lock, Loader2, Receipt, Truck, XCircle } from "lucide-react"
import { motion } from "framer-motion"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { Card, CardContent } from "@food/components/ui/card"
import eatiefyLogo from "@food/assets/logo.png"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


// Icon mapping
const iconMap = {
  Heart,
  Users,
  Shield,
  Clock,
  Star,
  Award
}

export default function About() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [logoUrl, setLogoUrl] = useState(null)
  const [aboutData, setAboutData] = useState({
    appName: '',
    version: '',
    description: '',
    logo: '',
    features: [],
    stats: []
  })

  useEffect(() => {
    fetchAboutData()
    loadLogo()

    // Listen for business settings updates
    const handleSettingsUpdate = () => {
      const cached = getCachedSettings()
      if (cached?.logo?.url) {
        setLogoUrl(cached.logo.url)
      }
    }
    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)
    return () => window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
  }, [])

  const loadLogo = async () => {
    const cached = getCachedSettings()
    if (cached?.logo?.url) {
      setLogoUrl(cached.logo.url)
    } else {
      const settings = await loadBusinessSettings()
      if (settings?.logo?.url) {
        setLogoUrl(settings.logo.url)
      }
    }
  }

  const fetchAboutData = async () => {
    try {
      setLoading(true)
      const response = await api.get(API_ENDPOINTS.ADMIN.ABOUT_PUBLIC)
      if (response.data.success) {
        setAboutData(response.data.data || {})
      }
    } catch (error) {
      debugError('Error fetching about data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-[#141414] dark:to-[#242424]">
        <div className="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8 flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading...</p>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-[#141414] dark:to-[#242424]">
      <div className="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
        {/* Header */}
        <div className="flex items-center mb-6 md:mb-8">
          <div
            onClick={() => navigate(-1)}
            className="h-10 w-10 md:h-11 md:w-11 flex items-center justify-center bg-white dark:bg-[#242424] rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_15px_rgba(0,0,0,0.08)] active:scale-95 transition-all cursor-pointer border border-slate-100 dark:border-gray-800"
          >
            <ArrowLeft className="h-5 w-5 text-slate-800 dark:text-white" />
          </div>
          <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white ml-4">About</h1>
        </div>

        {/* App Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="bg-gradient-to-br from-blue-50/60 to-white/40 dark:from-blue-900/20 dark:to-[#242424]/40 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_rgba(59,130,246,0.08)] border border-blue-100/50 dark:border-blue-900/30 mb-6 md:mb-8 overflow-hidden">
            <div className="p-8 md:p-10 text-center relative">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="flex justify-center mb-6"
              >
                <div className="relative">
                  <div className="relative bg-white dark:bg-gray-800 rounded-full p-4 md:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                    <img
                      src={aboutData.logo || logoUrl || eatiefyLogo}
                      alt={`${aboutData.appName || companyName || 'Eatiefy'} Logo`}
                      className="h-16 w-16 md:h-20 md:w-20 object-contain rounded-full"
                      onError={(e) => {
                        e.currentTarget.onerror = null
                        if (eatiefyLogo && e.currentTarget.src !== eatiefyLogo) {
                          e.currentTarget.src = eatiefyLogo
                        } else {
                          e.currentTarget.style.display = 'none'
                        }
                      }}
                    />
                  </div>
                </div>
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-2"
              >
                Eatiefy
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="text-gray-600 dark:text-gray-400 text-sm md:text-base font-medium mb-1"
              >
                Food & Takeaway
              </motion.p>
              
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="text-gray-500 dark:text-gray-500 text-xs md:text-sm mb-4"
              >
                {aboutData.version ? `Version ${aboutData.version}` : " "}
              </motion.p>

              {aboutData.description ? (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.5 }}
                  className="text-gray-700 dark:text-gray-300 leading-relaxed text-base md:text-lg max-w-2xl mx-auto"
                >
                  {aboutData.description}
                </motion.p>
              ) : null}
            </div>
          </Card>
        </motion.div>



        {/* Legal Links */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.5 }}
        >
          <Card className="bg-white dark:bg-[#242424] rounded-xl shadow-md border-0 dark:border-gray-800">
            <CardContent className="p-5 md:p-6">
              <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                Legal Information
              </h3>
              <div className="space-y-3">
                <Link
                  to="/user/profile/terms"
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                >
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors">
                    <FileText className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-medium text-gray-900 dark:text-white group-hover:text-[#1F6B45] dark:group-hover:text-[#1F6B45] transition-colors">
                      Terms and Conditions
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Read our terms and conditions
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-[#1F6B45] transition-colors" />
                </Link>

                <Link
                  to="/user/profile/privacy"
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                >
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors">
                    <Lock className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-medium text-gray-900 dark:text-white group-hover:text-[#1F6B45] dark:group-hover:text-[#1F6B45] transition-colors">
                      Privacy Policy
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Learn how we protect your data
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-[#1F6B45] transition-colors" />
                </Link>

                <Link
                  to="/user/profile/refund"
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                >
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors">
                    <Receipt className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-medium text-gray-900 dark:text-white group-hover:text-[#1F6B45] dark:group-hover:text-[#1F6B45] transition-colors">
                      Refund Policy
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Read our refund terms and conditions
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-[#1F6B45] transition-colors" />
                </Link>

                <Link
                  to="/user/profile/shipping"
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                >
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors">
                    <Truck className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-medium text-gray-900 dark:text-white group-hover:text-[#1F6B45] dark:group-hover:text-[#1F6B45] transition-colors">
                      Shipping Policy
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Learn about our shipping terms
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-[#1F6B45] transition-colors" />
                </Link>

                <Link
                  to="/user/profile/cancellation"
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                >
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors">
                    <XCircle className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-medium text-gray-900 dark:text-white group-hover:text-[#1F6B45] dark:group-hover:text-[#1F6B45] transition-colors">
                      Cancellation Policy
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Read our cancellation terms
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-[#1F6B45] transition-colors" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Footer Note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.5 }}
          className="text-center mt-8 mb-4"
        >
          <p className="text-sm text-gray-500 dark:text-gray-500">
            &copy; {new Date().getFullYear()} {companyName || 'Eatiefy'}. All rights reserved.
          </p>
        </motion.div>
      </div>
    </AnimatedPage>
  )
}


