import React, { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence, useScroll, useTransform, useSpring } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { useCompanyLogo } from "@food/hooks/useCompanyLogo"
import { loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import {
  Clock,
  MapPin,
  CheckCircle2,
  Star,
  ArrowRight,
  Menu,
  X,
  ShieldCheck,
  UtensilsCrossed,
  Smartphone,
  Download,
  Facebook,
  Twitter,
  Instagram,
  Linkedin,
  ChevronDown,
  Store,
  ShoppingBag,
  Rocket,
  Award,
  Navigation
} from "lucide-react"

const AppleIcon = ({ className }) => (
  <svg viewBox="0 0 384 512" fill="currentColor" className={className} aria-hidden="true">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5c0 25.7 4.7 52.3 14.1 79.7 12.4 36.7 57.2 126.7 103.9 125.2 24.6-.6 42-17.5 74-17.5 31 0 47.1 17.5 74.4 17.5 47.1-.7 87.6-82.9 99.4-119.7-63.2-29.8-50.9-87.5-51.1-90zM256.8 88.3c26.9-32 24.5-61.1 23.7-71.6-23.8 1.4-51.4 16.4-67.2 34.8-17.4 19.6-27.6 44-25.4 70.6 25.2 2 48.4-10.2 68.9-33.8z"/>
  </svg>
)

// Customer app store listings (hero, download section and footer).
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.eatiefy.user"
const APP_STORE_URL = "https://apps.apple.com/in/app/eatiefy/id6804955136"

const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "Restaurants", href: "#restaurants" },
  { label: "Features", href: "#features" },
  { label: "About", href: "#about" },
  { label: "Contact", href: "#contact" }
]

const WHY_CARDS = [
  {
    icon: Clock,
    title: "Skip Waiting",
    description: "Reserve tables instantly and walk in like a VIP. No more waiting in long queues."
  },
  {
    icon: UtensilsCrossed,
    title: "Fast Takeaway",
    description: "Order ahead, skip the line, and pick up your food fresh and hot without waiting."
  },
  {
    icon: ShieldCheck,
    title: "Verified Restaurants",
    description: "We partner only with premium, highly-rated restaurants to ensure a quality experience."
  }
]

const STEPS = [
  { title: "Browse Restaurants", description: "Discover premium dining spots near you.", icon: MapPin },
  { title: "Reserve / Order", description: "Book a table or schedule a takeaway.", icon: UtensilsCrossed },
  { title: "Reach Restaurant", description: "Arrive at your scheduled time.", icon: Clock },
  { title: "Enjoy Your Meal", description: "Dine in or pick up effortlessly.", icon: Star }
]

const FEATURED_RESTAURANTS = [
  {
    name: "The Grand Pavilion",
    image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=800",
    rating: 4.8,
    cuisine: "North Indian, Mughlai",
    distance: "1.2 km"
  },
  {
    name: "Sakura Sushi Bar",
    image: "https://images.unsplash.com/photo-1579027989536-b7b1f875659b?auto=format&fit=crop&q=80&w=800",
    rating: 4.9,
    cuisine: "Japanese, Asian",
    distance: "2.5 km"
  },
  {
    name: "La Piazza",
    image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=800",
    rating: 4.7,
    cuisine: "Italian, Desserts",
    distance: "0.8 km"
  }
]

const TESTIMONIALS = [
  {
    name: "Priya Sharma",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200",
    review: "Eatiefy completely changed how we dine out. Booking tables is seamless, and we never have to wait anymore!",
    rating: 5
  },
  {
    name: "Rahul Verma",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
    review: "The takeaway feature is a lifesaver for my busy schedule. My food is always ready when I arrive.",
    rating: 5
  },
  {
    name: "Sneha Patel",
    image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200",
    review: "Premium restaurants and amazing UI. Eatiefy feels incredibly polished and works flawlessly.",
    rating: 5
  }
]

