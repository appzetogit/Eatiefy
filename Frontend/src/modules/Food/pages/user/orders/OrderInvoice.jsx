import { useParams, Link, useLocation, useNavigate } from "react-router-dom"
import React, { useRef, useState, useEffect, useMemo } from "react"
import { toFoodUserPath } from "@food/utils/mainTabRoutes"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  Download,
  ArrowLeft,
  FileText,
  Printer,
  Receipt,
  AlertCircle,
  Loader2,
  RefreshCw,
  Building2,
  User,
  MapPin,
  CreditCard,
  Calendar,
  CheckCircle2
} from "lucide-react"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { setupPdfFonts } from "@food/utils/pdfFontUtils"
import AnimatedPage from "@food/components/user/AnimatedPage"
import ScrollReveal from "@food/components/user/ScrollReveal"
import { Card, CardHeader, CardTitle, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import { toast } from "sonner"
import { useOrders } from "@food/context/OrdersContext"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { orderAPI } from "@food/api"
import { resolveMediaUrl } from "@/shared/utils/mediaUrl"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import SafeImage from "@food/components/SafeImage"

export default function OrderInvoice() {
  const companyName = useCompanyName()
  const { orderId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { getOrderById } = useOrders()

  const initialOrder = location?.state?.order || (orderId ? getOrderById(orderId) : null)
  const [order, setOrder] = useState(initialOrder)
  const [loading, setLoading] = useState(!initialOrder)
  const [error, setError] = useState(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const invoiceRef = useRef(null)

  const effectiveLookupId = orderId || location?.state?.orderId

  useEffect(() => {
    let isMounted = true

    if (!effectiveLookupId) {
      setLoading(false)
      setError("No order identifier provided")
      return
    }

    const fetchOrder = async () => {
      try {
        if (!order) setLoading(true)
        setError(null)

        const response = await orderAPI.getOrderDetails(effectiveLookupId).catch(() => orderAPI.getOrder(effectiveLookupId))
        const fetched = response?.data?.data?.order || response?.data?.order || response?.data?.data || response?.data

        if (isMounted && fetched && typeof fetched === "object") {
          setOrder(fetched)
        } else if (isMounted && !order) {
          setError("Invoice not found for this order")
        }
      } catch (err) {
        if (isMounted && !order) {
          setError(err?.response?.data?.message || "Failed to load invoice details")
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchOrder()
    return () => { isMounted = false }
  }, [effectiveLookupId])

  const formatDate = (dateString) => {
    if (!dateString) return "N/A"
    try {
      const date = new Date(dateString)
      if (isNaN(date.getTime())) return "N/A"
      return date.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    } catch {
      return "N/A"
    }
  }

  const getAddressString = (addr) => {
    if (!addr) return ""
    if (typeof addr === "string" && addr.trim()) return addr.trim()
    if (typeof addr === "object") {
      if (addr.formattedAddress) return addr.formattedAddress
      if (addr.address && typeof addr.address === "string") return addr.address
      const parts = [
        addr.houseNo || addr.houseNumber,
        addr.buildingName,
        addr.street || addr.streetAddress || addr.addressLine1,
        addr.addressLine2 || addr.landmark,
        addr.area || addr.locality,
        addr.city || addr.town,
        addr.state,
        addr.zipCode || addr.pincode || addr.postalCode
      ].filter(Boolean)
      if (parts.length) return parts.join(", ")
    }
    return ""
  }

  // Safe normalized fields
  const displayOrderId = order?.orderId || order?.orderNumber || order?._id || order?.id || orderId || "N/A"
  const rawStatus = order?.orderStatus || order?.status || "delivered"
  const statusLabel = String(rawStatus).replace(/_/g, " ").toUpperCase()

  const restaurantObj = order?.restaurantId || order?.restaurant || {}
  const restaurantName = order?.restaurantName || restaurantObj.restaurantName || restaurantObj.name || (typeof restaurantObj === 'string' ? restaurantObj : '') || "Restaurant Partner"
  const restaurantAddress = order?.restaurantAddress || getAddressString(restaurantObj.location || restaurantObj.address) || ""

  const customerName = order?.userName || order?.customerName || order?.user?.name || "Customer"
  const customerPhone = order?.userPhone || order?.customerPhone || order?.user?.phone || ""
  const deliveryAddress = getAddressString(order?.deliveryAddress || order?.address || order?.deliveryAddressId || order?.userAddress)

  const items = useMemo(() => {
    const rawItems = Array.isArray(order?.items) ? order.items : (Array.isArray(order?.orderItems) ? order.orderItems : [])
    return rawItems.map((item, idx) => {
      const quantity = Number(item?.quantity || item?.qty || 1)
      const unitPrice = Number(item?.price ?? item?.unitPrice ?? item?.finalPrice ?? item?.pricing?.price ?? 0)
      const totalPrice = Number(item?.total ?? item?.totalPrice ?? (unitPrice * quantity) ?? 0)
      return {
        id: item?._id || item?.id || item?.itemId || item?.productId || idx,
        name: item?.name || item?.title || item?.itemName || "Food Item",
        variantName: item?.variantName || item?.variant?.name || item?.size || "",
        quantity,
        price: unitPrice,
        total: totalPrice,
        image: resolveMediaUrl(item?.image || item?.itemImage || item?.foodImage || dishFallbackImage)
      }
    })
  }, [order?.items, order?.orderItems])

  const pricing = useMemo(() => {
    const rawPricing = order?.pricing || {}
    const calculatedSubtotal = items.reduce((sum, item) => sum + item.total, 0)
    const subtotal = Number(rawPricing.subtotal ?? order?.subtotal ?? rawPricing.originalItemTotal ?? calculatedSubtotal)
    const packagingFee = Number(rawPricing.packagingFee ?? rawPricing.restaurantPackagingFee ?? order?.packagingFee ?? 0)
    const platformFee = Number(rawPricing.platformFee ?? order?.platformFee ?? 0)
    const deliveryFee = Number(rawPricing.deliveryFee ?? order?.deliveryFee ?? 0)
    const tax = Number(rawPricing.tax ?? rawPricing.gst ?? order?.tax ?? 0)
    const discount = Number(rawPricing.discount ?? order?.discount ?? 0)
    const calculatedTotal = subtotal + packagingFee + platformFee + deliveryFee + tax - discount
    const total = Number(rawPricing.total ?? rawPricing.grandTotal ?? order?.total ?? order?.totalAmount ?? order?.amount ?? calculatedTotal)

    return {
      subtotal,
      packagingFee,
      platformFee,
      deliveryFee,
      tax,
      discount,
      total
    }
  }, [order?.pricing, order?.subtotal, order?.packagingFee, order?.platformFee, order?.deliveryFee, order?.tax, order?.discount, order?.total, order?.totalAmount, order?.amount, items])

  const paymentMethod = order?.payment?.method || order?.paymentMethod?.type || order?.paymentMethod || "Online Payment"
  const orderDate = order?.createdAt || order?.date || order?.placedAt

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadPDF = async () => {
    try {
      setDownloadingPdf(true)
      const effectiveCompanyName = (await getCompanyNameAsync()) || companyName || "Eatiefy"
      const doc = new jsPDF()
      setupPdfFonts(doc)

      // Header Banner
      doc.setFontSize(18)
      doc.setFont("Roboto", "bold")
      doc.setTextColor(220, 38, 38) // #1F6B45
      doc.text(`${effectiveCompanyName} - TAX INVOICE`, 105, 18, { align: "center" })

      doc.setFontSize(9)
      doc.setFont("Roboto", "normal")
      doc.setTextColor(100, 100, 100)
      doc.text("Food Delivery & Online Ordering Services", 105, 24, { align: "center" })

      // Meta Details Section
      let yPos = 35
      doc.setFontSize(10)
      doc.setTextColor(30, 30, 30)

      // Invoice / Order Info (Left Column)
      doc.setFont("Roboto", "bold")
      doc.text("Invoice / Order ID:", 14, yPos)
      doc.setFont("Roboto", "normal")
      doc.text(`#${displayOrderId}`, 56, yPos)

      doc.setFont("Roboto", "bold")
      doc.text("Date & Time:", 14, yPos + 6)
      doc.setFont("Roboto", "normal")
      doc.text(formatDate(orderDate), 56, yPos + 6)

      doc.setFont("Roboto", "bold")
      doc.text("Payment Method:", 14, yPos + 12)
      doc.setFont("Roboto", "normal")
      doc.text(String(paymentMethod).toUpperCase(), 56, yPos + 12)

      doc.setFont("Roboto", "bold")
      doc.text("Status:", 14, yPos + 18)
      doc.setFont("Roboto", "normal")
      doc.text(statusLabel, 56, yPos + 18)

      // Right column is x=142..196 (54mm). Wrap text, hard-breaking unbroken
      // long strings so nothing runs off the page.
      const RIGHT_COL_W = 52
      const wrapRight = (text) => {
        const out = []
        for (const line of doc.splitTextToSize(String(text || ""), RIGHT_COL_W)) {
          let rest = line
          while (rest.length > 1 && doc.getTextWidth(rest) > RIGHT_COL_W) {
            let n = rest.length - 1
            while (n > 1 && doc.getTextWidth(rest.slice(0, n)) > RIGHT_COL_W) n--
            out.push(rest.slice(0, n))
            rest = rest.slice(n)
          }
          out.push(rest)
        }
        return out
      }

      // Restaurant & Customer (Right Column)
      doc.setFont("Roboto", "bold")
      doc.text("Restaurant:", 115, yPos)
      doc.setFont("Roboto", "normal")
      const restLines = wrapRight(restaurantName)
      doc.text(restLines, 142, yPos)

      const afterRestY = yPos + (restLines.length * 5)
      doc.setFont("Roboto", "bold")
      doc.text("Customer:", 115, afterRestY + 2)
      doc.setFont("Roboto", "normal")
      const custLines = wrapRight(customerName + (customerPhone ? ` (${customerPhone})` : ""))
      doc.text(custLines, 142, afterRestY + 2)

      const deliverY = afterRestY + 2 + custLines.length * 5 + 1
      if (deliveryAddress) {
        doc.setFont("Roboto", "bold")
        doc.text("Deliver To:", 115, deliverY)
        doc.setFont("Roboto", "normal")
        const addrLines = wrapRight(deliveryAddress)
        doc.text(addrLines, 142, deliverY)
        yPos = Math.max(yPos + 24, deliverY + (addrLines.length * 5))
      } else {
        yPos = Math.max(yPos + 24, deliverY + 6)
      }

      yPos += 6

      // Items Table
      const tableBody = items.map((item) => [
        item.variantName ? `${item.name} (${item.variantName})` : item.name,
        String(item.quantity),
        `₹${item.price.toFixed(2)}`,
        `₹${item.total.toFixed(2)}`
      ])

      autoTable(doc, {
        startY: yPos,
        head: [["Item Description", "Qty", "Unit Price", "Amount"]],
        body: tableBody,
        theme: "striped",
        headStyles: { font: "Roboto", fontStyle: "bold", fillColor: [220, 38, 38], textColor: 255, fontSize: 9 },
        styles: { font: "Roboto", fontSize: 8.5, cellPadding: 3 },
        columnStyles: {
          0: { cellWidth: 95 },
          1: { cellWidth: 20, halign: "center" },
          2: { cellWidth: 35, halign: "right" },
          3: { cellWidth: 35, halign: "right", fontStyle: "bold" }
        }
      })

      const finalY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : yPos + 40

      // Financial Summary Block
      let sumY = finalY + 8
      doc.setFontSize(9)
      doc.setFont("Roboto", "normal")
      doc.setTextColor(60, 60, 60)

      doc.text("Subtotal:", 135, sumY, { align: "right" })
      doc.text(`₹${pricing.subtotal.toFixed(2)}`, 185, sumY, { align: "right" })

      if (pricing.packagingFee > 0) {
        sumY += 5
        doc.text("Packaging Fee:", 135, sumY, { align: "right" })
        doc.text(`₹${pricing.packagingFee.toFixed(2)}`, 185, sumY, { align: "right" })
      }

      if (pricing.platformFee > 0) {
        sumY += 5
        doc.text("Platform Fee:", 135, sumY, { align: "right" })
        doc.text(`₹${pricing.platformFee.toFixed(2)}`, 185, sumY, { align: "right" })
      }

      if (pricing.deliveryFee > 0) {
        sumY += 5
        doc.text("Delivery Fee:", 135, sumY, { align: "right" })
        doc.text(`₹${pricing.deliveryFee.toFixed(2)}`, 185, sumY, { align: "right" })
      }

      if (pricing.tax > 0) {
        sumY += 5
        doc.text("Taxes & GST:", 135, sumY, { align: "right" })
        doc.text(`₹${pricing.tax.toFixed(2)}`, 185, sumY, { align: "right" })
      }

      if (pricing.discount > 0) {
        sumY += 5
        doc.setTextColor(22, 163, 74) // green
        doc.text("Discount:", 135, sumY, { align: "right" })
        doc.text(`-₹${pricing.discount.toFixed(2)}`, 185, sumY, { align: "right" })
        doc.setTextColor(60, 60, 60)
      }

      sumY += 7
      doc.setFontSize(11)
      doc.setFont("Roboto", "bold")
      doc.setTextColor(220, 38, 38)
      doc.text("Grand Total:", 135, sumY, { align: "right" })
      doc.text(`₹${pricing.total.toFixed(2)}`, 185, sumY, { align: "right" })

      // Footer note
      doc.setFontSize(8)
      doc.setFont("Roboto", "normal")
      doc.setTextColor(140, 140, 140)
      doc.text("This is a computer-generated tax invoice and does not require a physical signature.", 105, sumY + 16, { align: "center" })

      const fileName = `Invoice_${displayOrderId}_${Date.now()}.pdf`
      doc.save(fileName)
      toast.success("Invoice downloaded successfully!")
    } catch (err) {
      console.error("[OrderInvoice] Error generating PDF:", err)
      toast.error("Failed to generate PDF. Using print format.")
      handlePrint()
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-slate-50/50 dark:bg-[#141414] p-4 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#1F6B45]" />
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">Loading invoice details...</p>
        </div>
      </AnimatedPage>
    )
  }

  if (error || !order) {
    return (
      <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 via-white to-orange-50/20 dark:from-[#141414] dark:via-[#141414] dark:to-[#141414] p-4">
        <div className="max-w-md mx-auto pt-16 text-center">
          <Card className="shadow-lg border-slate-200 dark:border-zinc-800">
            <CardContent className="py-10 px-6 space-y-4">
              <AlertCircle className="h-12 w-12 mx-auto text-[#1F6B45]" />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {error || "Invoice Not Found"}
              </h1>
              <p className="text-xs text-muted-foreground">
                We couldn't retrieve the invoice for Order #{effectiveLookupId || "N/A"}.
              </p>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                <Button variant="outline" onClick={goBack} className="rounded-xl text-xs h-9">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
                </Button>
                <Link to={toFoodUserPath("/user/orders")}>
                  <Button variant="outline" className="rounded-xl text-xs h-9">
                    All Orders
                  </Button>
                </Link>
                <Link to={toFoodUserPath(`/user/help/orders/${effectiveLookupId || ''}`)}>
                  <Button className="bg-[#1F6B45] hover:bg-[#1A5C3B] text-white rounded-xl text-xs h-9">
                    Get Help
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-orange-50/30 via-white to-gray-50/30 dark:from-[#141414] dark:via-[#141414] dark:to-[#141414] p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        {/* Navigation & Action Bar */}
        <ScrollReveal>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2 sm:mb-4 no-print">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={goBack}
                className="rounded-full h-9 w-9 bg-white dark:bg-zinc-900 shadow-sm border border-slate-200 dark:border-zinc-800"
              >
                <ArrowLeft className="h-4 w-4 text-gray-800 dark:text-white" />
              </Button>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Tax Invoice</h1>
                <p className="text-xs text-muted-foreground font-medium">Order #{displayOrderId}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handlePrint}
                className="flex items-center gap-1.5 text-xs h-9 rounded-xl border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print</span>
              </Button>
              <Button
                onClick={handleDownloadPDF}
                disabled={downloadingPdf}
                className="bg-[#1F6B45] hover:bg-[#14512F] text-white flex items-center gap-1.5 text-xs h-9 rounded-xl shadow-sm transition-all"
              >
                {downloadingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 text-white" />
                )}
                <span>Download PDF</span>
              </Button>
            </div>
          </div>
        </ScrollReveal>

        {/* Printable Invoice Card */}
        <ScrollReveal delay={0.05}>
          <Card ref={invoiceRef} className="shadow-md bg-white dark:bg-zinc-900 border-slate-200/80 dark:border-zinc-800 rounded-2xl overflow-hidden print:shadow-none print:border-0">
            <CardContent className="p-4 sm:p-6 md:p-8 space-y-6">
              {/* Header */}
              <div className="border-b border-slate-100 dark:border-zinc-800 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 bg-red-50 dark:bg-red-950/30 rounded-xl text-[#1F6B45]">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight">TAX INVOICE</h2>
                      <p className="text-xs text-muted-foreground font-medium">{companyName} Food Delivery</p>
                    </div>
                  </div>
                  <Badge className="bg-emerald-600 text-white text-xs px-3 py-1 font-semibold w-fit self-start sm:self-center">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {statusLabel}
                  </Badge>
                </div>
              </div>

              {/* Invoice Meta Breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 text-xs sm:text-sm">
                {/* Left: Order Info & Billed To */}
                <div className="space-y-3 p-3.5 bg-slate-50/70 dark:bg-zinc-800/40 rounded-xl border border-slate-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                    <User className="w-4 h-4 text-[#1F6B45]" />
                    <span>Billed To / Customer:</span>
                  </div>
                  <div className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
                    <p className="font-semibold text-gray-900 dark:text-white break-all">{customerName}</p>
                    {customerPhone && <p>{customerPhone}</p>}
                    {deliveryAddress ? (
                      <div className="flex items-start gap-1 pt-1 text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>{deliveryAddress}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Right: Restaurant & Order Meta */}
                <div className="space-y-3 p-3.5 bg-slate-50/70 dark:bg-zinc-800/40 rounded-xl border border-slate-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                    <Building2 className="w-4 h-4 text-[#1F6B45]" />
                    <span>Order Details:</span>
                  </div>
                  <div className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
                    <p>
                      <strong className="text-gray-900 dark:text-white">Invoice #:</strong> #{displayOrderId}
                    </p>
                    <p>
                      <strong className="text-gray-900 dark:text-white">Date:</strong> {formatDate(orderDate)}
                    </p>
                    <p>
                      <strong className="text-gray-900 dark:text-white">Restaurant:</strong> {restaurantName}
                    </p>
                    <p>
                      <strong className="text-gray-900 dark:text-white">Payment Mode:</strong> {paymentMethod}
                    </p>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h3 className="font-bold text-xs sm:text-sm text-gray-900 dark:text-white uppercase tracking-wider">
                  Ordered Items:
                </h3>
                <div className="overflow-x-auto border border-slate-100 dark:border-zinc-800 rounded-xl">
                  <table className="w-full text-xs sm:text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-zinc-800/60 text-gray-700 dark:text-gray-300 border-b border-slate-100 dark:border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Item</th>
                        <th className="py-2.5 px-3 font-semibold text-center w-16">Qty</th>
                        <th className="py-2.5 px-3 font-semibold text-right w-24">Unit Price</th>
                        <th className="py-2.5 px-3 font-semibold text-right w-28">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 text-gray-800 dark:text-gray-200">
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-4 px-3 text-center text-xs text-muted-foreground">
                            No item breakdown available
                          </td>
                        </tr>
                      ) : (
                        items.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/30">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2.5">
                                <SafeImage
                                  src={item.image}
                                  fallbackSrc={dishFallbackImage}
                                  alt={item.name}
                                  loading="eager"
                                  className="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-slate-100 dark:bg-zinc-800"
                                />
                                <div>
                                  <span className="font-semibold block">{item.name}</span>
                                  {item.variantName ? (
                                    <span className="text-[11px] text-muted-foreground">{item.variantName}</span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center font-medium">{item.quantity}</td>
                            <td className="py-2.5 px-3 text-right text-muted-foreground">₹{item.price.toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-right font-bold">₹{item.total.toFixed(2)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Breakdown Section */}
              <div className="flex justify-end pt-2">
                <div className="w-full sm:w-72 space-y-2 p-3.5 bg-slate-50/60 dark:bg-zinc-800/40 rounded-xl border border-slate-100 dark:border-zinc-800 text-xs sm:text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span className="font-medium text-gray-900 dark:text-white">₹{pricing.subtotal.toFixed(2)}</span>
                  </div>

                  {pricing.packagingFee > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Packaging Fee:</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{pricing.packagingFee.toFixed(2)}</span>
                    </div>
                  )}

                  {pricing.platformFee > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Platform Fee:</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{pricing.platformFee.toFixed(2)}</span>
                    </div>
                  )}

                  {pricing.deliveryFee > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Delivery Fee:</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{pricing.deliveryFee.toFixed(2)}</span>
                    </div>
                  )}

                  {pricing.tax > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Taxes & GST:</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{pricing.tax.toFixed(2)}</span>
                    </div>
                  )}

                  {pricing.discount > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                      <span>Discount:</span>
                      <span>-₹{pricing.discount.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-200 dark:border-zinc-700 flex justify-between font-bold text-sm sm:text-base text-[#1F6B45]">
                    <span>Grand Total:</span>
                    <span>₹{pricing.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Invoice Footer */}
              <div className="pt-4 border-t border-slate-100 dark:border-zinc-800 text-center text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-gray-700 dark:text-gray-300">Thank you for ordering with {companyName}!</p>
                <p>This is a system-generated electronic receipt for your records.</p>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Action Links */}
        <ScrollReveal delay={0.1}>
          <div className="flex gap-3 no-print pb-[calc(6rem+env(safe-area-inset-bottom))]">
            <Link to={toFoodUserPath(`/user/orders/${displayOrderId}`)} className="flex-1">
              <Button variant="outline" className="w-full rounded-xl border-slate-200 dark:border-zinc-800 text-xs sm:text-sm h-10">
                Track Order
              </Button>
            </Link>
            <Link to={toFoodUserPath("/user/orders")} className="flex-1">
              <Button variant="outline" className="w-full rounded-xl border-slate-200 dark:border-zinc-800 text-xs sm:text-sm h-10">
                All Orders
              </Button>
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </AnimatedPage>
  )
}
