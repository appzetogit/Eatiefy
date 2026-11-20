import { useState, useEffect, useRef } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"
import {
  Search,
  HelpCircle,
  Package,
  CreditCard,
  User,
  Truck,
  MessageCircle,
  Phone,
  Mail,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  FileText,
  Shield,
  Clock,
  MapPin,
  Send,
  Headphones,
  X
} from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import ScrollReveal from "@food/components/user/ScrollReveal"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Badge } from "@food/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@food/components/ui/dialog"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"

const helpCategories = [
  {
    id: "ordering",
    title: "Ordering",
    icon: Package,
    color: "text-[#1F6B45]",
    bgColor: "bg-orange-50",
    description: "Learn how to place and manage orders",
    topics: [
      {
        question: "How do I place an order?",
        answer: "To place an order, browse restaurants, add items to your cart, and proceed to checkout. Select your delivery address and payment method, then confirm your order."
      },
      {
        question: "Can I modify or cancel my order?",
        answer: "You can modify or cancel your order within 5 minutes of placing it. After that, please contact support for assistance."
      },
      {
        question: "How do I track my order?",
        answer: "Go to 'My Orders' in your profile, select the order you want to track, and you'll see real-time updates on your order status."
      },
      {
        question: "What is the minimum order amount?",
        answer: "The minimum order amount varies by restaurant, typically ranging from $10 to $15. This information is displayed on each restaurant's page."
      }
    ]
  },
  {
    id: "payments",
    title: "Payments",
    icon: CreditCard,
    color: "text-[#1F6B45]",
    bgColor: "bg-orange-50",
    description: "Payment methods and billing questions",
    topics: [
      {
        question: "What payment methods do you accept?",
        answer: "We accept all major credit cards, debit cards, digital wallets (Apple Pay, Google Pay), and cash on delivery in select areas."
      },
      {
        question: "Is my payment information secure?",
        answer: "Yes, we use industry-standard encryption to protect your payment information. We never store your full card details."
      },
      {
        question: "Can I get a refund?",
        answer: "Refunds are processed for cancelled orders, incorrect items, or quality issues. Contact support within 24 hours of delivery for assistance."
      },
      {
        question: "Why was my payment declined?",
        answer: "Payment can be declined due to insufficient funds, incorrect card details, or bank restrictions. Please verify your payment method and try again."
      }
    ]
  },
  {
    id: "delivery",
    title: "Delivery",
    icon: Truck,
    color: "text-#14512F",
    bgColor: "bg-orange-50",
    description: "Delivery times, fees, and tracking",
    topics: [
      {
        question: "What are your delivery times?",
        answer: "Delivery times typically range from 30-60 minutes, depending on the restaurant and your location. Estimated time is shown before checkout."
      },
      {
        question: "How much is the delivery fee?",
        answer: "Delivery fees vary by restaurant and distance, typically ranging from $2.99 to $5.99. The exact fee is shown before you place your order."
      },
      {
        question: "Can I schedule a delivery for later?",
        answer: "Yes, you can schedule orders for up to 7 days in advance during checkout. Select your preferred delivery time."
      },
      {
        question: "What if my order is late?",
        answer: "If your order is significantly delayed, contact support. We'll investigate and may provide compensation or a refund."
      }
    ]
  },
  {
    id: "account",
    title: "Account & Profile",
    icon: User,
    color: "text-[#1F6B45]",
    bgColor: "bg-orange-50",
    description: "Manage your account and preferences",
    topics: [
      {
        question: "How do I update my profile?",
        answer: "Go to 'Profile' in the menu, then select 'Edit Profile' to update your name, email, phone number, and other information."
      },
      {
        question: "How do I change my password?",
        answer: "Go to Profile > Settings > Security to change your password. You'll need to verify your current password first."
      },
      {
        question: "How do I manage my addresses?",
        answer: "Navigate to Profile > Addresses to view, add, edit, or delete delivery addresses. Set a default address for faster checkout."
      },
      {
        question: "How do I save my favorite restaurants?",
        answer: "Click the heart icon on any restaurant page to add it to your favorites. View all favorites in Profile > Favorites."
      }
    ]
  },
  {
    id: "refunds",
    title: "Refunds & Returns",
    icon: Shield,
    color: "text-[#1F6B45]",
    bgColor: "bg-orange-50",
    description: "Refund policy and return process",
    topics: [
      {
        question: "What is your refund policy?",
        answer: "We offer full refunds for cancelled orders, incorrect items, or quality issues reported within 24 hours of delivery."
      },
      {
        question: "How long do refunds take?",
        answer: "Refunds are typically processed within 5-7 business days, depending on your payment method. You'll receive a confirmation email."
      },
      {
        question: "Can I return food items?",
        answer: "Due to food safety regulations, we cannot accept returns of food items. However, we'll provide a full refund for quality issues."
      },
      {
        question: "What if I received the wrong order?",
        answer: "Contact support immediately with your order number. We'll arrange a replacement or full refund, and you can keep the incorrect order."
      }
    ]
  },
  {
    id: "general",
    title: "General Questions",
    icon: HelpCircle,
    color: "text-gray-600",
    bgColor: "bg-gray-50",
    description: "Other frequently asked questions",
    topics: [
      {
        question: "Do you offer discounts or promotions?",
        answer: "Yes! Check the 'Offers' section for current promotions, discount codes, and special deals from restaurants."
      },
      {
        question: "How do I contact customer support?",
        answer: "You can contact us via phone, email, or live chat. Visit the 'Contact Support' section below for all contact options."
      },
      {
        question: "Is there a mobile app?",
        answer: "Yes, our mobile app is available for iOS and Android. Download it from the App Store or Google Play for the best experience."
      },
      {
        question: "Do you deliver to my area?",
        answer: "Enter your delivery address to see available restaurants in your area. We're constantly expanding our delivery zones."
      }
    ]
  }
]

