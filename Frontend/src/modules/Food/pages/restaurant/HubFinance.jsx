import { useState, useMemo, useRef, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Bell, Menu, ChevronDown, Calendar, Download, ArrowRight, FileText, Wallet, X, ArrowLeft } from "lucide-react"
import { useLocation } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import BottomNavOrders from "@food/components/restaurant/BottomNavOrders"
import { restaurantAPI } from "@food/api"
import { DateRangeCalendar } from "@food/components/ui/date-range-calendar"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }


export default function HubFinance() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useRestaurantBackNavigation()
  const showBack = location.state?.from
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => {
    const tabParam = searchParams.get("tab")
    return tabParam === "invoices" ? "invoices" : "payouts"
  })
  const [selectedDateRange, setSelectedDateRange] = useState("Last 30 days")
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showDateRangePicker, setShowDateRangePicker] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  const downloadMenuRef = useRef(null)
  const dateRangePickerRef = useRef(null)
  const [financeData, setFinanceData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pastCyclesData, setPastCyclesData] = useState(null)
  const [loadingPastCycles, setLoadingPastCycles] = useState(false)
  const [restaurantData, setRestaurantData] = useState(null)
  const [loadingRestaurant, setLoadingRestaurant] = useState(true)
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)
  useEffect(() => {
    if (showWithdrawalModal || showDateRangePicker || showCalendar) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [showWithdrawalModal, showDateRangePicker, showCalendar])
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false)
  const [withdrawalRequests, setWithdrawalRequests] = useState([])
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false)

  // Fetch finance data on mount
  useEffect(() => {
    const fetchFinanceData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getFinance()
        if (response.data?.success && response.data?.data) {
          const data = response.data.data
          setFinanceData(data)
          debugLog('? Finance data fetched:', data)
        }
      } catch (error) {
        // Suppress 401 errors as they're handled by axios interceptor (token refresh/redirect)
        if (error.response?.status !== 401) {
          debugError('? Error fetching finance data:', error)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchFinanceData()
  }, [])

  useEffect(() => {
    const fetchWithdrawals = async () => {
      try {
        setLoadingWithdrawals(true)
        const response = await restaurantAPI.getWithdrawalHistory()
        const payload = response?.data?.data
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.withdrawals)
            ? payload.withdrawals
            : []
        setWithdrawalRequests(list)
      } catch (error) {
        if (error?.response?.status !== 401) {
          debugError('Error fetching withdrawal history:', error)
        }
        setWithdrawalRequests([])
      } finally {
        setLoadingWithdrawals(false)
      }
    }

    fetchWithdrawals()
  }, [])

  // Fetch restaurant data for header display
  useEffect(() => {
    // Use restaurant data from financeData if available, otherwise fetch separately
    if (financeData?.restaurant) {
      setRestaurantData(financeData.restaurant)
    } else {
      const fetchRestaurantData = async () => {
        try {
          const response = await restaurantAPI.getRestaurantByOwner()
          const data = response?.data?.data?.restaurant || response?.data?.restaurant || response?.data?.data
          if (data) {
            setRestaurantData({
              name: data.name,
              restaurantId: data.restaurantId || data._id,
              address: data.location?.address || data.location?.formattedAddress || data.address || ''
            })
          }
        } catch (error) {
          // Suppress 401 errors as they're handled by axios interceptor
          if (error.response?.status !== 401) {
            debugError('? Error fetching restaurant data:', error)
          }
        }
      }
      fetchRestaurantData()
    }
  }, [financeData])

  // Format restaurant ID to REST###### format (e.g., REST005678)
  const formatRestaurantId = (restaurantId) => {
    if (!restaurantId) return ''

    // Extract numeric part from the end (e.g., "REST-1768762345335-5678" -> "5678")
    const strId = String(restaurantId)
    const numericMatch = strId.match(/(\d+)$/)

    if (numericMatch) {
      const numericPart = numericMatch[1]
      // Take last 6 digits and pad with zeros if needed
      const lastDigits = numericPart.slice(-6).padStart(6, '0')
      return `REST${lastDigits}`
    }

    // Fallback: if no numeric part found, use original
    return strId
  }

  // Get current cycle dates from API response or use default
  const currentCycleDates = useMemo(() => {
    if (financeData?.currentCycle) {
      return {
        start: financeData.currentCycle.start.day,
        end: financeData.currentCycle.end.day,
        month: financeData.currentCycle.start.month,
        year: financeData.currentCycle.start.year
      }
    }
    return {
      start: "15",
      end: "21",
      month: "Dec",
      year: "25"
    }
  }, [financeData])

  const invoiceOrders = useMemo(() => {
    const allOrdersMap = new Map()

    // Add current cycle orders first
    const current = financeData?.currentCycle?.orders || []
    current.forEach(order => {
      const id = order.orderId || order._id || order.id
      if (id) {
        allOrdersMap.set(id, order)
      }
    })

    // Add past cycles orders, avoiding duplicates already in current map
    const past = pastCyclesData?.orders || []
    past.forEach(order => {
      const id = order.orderId || order._id || order.id
      if (id && !allOrdersMap.has(id)) {
        allOrdersMap.set(id, order)
      }
    })

    return Array.from(allOrdersMap.values())
  }, [financeData, pastCyclesData])

  const invoiceSummary = useMemo(() => {
    const earnings = invoiceOrders.reduce((sum, order) => sum + (Number(order.payout || order.restaurantEarning || 0) || 0), 0)
    const commission = invoiceOrders.reduce((sum, order) => sum + (Number(order.commission || 0) || 0), 0)
    const gross = invoiceOrders.reduce((sum, order) => {
      const orderGross = order.restaurantGross ?? order.grossAmount ?? ((Number(order.payout || order.restaurantEarning || 0) || 0) + (Number(order.commission || 0) || 0))
      return sum + (Number(orderGross) || 0)
    }, 0)
    return { earnings, commission, gross, count: invoiceOrders.length }
  }, [invoiceOrders])

  const handleViewDetails = () => {
    navigate("/food/restaurant/finance-details", { state: { financeData, restaurantData, from: location.pathname } })
  }

  const getWithdrawalStatusClass = (statusRaw) => {
    const status = String(statusRaw || '').trim().toLowerCase()
    if (status === 'approved') return 'bg-green-100 text-green-700'
    if (status === 'rejected') return 'bg-red-100 text-red-700'
    return 'bg-amber-100 text-amber-700'
  }

  const formatWithdrawalStatus = (statusRaw) => {
    const status = String(statusRaw || '').trim().toLowerCase()
    if (!status) return 'Pending'
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  const formatDateTime = (dateValue) => {
    if (!dateValue) return 'N/A'
    const date = new Date(dateValue)
    if (Number.isNaN(date.getTime())) return 'N/A'
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }

  // Parse date range string to extract start and end dates
  const parseDateRange = (dateRangeStr) => {
    try {
      if (!dateRangeStr || typeof dateRangeStr !== 'string') return null;

      // Handle relative ranges
      const today = new Date();
      if (dateRangeStr === "Last 7 days") {
        const start = new Date();
        start.setDate(today.getDate() - 7);
        return { startDate: start.toISOString(), endDate: today.toISOString() };
      }
      if (dateRangeStr === "Last 30 days" || dateRangeStr === "Last 1 month") {
        const start = new Date();
        start.setDate(today.getDate() - 30);
        return { startDate: start.toISOString(), endDate: today.toISOString() };
      }
      if (dateRangeStr === "This week") {
        const start = new Date();
        const day = today.getDay();
        start.setDate(today.getDate() - day);
        return { startDate: start.toISOString(), endDate: today.toISOString() };
      }
      if (dateRangeStr === "This month") {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return { startDate: start.toISOString(), endDate: today.toISOString() };
      }

      const parts = dateRangeStr.split(' - ')
      if (parts.length !== 2) return null

      const startStr = parts[0].trim().replace("'", " ")
      const endStr = parts[1].trim().replace("'", " ")

      const currentYear = new Date().getFullYear()
      const startParts = startStr.split(' ')
      const endParts = endStr.split(' ')

      if (startParts.length < 2 || endParts.length < 2) return null

      const monthMap = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
      }

      const startDay = parseInt(startParts[0])
      const startMonth = monthMap[startParts[1]]
      const endDay = parseInt(endParts[0])
      const endMonth = monthMap[endParts[1]]
      
      const startYear = startParts.length > 2 ? parseInt('20' + startParts[2]) : currentYear
      const endYear = endParts.length > 2 ? parseInt('20' + endParts[2]) : currentYear

      if (startMonth === undefined || endMonth === undefined || isNaN(startDay) || isNaN(endDay)) {
        return null
      }

      const start = new Date(startYear, startMonth, startDay)
      const end = new Date(endYear, endMonth, endDay)

      return {
        startDate: start.toISOString(),
        endDate: end.toISOString()
      }
    } catch (error) {
      debugError('Error parsing date range:', error)
      return null
    }
  }

  // Fetch past cycles data when date range changes
  const fetchPastCyclesData = async (startDate, endDate) => {
    if (!startDate || !endDate) {
      setPastCyclesData(null)
      return
    }

    try {
      setLoadingPastCycles(true)
      // Validate dates and format as ISO strings
      const startDateObj = startDate instanceof Date ? startDate : new Date(startDate)
      const endDateObj = endDate instanceof Date ? endDate : new Date(endDate)

      // Check if dates are valid
      if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
        debugError('Invalid date values:', { startDate, endDate })
        setPastCyclesData(null)
        return
      }

      const formatLocalISO = (d) => {
        const pad = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      }

      const startDateISO = formatLocalISO(startDateObj)
      const endDateISO = formatLocalISO(endDateObj)

      const response = await restaurantAPI.getFinance({
        startDate: startDateISO,
        endDate: endDateISO
      })
      if (response.data?.success && response.data?.data?.pastCycles) {
        setPastCyclesData(response.data.data.pastCycles)
        debugLog('? Past cycles data fetched:', response.data.data.pastCycles)
        debugLog('?? Orders array:', response.data.data.pastCycles?.orders)
        debugLog('?? Total orders:', response.data.data.pastCycles?.totalOrders)
      } else {
        setPastCyclesData(null)
      }
    } catch (error) {
      // Suppress 401 errors as they're handled by axios interceptor (token refresh/redirect)
      if (error.response?.status !== 401) {
        debugError('? Error fetching past cycles data:', error)
      }
      setPastCyclesData(null)
    } finally {
      setLoadingPastCycles(false)
    }
  }

  // Fetch past cycles data on mount and when date range changes
  useEffect(() => {
    const dateRange = parseDateRange(selectedDateRange)
    if (dateRange && dateRange.startDate && dateRange.endDate) {
      fetchPastCyclesData(dateRange.startDate, dateRange.endDate)
    } else {
      // If date range is invalid, don't fetch
      setPastCyclesData(null)
    }
  }, [selectedDateRange])


  // Prepare report data from real finance data
  const getReportData = () => {
    const restaurantName = financeData?.restaurant?.name || "Restaurant"
    const restaurantId = financeData?.restaurant?.restaurantId || "N/A"
    const currentCycle = financeData?.currentCycle || {}

    // Get all orders (current cycle + past cycles) - DEDUPLICATED
    const allOrdersMap = new Map()

    // Add current cycle orders first
    if (financeData?.currentCycle?.orders && Array.isArray(financeData.currentCycle.orders)) {
      financeData.currentCycle.orders.forEach(order => {
        if (order.orderId) {
          allOrdersMap.set(order.orderId, {
            ...order,
            cycle: 'Current Cycle'
          })
        }
      })
    }

    // Add past cycles orders (ignoring duplicates already in current map)
    if (pastCyclesData?.orders && Array.isArray(pastCyclesData.orders)) {
      pastCyclesData.orders.forEach(order => {
        if (order.orderId && !allOrdersMap.has(order.orderId)) {
          allOrdersMap.set(order.orderId, {
            ...order,
            cycle: 'Past Cycle'
          })
        }
      })
    }

    const allOrders = Array.from(allOrdersMap.values())

    return {
      restaurantName,
      restaurantId,
      dateRange: selectedDateRange,
      currentCycle: {
        start: currentCycleDates.start,
        end: currentCycleDates.end,
        month: currentCycleDates.month,
        year: currentCycleDates.year,
        estimatedPayout: `₹${(currentCycle.estimatedPayout || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        orders: currentCycle.totalOrders || 0,
        // The backend's processed-withdrawal timestamp, formatted exactly like
        // the payout history screen so the report and the app agree. Never the
        // report-generation date.
        payoutDate: currentCycle.payoutDate
          ? new Date(currentCycle.payoutDate).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : "No payout processed yet"
      },
      pastCycles: pastCyclesData,
      allOrders: allOrders
    }
  }

  // Generate HTML content for the report
  const generateHTMLContent = (reportData) => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Finance Report - ${reportData.dateRange}</title>
        <meta charset="UTF-8">
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 40px;
            color: #333;
            background-color: #fff;
            width: 794px; /* A4 width at 96dpi */
            box-sizing: border-box;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            color: #000;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .header p {
            margin: 5px 0;
            font-size: 14px;
            color: #444;
          }
          .section {
            margin-bottom: 30px;
            clear: both;
          }
          .section-title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 15px;
            color: #000;
            border-left: 4px solid #000;
            padding-left: 10px;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px dashed #ddd;
          }
          .current-cycle {
            background-color: #fcfcfc;
            padding: 25px;
            border: 1px solid #eee;
            border-radius: 12px;
            margin-bottom: 25px;
          }
          .payout-amount {
            font-size: 36px;
            font-weight: 800;
            color: #000;
            margin: 10px 0;
          }
          .orders-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-top: 20px;
            border: 1px solid #000;
          }
          .orders-table th {
            background-color: #f2f2f2;
            padding: 12px 8px;
            text-align: left;
            border: 1px solid #000;
            font-weight: bold;
            font-size: 11px;
            text-transform: uppercase;
          }
          .orders-table td {
            padding: 10px 8px;
            border: 1px solid #000;
            font-size: 11px;
            word-wrap: break-word;
            vertical-align: top;
          }
          .footer {
            margin-top: 50px;
            padding-top: 25px;
            border-top: 1px solid #000;
            text-align: center;
            font-size: 12px;
            color: #555;
          }
          @media print {
            body { padding: 20px; width: auto; }
            .current-cycle { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Finance Report</h1>
          <p>${reportData.restaurantName}</p>
          <p>ID: ${reportData.restaurantId}</p>
          <p>Generated on: ${new Date().toLocaleString('en-IN')}</p>
        </div>

        <div class="section">
          <div class="section-title">Current Cycle</div>
          <div class="current-cycle">
            <p style="font-size: 12px; color: #666; margin: 0 0 5px 0;">
              Est. payout (${reportData.currentCycle.start} - ${reportData.currentCycle.end} ${reportData.currentCycle.month})
            </p>
            <div class="payout-amount">${reportData.currentCycle.estimatedPayout}</div>
            <p style="font-size: 14px; color: #666; margin: 5px 0;">${reportData.currentCycle.orders} orders</p>
            <div class="info-row">
              <div>
                <p class="info-label" style="font-size: 11px; margin: 5px 0;">Payout for</p>
                <p style="margin: 0; font-weight: 600;">${reportData.currentCycle.start} - ${reportData.currentCycle.end} ${reportData.currentCycle.month}'${reportData.currentCycle.year}</p>
              </div>
              <div style="text-align: right;">
                <p class="info-label" style="font-size: 11px; margin: 5px 0;">Payout date</p>
                <p style="margin: 0; font-weight: 600;">${reportData.currentCycle.payoutDate}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Detailed Order Wise Report</div>
          ${reportData.allOrders && reportData.allOrders.length > 0 ? `
            <table class="orders-table">
              <thead>
                <tr>
                  <th style="width: 14%;">Cycle</th>
                  <th style="width: 15%;">Order ID</th>
                  <th style="width: 12%;">Date</th>
                  <th style="width: 28%;">Items</th>
                  <th style="width: 8%;">Qty</th>
                  <th style="width: 11%;">Amount</th>
                  <th style="width: 12%;">Earning</th>
                </tr>
              </thead>
              <tbody>
                ${reportData.allOrders.map(order => {
      const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN') : (order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-IN') : 'N/A')
      const foodItems = order.foodNames || (order.items && order.items.map(item => item.name).join(', ')) || 'N/A'
      const itemQuantities = order.items ? order.items.map(item => (item.quantity || 1).toString()).join(', ') : 'N/A'
      const orderAmount = (order.restaurantGross ?? order.grossAmount ?? ((Number(order.payout || order.restaurantEarning || 0) || 0) + (Number(order.commission || 0) || 0))) || order.orderTotal || 0
      const earning = order.payout || order.restaurantEarning || 0

      return `
                    <tr>
                      <td>${order.cycle || 'N/A'}</td>
                      <td>${order.orderId || 'N/A'}</td>
                      <td>${orderDate}</td>
                      <td>${foodItems}</td>
                      <td>${itemQuantities}</td>
                      <td>₹${orderAmount.toFixed(2)}</td>
                      <td>₹${earning.toFixed(2)}</td>
                    </tr>
                  `
    }).join('')}
              </tbody>
              <tfoot>
                <tr style="background-color: #e8f5e9; font-weight: bold;">
                  <td colspan="5" style="text-align: right;">Total Earnings:</td>
                  <td colspan="2">₹${reportData.allOrders.reduce((sum, order) => sum + (order.payout || order.restaurantEarning || 0), 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          ` : `
          <div class="info-row">
            <span class="info-label">Status:</span>
              <span class="info-value">No orders available</span>
          </div>
          `}
        </div>

        <div class="footer">
          <p>This is an auto-generated report. For detailed information, please visit the Finance section.</p>
          <p>Total Orders: ${reportData.allOrders?.length || 0} | Total Earnings: ₹${reportData.allOrders?.reduce((sum, order) => sum + (order.payout || order.restaurantEarning || 0), 0).toFixed(2) || '0.00'}</p>
        </div>
      </body>
      </html>
    `
  }

  // Download PDF report - Direct download without print dialog
  const downloadPDF = async () => {
    try {
      setShowDownloadMenu(false)

      const reportData = getReportData()
      const htmlContent = generateHTMLContent(reportData)

      debugLog('?? Generating PDF...')

      // Create a temporary hidden iframe to render HTML properly
      const iframe = document.createElement('iframe')
      iframe.style.position = 'absolute'
      iframe.style.left = '-9999px'
      iframe.style.top = '0'
      iframe.style.width = '210mm'
      iframe.style.height = '297mm'
      iframe.style.border = 'none'
      document.body.appendChild(iframe)

      // Write HTML to iframe
      iframe.contentDocument.open()
      iframe.contentDocument.write(htmlContent)
      iframe.contentDocument.close()

      // Wait for iframe content to load
      await new Promise((resolve) => {
        if (iframe.contentDocument.readyState === 'complete') {
          resolve()
        } else {
          iframe.contentWindow.onload = resolve
          setTimeout(resolve, 1000) // Fallback timeout
        }
      })

      // Wait a bit more for styles to apply
      await new Promise(resolve => setTimeout(resolve, 500))

      // Import html2canvas and jsPDF dynamically
      debugLog('?? Loading libraries...')
      const html2canvas = (await import('html2canvas')).default
      const { default: jsPDF } = await import('jspdf')

      // Get the body element from iframe
      const iframeBody = iframe.contentDocument.body

      debugLog('?? Converting to canvas...')
      // Convert HTML to canvas
      const canvas = await html2canvas(iframeBody, {
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: iframeBody.scrollWidth,
        height: iframeBody.scrollHeight
      })

      debugLog('? Canvas created:', canvas.width, 'x', canvas.height)

      // Remove temporary iframe
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe)
      }

      // Calculate PDF dimensions
      const imgWidth = 210 // A4 width in mm
      const pageHeight = 297 // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      debugLog('?? PDF dimensions:', imgWidth, 'x', imgHeight, 'mm')

      // Create PDF
      const pdf = new jsPDF('p', 'mm', 'a4')
      let heightLeft = imgHeight
      let position = 0

      // Add first page
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      // Add additional pages if content is longer than one page
      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }

      // Download PDF
      const fileName = `finance-report-${reportData.dateRange.replace(/\s+/g, '-').replace(/'/g, '')}_${new Date().toISOString().split("T")[0]}.pdf`
      debugLog('?? Downloading PDF:', fileName)
      pdf.save(fileName)
      debugLog('? PDF downloaded successfully!')
    } catch (error) {
      debugError('? Error downloading PDF:', error)
      debugError('Error details:', error.stack)
      alert(`Failed to download PDF: ${error.message}. Please check console for details.`)
      setShowDownloadMenu(false)
    }
  }

  // Close download menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target)) {
        setShowDownloadMenu(false)
      }
    }

    if (showDownloadMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDownloadMenu])

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Navbar */}
      <div className="sticky bg-white top-0 z-40 px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between gap-3">
          {showBack && (
            <button
              onClick={goBack}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5 text-gray-900" />
            </button>
          )}
          <div className="flex-1 min-w-0 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className="text-lg font-bold text-gray-900 truncate">
                  {restaurantData?.name || financeData?.restaurant?.name || "Restaurant"}
                </p>
                <ChevronDown className="w-4 h-4 text-gray-600 flex-shrink-0" />
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                {(() => {
                  const restaurantId = restaurantData?.restaurantId || financeData?.restaurant?.restaurantId
                  const address = restaurantData?.address || financeData?.restaurant?.address || ''
                  const parts = []
                  if (restaurantId) {
                    const formattedId = formatRestaurantId(restaurantId)
                    parts.push(`ID: ${formattedId}`)
                  }
                  if (address) {
                    const shortAddress = address.length > 40 ? address.substring(0, 40) + '...' : address
                    parts.push(shortAddress)
                  }
                  return parts.length > 0 ? parts.join(' • ') : 'Loading...'
                })()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <button
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              onClick={() => navigate("/food/restaurant/withdrawal-history", { state: { from: location.pathname } })}
              title="Withdrawal History"
            >
              <Wallet className="w-5 h-5 text-gray-700" />
            </button>
            <button
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              onClick={() => navigate("/food/restaurant/notifications", { state: { from: location.pathname } })}
            >
              <Bell className="w-5 h-5 text-gray-700" />
            </button>
            <button
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              onClick={() => navigate("/food/restaurant/explore")}
            >
              <Menu className="w-5 h-5 text-gray-700" />
            </button>
          </div>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("payouts")}
            className={`flex-1 py-3 px-4 rounded-full font-medium text-sm transition-colors ${activeTab === "payouts"
                ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white"
                : "bg-white text-gray-600 border border-gray-300"
              }`}
          >
            Payouts
          </button>
          <button
            onClick={() => setActiveTab("invoices")}
            className={`flex-1 py-3 px-4 rounded-full font-medium text-sm transition-colors ${activeTab === "invoices"
                ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white"
                : "bg-white text-gray-600 border border-gray-300"
              }`}
          >
            Invoices & Taxes
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom,16px))]">
        {activeTab === "payouts" && (
          <div className="space-y-6">
            {/* Current cycle */}
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-3">Current cycle</h2>
              <div className="bg-white rounded-lg p-4">
                {loading ? (
                  <div className="py-8 text-center text-gray-500">Loading...</div>
                ) : (
                  <>
                    <p className="text-4xl font-bold text-gray-900 mb-2">
                      ₹{(financeData?.currentCycle?.estimatedPayout || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-sm text-gray-600 mb-4">
                      {financeData?.currentCycle?.totalOrders || 0} {financeData?.currentCycle?.totalOrders === 1 ? 'order' : 'orders'}
                    </p>
                    <button
                      onClick={() => { setWithdrawalAmount(''); setShowWithdrawalModal(true) }}
                      disabled={!(financeData?.currentCycle?.estimatedPayout > 0)}
                      className={`w-full py-3 px-4 rounded-lg font-semibold flex items-center justify-center gap-2 mt-4 transition-colors ${financeData?.currentCycle?.estimatedPayout > 0
                          ? "bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white hover:bg-gray-800"
                          : "bg-gray-200 text-gray-500 cursor-not-allowed"
                        }`}
                    >
                      <Wallet className="h-5 w-5" />
                      Withdraw
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Withdrawal Requests */}
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-3">Withdrawal requests</h2>
              <div className="bg-white rounded-lg p-4">
                {loadingWithdrawals ? (
                  <div className="py-6 text-center text-sm text-gray-500">Loading withdrawal requests...</div>
                ) : withdrawalRequests.length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-500">No withdrawal requests found.</div>
                ) : (
                  <div className="space-y-3">
                    {withdrawalRequests.slice(0, 8).map((request, index) => {
                      const status = formatWithdrawalStatus(request?.status)
                      const isRejected = String(request?.status || '').toLowerCase() === 'rejected'
                      const reason = request?.rejectionReason || request?.reason || request?.adminNote
                      return (
                        <div
                          key={request?._id || request?.id || index}
                          className={`border rounded-lg p-3 ${isRejected ? 'border-red-200 bg-red-50/20' : 'border-gray-200'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">
                                ₹{Number(request?.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Requested: {formatDateTime(request?.createdAt || request?.requestedAt)}
                              </p>
                              {request?.processedAt ? (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {isRejected ? 'Rejected' : 'Processed'}: {formatDateTime(request?.processedAt)}
                                </p>
                              ) : null}
                            </div>
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getWithdrawalStatusClass(request?.status)}`}>
                              {status}
                            </span>
                          </div>
                          {isRejected && reason ? (
                            <div className="mt-2.5 pt-2 border-t border-red-100 flex items-start gap-1.5 text-xs text-red-700">
                              <span className="font-semibold shrink-0">Reason:</span>
                              <span className="break-words">{reason}</span>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}

                    {withdrawalRequests.length > 8 ? (
                      <button
                        type="button"
                        onClick={() => navigate("/food/restaurant/withdrawal-history")}
                        className="w-full text-sm font-medium text-black hover:underline pt-1"
                      >
                        View all requests
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Past cycles */}
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-3">Past cycles</h2>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1 relative" ref={dateRangePickerRef}>
                    <button
                      onClick={() => setShowDateRangePicker(!showDateRangePicker)}
                      className="w-full bg-white rounded-lg px-4 py-3 flex items-center justify-between border border-gray-200 hover:border-gray-300 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-600" />
                        <span className="text-sm font-medium text-gray-900">{selectedDateRange}</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-600 transition-transform ${showDateRangePicker ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Date Range Picker Dropdown */}
                    <AnimatePresence>
                      {showDateRangePicker && (
                        <>
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 z-[60]"
                            onClick={() => setShowDateRangePicker(false)}
                          />
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
                            onClick={() => setShowDateRangePicker(false)}
                          >
                            <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-sm max-h-[80vh] flex flex-col">
                              <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                                <h3 className="text-lg font-bold text-gray-900">Select Date Range</h3>
                                <button onClick={() => setShowDateRangePicker(false)} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                                  <X className="w-5 h-5 text-gray-500" />
                                </button>
                              </div>
                              <div className="p-2 overflow-y-auto custom-scrollbar">
                                <div className="space-y-1">
                                  {(() => {
                                const getDateRanges = () => {
                                  const today = new Date()
                                  today.setHours(23, 59, 59, 999)

                                  // Today
                                  const todayStart = new Date(today)
                                  todayStart.setHours(0, 0, 0, 0)

                                  // Last 7 days
                                  const last7DaysStart = new Date(today)
                                  last7DaysStart.setDate(today.getDate() - 7)
                                  last7DaysStart.setHours(0, 0, 0, 0)

                                  // Last 30 days
                                  const last30DaysStart = new Date(today)
                                  last30DaysStart.setDate(today.getDate() - 30)
                                  last30DaysStart.setHours(0, 0, 0, 0)

                                  // This week (Monday to Sunday)
                                  const currentDay = today.getDay()
                                  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1
                                  const thisWeekStart = new Date(today)
                                  thisWeekStart.setDate(today.getDate() - daysFromMonday)
                                  thisWeekStart.setHours(0, 0, 0, 0)
                                  const thisWeekEnd = new Date(thisWeekStart)
                                  thisWeekEnd.setDate(thisWeekStart.getDate() + 6)
                                  thisWeekEnd.setHours(23, 59, 59, 999)

                                  // Last week
                                  const lastWeekStart = new Date(thisWeekStart)
                                  lastWeekStart.setDate(thisWeekStart.getDate() - 7)
                                  const lastWeekEnd = new Date(thisWeekEnd)
                                  lastWeekEnd.setDate(thisWeekEnd.getDate() - 7)

                                  // This month
                                  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
                                  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999)

                                  // Last month
                                  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
                                  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999)

                                  return {
                                    today,
                                    todayStart,
                                    last7DaysStart,
                                    last30DaysStart,
                                    thisWeekStart,
                                    thisWeekEnd,
                                    lastWeekStart,
                                    lastWeekEnd,
                                    thisMonthStart,
                                    thisMonthEnd,
                                    lastMonthStart,
                                    lastMonthEnd
                                  }
                                }

                                const formatDateForDisplay = (date) => {
                                  const day = date.getDate()
                                  const month = date.toLocaleString('en-US', { month: 'short' })
                                  const year = date.getFullYear().toString().slice(-2)
                                  return `${day} ${month}'${year}`
                                }

                                const formatDateRange = (start, end) => {
                                  return `${formatDateForDisplay(start)} - ${formatDateForDisplay(end)}`
                                }

                                const ranges = getDateRanges()
                                const dateOptions = [
                                  {
                                    label: "Today",
                                    range: formatDateRange(ranges.todayStart, ranges.today),
                                    startDate: ranges.todayStart,
                                    endDate: ranges.today
                                  },
                                  {
                                    label: "Last 7 days",
                                    range: formatDateRange(ranges.last7DaysStart, ranges.today),
                                    startDate: ranges.last7DaysStart,
                                    endDate: ranges.today
                                  },
                                  {
                                    label: "Last 30 days",
                                    range: formatDateRange(ranges.last30DaysStart, ranges.today),
                                    startDate: ranges.last30DaysStart,
                                    endDate: ranges.today
                                  },
                                  {
                                    label: "This week",
                                    range: formatDateRange(ranges.thisWeekStart, ranges.thisWeekEnd),
                                    startDate: ranges.thisWeekStart,
                                    endDate: ranges.thisWeekEnd
                                  },
                                  {
                                    label: "Last week",
                                    range: formatDateRange(ranges.lastWeekStart, ranges.lastWeekEnd),
                                    startDate: ranges.lastWeekStart,
                                    endDate: ranges.lastWeekEnd
                                  },
                                  {
                                    label: "This month",
                                    range: formatDateRange(ranges.thisMonthStart, ranges.thisMonthEnd),
                                    startDate: ranges.thisMonthStart,
                                    endDate: ranges.thisMonthEnd
                                  },
                                  {
                                    label: "Last month",
                                    range: formatDateRange(ranges.lastMonthStart, ranges.lastMonthEnd),
                                    startDate: ranges.lastMonthStart,
                                    endDate: ranges.lastMonthEnd
                                  },
                                  {
                                    label: "Custom date range",
                                    custom: true
                                  }
                                ]

                                return dateOptions.map((option, index) => (
                                  <button
                                    key={index}
                                    onClick={() => {
                                      if (option.custom) {
                                        setShowDateRangePicker(false)
                                        setShowCalendar(true)
                                      } else {
                                        setSelectedDateRange(option.range)
                                        setStartDate(option.startDate)
                                        setEndDate(option.endDate)
                                        setShowDateRangePicker(false)
                                        fetchPastCyclesData(option.startDate, option.endDate)
                                      }
                                    }}
                                    className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 transition-colors text-sm"
                                  >
                                    <div className="font-medium text-gray-900">{option.label}</div>
                                    {!option.custom && <div className="text-xs text-gray-500">{option.range}</div>}
                                  </button>
                                ))
                              })()}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>

              {/* Custom Date Range Calendar */}
              <AnimatePresence>
                {showCalendar && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="fixed inset-0 bg-black/50 z-[60]"
                      onClick={() => setShowCalendar(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96, y: 16 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: 16 }}
                      transition={{ duration: 0.2 }}
                      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
                      onClick={() => setShowCalendar(false)}
                    >
                      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
                        <DateRangeCalendar
                          startDate={startDate}
                          endDate={endDate}
                          onDateRangeChange={(start, end) => {
                            setStartDate(start)
                            setEndDate(end)
                            
                            if (start && end) {
                              const formatDateForDisplay = (date) => {
                                const day = date.getDate()
                                const month = date.toLocaleString('en-US', { month: 'short' })
                                const year = date.getFullYear().toString().slice(-2)
                                return `${day} ${month}'${year}`
                              }
                              
                              setSelectedDateRange(`${formatDateForDisplay(start)} - ${formatDateForDisplay(end)}`)
                              setShowCalendar(false)
                              fetchPastCyclesData(start, end)
                            }
                          }}
                          onClose={() => setShowCalendar(false)}
                        />
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              </div>
                  <div className="relative" ref={downloadMenuRef}>
                    <button
                      onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                      className="bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-lg px-4 py-3 flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span className="text-sm font-medium">Get report</span>
                      <ChevronDown className="w-4 h-4" />
                    </button>

                    <AnimatePresence>
                      {showDownloadMenu && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -10 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 py-2 z-50 min-w-[180px]"
                        >
                          <button
                            onClick={downloadPDF}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <div className="w-6 h-6 rounded-md bg-red-50 flex items-center justify-center">
                              <FileText className="w-4 h-4 text-[#2E7D52]" />
                            </div>
                            <span>Download PDF</span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                
                {/* Order count */}
                {!loadingPastCycles && pastCyclesData && pastCyclesData.orders && (
                  <p className="text-sm font-medium text-gray-500 mb-3 px-1">
                    {pastCyclesData.orders.length} orders found
                  </p>
                )}

                {loadingPastCycles ? (
                  <div className="bg-white rounded-lg p-4">
                    <p className="text-sm text-gray-600 text-center">Loading past cycles...</p>
                  </div>
                ) : (
                  <>
                    {/* Show past cycles orders if available */}
                    {pastCyclesData && pastCyclesData.orders && pastCyclesData.orders.length > 0 ? (
                      <div className="bg-white rounded-lg p-4 space-y-3">
                        {pastCyclesData.orders.map((order, index) => (
                          <div key={order.orderId || index} className="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 mb-1">
                                  Order ID: {order.orderId || 'N/A'}
                                </p>
                                <p className="text-xs text-gray-500 mb-1">
                                  {formatDateTime(order.createdAt || order.deliveredAt)}
                                </p>
                                <p className="text-xs text-gray-600">
                                  {order.foodNames || (order.items && order.items.map(item => item.name).join(', ')) || 'N/A'}
                                </p>
                              </div>
                              <div className="text-right ml-4">
                                <p className="text-sm font-bold text-gray-900">
                                  ₹{(order.payout || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Earning
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (pastCyclesData && pastCyclesData.orders && pastCyclesData.orders.length === 0) ? (
                      <div className="bg-white rounded-lg p-8 text-center border border-dashed border-gray-300">
                        <p className="text-sm text-gray-500 italic">No orders found for this selected range.</p>
                      </div>
                    ) : null}

                    {/* Show current cycle orders if past cycles data is not requested or not being viewed */}
                    {(!pastCyclesData || !pastCyclesData.orders) && !loadingPastCycles && financeData?.currentCycle?.orders && financeData.currentCycle.orders.length > 0 && (
                      <div className="bg-white rounded-lg p-4 space-y-3">
                        {financeData.currentCycle.orders.map((order, index) => (
                          <div key={order.orderId || index} className="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 mb-1">
                                  Order ID: {order.orderId || 'N/A'}
                                </p>
                                <p className="text-xs text-gray-500 mb-1">
                                  {formatDateTime(order.createdAt || order.deliveredAt)}
                                </p>
                                <p className="text-xs text-gray-600">
                                  {order.foodNames || (order.items && order.items.map(item => item.name).join(', ')) || 'N/A'}
                                </p>
                              </div>
                              <div className="text-right ml-4">
                                <p className="text-sm font-bold text-gray-900">
                                  ₹{(order.payout || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Earning
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(!pastCyclesData || (!pastCyclesData.orders || pastCyclesData.orders.length === 0)) &&
                      (!financeData?.currentCycle?.orders || financeData.currentCycle.orders.length === 0) &&
                      !loadingPastCycles && !loading && (
                        <div className="bg-white rounded-lg p-12 text-center border border-gray-200">
                          <p className="text-gray-400 mb-2">No transaction history available</p>
                          <p className="text-xs text-gray-500">Your earnings and order payouts will appear here.</p>
                        </div>
                      )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "invoices" && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Invoices & Taxes Summary</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-md bg-gray-50 p-3">
                  <p className="text-xs text-gray-600">Orders</p>
                  <p className="text-base font-semibold text-gray-900">{invoiceSummary.count}</p>
                </div>
                <div className="rounded-md bg-gray-50 p-3">
                  <p className="text-xs text-gray-600">Earnings</p>
                  <p className="text-base font-semibold text-gray-900">₹{invoiceSummary.earnings.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div className="rounded-md bg-gray-50 p-3">
                  <p className="text-xs text-gray-600">Commission</p>
                  <p className="text-base font-semibold text-gray-900">₹{invoiceSummary.commission.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div className="rounded-md bg-gray-50 p-3">
                  <p className="text-xs text-gray-600">Gross amount</p>
                  <p className="text-base font-semibold text-gray-900">₹{invoiceSummary.gross.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Order invoice details</h3>
              {loading ? (
                <p className="text-sm text-gray-500">Loading invoice data...</p>
              ) : invoiceOrders.length === 0 ? (
                <p className="text-sm text-gray-500">No invoice data available for selected range.</p>
              ) : (
                <div className="space-y-2">
                  {invoiceOrders.map((order, index) => {
                    const orderGross = order.restaurantGross ?? order.grossAmount ?? ((Number(order.payout || order.restaurantEarning || 0) || 0) + (Number(order.commission || 0) || 0))
                    return (
                      <div key={`${order.orderId || index}-invoice`} className="border border-gray-100 rounded-md p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-900">Order: {order.orderId || "N/A"}</p>
                            <p className="text-xs text-gray-600 mt-0.5">
                              {order.paymentMethod || "N/A"} | {order.orderStatus || "N/A"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900">
                              ₹{(Number(orderGross) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-gray-500">Gross</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Withdrawal Modal */}
      <AnimatePresence>
        {showWithdrawalModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50"
              onClick={() => setShowWithdrawalModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 my-auto max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900">Withdraw Amount</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setShowWithdrawalModal(false)
                      setWithdrawalAmount('')
                    }}
                    className="p-1.5 hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-gray-700"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    Available Balance: <span className="font-semibold text-gray-900">₹{(financeData?.currentCycle?.estimatedPayout || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </p>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Enter Amount to Withdraw
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={withdrawalAmount}
                    onChange={(e) => {
                      let val = e.target.value.replace(/[^0-9.]/g, '')
                      // Remove multiple dots
                      const parts = val.split('.')
                      if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('')
                      // Remove leading zeros unless it's "0."
                      if (val.length > 1 && val.startsWith('0') && !val.startsWith('0.')) {
                        val = val.replace(/^0+/, '')
                      }
                      setWithdrawalAmount(val)
                    }}
                    autoComplete="off"
                    placeholder="Enter amount"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#2E7D52] focus:border-transparent outline-none text-base transition-all"
                  />
                  {withdrawalAmount && parseFloat(withdrawalAmount) > (financeData?.currentCycle?.estimatedPayout || 0) && (
                    <p className="text-sm text-red-600 mt-1.5 font-medium">Amount cannot exceed available balance</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowWithdrawalModal(false)
                      setWithdrawalAmount('')
                    }}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const amount = parseFloat(withdrawalAmount)
                      if (!amount || amount <= 0) {
                        alert('Please enter a valid amount')
                        return
                      }
                      if (amount > (financeData?.currentCycle?.estimatedPayout || 0)) {
                        alert('Amount cannot exceed available balance')
                        return
                      }

                      try {
                        setSubmittingWithdrawal(true)
                        const response = await restaurantAPI.createWithdrawalRequest(amount)
                        if (response.data?.success) {
                          alert('Withdrawal request submitted successfully!')
                          setShowWithdrawalModal(false)
                          setWithdrawalAmount('')
                          // Refresh finance data
                          const financeResponse = await restaurantAPI.getFinance()
                          if (financeResponse.data?.success && financeResponse.data?.data) {
                            setFinanceData(financeResponse.data.data)
                          }
                          const withdrawalResponse = await restaurantAPI.getWithdrawalHistory()
                          const withdrawalPayload = withdrawalResponse?.data?.data
                          const withdrawalList = Array.isArray(withdrawalPayload)
                            ? withdrawalPayload
                            : Array.isArray(withdrawalPayload?.withdrawals)
                              ? withdrawalPayload.withdrawals
                              : []
                          setWithdrawalRequests(withdrawalList)
                        } else {
                          alert(response.data?.message || 'Failed to submit withdrawal request')
                        }
                      } catch (error) {
                        debugError('Error submitting withdrawal request:', error)
                        alert(error.response?.data?.message || 'Failed to submit withdrawal request. Please try again.')
                      } finally {
                        setSubmittingWithdrawal(false)
                      }
                    }}
                    disabled={submittingWithdrawal || !withdrawalAmount || parseFloat(withdrawalAmount) <= 0 || parseFloat(withdrawalAmount) > (financeData?.currentCycle?.estimatedPayout || 0)}
                    className="flex-1 px-4 py-3 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submittingWithdrawal ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {!showWithdrawalModal && <BottomNavOrders />}
    </div>
  )
}








