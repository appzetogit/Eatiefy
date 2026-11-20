import React, { useState, useMemo, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Search, Download, ChevronDown, Eye, FileDown, FileSpreadsheet, FileText, X, Mail, Phone, MapPin, Package, IndianRupee, Calendar as CalendarIcon, User, CheckCircle, XCircle, Wallet, Plus, Minus } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { exportCustomersToCSV, exportCustomersToExcel, exportCustomersToPDF } from "@food/components/admin/customers/customersExportUtils"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@food/components/ui/dialog"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function Customers() {
  const [searchQuery, setSearchQuery] = useState("")
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('admin_customers_pageSize')) || 20)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [userDetails, setUserDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [showUserDetails, setShowUserDetails] = useState(false)
  const [filters, setFilters] = useState({
    orderDate: "",
    joiningDate: "",
    status: "",
    sortBy: "",
    chooseFirst: "",
  })

  const [globalCodBlockedFeatureEnabled, setGlobalCodBlockedFeatureEnabled] = useState(true)

  // Wallet add/deduct modal
  const [walletTarget, setWalletTarget] = useState(null) // { id, name, balance }
  const [walletTargetLoading, setWalletTargetLoading] = useState(false)
  const [walletType, setWalletType] = useState("credit") // "credit" | "debit"
  const [walletAmount, setWalletAmount] = useState("")
  const [walletReason, setWalletReason] = useState("")
  const [walletSubmitting, setWalletSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchGlobalConfig = async () => {
      try {
        const res = await adminAPI.getCustomizationSettings()
        if (!cancelled && res?.data?.data) {
          const config = res.data.data
          if (config.cod_blocking_feature_enabled !== undefined) {
            setGlobalCodBlockedFeatureEnabled(config.cod_blocking_feature_enabled)
          }
        }
      } catch (err) {
        debugError("Error fetching global config", err)
      }
    }
    fetchGlobalConfig()
    return () => { cancelled = true }
  }, [])

  const filteredCustomers = useMemo(() => {
    let result = [...customers]

    // Search is handled by the API globally — do not re-filter the current page only.

    // Filter by order date when that field is available in the API payload.

    // Filter by joining date
    if (filters.joiningDate) {
      result = result.filter(customer => {
        // Parse joining date from format "17 Oct 2021"
        const customerDate = new Date(customer.joiningDate)
        const filterDate = new Date(filters.joiningDate)
        return customerDate.toDateString() === filterDate.toDateString()
      })
    }

    // Filter by status
    if (filters.status) {
      if (filters.status === "active") {
        result = result.filter(customer => customer.status === true)
      } else if (filters.status === "inactive") {
        result = result.filter(customer => customer.status === false)
      }
    }

    // Sort by options
    if (filters.sortBy) {
      if (filters.sortBy === "name-asc") {
        result.sort((a, b) => a.name.localeCompare(b.name))
      } else if (filters.sortBy === "name-desc") {
        result.sort((a, b) => b.name.localeCompare(a.name))
      } else if (filters.sortBy === "orders-asc") {
        result.sort((a, b) => a.totalOrder - b.totalOrder)
      } else if (filters.sortBy === "orders-desc") {
        result.sort((a, b) => b.totalOrder - a.totalOrder)
      }
    }

    // Limit results if "Choose First" is set
    if (filters.chooseFirst && parseInt(filters.chooseFirst) > 0) {
      result = result.slice(0, parseInt(filters.chooseFirst))
    }

    return result
  }, [customers, filters])

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }))
    setCurrentPage(1)
  }

  const formatDateTime = (value) => {
    if (!value) return "-"
    try {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return String(value)
      const day = String(d.getDate()).padStart(2, "0")
      const month = d.toLocaleString("en-GB", { month: "short" })
      const year = d.getFullYear()
      const time = d.toLocaleString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
      return `${day} ${month} ${year}, ${time}`
    } catch {
      return String(value)
    }
  }

  // Fetch customers from API
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  useEffect(() => {
    let cancelled = false
    const fetchCustomers = async () => {
      try {
        setLoading(true)
        const params = {
          limit: pageSize,
          page: currentPage,
          ...(searchQuery && { search: searchQuery }),
          ...(filters.status && { status: filters.status }),
          ...(filters.joiningDate && { joiningDate: filters.joiningDate }),
          ...(filters.sortBy && { sortBy: filters.sortBy }),
          ...(filters.chooseFirst && { chooseFirst: filters.chooseFirst }),
        }

        const response = await adminAPI.getCustomers(params)
        const data = response?.data?.data || response?.data?.data || response?.data

        const list = Array.isArray(data?.customers)
          ? data.customers
          : Array.isArray(data?.users)
            ? data.users
            : Array.isArray(data)
              ? data
              : []
        if (!cancelled && Array.isArray(list)) {
          setCustomers(list)
          setTotalCustomers(data?.total || list.length)
        } else {
          if (!cancelled) {
            setCustomers([])
            setTotalCustomers(0)
          }
        }
      } catch (error) {
        debugError('Error fetching customers:', error)
        toast.error('Failed to load customers')
        if (!cancelled) {
          setCustomers([])
          setTotalCustomers(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const delay = searchQuery ? 250 : 0
    const t = setTimeout(fetchCustomers, delay)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [currentPage, pageSize, searchQuery, filters.status, filters.joiningDate, filters.sortBy, filters.chooseFirst])

  const [searchParams] = useSearchParams()
  const userIdFromUrl = searchParams.get("userId")

  useEffect(() => {
    if (userIdFromUrl && customers.length > 0) {
      const customer = customers.find(c => c.id === userIdFromUrl || c._id === userIdFromUrl)
      if (customer) {
        handleViewDetails(customer.id || customer.sl || customer._id)
      }
    }
  }, [userIdFromUrl, customers])

  const handleToggleStatus = async (customerId) => {
    try {
      // Find customer
      const customer = customers.find(c => (c._id || c.id) === customerId)
      if (!customer) return

      const newStatus = !customer.status

      // Optimistically update UI
      setCustomers(customers.map(c =>
        c.id === customerId ? { ...c, status: newStatus } : c
      ))

      // Call API to update user status
      await adminAPI.updateCustomerStatus(customerId, newStatus)
      toast.success(`User ${newStatus ? 'activated' : 'deactivated'} successfully`)
    } catch (error) {
      debugError('Error updating status:', error)
      toast.error('Failed to update status')
      // Revert optimistic update
      setCustomers(customers.map(c =>
        c.id === customerId ? { ...c, status: !c.status } : c
      ))
    }
  }

  const handleToggleCodStatus = async (customerId) => {
    try {
      const customer = customers.find(c => (c._id || c.id) === customerId)
      if (!customer) return

      const newCodStatus = !customer.isCodBlocked

      setCustomers(customers.map(c =>
        (c.id || c._id) === customerId ? { ...c, isCodBlocked: newCodStatus } : c
      ))

      await adminAPI.updateCustomerCodStatus(customerId, newCodStatus)
      toast.success(`User COD ${newCodStatus ? 'blocked' : 'unblocked'} successfully`)
    } catch (error) {
      debugError('Error updating COD status:', error)
      toast.error('Failed to update COD status')
      setCustomers(customers.map(c =>
        (c.id || c._id) === customerId ? { ...c, isCodBlocked: !c.isCodBlocked } : c
      ))
    }
  }

  const handleViewDetails = async (customerId) => {
    try {
      setLoadingDetails(true)
      setShowUserDetails(true)
      setSelectedCustomer(customerId)

      const response = await adminAPI.getCustomerById(customerId)
      const data = response?.data?.data || response?.data

      if (data?.user) {
        setUserDetails(data.user)
      } else {
        toast.error('Failed to load user details')
        setShowUserDetails(false)
      }
    } catch (error) {
      debugError('Error fetching user details:', error)
      toast.error('Failed to load user details')
      setShowUserDetails(false)
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleOpenWalletModal = async (customer, type = "credit") => {
    const id = customer._id || customer.id || customer.sl
    setWalletType(type)
    setWalletAmount("")
    setWalletReason("")
    setWalletTarget({ id, name: customer.name, balance: null })
    setWalletTargetLoading(true)
    try {
      const response = await adminAPI.getCustomerById(id)
      const data = response?.data?.data || response?.data
      const balance = Number(data?.user?.walletBalance ?? data?.customer?.walletBalance) || 0
      setWalletTarget({ id, name: customer.name, balance })
    } catch (error) {
      debugError("Error fetching wallet balance:", error)
      setWalletTarget({ id, name: customer.name, balance: 0 })
    } finally {
      setWalletTargetLoading(false)
    }
  }

  const handleCloseWalletModal = () => {
    if (walletSubmitting) return
    setWalletTarget(null)
    setWalletAmount("")
    setWalletReason("")
  }

  const handleSubmitWalletAdjustment = async () => {
    if (!walletTarget?.id) return
    const amount = Number(walletAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid amount")
      return
    }
    if (walletType === "debit" && walletTarget.balance !== null && amount > walletTarget.balance) {
      toast.error("Amount exceeds the customer's wallet balance")
      return
    }

    setWalletSubmitting(true)
    try {
      const response = await adminAPI.adjustCustomerWallet(walletTarget.id, {
        type: walletType,
        amount,
        reason: walletReason.trim(),
      })
      const data = response?.data?.data
      const newBalance = Number(data?.wallet?.balance)
      toast.success(
        `${"₹"}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${walletType === "credit" ? "added to" : "deducted from"} ${walletTarget.name}'s wallet`,
      )
      setCustomers((prev) =>
        prev.map((c) =>
          (c._id || c.id || c.sl) === walletTarget.id && Number.isFinite(newBalance)
            ? { ...c, walletBalance: newBalance }
            : c,
        ),
      )
      if (userDetails && (userDetails._id || userDetails.id) === walletTarget.id && Number.isFinite(newBalance)) {
        setUserDetails((prev) => ({ ...prev, walletBalance: newBalance }))
      }
      setWalletTarget(null)
      setWalletAmount("")
      setWalletReason("")
    } catch (error) {
      debugError("Error adjusting wallet:", error)
      toast.error(error?.response?.data?.message || "Failed to update wallet")
    } finally {
      setWalletSubmitting(false)
    }
  }

  const handleExport = (format) => {
    if (filteredCustomers.length === 0) {
      toast.error("No customers to export")
      return
    }

    const filename = "customers"
    try {
      switch (format) {
        case "csv":
          exportCustomersToCSV(filteredCustomers, filename)
          toast.success("CSV export started")
          break
        case "excel":
          exportCustomersToExcel(filteredCustomers, filename)
          toast.success("Excel export started")
          break
        case "pdf":
          exportCustomersToPDF(filteredCustomers, filename)
          toast.success("PDF download started")
          break
        default:
          toast.error("Invalid export format")
          break
      }
    } catch (error) {
      debugError("Export error:", error)
      toast.error("Failed to export customers")
    }
  }

  const getInitials = (name) => {
    if (!name) return "NA"
    return name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "NA"
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Filters Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Order Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={filters.orderDate}
                  onChange={(e) => handleFilterChange("orderDate", e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Customer Joining Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={filters.joiningDate}
                  onChange={(e) => handleFilterChange("joiningDate", e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Customer status
              </label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="">Select Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Sort By
              </label>
              <select
                value={filters.sortBy}
                onChange={(e) => handleFilterChange("sortBy", e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="">Select Customer Sorting Order</option>
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="orders-asc">Orders (Low to High)</option>
                <option value="orders-desc">Orders (High to Low)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Choose First
              </label>
              <input
                type="number"
                value={filters.chooseFirst}
                onChange={(e) => handleFilterChange("chooseFirst", e.target.value)}
                placeholder="Ex: 100"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // Filters are applied automatically via useMemo
                }}
                className="px-6 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all"
              >
                Apply Filters
              </button>
              <button
                onClick={() => {
                  setFilters({
                    orderDate: "",
                    joiningDate: "",
                    status: "",
                    sortBy: "",
                    chooseFirst: "",
                  })
                }}
                className="px-6 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                Reset Filters
              </button>
            </div>
            <div className="text-sm text-slate-600">
              {loading ? 'Loading...' : `Showing ${filteredCustomers.length} of ${totalCustomers} customers`}
            </div>
          </div>
        </div>

        {/* Customer List Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">Customer list</h2>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700 flex items-center justify-center min-w-[2.5rem] h-7">
                {loading ? (
                  <span className="w-5 h-3 rounded bg-slate-300/80 animate-pulse" />
                ) : (
                  totalCustomers
                )}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                <input
                  type="text"
                  placeholder="Ex: Search by name"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all">
                    <Download className="w-4 h-4" />
                    <span className="text-black font-bold">Export</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                  <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("csv")} className="cursor-pointer">
                    <FileDown className="w-4 h-4 mr-2" />
                    Export as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("excel")} className="cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Export as Excel
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")} className="cursor-pointer">
                    <FileText className="w-4 h-4 mr-2" />
                    Export as PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Sl</th>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Name</th>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Contact Info</th>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Total Order</th>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Total Amount</th>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Wallet Balance</th>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Joining Date</th>
                  <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Active/Inactive</th>
                  {globalCodBlockedFeatureEnabled && (
                    <th className="px-3 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">COD Blocked</th>
                  )}
                  <th className="px-3 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={globalCodBlockedFeatureEnabled ? 10 : 9} className="px-6 py-8 text-center">
                      <div className="text-sm text-slate-500">Loading customers...</div>
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={globalCodBlockedFeatureEnabled ? 10 : 9} className="px-6 py-8 text-center">
                      <div className="text-sm text-slate-500">No customers found</div>
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((customer, index) => (
                    <tr key={customer.id || customer.sl} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-700">{(currentPage - 1) * pageSize + index + 1}</span>
                      </td>
                      <td className="px-3 py-4 w-[260px] max-w-[260px]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div 
                            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:opacity-80 transition-all border border-slate-200"
                            style={{ background: 'linear-gradient(135deg, #E8EEF7 0%, #C5D3E5 100%)' }}
                            onClick={() => handleViewDetails(customer._id || customer.id || customer.sl)}
                          >
                            <img
                              src={customer.profileImage || "/assets/images/profile_avatar.webp"}
                              alt={customer.name}
                              className="w-full h-full object-cover"
                              style={{ mixBlendMode: 'multiply' }}
                              onError={(e) => {
                                e.currentTarget.src = "/assets/images/profile_avatar.webp"
                              }}
                            />
                          </div>
                          <span 
                            className="min-w-0 flex-1 text-sm font-medium text-slate-900 cursor-pointer hover:text-blue-600 transition-colors whitespace-normal [overflow-wrap:anywhere]"
                            onClick={() => handleViewDetails(customer._id || customer.id || customer.sl)}
                          >
                            {customer.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4 max-w-[220px]">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm text-slate-700 [overflow-wrap:anywhere]">{customer.email || "NA"}</span>
                          <span className="text-xs text-slate-500">{customer.phone}</span>
                        </div>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">{customer.totalOrder || 0}</span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-900">{"\u20B9"} {(customer.totalOrderAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="text-sm font-semibold text-emerald-700">{"₹"} {(customer.walletBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">{formatDateTime(customer.joiningDate)}</span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleStatus(customer.id || customer.sl)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${customer.status ? "bg-green-600" : "bg-slate-300"
                            }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${customer.status ? "translate-x-6" : "translate-x-1"
                              }`}
                          />
                        </button>
                      </td>
                      {globalCodBlockedFeatureEnabled && (
                        <td className="px-3 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleCodStatus(customer.id || customer.sl || customer._id)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${customer.isCodBlocked ? "bg-red-600" : "bg-slate-300"
                              }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${customer.isCodBlocked ? "translate-x-6" : "translate-x-1"
                                }`}
                            />
                          </button>
                        </td>
                      )}
                      <td className="px-3 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleViewDetails(customer._id || customer.id || customer.sl)}
                            className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleOpenWalletModal(customer, "credit")}
                            className="p-1.5 rounded text-green-600 hover:bg-green-50 transition-colors"
                            title="Add / deduct wallet balance"
                          >
                            <Wallet className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalCustomers > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-100 bg-white px-4 py-4 sm:px-6 mt-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500 font-medium">Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const size = Number(e.target.value)
                    setPageSize(size)
                    localStorage.setItem('admin_customers_pageSize', size)
                    setCurrentPage(1)
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 cursor-pointer shadow-sm"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex flex-1 justify-between sm:hidden w-full">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, Math.ceil(totalCustomers / pageSize)))}
                  disabled={currentPage >= Math.ceil(totalCustomers / pageSize)}
                  className="relative ml-3 inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Next
                </button>
              </div>

              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between w-full">
                <div className="pl-4">
                  <p className="text-sm text-slate-600">
                    Showing <span className="font-semibold text-slate-900">{Math.min(totalCustomers, (currentPage - 1) * pageSize + 1)}</span> to{" "}
                    <span className="font-semibold text-slate-900">{Math.min(totalCustomers, currentPage * pageSize)}</span> of{" "}
                    <span className="font-semibold text-slate-900">{totalCustomers}</span> customers
                  </p>
                </div>
                <div>
                  <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm gap-1" aria-label="Pagination">
                    <button
                      onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center rounded-md px-2.5 py-1.5 text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      &lt;
                    </button>
                    {Array.from({ length: Math.ceil(totalCustomers / pageSize) }, (_, i) => i + 1)
                      .filter(page => page === 1 || page === Math.ceil(totalCustomers / pageSize) || (page >= currentPage - 2 && page <= currentPage + 2))
                      .map((page, index, arr) => {
                        const showEllipsisBefore = index > 0 && page - arr[index - 1] > 1;
                        return (
                          <React.Fragment key={page}>
                            {showEllipsisBefore && (
                              <span className="px-3 py-1.5 text-slate-400 text-sm">...</span>
                            )}
                            <button
                              onClick={() => setCurrentPage(page)}
                              className={`relative inline-flex items-center px-3.5 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                                currentPage === page
                                  ? "bg-slate-900 text-white"
                                  : "text-slate-700 border border-slate-200 hover:bg-slate-50"
                              }`}
                            >
                              {page}
                            </button>
                          </React.Fragment>
                        );
                      })}
                    <button
                      onClick={() => setCurrentPage((prev) => Math.min(prev + 1, Math.ceil(totalCustomers / pageSize)))}
                      disabled={currentPage >= Math.ceil(totalCustomers / pageSize)}
                      className="relative inline-flex items-center rounded-md px-2.5 py-1.5 text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      &gt;
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Details Modal */}
      <Dialog open={showUserDetails} onOpenChange={setShowUserDetails}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto mx-auto p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="pr-12 text-xl font-bold text-slate-900">User Details</DialogTitle>
          </DialogHeader>

          {loadingDetails ? (
            <div className="px-6 py-8 text-center">
              <div className="text-sm text-slate-500">Loading user details...</div>
            </div>
          ) : userDetails ? (
            <div className="space-y-4 px-6 py-5">
              {/* Profile Section */}
              <div className="bg-slate-50 rounded-xl p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div 
                    className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden border border-slate-200"
                    style={{ background: 'linear-gradient(135deg, #E8EEF7 0%, #C5D3E5 100%)' }}
                  >
                    <img
                      src={userDetails.profileImage || "/assets/images/profile_avatar.webp"}
                      alt={userDetails.name}
                      className="w-full h-full rounded-full object-cover"
                      style={{ mixBlendMode: 'multiply' }}
                      onError={(e) => { e.currentTarget.src = "/assets/images/profile_avatar.webp" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="text-lg font-bold text-slate-900 [overflow-wrap:anywhere]">{userDetails.name}</h3>
                      {userDetails.isActive ? (
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div className="flex items-center gap-2 text-sm text-slate-600 min-w-0">
                        <Mail className="w-4 h-4" />
                        <span className="truncate">{userDetails.email || "NA"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600 min-w-0">
                        <Phone className="w-4 h-4" />
                        <span>{userDetails.phone}</span>
                        {userDetails.phoneVerified && (
                          <CheckCircle className="w-3 h-3 text-green-600" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <CalendarIcon className="w-4 h-4" />
                        <span>Joined: {formatDateTime(userDetails.joiningDate)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Statistics Section */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-slate-700">Total Orders</span>
                  </div>
                  <p className="text-xl font-bold text-blue-600">{userDetails.totalOrders || 0}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <IndianRupee className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-semibold text-slate-700">Total Spent</span>
                  </div>
                  <p className="text-xl font-bold text-green-600">
                    {"\u20B9"}{(userDetails.totalOrderAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CalendarIcon className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-semibold text-slate-700">Member Since</span>
                  </div>
                  <p className="text-base font-bold text-purple-600">{formatDateTime(userDetails.joiningDate)}</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Wallet className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-semibold text-slate-700">Wallet Balance</span>
                  </div>
                  <p className="text-xl font-bold text-amber-600 mb-2">
                    {"\u20B9"}{(userDetails.walletBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleOpenWalletModal(userDetails, "credit")}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-green-600 text-white text-xs font-semibold px-2 py-1.5 hover:bg-green-700 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                    <button
                      onClick={() => handleOpenWalletModal(userDetails, "debit")}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-red-600 text-white text-xs font-semibold px-2 py-1.5 hover:bg-red-700 transition-colors"
                    >
                      <Minus className="w-3 h-3" /> Deduct
                    </button>
                  </div>
                </div>
              </div>

              {/* Addresses Section */}
              {userDetails.addresses && userDetails.addresses.length > 0 && (
                <div>
                  <h4 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Addresses
                  </h4>
                  <div className="space-y-2">
                    {userDetails.addresses.map((address, index) => (
                      <div key={index} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-slate-700">{address.label || 'Address'}</span>
                          {address.isDefault && (
                            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600">
                          {address.street}
                          {address.additionalDetails && `, ${address.additionalDetails}`}
                          {address.city && `, ${address.city}`}
                          {address.state && `, ${address.state}`}
                          {address.zipCode && ` - ${address.zipCode}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Orders Section */}
              {userDetails.orders && userDetails.orders.length > 0 && (
                <div>
                  <h4 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Recent Orders
                  </h4>
                  <div className="space-y-2">
                    {userDetails.orders.slice(0, 5).map((order, index) => (
                      <div key={index} className="bg-slate-50 rounded-lg p-3 border border-slate-200 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{order.orderId}</p>
                          <p className="text-xs text-slate-600">{order.restaurantName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-900">{"\u20B9"}{(order.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          <p className="text-xs text-slate-600 capitalize">{order.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {userDetails.gender && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-700 mb-1">Gender</p>
                    <p className="text-sm text-slate-600 capitalize">{userDetails.gender}</p>
                  </div>
                )}
                {userDetails.dateOfBirth && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-700 mb-1">Date of Birth</p>
                    <p className="text-sm text-slate-600">
                      {new Date(userDetails.dateOfBirth).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <div className="text-sm text-slate-500">No user details available</div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Wallet Add / Deduct Modal */}
      <Dialog open={!!walletTarget} onOpenChange={(open) => { if (!open) handleCloseWalletModal() }}>
        <DialogContent className="max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-amber-600" />
              {walletType === "credit" ? "Add Money to Wallet" : "Deduct Money from Wallet"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 px-1 py-2">
            <div className="bg-slate-50 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{walletTarget?.name}</span>
              <span className="text-sm text-slate-600">
                Current balance:{" "}
                <span className="font-bold text-slate-900">
                  {walletTargetLoading
                    ? "..."
                    : `${"₹"}${(walletTarget?.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setWalletType("credit")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-semibold transition-colors ${
                  walletType === "credit" ? "bg-green-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Plus className="w-4 h-4" /> Add Money
              </button>
              <button
                type="button"
                onClick={() => setWalletType("debit")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-semibold transition-colors ${
                  walletType === "debit" ? "bg-red-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Minus className="w-4 h-4" /> Deduct Money
              </button>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Amount ({"₹"})</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                placeholder="Ex: 100"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Reason (optional)</label>
              <input
                type="text"
                value={walletReason}
                onChange={(e) => setWalletReason(e.target.value)}
                placeholder="Ex: Goodwill credit / Refund correction"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleCloseWalletModal}
                disabled={walletSubmitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitWalletAdjustment}
                disabled={walletSubmitting || walletTargetLoading}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg text-white transition-all disabled:opacity-50 ${
                  walletType === "credit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {walletSubmitting ? "Processing..." : walletType === "credit" ? "Add Money" : "Deduct Money"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

