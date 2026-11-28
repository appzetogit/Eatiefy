import { useState, useMemo } from "react"
import { exportToExcel, exportToPDF } from "./ordersExportUtils"
import { resolveRestaurantItemUnitPrice, resolveItemMarkupUnit } from "@food/utils/restaurantOrderPricing"
const debugError = (...args) => {}

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatMoney = (value) => `Rs. ${toNumber(value).toFixed(2)}`

const formatOrderDate = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return new Date().toLocaleDateString()
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).toUpperCase()
}

const formatOrderTime = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).toUpperCase()
}

const getOriginalOrder = (order) => order?.originalOrder || order || {}

const getOrderAmount = (order) => {
  const originalOrder = getOriginalOrder(order)
  return toNumber(
    originalOrder.pricing?.total ??
      originalOrder.totalAmount ??
      originalOrder.total ??
      order.totalAmount ??
      order.total ??
      0
  )
}

const getPaymentStatus = (order) => {
  const originalOrder = getOriginalOrder(order)
  return String(
    originalOrder.payment?.status ??
      originalOrder.paymentStatus ??
      order.paymentStatus ??
      ""
  ).toLowerCase()
}

const getDeliveryType = (order) => {
  const originalOrder = getOriginalOrder(order)
  return String(originalOrder.deliveryType ?? order.deliveryType ?? "").toLowerCase()
}

const getRestaurantName = (order) =>
  String(order.restaurantName ?? order.restaurant ?? getOriginalOrder(order).restaurantName ?? "").trim()

const parseFilterDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