export default function MasterLandingPage() {
  const navigate = useNavigate()
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeTestimonial, setActiveTestimonial] = useState(0)
  const companyName = useCompanyName()
  const logoUrl = useCompanyLogo("user")
  const [contactInfo, setContactInfo] = useState(() => {
    const cached = getCachedSettings()
    return { email: cached?.email, phone: cached?.phone }
  })

  useEffect(() => {
    const syncContactInfo = () => {
      const settings = getCachedSettings()
      if (settings) setContactInfo({ email: settings.email, phone: settings.phone })
    }
    if (!getCachedSettings()) {
      loadBusinessSettings().then(syncContactInfo).catch(() => {})
    } else {
      syncContactInfo()
    }
    window.addEventListener("businessSettingsUpdated", syncContactInfo)
    return () => window.removeEventListener("businessSettingsUpdated", syncContactInfo)
  }, [])

  const contactEmail = contactInfo.email || "support@eatiefy.in"
  const contactPhone = contactInfo.phone?.number
    ? `${contactInfo.phone.countryCode || "+91"} ${contactInfo.phone.number}`
    : "+91 98765 43210"

  const mobileSectionRef = useRef(null)

  // Tracks scroll progress over the mobile section
  const { scrollYProgress: mobileScrollYProgress } = useScroll({
    target: mobileSectionRef,
    offset: ["start center", "end start"]
  });

  // Maps scroll progress to 3D rotation and position values
  const phoneRotateX = useTransform(mobileScrollYProgress, [0, 0.5, 1], [40, 5, -20]);
  const phoneRotateY = useTransform(mobileScrollYProgress, [0, 0.5, 1], [-30, 15, 30]);
  const phoneY = useTransform(mobileScrollYProgress, [0, 0.5, 1], [150, 0, -150]);
  const phoneScale = useTransform(mobileScrollYProgress, [0, 0.5, 1], [0.8, 1.05, 0.9]);

  // Applies spring physics for a smooth, natural feel
  const smoothRotateX = useSpring(phoneRotateX, { damping: 20, stiffness: 100 });
  const smoothRotateY = useSpring(phoneRotateY, { damping: 20, stiffness: 100 });
  const smoothY = useSpring(phoneY, { damping: 20, stiffness: 100 });
  const smoothScale = useSpring(phoneScale, { damping: 20, stiffness: 100 });

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTestimonial((prev) => (prev + 1) % TESTIMONIALS.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-white font-sans selection:bg-[#D32F2F]/30 overflow-x-hidden scroll-smooth">

      {/* 2. Hero Section */}
      <section id="home" className="relative h-screen flex items-center justify-center overflow-hidden">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/assets/media/hero-bg-trim.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B0B0B]/80 via-[#0B0B0B]/60 to-[#0B0B0B] z-10 pointer-events-none" />

        <div className="relative z-20 max-w-7xl mx-auto px-6 text-center flex flex-col items-center mt-20">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="mb-2"
          >
            <h1 className="text-7xl md:text-[110px] font-black italic tracking-tighter drop-shadow-2xl text-white">
              Eatie<span className="text-[#D32F2F]">fy</span>
            </h1>
          </motion.div>

          {/* Subheading */}
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 drop-shadow-lg"
          >
            <br className="md:hidden" /> food & takeaway services
          </motion.h2>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
            className="text-lg md:text-2xl text-gray-100 mb-10 max-w-2xl mx-auto font-medium drop-shadow-md"
          >
            Experience fast & easy online ordering <br className="hidden md:block" /> on the Eatiefy app
          </motion.p>

          {/* Play Store Button */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6, ease: "easeOut" }}
            className="flex flex-col sm:flex-row items-center gap-4 justify-center relative z-30"
          >
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ cursor: 'pointer' }}
              className="cursor-pointer flex items-center gap-3 bg-black border border-gray-600 text-white px-5 py-2 rounded-xl hover:-translate-y-2 hover:scale-[1.03] hover:border-gray-400 hover:shadow-2xl transition-all duration-200 w-48 justify-center relative z-30"
            >
              <img src="/assets/images/playstore_img-removebg-preview.webp" alt="Google Play" className="w-6 h-6 object-contain pointer-events-none" />
              <div className="text-left leading-tight pointer-events-none">
                <div className="text-[10px] uppercase tracking-wide text-gray-300">GET IT ON</div>
                <div className="text-sm font-semibold">Google Play</div>
              </div>
            </a>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ cursor: 'pointer' }}
              className="cursor-pointer flex items-center gap-3 bg-black border border-gray-600 text-white px-5 py-2 rounded-xl hover:-translate-y-2 hover:scale-[1.03] hover:border-gray-400 hover:shadow-2xl transition-all duration-200 w-48 justify-center relative z-30"
            >
              <AppleIcon className="w-6 h-6 text-white pointer-events-none" />
              <div className="text-left leading-tight pointer-events-none">
                <div className="text-[10px] uppercase tracking-wide text-gray-300">Download on the</div>
                <div className="text-sm font-semibold">App Store</div>
              </div>
            </a>
          </motion.div>

        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.5 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-row items-center gap-2 cursor-pointer text-white hover:text-gray-300 transition-colors z-30 animate-bounce"
          onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <span className="text-[13px] font-medium tracking-wide">Scroll down</span>
          <ChevronDown className="w-6 h-6 mt-[1px]" />
        </motion.div>
      </section>

      {/* 2nd Page / New Section */}
      <section id="features" className="relative min-h-[100vh] lg:h-screen bg-red-50 text-gray-900 flex flex-col items-center justify-center overflow-hidden py-24 lg:py-0">
        {/* Background Premium Dot Texture */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.15]" style={{ backgroundImage: 'radial-gradient(#D32F2F 2px, transparent 2px)', backgroundSize: '32px 32px' }}></div>
        {/* Fade gradient so texture blends smoothly at edges */}
        <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-b from-red-50/20 via-transparent to-red-50"></div>

        {/* Floating food items */}
        {/* Burger */}
        <motion.div
          animate={{ y: [-10, 10, -10], rotate: [-2, 2, -2] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-10 md:left-24 -translate-y-1/2 z-10 drop-shadow-[0_20px_30px_rgba(0,0,0,0.2)]"
        >
          <img src="/assets/images/burger-real.png" alt="Burger" className="w-20 md:w-64 object-contain opacity-50 md:opacity-100" />
        </motion.div>

        {/* Dim sums / Momos - Using user's provided dish image */}
        <motion.div
          animate={{ y: [10, -10, 10], rotate: [5, -5, 5] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-10 right-10 md:right-20 z-10 drop-shadow-[0_20px_30px_rgba(0,0,0,0.15)]"
        >
          <img
            src="/assets/images/dish-img.png"
            alt="Dim Sums"
            className="w-24 md:w-64 object-contain opacity-50 md:opacity-100"
          />
        </motion.div>

        {/* Pizza */}
        <motion.div
          animate={{ y: [-15, 15, -15], rotate: [-10, 10, -10] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-32 right-10 md:right-32 z-10 drop-shadow-[0_20px_30px_rgba(0,0,0,0.2)]"
        >
          <img src="/assets/images/pizza-free.png" alt="Pizza" className="w-20 md:w-60 object-contain opacity-50 md:opacity-100" />
        </motion.div>

        {/* Center Content */}
        <div className="relative z-20 text-center max-w-3xl mx-auto flex flex-col items-center px-6">
          <h2 className="text-5xl md:text-[68px] font-bold text-[#E64A53] leading-tight mb-8">
            Better food for <br /> more people
          </h2>
          <p className="text-xl md:text-[22px] text-gray-500 font-medium leading-relaxed max-w-2xl">
            For over a decade, we've enabled our customers to discover new tastes, delivered right to their doorstep
          </p>
        </div>

        {/* Services Card */}
        <div className="relative lg:absolute mt-16 lg:mt-0 bottom-auto lg:bottom-10 left-0 lg:left-1/2 lg:-translate-x-1/2 w-[90%] max-w-[1000px] z-30 mx-auto lg:mx-0">
          <div className="bg-white rounded-[32px] shadow-[0_15px_60px_-15px_rgba(0,0,0,0.15)] py-6 px-8 md:px-12 flex flex-col md:flex-row items-center justify-between gap-6 border border-gray-100">
            {/* Service 1 */}
            <div className="flex items-center gap-4 w-full justify-center md:justify-start group cursor-default">
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 border border-red-200 flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all duration-300 shrink-0">
                <Rocket className="w-7 h-7 md:w-8 md:h-8 text-[#E64A53]" strokeWidth={1.5} />
              </div>
              <div className="text-center md:text-left">
                <div className="text-lg md:text-xl font-extrabold text-[#353A40] mb-0.5 tracking-tight group-hover:text-[#E64A53] transition-colors">Lightning Fast</div>
                <div className="text-[13px] md:text-[14px] text-gray-500 font-medium">Delivery under 30 mins</div>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden md:block w-px h-16 bg-gray-200 shrink-0"></div>

            {/* Service 2 */}
            <div className="flex items-center gap-4 w-full justify-center md:justify-center group cursor-default">
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 border border-red-200 flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all duration-300 shrink-0">
                <Award className="w-7 h-7 md:w-8 md:h-8 text-[#E64A53]" strokeWidth={1.5} />
              </div>
              <div className="text-center md:text-left">
                <div className="text-lg md:text-xl font-extrabold text-[#353A40] mb-0.5 tracking-tight group-hover:text-[#E64A53] transition-colors">Premium Quality</div>
                <div className="text-[13px] md:text-[14px] text-gray-500 font-medium">Top-rated restaurants</div>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden md:block w-px h-16 bg-gray-200 shrink-0"></div>

            {/* Service 3 */}
            <div className="flex items-center gap-4 w-full justify-center md:justify-end group cursor-default">
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 border border-red-200 flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all duration-300 shrink-0">
                <Navigation className="w-7 h-7 md:w-8 md:h-8 text-[#E64A53]" strokeWidth={1.5} />
              </div>
              <div className="text-center md:text-left">
                <div className="text-lg md:text-xl font-extrabold text-[#353A40] mb-0.5 tracking-tight group-hover:text-[#E64A53] transition-colors">Live Tracking</div>
                <div className="text-[13px] md:text-[14px] text-gray-500 font-medium">Real-time order updates</div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* 3rd Page / App Features */}
      <section className="relative pt-20 pb-16 md:pb-24 bg-[#F35E6B] overflow-hidden text-center">
        <div className="max-w-5xl mx-auto px-6 relative z-10">
          <h2 className="text-3xl md:text-[40px] font-black text-white mb-4 tracking-tight leading-tight">
            What's waiting for you <br className="hidden md:block" /> on the app?
          </h2>
          <p className="text-red-100 font-medium text-base md:text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
            Our app is packed with features that <br className="hidden md:block" /> enable you to experience food <br className="hidden md:block" /> delivery like never before
          </p>

          <div className="relative w-full max-w-[700px] mx-auto h-[320px] flex justify-center mt-2 scale-[0.85] sm:scale-[0.9] md:scale-100 origin-top">

            {/* Phone Mockup - Scaled down and made very concise */}
            <div className="relative w-[220px] md:w-[250px] h-[450px] md:h-[500px] bg-black rounded-[40px] border-[10px] border-black shadow-[0_30px_60px_rgba(0,0,0,0.2)] z-20 overflow-hidden transform translate-y-12 md:translate-y-16 group">
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[100px] h-[20px] bg-black rounded-b-[12px] z-30" />
              {/* Screen Background */}
              <div className="w-full h-full bg-[#F8F9FA] flex flex-col items-center justify-center p-5 pt-12 transition-transform duration-500 group-hover:bg-[#F0F2F5]">
                {/* Live Tracking Card */}
                <div className="w-[95%] bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center text-center transform hover:scale-105 transition-transform duration-300 cursor-pointer -mt-40">
                  <div className="w-12 h-12 mb-2 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                    <MapPin className="w-6 h-6 text-blue-500" />
                  </div>
                  <h3 className="font-bold text-gray-800 text-[13px] mb-1">Live Tracking</h3>
                  <p className="text-[10px] text-gray-500 leading-tight">Track your order<br />in real-time</p>
                </div>
              </div>
            </div>

            {/* Left Floating Cards - Pulled very close */}
            <div className="flex absolute left-[-5%] sm:left-[2%] md:left-[12%] top-[8%] z-30 flex-col gap-4 md:gap-5">
              <motion.div whileHover={{ scale: 1.15, rotate: -5, zIndex: 50 }} whileTap={{ scale: 0.95 }} animate={{ y: [-4, 4, -4] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }} className="group bg-white rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.08)] p-2.5 pb-3 border border-gray-100 flex flex-col gap-1.5 items-center text-center w-[90px] md:w-[100px] cursor-pointer">
                <div className="w-12 h-12 md:w-14 md:h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-0.5 group-hover:bg-green-50 group-hover:shadow-inner transition-colors duration-300 border border-transparent group-hover:border-green-100 relative overflow-hidden">
                  <div className="absolute inset-0 bg-green-400 opacity-0 group-hover:opacity-20 group-hover:animate-ping rounded-2xl"></div>
                  <div className="text-[28px] md:text-[32px] leading-none group-hover:scale-125 group-hover:-rotate-12 transition-transform duration-300 relative z-10">🥗</div>
                </div>
                <span className="font-semibold text-[10px] md:text-[11px] text-gray-700 group-hover:text-green-600 transition-colors">Healthy</span>
              </motion.div>
              <motion.div whileHover={{ scale: 1.15, rotate: 5, zIndex: 50 }} whileTap={{ scale: 0.95 }} animate={{ y: [4, -4, 4] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }} className="group bg-white rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.08)] p-2.5 pb-3 border border-gray-100 flex flex-col gap-1.5 items-center text-center w-[90px] md:w-[100px] ml-4 md:ml-6 cursor-pointer">
                <div className="w-12 h-12 md:w-14 md:h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-0.5 group-hover:bg-yellow-50 group-hover:shadow-inner transition-colors duration-300 border border-transparent group-hover:border-yellow-100 relative overflow-hidden">
                  <div className="absolute inset-0 bg-yellow-400 opacity-0 group-hover:opacity-20 group-hover:animate-ping rounded-2xl"></div>
                  <div className="text-[28px] md:text-[32px] leading-none group-hover:scale-125 group-hover:rotate-12 transition-transform duration-300 relative z-10">🎉</div>
                </div>
                <span className="font-semibold text-[10px] md:text-[11px] text-gray-700 leading-tight group-hover:text-yellow-600 transition-colors">Plan<br />a Party</span>
              </motion.div>
            </div>

            {/* Left Top Card - Veg Mode */}
            <motion.div whileHover={{ scale: 1.15, zIndex: 50 }} whileTap={{ scale: 0.95 }} animate={{ y: [-3, 3, -3] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} className="flex group absolute left-[15%] sm:left-[20%] md:left-[30%] top-[-8%] md:top-[-6%] z-30 bg-white rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.12)] p-2.5 pb-3 border border-gray-100 flex-col gap-2 items-center text-center w-[90px] md:w-[100px] cursor-pointer">
              <div className="w-[44px] md:w-[50px] h-[22px] md:h-[26px] bg-[#1FA54E] rounded-full flex items-center p-[3px] group-hover:bg-[#188a40] transition-colors relative overflow-hidden shadow-inner group-hover:shadow-[0_0_15px_rgba(31,165,78,0.4)]">
                <div className="w-[16px] md:w-[20px] h-[16px] md:h-[20px] bg-white rounded-full shadow-sm group-hover:scale-90 transform group-hover:translate-x-[22px] md:group-hover:translate-x-[24px] transition-all duration-300 absolute left-[3px]"></div>
              </div>
              <span className="font-semibold text-[10px] md:text-[11px] text-gray-700 mt-0.5 group-hover:text-[#1FA54E] transition-colors">Veg Mode</span>
            </motion.div>

            {/* Right Floating Cards - Pulled very close */}
            <div className="flex absolute right-[-5%] sm:right-[2%] md:right-[12%] top-[12%] md:top-[14%] z-30 flex-col gap-4 md:gap-5 items-end">
              <motion.div whileHover={{ scale: 1.15, rotate: 5, zIndex: 50 }} whileTap={{ scale: 0.95 }} animate={{ y: [3, -3, 3] }} transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }} className="group bg-white rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.08)] p-2.5 pb-3 border border-gray-100 flex flex-col gap-1.5 items-center text-center w-[90px] md:w-[100px] cursor-pointer">
                <div className="w-12 h-12 md:w-14 md:h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-0.5 group-hover:bg-orange-50 group-hover:shadow-inner transition-colors duration-300 border border-transparent group-hover:border-orange-100 relative overflow-hidden">
                  <div className="absolute inset-0 bg-orange-400 opacity-0 group-hover:opacity-20 group-hover:animate-ping rounded-2xl"></div>
                  <div className="text-[28px] md:text-[32px] leading-none group-hover:scale-125 group-hover:rotate-12 transition-transform duration-300 relative z-10">🍝</div>
                </div>
                <span className="font-semibold text-[10px] md:text-[11px] text-gray-700 group-hover:text-orange-500 transition-colors">Gourmet</span>
              </motion.div>
              <motion.div whileHover={{ scale: 1.15, rotate: -5, zIndex: 50 }} whileTap={{ scale: 0.95 }} animate={{ y: [-5, 5, -5] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} className="group bg-white rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.08)] p-2.5 pb-3 border border-gray-100 flex flex-col gap-1.5 items-center text-center w-[90px] md:w-[100px] mr-4 md:mr-6 cursor-pointer">
                <div className="w-12 h-12 md:w-14 md:h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-0.5 group-hover:bg-red-50 group-hover:shadow-inner transition-colors duration-300 border border-transparent group-hover:border-red-100 relative overflow-hidden">
                  <div className="absolute inset-0 bg-red-400 opacity-0 group-hover:opacity-20 group-hover:animate-ping rounded-2xl"></div>
                  <div className="text-[28px] md:text-[32px] leading-none group-hover:scale-125 group-hover:-rotate-12 transition-transform duration-300 relative z-10">🍔</div>
                </div>
                <span className="font-semibold text-[10px] md:text-[11px] text-gray-700 group-hover:text-[#E64A53] transition-colors">Collections</span>
              </motion.div>
            </div>

            {/* Right Top Card - Offers */}
            <motion.div whileHover={{ scale: 1.15, zIndex: 50 }} whileTap={{ scale: 0.95 }} animate={{ y: [4, -4, 4] }} transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }} className="flex group absolute right-[15%] sm:right-[20%] md:right-[30%] top-[0%] z-30 bg-white rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.12)] p-2.5 pb-3 border border-gray-100 flex-col gap-2 items-center text-center w-[90px] md:w-[100px] cursor-pointer">
              <div className="w-[36px] md:w-[42px] h-[36px] md:h-[42px] bg-blue-50 rounded-[12px] flex items-center justify-center group-hover:bg-blue-100 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all duration-300">
                <img src="/assets/images/offers.png" alt="Offers" className="w-[20px] h-[20px] md:w-[24px] md:h-[24px] object-contain group-hover:scale-110 transition-transform" />
              </div>
              <span className="font-semibold text-[10px] md:text-[11px] text-gray-700 mt-1 group-hover:text-blue-500 transition-colors">Offers</span>
            </motion.div>
          </div>
        </div>

        {/* Curved bridge divider connecting to the dark section below */}
        <div className="absolute -bottom-1 left-0 w-full z-10 pointer-events-none">
          <svg viewBox="0 0 1440 250" className="w-full h-[150px] md:h-[250px] block" preserveAspectRatio="none">
            {/* This draws a black shape at the bottom that dips downwards in the center to match the screenshot smile curve */}
            <path d="M0,250 L0,100 Q720,300 1440,100 L1440,250 Z" fill="#111" />
          </svg>
        </div>
      </section>

      {/* 4. How Eatiefy Works */}
      <section className="py-24 px-6 bg-[#111] relative overflow-hidden">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-black mb-4">How It <span className="text-[#D32F2F]">Works</span></h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">Your journey to a perfect meal in four simple steps.</p>
          </div>

          <div className="relative">
            {/* Connecting line */}
            <div className="opacity-0 md:opacity-100 hidden md:block absolute top-1/2 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#D32F2F]/50 to-transparent -translate-y-1/2" />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-12 md:gap-6">
              {STEPS.map((step, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: idx * 0.15 }}
                  className="relative flex flex-col items-center text-center group"
                >
                  <div className="w-20 h-20 rounded-full bg-[#1A1A1A] border-2 border-[#333] group-hover:border-[#D32F2F] flex items-center justify-center mb-6 relative z-10 transition-colors duration-300 shadow-xl">
                    <step.icon className="w-8 h-8 text-gray-400 group-hover:text-[#D32F2F] transition-colors" />

                    {/* Step Number Badge */}
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[#D32F2F] text-white font-bold flex items-center justify-center text-sm border-2 border-[#111]">
                      {idx + 1}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                  <p className="text-gray-400 text-sm max-w-[200px] mx-auto">{step.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Premium Red Transition Divider */}
      <div className="relative w-full h-[150px] md:h-[250px] bg-[#111] overflow-hidden flex justify-center mt-[-1px]">
        {/* Faint red geometric diamond patterns */}
        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg stroke=\'%23D32F2F\' stroke-width=\'1\'%3E%3Cpath d=\'M30 0l30 30-30 30L0 30z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")', backgroundSize: '120px 120px' }}></div>

        {/* Massive White Convex Curve */}
        <div className="absolute bottom-[-2px] left-0 w-full z-20">
          <svg viewBox="0 0 1440 200" className="w-full h-[80px] md:h-[150px] block" preserveAspectRatio="none">
            <path d="M0,200 L0,150 Q720,0 1440,150 L1440,200 Z" fill="#ffffff" />
          </svg>
        </div>
      </div>



      {/* 6. Eatiefy Experience */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="w-full lg:w-1/2 relative min-h-[500px] md:min-h-[600px] flex items-center justify-center"
          >
            {/* Background Image (Restaurant Exterior) */}
            <div className="absolute top-0 right-0 w-[85%] h-[80%] rounded-[32px] overflow-hidden shadow-2xl">
              <div className="absolute inset-0 bg-[#D32F2F]/10 z-10 mix-blend-overlay" />
              <img
                src="https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?auto=format&fit=crop&w=1000&q=80"
                alt="Roadside Restaurant"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>

            {/* Foreground Image (Food - overlapping bottom left) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.2, delay: 0 }}
              className="absolute bottom-0 left-0 w-[75%] h-[55%] bg-white p-3 rounded-[24px] shadow-[0_20px_50px_rgba(0,0,0,0.2)] z-20"
            >
              <img
                src="/assets/images/restaurant-food.jpg"
                alt="Delicious Food"
                className="w-full h-full object-cover rounded-[16px]"
              />
            </motion.div>

            {/* Floating UI Element (Moved to top left to balance) */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-10 -left-6 md:-left-10 bg-[#1A1A1A] p-4 rounded-2xl border border-white/10 shadow-xl flex items-center gap-4 z-30"
            >
              <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center text-green-500">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Table Reserved</p>
                <p className="font-bold text-white">Confirmed instantly</p>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="w-full lg:w-1/2 space-y-10"
          >
            <div>
              <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight text-black">Elevate your <span className="text-[#D32F2F]">dining & takeaway experience</span></h2>
              <p className="text-gray-600 text-lg">We've reimagined everything from discovering places to paying the bill. It's smart, seamless, and incredibly fast.</p>
            </div>

            <div className="space-y-6">
              {[
                { title: "Table Reservation", desc: "Book instantly and walk past the queue." },
                { title: "Takeaway Scheduling", desc: "Order ahead and pick it up on your way." },
                { title: "Digital Bills & Easy Payments", desc: "Split the bill and pay securely from your phone." },
                { title: "Live Order Status", desc: "Know exactly when your food is ready." }
              ].map((item, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <div className="mt-1 w-6 h-6 rounded-full bg-[#D32F2F]/20 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-[#D32F2F]" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold mb-1 text-black">{item.title}</h4>
                    <p className="text-gray-500">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

          </motion.div>
        </div>
      </section>



      {/* 8. Download App */}
      <section ref={mobileSectionRef} className="py-24 px-6 bg-gradient-to-b from-[#111] to-[#0B0B0B]">
        <div className="max-w-6xl mx-auto bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] rounded-[32px] md:rounded-[48px] border border-white/10 p-8 md:p-20 overflow-hidden relative shadow-2xl">
          <div className="absolute inset-0 bg-[#D32F2F]/5 blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
            <div className="w-full md:w-1/2 text-center md:text-left">
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black mb-6 leading-tight text-white">
                Get the <span className="text-white">Eatie</span><span className="text-[#D32F2F]">fy</span> App
              </h2>
              <p className="text-gray-400 text-lg mb-10 max-w-md mx-auto md:mx-0">
                Download our app for the fastest booking experience, exclusive offers, and live order tracking.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-4 justify-center md:justify-start relative z-30">
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ cursor: 'pointer' }}
                  className="cursor-pointer flex items-center gap-3 bg-transparent border border-white/20 text-white px-6 py-3 rounded-2xl hover:-translate-y-2 hover:scale-[1.03] hover:border-gray-400 hover:shadow-2xl transition-all duration-200 w-full sm:w-[230px] justify-center md:justify-start relative z-30"
                >
                  <div className="w-8 h-8 flex items-center justify-center shrink-0 pointer-events-none">
                    <img src="/assets/images/playstore_img-removebg-preview.webp" alt="Google Play" className="w-7 h-7 object-contain scale-110" />
                  </div>
                  <div className="text-left flex-1 pointer-events-none">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Get it on</div>
                    <div className="text-lg font-bold leading-none text-white tracking-tight">Google Play</div>
                  </div>
                </a>
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ cursor: 'pointer' }}
                  className="cursor-pointer flex items-center gap-3 bg-transparent border border-white/20 text-white px-6 py-3 rounded-2xl hover:-translate-y-2 hover:scale-[1.03] hover:border-gray-400 hover:shadow-2xl transition-all duration-200 w-full sm:w-[230px] justify-center md:justify-start relative z-30"
                >
                  <div className="w-8 h-8 flex items-center justify-center shrink-0 pointer-events-none">
                    <AppleIcon className="w-7 h-7 text-white" />
                  </div>
                  <div className="text-left flex-1 pointer-events-none">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Download on the</div>
                    <div className="text-lg font-bold leading-none text-white tracking-tight">App Store</div>
                  </div>
                </a>
              </div>
            </div>

            <div className="w-full md:w-1/2 flex justify-center relative" style={{ perspective: 1000 }}>
              {/* Abstract decorative elements behind phone */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-[#D32F2F]/20 rounded-full blur-3xl" />

              {/* Phone Mockup Placeholder */}
              <motion.div
                initial={{ opacity: 0, y: 150, scale: 0.5 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: "-50% 0px 0px 0px" }}
                transition={{ duration: 0.8, type: "spring", bounce: 0.4 }}
              >
                <motion.div 
                  style={{ 
                    rotateX: smoothRotateX, 
                    rotateY: smoothRotateY, 
                    y: smoothY, 
                    scale: smoothScale 
                  }}
                  className="relative w-[260px] h-[554px] bg-black border-[8px] border-[#333] rounded-[36px] shadow-2xl overflow-hidden"
                >
                  {/* Screen content */}
                  <div className="absolute inset-0 bg-black flex flex-col overflow-hidden rounded-[28px]">
                  
                  {/* Phone Status Bar */}
                  <div className="w-full h-7 bg-black flex justify-between items-center px-5 z-10 shrink-0">
                    {/* Time */}
                    <span className="text-[12px] font-semibold text-white tracking-wide">9:41</span>
                    {/* Icons (Signal, Wifi, Battery) */}
                    <div className="flex items-center gap-1.5 opacity-90 mt-0.5">
                      <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2,22L22,2L22,22H2Z" />
                      </svg>
                      <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12,3C7.95,3 4.21,4.34 1.2,6.6L12,21.5L22.8,6.6C19.79,4.34 16.05,3 12,3M12,5.5C15.06,5.5 17.86,6.34 20.15,7.74L12,18.97L3.85,7.74C6.14,6.34 8.94,5.5 12,5.5Z" />
                      </svg>
                      <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16.67,4H15V2H9V4H7.33C6.6,4 6,4.6 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67C17.4,22 18,21.4 18,20.67V5.33C18,4.6 17.4,4 16.67,4Z" />
                      </svg>
                    </div>
                  </div>

                  <div className="flex-1 w-full relative">
                    <img 
                      src="/assets/images/eatiefy_app_screen.png"
                      alt="Eatiefy App Screen"
                      className="absolute inset-0 w-full h-full object-cover object-top"
                      style={{ imageRendering: 'high-quality', WebkitFontSmoothing: 'antialiased' }} 
                    />
                  </div>
                </div>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. Footer */}
      <footer id="contact" className="bg-[#050505] pt-24 pb-10 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 mb-16">

            {/* Brand */}
            <div>
              <div className="flex items-center gap-2 mb-6">
                <img src={logoUrl} alt={companyName} className="h-14 w-14 object-cover rounded-xl shadow-lg" />
              </div>
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                India's smartest dining and takeaway platform. Skip the lines, discover new tastes, and dine better.
              </p>
              <div className="flex gap-4 relative z-30">
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ cursor: 'pointer' }}
                  className="cursor-pointer w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-[#D32F2F] hover:text-white transition-all group relative z-30"
                  title="Google Play Store"
                >
                  <img src="/assets/images/playstore_img-removebg-preview.webp" alt="Google Play" className="w-5 h-5 object-contain opacity-70 group-hover:opacity-100 transition-all pointer-events-none" />
                </a>
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ cursor: 'pointer' }}
                  className="cursor-pointer w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-[#D32F2F] hover:text-white transition-all group relative z-30"
                  title="Apple App Store"
                >
                  <AppleIcon className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-all pointer-events-none" />
                </a>
              </div>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-bold text-white mb-6 uppercase tracking-wider text-sm">Legal</h4>
              <ul className="space-y-4">
                {[
                  { name: "Privacy Policy", path: "/user/profile/privacy" },
                  { name: "Terms of Service", path: "/user/profile/terms" },
                  { name: "Support", path: "/user/profile/support-info" }
                ].map(item => (
                  <li key={item.name}>
                    <a href={item.path} className="text-gray-400 hover:text-[#D32F2F] transition-colors text-sm">
                      {item.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact Us */}
            <div>
              <h4 className="font-bold text-white mb-6 uppercase tracking-wider text-sm">Contact Us</h4>
              <ul className="space-y-4 text-sm text-gray-400">
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  </div>
                  <span>{contactEmail}</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" /></svg>
                  </div>
                  <span>{contactPhone}</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-gray-500 text-sm">
              &copy; {new Date().getFullYear()} {companyName} Technologies. All rights reserved.
            </p>
            <div className="flex gap-4 text-sm text-gray-500">
              <span>Made with ❤️ in India</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