export default function Help() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedCategory, setExpandedCategory] = useState(null)
  const [expandedQuestion, setExpandedQuestion] = useState(null)

  // Live Chat & Support Info state
  const [isLiveChatOpen, setIsLiveChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef(null)
  const [supportInfo, setSupportInfo] = useState({
    phone: "+91 1800-123-4567",
    email: "support@eatiefy.com"
  })

  useEffect(() => {
    let isMounted = true
    const fetchSupportConfig = async () => {
      try {
        const res = await api.get(API_ENDPOINTS.ADMIN.SUPPORT_USER_PUBLIC)
        const data = res?.data?.data || res?.data
        if (isMounted && data && typeof data === "object") {
          setSupportInfo({
            phone: data.mobile || data.phone || "+91 1800-123-4567",
            email: data.email || "support@eatiefy.com"
          })
        }
      } catch (_) {}
    }
    fetchSupportConfig()
    return () => { isMounted = false }
  }, [])

  const initialBotMessage = {
    id: "welcome-1",
    sender: "bot",
    text: "Hello! 👋 Welcome to Eatiefy Live Support. How can we help you today?",
    time: "Just now",
    options: [
      { label: "Track my order", action: "track" },
      { label: "Order delay or missing item", action: "order_issue" },
      { label: "Refund & payment query", action: "refund" },
      { label: "Talk to support agent", action: "agent" }
    ]
  }

  const [chatMessages, setChatMessages] = useState([initialBotMessage])

  useEffect(() => {
    if (isLiveChatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [chatMessages, isLiveChatOpen])

  const handleQuickOption = (option) => {
    const userMsg = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: option.label,
      time: "Just now"
    }
    setChatMessages((prev) => [...prev, userMsg])
    setIsTyping(true)

    setTimeout(() => {
      let reply = ""
      let linkAction = null

      switch (option.action) {
        case "track":
          reply = "You can view real-time location and live delivery tracking for any active order in the Orders tab."
          linkAction = { label: "View My Orders", path: "/user/orders" }
          break
        case "order_issue":
          reply = "We are sorry for the issue with your order! Please submit a quick support ticket so our team can resolve it immediately."
          linkAction = { label: "Create Order Support Ticket", path: "/user/profile/support", state: { type: "order", step: "order_issue" } }
          break
        case "refund":
          reply = "Refunds for cancelled or returned orders are processed within 5-7 business days. You can also raise a request directly with support."
          linkAction = { label: "Contact Support for Refund", path: "/user/profile/support", state: { type: "order", issueType: "Payment issue", step: "order_issue" } }
          break
        case "agent":
        default:
          reply = "Connecting you to our support ticketing desk. You can submit your ticket now and our team will get back to you right away."
          linkAction = { label: "Open Support Desk", path: "/user/profile/support" }
          break
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: reply,
          time: "Just now",
          linkAction
        }
      ])
      setIsTyping(false)
    }, 600)
  }

  const handleSendChat = (e) => {
    e?.preventDefault()
    const text = chatInput.trim()
    if (!text) return

    const userMsg = {
      id: `user-${Date.now()}`,
      sender: "user",
      text,
      time: "Just now"
    }

    setChatMessages((prev) => [...prev, userMsg])
    setChatInput("")
    setIsTyping(true)

    setTimeout(() => {
      const lower = text.toLowerCase()
      let reply = "Thank you for reaching out! We've noted your message. You can create a direct support ticket with our team to resolve this immediately."
      let linkAction = {
        label: "Create Support Ticket",
        path: "/user/profile/support",
        state: { subject: "Live Chat: " + text.slice(0, 30), description: text }
      }

      if (lower.includes("order") || lower.includes("track")) {
        reply = "Looking for your order? You can track active delivery and view status in your Orders tab, or raise a ticket with order details."
        linkAction = { label: "Track Orders", path: "/user/orders" }
      } else if (lower.includes("refund") || lower.includes("money") || lower.includes("payment")) {
        reply = "For payment deductions or refund inquiries, please submit a support ticket so our finance team can assist you."
        linkAction = { label: "Raise Payment Ticket", path: "/user/profile/support", state: { type: "order", issueType: "Payment issue" } }
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: reply,
          time: "Just now",
          linkAction
        }
      ])
      setIsTyping(false)
    }, 700)
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0

  // While searching, keep only matching topics per category (a category whose
  // title/description matches keeps all its topics) and auto-expand results.
  const filteredCategories = isSearching
    ? helpCategories
        .map((category) => {
          const categoryMatches =
            category.title.toLowerCase().includes(normalizedQuery) ||
            category.description.toLowerCase().includes(normalizedQuery)
          const topics = categoryMatches
            ? category.topics
            : category.topics.filter(
                (topic) =>
                  topic.question.toLowerCase().includes(normalizedQuery) ||
                  topic.answer.toLowerCase().includes(normalizedQuery)
              )
          return { ...category, topics }
        })
        .filter((category) => category.topics.length > 0)
    : helpCategories

  const toggleCategory = (categoryId) => {
    setExpandedCategory(expandedCategory === categoryId ? null : categoryId)
    setExpandedQuestion(null)
  }

  const toggleQuestion = (questionIndex) => {
    setExpandedQuestion(expandedQuestion === questionIndex ? null : questionIndex)
  }

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 via-white to-orange-50/20 dark:from-[#141414] dark:via-[#141414] dark:to-[#141414] p-4 md:p-6 lg:p-8 pb-32 md:pb-28">
      <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-6xl mx-auto space-y-4 md:space-y-5 lg:space-y-6 pb-12">
        <ScrollReveal>
          <div className="text-center space-y-3 md:space-y-4 mb-6 md:mb-8">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold">Help Center</h1>
            <p className="text-base md:text-lg lg:text-xl text-muted-foreground">
              Find answers to common questions or contact our support team
            </p>
          </div>
        </ScrollReveal>

        {/* Search Bar */}
        <ScrollReveal delay={0.1}>
          <Card className="shadow-lg">
            <CardContent className="p-4 md:p-5 lg:p-6">
              <div className="relative">
                <Search className="absolute left-3 md:left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 md:h-6 md:w-6 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search help topics or questions"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 md:pl-12 h-12 md:h-14 text-sm sm:text-base md:text-lg placeholder:text-sm sm:placeholder:text-base md:placeholder:text-lg"
                />
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Quick Actions */}
        <ScrollReveal delay={0.2}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
            <Link to={toFoodUserPath("/user/orders")}>
              <CardContent className="p-4 md:p-5 lg:p-6">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="p-2 md:p-3 bg-yellow-100 rounded-lg">
                    <Package className="h-5 w-5 md:h-6 md:w-6 text-[#1F6B45]" />
                  </div>
                  <div>
                    <h3 className="text-sm md:text-base font-semibold">Track Your Order</h3>
                    <p className="text-xs md:text-sm text-muted-foreground">View order status</p>
                  </div>
                </div>
              </CardContent>
            </Link>
            <Link to={toFoodUserPath("/user/profile")}>
              <CardContent className="p-4 md:p-5 lg:p-6">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="p-2 md:p-3 bg-orange-100 rounded-lg">
                    <User className="h-5 w-5 md:h-6 md:w-6 text-[#1F6B45]" />
                  </div>
                  <div>
                    <h3 className="text-sm md:text-base font-semibold">Manage Account</h3>
                    <p className="text-xs md:text-sm text-muted-foreground">Update profile & settings</p>
                  </div>
                </div>
              </CardContent>
            </Link>
            <Link to={toFoodUserPath("/user/profile/support")}>
              <CardContent className="p-4 md:p-5 lg:p-6">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="p-2 md:p-3 bg-orange-100 rounded-lg">
                    <MessageCircle className="h-5 w-5 md:h-6 md:w-6 text-[#1F6B45]" />
                  </div>
                  <div>
                    <h3 className="text-sm md:text-base font-semibold">Contact Support</h3>
                    <p className="text-xs md:text-sm text-muted-foreground">Get help from our team</p>
                  </div>
                </div>
              </CardContent>
            </Link>
          </div>
        </ScrollReveal>

        {/* Help Categories */}
        <ScrollReveal delay={0.3}>
          <div className="space-y-4 md:space-y-5 lg:space-y-6">
            <h2 className="text-xl md:text-2xl lg:text-3xl font-bold">Browse by Category</h2>
            {filteredCategories.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <HelpCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-semibold mb-2">No results found</p>
                  <p className="text-muted-foreground mb-4">
                    Try searching with different keywords
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setSearchQuery("")}
                  >
                    Clear Search
                  </Button>
                </CardContent>
              </Card>
            ) : (
              filteredCategories.map((category, categoryIndex) => {
                const Icon = category.icon
                const isExpanded = isSearching || expandedCategory === category.id

                return (
                  <Card key={category.id} className="shadow-lg">
                    <CardHeader
                      onClick={() => toggleCategory(category.id)}
                      className="p-4 md:p-5 lg:p-6"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 md:gap-4">
                          <div className={`p-2 md:p-3 ${category.bgColor} rounded-lg`}>
                            <Icon className={`h-5 w-5 md:h-6 md:w-6 ${category.color}`} />
                          </div>
                          <div>
                            <CardTitle className="text-lg md:text-xl lg:text-2xl">{category.title}</CardTitle>
                            <CardDescription className="text-sm md:text-base">{category.description}</CardDescription>
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 md:h-6 md:w-6 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-5 w-5 md:h-6 md:w-6 text-muted-foreground flex-shrink-0" />
                        )}
                      </div>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent className="space-y-3 md:space-y-4 pt-0 p-4 md:p-5 lg:p-6">
                        {category.topics.map((topic, topicIndex) => {
                          const questionIndex = `${category.id}-${topicIndex}`
                          const isQuestionExpanded = expandedQuestion === questionIndex

                          return (
                            <div
                              key={topicIndex}
                              className="border rounded-lg overflow-hidden"
                            >
                              <button
                                onClick={() => toggleQuestion(questionIndex)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
                              >
                                <span className="font-semibold">{topic.question}</span>
                                {isQuestionExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                )}
                              </button>
                              {isQuestionExpanded && (
                                <div className="px-4 py-3.5 text-sm text-muted-foreground border-t bg-muted/30">
                                  <p>{topic.answer}</p>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </CardContent>
                    )}
                  </Card>
                )
              })
            )}
          </div>
        </ScrollReveal>

        {/* Contact Support Section */}
        <ScrollReveal delay={0.4}>
          <Card className="bg-gradient-to-br from-yellow-50 to-orange-50 border-yellow-200 shadow-lg">
            <CardHeader className="p-4 md:p-5 lg:p-6">
              <CardTitle className="text-xl md:text-2xl lg:text-3xl flex items-center gap-2">
                <MessageCircle className="h-5 w-5 md:h-6 md:w-6 text-[#1F6B45]" />
                Still Need Help?
              </CardTitle>
              <CardDescription className="text-sm md:text-base">
                Our support team is here to assist you 24/7
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 md:space-y-5 lg:space-y-6 p-4 md:p-5 lg:p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
                <div className="flex items-start gap-3 p-4 bg-white rounded-lg">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Phone className="h-5 w-5 text-[#1F6B45]" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Phone Support</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Call us anytime
                    </p>
                    <a
                      href={`tel:${supportInfo.phone}`}
                      className="text-sm text-primary hover:underline font-medium"
                    >
                      {supportInfo.phone}
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-white rounded-lg">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Mail className="h-5 w-5 text-[#1F6B45]" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Email Support</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      We'll respond within 24 hours
                    </p>
                    <a
                      href={`mailto:${supportInfo.email}`}
                      className="text-sm text-primary hover:underline font-medium"
                    >
                      {supportInfo.email}
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-white rounded-lg">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <MessageCircle className="h-5 w-5 text-[#1F6B45]" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Live Chat</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Available 24/7
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1 border-[#1F6B45] text-[#1F6B45] hover:bg-[#1F6B45] hover:text-white transition-colors"
                      onClick={() => setIsLiveChatOpen(true)}
                    >
                      Start Chat
                    </Button>
                  </div>
                </div>
              </div>
              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground mb-3">
                  <Clock className="h-4 w-4 inline mr-1" />
                  Average response time: Less than 5 minutes
                </p>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>
      </div>

      {/* Live Chat Dialog */}
      <Dialog open={isLiveChatOpen} onOpenChange={setIsLiveChatOpen}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[10050]"
          className="z-[10050] w-[calc(100%-1.5rem)] max-w-lg rounded-3xl p-0 overflow-hidden border-0 shadow-2xl bg-white dark:bg-[#1a1a1a] flex flex-col max-h-[85vh] sm:max-h-[640px]"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#1F6B45] to-[#2E8B57] text-white px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center text-white">
                  <Headphones className="h-5 w-5" />
                </div>
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-white rounded-full"></span>
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-white flex items-center gap-1.5">
                  Eatiefy Live Chat
                  <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider">
                    24/7
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-emerald-100 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse"></span>
                  Online • Typically replies in 2 mins
                </DialogDescription>
              </div>
            </div>
            <button
              onClick={() => setIsLiveChatOpen(false)}
              className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/70 dark:bg-[#141414] min-h-[260px] max-h-[380px]">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm shadow-xs ${
                    msg.sender === "user"
                      ? "bg-[#1F6B45] text-white rounded-tr-none"
                      : "bg-white dark:bg-zinc-800 text-gray-800 dark:text-gray-200 border border-slate-100 dark:border-zinc-700/80 rounded-tl-none"
                  }`}
                >
                  <p className="leading-relaxed">{msg.text}</p>
                </div>

                {/* Optional options/chips */}
                {msg.options && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {msg.options.map((opt, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleQuickOption(opt)}
                        className="text-xs font-medium px-3 py-1.5 rounded-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-[#1F6B45] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-zinc-700 transition-colors shadow-2xs cursor-pointer"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Optional Action Button */}
                {msg.linkAction && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setIsLiveChatOpen(false)
                        navigate(toFoodUserPath(msg.linkAction.path), { state: msg.linkAction.state })
                      }}
                      className="bg-[#1F6B45] hover:bg-[#175335] text-white text-xs h-8 rounded-xl shadow-xs"
                    >
                      {msg.linkAction.label}
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                )}
                <span className="text-[10px] text-muted-foreground px-1 mt-1">{msg.time}</span>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-800 border border-slate-100 dark:border-zinc-700 w-fit px-3 py-2 rounded-2xl rounded-tl-none">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.4s]"></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Helpline Strip */}
          <div className="px-4 py-2 bg-emerald-50/60 dark:bg-zinc-900 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Urgent issue?</span>
            <div className="flex items-center gap-3">
              <a
                href={`tel:${supportInfo.phone}`}
                className="font-semibold text-[#1F6B45] dark:text-emerald-400 hover:underline flex items-center gap-1"
              >
                <Phone className="h-3 w-3" /> Call {supportInfo.phone}
              </a>
              <Link
                to={toFoodUserPath("/user/profile/support")}
                onClick={() => setIsLiveChatOpen(false)}
                className="font-medium text-gray-600 dark:text-gray-300 hover:underline"
              >
                Tickets
              </Link>
            </div>
          </div>

          {/* Footer Input */}
          <form
            onSubmit={handleSendChat}
            className="p-3 bg-white dark:bg-[#1a1a1a] border-t border-slate-100 dark:border-zinc-800 flex items-center gap-2"
          >
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 h-10 text-xs sm:text-sm rounded-xl border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!chatInput.trim()}
              className="h-10 w-10 rounded-xl bg-[#1F6B45] hover:bg-[#175335] text-white shrink-0 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  )
}
