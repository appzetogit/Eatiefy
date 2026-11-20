import { useState, useMemo, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, IndianRupee, Plus, ArrowDownCircle, ArrowUpCircle, RefreshCw, Loader2, History } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Card, CardContent } from "@food/components/ui/card"
import AnimatedPage from "@food/components/user/AnimatedPage"
import AddMoneyModal from "@food/components/user/AddMoneyModal"
import { userAPI } from "@food/api"
import { toast } from "sonner"
import { useCompanyName } from "@food/hooks/useCompanyName"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { WalletSkeleton } from "@food/components/ui/loading-skeletons"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const TRANSACTION_TYPES = {
  ALL: "all",
  ADDITIONS: "additions",
  DEDUCTIONS: "deductions",
  REFUNDS: "refunds",
}

export default function Wallet() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [selectedFilter, setSelectedFilter] = useState(TRANSACTION_TYPES.ALL)
  const [wallet, setWallet] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addMoneyModalOpen, setAddMoneyModalOpen] = useState(false)

  const fetchWalletData = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await userAPI.getWallet()
      const walletData = response?.data?.data?.wallet || response?.data?.wallet

      if (walletData) {
        setWallet(walletData)
        setTransactions(walletData.transactions || [])
      }
    } catch (err) {
      debugError("Error fetching wallet:", err)
      setError(err?.response?.data?.message || "Failed to load wallet")
      toast.error("Failed to load wallet data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWalletData()
  }, [])

  const currentBalance = wallet?.balance || 0

  const filteredTransactions = useMemo(() => {
    if (selectedFilter === TRANSACTION_TYPES.ALL) {
      return transactions
    }

    return transactions.filter((transaction) => {
      if (selectedFilter === TRANSACTION_TYPES.ADDITIONS) {
        return transaction.type === "addition"
      }
      if (selectedFilter === TRANSACTION_TYPES.DEDUCTIONS) {
        return transaction.type === "deduction"
      }
      if (selectedFilter === TRANSACTION_TYPES.REFUNDS) {
        return transaction.type === "refund"
      }
      return true
    })
  }, [selectedFilter, transactions])

  const formatAmount = (amount) => {
    const numeric = Number(amount ?? 0)
    const safe = Number.isFinite(numeric) ? numeric : 0
    return `${"\u20B9"}${safe.toLocaleString("en-IN")}`
  }

  const formatDate = (dateString) => {
    if (!dateString) return "N/A"

    const date = new Date(dateString)
    const formattedDate = date.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    const formattedTime = date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })

    return `${formattedDate} | ${formattedTime}`
  }

  const getTransactionIcon = (type) => {
    switch (type) {
      case "addition":
        return <ArrowDownCircle className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-green-600 dark:text-green-400" />
      case "deduction":
        return <ArrowUpCircle className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-red-600 dark:text-red-400" />
      case "refund":
        return <RefreshCw className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-blue-600 dark:text-blue-400" />
      default:
        return null
    }
  }

  const getTransactionColor = (type) => {
    switch (type) {
      case "addition":
        return "text-green-600 dark:text-green-400"
      case "deduction":
        return "text-red-600 dark:text-red-400"
      case "refund":
        return "text-blue-600 dark:text-blue-400"
      default:
        return "text-gray-600 dark:text-gray-400"
    }
  }

  return (
    <AnimatedPage className="min-h-screen bg-white dark:bg-[#141414]">
      <div className="bg-white dark:bg-[#242424] sticky top-0 z-10 border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 px-4 sm:px-6 md:px-8 lg:px-10 py-4 md:py-5">
            <button
              onClick={goBack}
              className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-5 w-5 md:h-6 md:w-6 text-gray-700 dark:text-white" />
            </button>
            <h1 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">Wallet</h1>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-6 md:py-8 lg:py-10 space-y-6 md:space-y-8">
        {loading && (
          <WalletSkeleton />
        )}

        {error && !loading && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 md:p-6">
            <p className="text-red-600 dark:text-red-400 text-sm md:text-base">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 md:gap-8 lg:gap-10">
              <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 lg:gap-8 flex-1">
                <div className="relative flex-shrink-0">
                  <div className="w-20 h-20 md:w-24 md:h-24 lg:w-28 lg:h-28 xl:w-32 xl:h-32 bg-gradient-to-br from-red-500 via-red-600 to-red-700 rounded-xl md:rounded-2xl flex items-center justify-center shadow-lg transform rotate-[-5deg]">
                    <div className="w-16 h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 xl:w-28 xl:h-28 bg-white/10 rounded-lg md:rounded-xl flex items-center justify-center backdrop-blur-sm border border-white/20">
                      <IndianRupee className="h-10 w-10 md:h-12 md:w-12 lg:h-14 lg:w-14 xl:h-16 xl:w-16 text-white" strokeWidth={2.5} />
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-red-800 rounded-xl md:rounded-2xl transform rotate-[-5deg] translate-y-1 -z-10 opacity-25" />
                </div>

                <div className="flex flex-col md:items-start items-center text-center md:text-left">
                  <h2 className="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white mb-2 md:mb-3">
                    {companyName} Money
                  </h2>

                  <div className="mb-2 md:mb-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base mb-1">Current Balance</p>
                    <p className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl 2xl:text-6xl font-bold text-gray-900 dark:text-white">
                      {formatAmount(currentBalance)}
                    </p>
                  </div>

                  <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base text-center md:text-left max-w-md">
                    Add money to enjoy one-tap, seamless payments
                  </p>
                </div>
              </div>

              <div className="flex-shrink-0 w-full md:w-auto">
                <Button
                  className="w-full md:w-auto md:min-w-[200px] lg:min-w-[240px] h-12 md:h-14 lg:h-16 bg-[#14512F] hover:bg-[#0F3F25] dark:bg-[#14512F] dark:hover:bg-[#0F3F25] text-white font-semibold shadow-md text-sm md:text-base lg:text-lg rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
                  onClick={() => setAddMoneyModalOpen(true)}
                >
                  <Plus className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" />
                  Add money
                </Button>
              </div>
            </div>

            <div className="space-y-4 md:space-y-6 lg:space-y-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
                <h2 className="text-xs sm:text-sm md:text-base lg:text-lg font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase">
                  TRANSACTION HISTORY
                </h2>

                <div className="flex gap-2 md:gap-3 overflow-x-auto md:overflow-x-visible scrollbar-hide pb-2 md:pb-0">
                  {[
                    { id: TRANSACTION_TYPES.ALL, label: "All Transactions" },
                    { id: TRANSACTION_TYPES.ADDITIONS, label: "Additions" },
                    { id: TRANSACTION_TYPES.DEDUCTIONS, label: "Deductions" },
                    { id: TRANSACTION_TYPES.REFUNDS, label: "Refunds" },
                  ].map((filter) => {
                    const isSelected = selectedFilter === filter.id
                    return (
                      <button
                        key={filter.id}
                        onClick={() => setSelectedFilter(filter.id)}
                        className={`px-4 md:px-5 lg:px-6 py-2 md:py-2.5 lg:py-3 rounded-lg md:rounded-xl text-xs md:text-sm lg:text-base font-medium whitespace-nowrap flex-shrink-0 transition-all ${
                          isSelected
                            ? "bg-white dark:bg-[#242424] border-2 border-green-600 dark:border-green-500 text-green-600 dark:text-green-400 shadow-sm"
                            : "bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm"
                        }`}
                      >
                        {filter.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {filteredTransactions.length > 0 ? (
                <div className="space-y-3 md:space-y-4">
                  {filteredTransactions.map((transaction) => (
                    <Card
                      key={transaction.id}
                      className="py-0 border border-gray-100 dark:border-gray-800 shadow-sm dark:bg-[#242424] hover:shadow-md transition-all duration-200 cursor-pointer"
                    >
                      <CardContent className="p-4 md:p-5 lg:p-6">
                        <div className="flex items-center justify-between gap-4 md:gap-6">
                          <div className="flex items-center gap-4 md:gap-5 lg:gap-6 flex-1 min-w-0">
                            <div className="flex-shrink-0">
                              <div className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-800/50">
                                {getTransactionIcon(transaction.type)}
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-gray-900 dark:text-white font-semibold text-sm md:text-base lg:text-lg truncate mb-1">
                                {transaction.description}
                              </p>
                              <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base">
                                {formatDate(transaction.date || transaction.createdAt)}
                              </p>
                            </div>
                          </div>

                          <div className={`flex-shrink-0 font-bold text-lg md:text-xl lg:text-2xl ${getTransactionColor(transaction.type)}`}>
                            {transaction.type === "deduction" ? "-" : "+"}
                            {formatAmount(transaction.amount)}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="py-16 md:py-20 flex flex-col items-center justify-center text-center px-4">
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gray-50 dark:bg-[#242424] flex items-center justify-center mb-5 border border-gray-100 dark:border-gray-800 shadow-sm">
                    <History className="w-8 h-8 md:w-10 md:h-10 text-gray-300 dark:text-gray-600" />
                  </div>
                  <h3 className="text-gray-900 dark:text-white font-bold text-base md:text-lg mb-2">
                    No Transaction History
                  </h3>
                  <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm max-w-xs leading-relaxed">
                    Your transactions will appear here when you add money or make a purchase.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <AddMoneyModal
        open={addMoneyModalOpen}
        onOpenChange={setAddMoneyModalOpen}
        onSuccess={fetchWalletData}
      />
    </AnimatedPage>
  )
}