const getOrderCreatedAt = (order) => {
  const originalOrder = getOriginalOrder(order)
  const createdAt = originalOrder.createdAt ?? order.createdAt
  const date = createdAt ? new Date(createdAt) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

const buildInvoiceModel = (order) => {
  const originalOrder = getOriginalOrder(order)
  const items = Array.isArray(originalOrder.items)
    ? originalOrder.items
    : Array.isArray(order.items)
      ? order.items
      : []

  const pricing = originalOrder.pricing || order.pricing || {}
  const computedBase = items.reduce((sum, item) => {
    const quantity = toNumber(item?.quantity || 1)
    const unitPrice = resolveRestaurantItemUnitPrice(item)
    return sum + quantity * unitPrice
  }, 0)
  const computedMarkup = items.reduce((sum, item) => {
    const quantity = toNumber(item?.quantity || 1)
    return sum + quantity * resolveItemMarkupUnit(item)
  }, 0)
  const baseSubtotal = toNumber(
    originalOrder.baseSubtotal ??
    order.baseSubtotal ??
    pricing.baseSubtotal ??
    (computedBase > 0 ? computedBase : (originalOrder.totalItemAmount ?? order.totalItemAmount)) ??
    0
  )
  const markupTotal = toNumber(
    originalOrder.markupTotal ??
    order.markupTotal ??
    pricing.markupTotal ??
    computedMarkup ??
    0
  )
  const subtotal = baseSubtotal

  const packagingFee = toNumber(
    pricing.packagingFee ??
    originalOrder.packagingCharge ??
    originalOrder.packagingFee ??
    order.packagingCharge ??
    order.packagingFee ??
    0
  )
  const platformFee = toNumber(
    pricing.platformFee ??
    originalOrder.platformFee ??
    originalOrder.platformCharge ??
    order.platformFee ??
    order.platformCharge ??
    0
  )
  const deliveryFee = toNumber(pricing.deliveryFee ?? originalOrder.deliveryCharge ?? originalOrder.deliveryFee ?? order.deliveryCharge ?? order.deliveryFee)
  const taxAmount = toNumber(pricing.tax ?? originalOrder.taxAmount ?? originalOrder.tax ?? order.taxAmount ?? order.tax)
  const discountAmount = toNumber(pricing.discount ?? originalOrder.discountAmount ?? originalOrder.couponDiscount ?? order.discountAmount ?? order.couponDiscount)
  const totalAmount = getOrderAmount(order)
  const createdAt = getOrderCreatedAt(order)

  return {
    orderId: order.orderId || originalOrder.orderId || originalOrder.id || "N/A",
    orderDate: formatOrderDate(createdAt),
    orderTime: formatOrderTime(createdAt),
    customerName: order.userName || originalOrder.customerName || originalOrder.userName || "N/A",
    customerPhone: order.userNumber || originalOrder.customerPhone || originalOrder.userNumber || originalOrder.deliveryAddress?.phone || "N/A",
    restaurantName: getRestaurantName(order) || "N/A",
    deliveryPartnerName: order.deliveryBoyName || originalOrder.deliveryPartnerName || originalOrder.deliveryBoyName || originalOrder.deliveryPartnerId?.name || originalOrder.dispatch?.deliveryPartnerId?.name || "Not assigned",
    deliveryPartnerPhone: order.deliveryBoyNumber || originalOrder.deliveryPartnerPhone || originalOrder.deliveryBoyNumber || originalOrder.deliveryPartnerId?.phone || originalOrder.dispatch?.deliveryPartnerId?.phone || "N/A",
    status: order.status || originalOrder.orderStatus || originalOrder.status || "N/A",
    paymentStatus: originalOrder.payment?.status || originalOrder.paymentStatus || "N/A",
    paymentType: originalOrder.payment?.method || originalOrder.paymentType || originalOrder.paymentMethod || "N/A",
    items,
    baseSubtotal,
    markupTotal,
    subtotal,
    packagingFee,
    platformFee,
    deliveryFee,
    taxAmount,
    discountAmount,
    totalAmount,
  }
}

export function useGenericTableManagement(data, title, searchFields = []) {
  const [searchQuery, setSearchQuery] = useState("")
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isViewOrderOpen, setIsViewOrderOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [filters, setFilters] = useState({
    paymentStatus: "",
    deliveryType: "",
    minAmount: "",
    maxAmount: "",
    fromDate: "",
    toDate: "",
    restaurant: "",
  })
  const [visibleColumns, setVisibleColumns] = useState({})

  const filteredData = useMemo(() => {
    let result = [...data]

    if (searchQuery.trim() && searchFields.length > 0) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter((item) =>
        searchFields.some((field) => {
          const value = item[field]
          return value && value.toString().toLowerCase().includes(query)
        })
      )
    }

    if (filters.paymentStatus) {
      result = result.filter((item) => getPaymentStatus(item) === filters.paymentStatus.toLowerCase())
    }

    if (filters.deliveryType) {
      result = result.filter((item) => getDeliveryType(item) === filters.deliveryType.toLowerCase())
    }

    if (filters.minAmount !== "") {
      const minAmount = toNumber(filters.minAmount)
      result = result.filter((item) => getOrderAmount(item) >= minAmount)
    }

    if (filters.maxAmount !== "") {
      const maxAmount = toNumber(filters.maxAmount)
      result = result.filter((item) => getOrderAmount(item) <= maxAmount)
    }

    if (filters.restaurant) {
      result = result.filter((item) => getRestaurantName(item) === filters.restaurant)
    }

    const fromDate = parseFilterDate(filters.fromDate)
    if (fromDate) {
      result = result.filter((item) => {
        const orderDate = getOrderCreatedAt(item)
        return orderDate ? orderDate >= fromDate : false
      })
    }

    const toDate = parseFilterDate(filters.toDate)
    if (toDate) {
      toDate.setHours(23, 59, 59, 999)
      result = result.filter((item) => {
        const orderDate = getOrderCreatedAt(item)
        return orderDate ? orderDate <= toDate : false
      })
    }

    return result
  }, [data, searchQuery, filters, searchFields])

  const count = filteredData.length

  const activeFiltersCount = useMemo(() => {
    return Object.values(filters).filter((value) => value !== "" && value !== null && value !== undefined).length
  }, [filters])

  const handleApplyFilters = () => {
    setIsFilterOpen(false)
  }

  const handleResetFilters = () => {
    setFilters({
      paymentStatus: "",
      deliveryType: "",
      minAmount: "",
      maxAmount: "",
      fromDate: "",
      toDate: "",
      restaurant: "",
    })
  }

  const handleExport = async (format) => {
    const filename = title.toLowerCase().replace(/\s+/g, "_")
    switch (format) {
      case "excel":
        exportToExcel(filteredData, filename)
        break
      case "pdf":
        await exportToPDF(filteredData, filename)
        break
      default:
        break
    }
  }

  const handleViewOrder = (order) => {
    setSelectedOrder(order)
    setIsViewOrderOpen(true)
  }

  const handlePrintOrder = async (order) => {
    try {
      const { default: jsPDF } = await import("jspdf")
      const { default: autoTable } = await import("jspdf-autotable")
      const invoice = buildInvoiceModel(order)

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      })
      const pageWidth = doc.internal.pageSize.getWidth()

      doc.setFontSize(18)
      doc.setTextColor(30, 30, 30)
      doc.text("Order Invoice", 105, 20, { align: "center" })

      doc.setFontSize(12)
      doc.setTextColor(100, 100, 100)
      doc.text(`Order ID: ${invoice.orderId}`, 105, 28, { align: "center" })
      doc.setFontSize(10)
      doc.text(`Date: ${invoice.orderDate}${invoice.orderTime ? `, ${invoice.orderTime}` : ""}`, 105, 34, { align: "center" })

      let startY = 45

      const infoRows = [
        ["Customer", invoice.customerName],
        ["Phone", invoice.customerPhone],
        ["Restaurant", invoice.restaurantName],
        ["Delivery Boy", invoice.deliveryPartnerName],
        ["Delivery Phone", invoice.deliveryPartnerPhone],
        ["Payment Status", invoice.paymentStatus],
        ["Payment Type", invoice.paymentType],
        ["Order Status", invoice.status],
      ]

      autoTable(doc, {
        startY,
        body: infoRows,
        theme: "grid",
        styles: {
          fontSize: 9,
          cellPadding: 3,
          textColor: [30, 30, 30],
        },
        columnStyles: {
          0: { cellWidth: 42, fontStyle: "bold", fillColor: [248, 250, 252] },
          1: { cellWidth: 134 },
        },
        margin: { left: 14, right: 14 },
      })

      startY = (doc.lastAutoTable?.finalY || startY) + 8

      const tableData =
        invoice.items.length > 0
          ? invoice.items.map((item) => {
              const quantity = toNumber(item?.quantity || 1)
              const itemName = item?.name || item?.itemName || item?.title || "Item"
              const itemPrice = resolveRestaurantItemUnitPrice(item)
              return [
                quantity,
                itemName,
                formatMoney(itemPrice),
                formatMoney(quantity * itemPrice),
              ]
            })
          : [[1, "Order Total", formatMoney(invoice.totalAmount), formatMoney(invoice.totalAmount)]]

      autoTable(doc, {
        startY,
        head: [["Qty", "Item Name", "Price", "Total"]],
        body: tableData,
        theme: "striped",
        headStyles: {
          fillColor: [59, 130, 246],
          textColor: 255,
          fontStyle: "bold",
          fontSize: 10,
        },
        bodyStyles: {
          fontSize: 9,
          textColor: [30, 30, 30],
        },
        alternateRowStyles: {
          fillColor: [245, 247, 250],
        },
        styles: {
          cellPadding: 4,
          lineColor: [200, 200, 200],
          lineWidth: 0.5,
        },
        columnStyles: {
          0: { cellWidth: 20, halign: "center" },
          1: { cellWidth: 80 },
          2: { cellWidth: 35, halign: "right" },
          3: { cellWidth: 35, halign: "right", fontStyle: "bold" },
        },
        margin: { left: 14, right: 14 },
      })

      startY = (doc.lastAutoTable?.finalY || startY) + 10

      const summaryRows = [
        ["Subtotal (Restaurant)", formatMoney(invoice.baseSubtotal ?? invoice.subtotal ?? invoice.totalAmount)],
        ...(invoice.markupTotal > 0 ? [["Admin Pricing", `+ ${formatMoney(invoice.markupTotal)}`]] : []),
        ["Packaging Fee", formatMoney(invoice.packagingFee)],
        ["Delivery Fee", formatMoney(invoice.deliveryFee)],
        ["Platform Fee", formatMoney(invoice.platformFee)],
        ["Tax", formatMoney(invoice.taxAmount)],
        ...(invoice.discountAmount > 0 ? [["Coupon Discount", `- ${formatMoney(invoice.discountAmount)}`]] : []),
        ["Grand Total", formatMoney(invoice.totalAmount)],
      ]

      const summaryBoxWidth = 80
      const summaryBoxX = pageWidth - 14 - summaryBoxWidth
      const summaryBoxY = startY - 4
      const summaryBoxHeight = summaryRows.length * 6.5 + 4

      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(226, 232, 240)
      doc.roundedRect(summaryBoxX, summaryBoxY, summaryBoxWidth, summaryBoxHeight, 2, 2, "FD")

      autoTable(doc, {
        startY,
        body: summaryRows,
        theme: "plain",
        styles: {
          fontSize: 9.5,
          textColor: [30, 30, 30],
          cellPadding: { top: 1.5, right: 0, bottom: 1.5, left: 0 },
          valign: "middle",
        },
        columnStyles: {
          0: { cellWidth: 40, fontStyle: "bold", halign: "left" },
          1: { cellWidth: 36, halign: "right" },
        },
        margin: { left: summaryBoxX + 2, right: 14 },
        tableWidth: 76,
        didParseCell: (hookData) => {
          if (hookData.row.index === summaryRows.length - 1) {
            hookData.cell.styles.fontStyle = "bold"
            hookData.cell.styles.fontSize = 10.5
          }
        },
      })

      const filename = `Invoice_${invoice.orderId}_${new Date().toISOString().split("T")[0]}.pdf`
      doc.save(filename)
    } catch (error) {
      debugError("Error generating PDF invoice:", error)
      alert("Failed to download PDF invoice. Please try again.")
    }
  }

  const toggleColumn = (columnKey) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [columnKey]: !prev[columnKey],
    }))
  }

  const resetColumns = (defaultColumns) => {
    setVisibleColumns(defaultColumns || {})
  }

  return {
    searchQuery,
    setSearchQuery,
    isFilterOpen,
    setIsFilterOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isViewOrderOpen,
    setIsViewOrderOpen,
    selectedOrder,
    filters,
    setFilters,
    visibleColumns,
    filteredData,
    count,
    activeFiltersCount,
    handleApplyFilters,
    handleResetFilters,
    handleExport,
    handleViewOrder,
    handlePrintOrder,
    toggleColumn,
    resetColumns,
  }
}
