import { setupPdfFonts } from "@food/utils/pdfFontUtils"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const formatMoney = (value) => `₹${Number(value || 0).toFixed(2)}`

// Export utility functions for orders
export const exportToCSV = (orders, filename = "orders") => {
  // Detect order structure
  const firstOrder = orders[0]
  const isSubscription = firstOrder?.subscriptionId
  const isOrderDetectDelivery = firstOrder?.userName && firstOrder?.orderDate
  const isDispatch = firstOrder?.id && !firstOrder?.orderId
  
  let headers, rows
  
  if (isSubscription) {
    headers = ["SI", "Subscription ID", "Order Type", "Duration", "Restaurant", "Customer Name", "Customer Phone", "Status", "Total Orders", "Delivered"]
    rows = orders.map((order, index) => [
      index + 1,
      order.subscriptionId,
      order.orderType,
      order.duration,
      order.restaurant,
      order.customerName,
      order.customerPhone,
      order.status,
      order.totalOrders,
      order.delivered
    ])
  } else if (isOrderDetectDelivery) {
    headers = ["SI", "Order ID", "Order Date", "Order Time", "Customer Name", "Customer Phone", "Restaurant Name", "Delivery Boy Name", "Delivery Boy Phone", "Status", "Packaging Charge", "Delivery Fee", "Platform Charge", "Total Amount", "Payment Status"]
    rows = orders.map((order, index) => {
      const originalOrder = order.originalOrder || {}
      const pricing = originalOrder.pricing || {}
      const packagingFee = Number(pricing.packagingFee ?? originalOrder.packagingFee ?? order.packagingFee ?? 0)
      const deliveryFee = Number(pricing.deliveryFee ?? originalOrder.deliveryCharge ?? originalOrder.deliveryFee ?? 0)
      const platformFee = Number(pricing.platformFee ?? originalOrder.platformFee ?? order.platformFee ?? 0)
      const totalAmount = pricing.total || originalOrder.totalAmount || originalOrder.total || 0
      const s = String(originalOrder.payment?.status || "").toLowerCase()
      let paymentStatus = originalOrder.paymentStatus || 'N/A'
      if (s === "paid" || s === "captured" || s === "settled") paymentStatus = "Paid"
      else if (s === "cod_pending") paymentStatus = "COD Pending"
      else if (s === "refunded") paymentStatus = "Refunded"
      else if (s === "failed") paymentStatus = "Failed"

      return [
        order.sl || index + 1,
        order.orderId || 'N/A',
        order.orderDate || 'N/A',
        order.orderTime || 'N/A',
        order.userName || 'N/A',
        order.userNumber || 'N/A',
        order.restaurantName || 'N/A',
        order.deliveryBoyName || 'N/A',
        order.deliveryBoyNumber || 'N/A',
        order.status || 'N/A',
        formatMoney(packagingFee),
        formatMoney(deliveryFee),
        formatMoney(platformFee),
        totalAmount > 0 ? formatMoney(totalAmount) : 'N/A',
        paymentStatus
      ]
    })
  } else {
    headers = ["SI", "Order ID", "Order Date", "Customer Name", "Customer Phone", "Restaurant", "Total Amount", "Payment Status", "Order Status", "Delivery Type"]
    rows = orders.map((order, index) => [
      index + 1,
      order.orderId || order.id,
      `${order.date}${order.time ? `, ${order.time}` : ""}`,
      order.customerName,
      order.customerPhone,
      order.restaurant,
      order.total || formatMoney(order.totalAmount || 0),
      (order.payment?.status === "paid" || order.payment?.status === "captured" || order.payment?.status === "settled" ? "Paid" :
       order.payment?.status === "cod_pending" ? "COD Pending" :
       order.payment?.status === "refunded" ? "Refunded" :
       order.payment?.status === "failed" ? "Failed" :
       order.paymentStatus || ""),
      order.orderStatus || "",
      order.deliveryType || ""
    ])
  }
  
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.csv`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const exportToExcel = (orders, filename = "orders") => {
  if (!orders || orders.length === 0) {
    alert("No data to export")
    return
  }

  // Detect order structure
  const firstOrder = orders[0]
  const isSubscription = firstOrder?.subscriptionId
  const isOrderDetectDelivery = firstOrder?.userName && firstOrder?.orderDate // OrderDetectDelivery format
  
  let headers, rows
  
  if (isSubscription) {
    headers = ["SI", "Subscription ID", "Order Type", "Duration", "Restaurant", "Customer Name", "Customer Phone", "Status", "Total Orders", "Delivered"]
    rows = orders.map((order, index) => [
      index + 1,
      order.subscriptionId,
      order.orderType,
      order.duration,
      order.restaurant,
      order.customerName,
      order.customerPhone,
      order.status,
      order.totalOrders,
      order.delivered
    ])
  } else if (isOrderDetectDelivery) {
    // OrderDetectDelivery format - includes delivery boy info and payment details
    headers = ["SI", "Order ID", "Order Date", "Order Time", "Customer Name", "Customer Phone", "Restaurant Name", "Delivery Boy Name", "Delivery Boy Phone", "Status", "Packaging Charge", "Delivery Fee", "Platform Charge", "Total Amount", "Payment Status"]
    rows = orders.map((order, index) => {
      const originalOrder = order.originalOrder || {}
      const pricing = originalOrder.pricing || {}
      const packagingFee = Number(pricing.packagingFee ?? originalOrder.packagingFee ?? order.packagingFee ?? 0)
      const deliveryFee = Number(pricing.deliveryFee ?? originalOrder.deliveryCharge ?? originalOrder.deliveryFee ?? 0)
      const platformFee = Number(pricing.platformFee ?? originalOrder.platformFee ?? order.platformFee ?? 0)
      const totalAmount = pricing.total || originalOrder.totalAmount || originalOrder.total || 0
      const s = String(originalOrder.payment?.status || "").toLowerCase()
      let paymentStatus = originalOrder.paymentStatus || 'N/A'
      if (s === "paid" || s === "captured" || s === "settled") paymentStatus = "Paid"
      else if (s === "cod_pending") paymentStatus = "COD Pending"
      else if (s === "refunded") paymentStatus = "Refunded"
      else if (s === "failed") paymentStatus = "Failed"
      
      return [
        order.sl || index + 1,
        order.orderId || 'N/A',
        order.orderDate || 'N/A',
        order.orderTime || 'N/A',
        order.userName || 'N/A',
        order.userNumber || 'N/A',
        order.restaurantName || 'N/A',
        order.deliveryBoyName || 'N/A',
        order.deliveryBoyNumber || 'N/A',
        order.status || 'N/A',
        formatMoney(packagingFee),
        formatMoney(deliveryFee),
        formatMoney(platformFee),
        totalAmount > 0 ? formatMoney(totalAmount) : 'N/A',
        paymentStatus
      ]
    })
  } else {
    headers = ["SI", "Order ID", "Order Date", "Customer Name", "Customer Phone", "Restaurant", "Total Amount", "Payment Status", "Order Status", "Delivery Type"]
    rows = orders.map((order, index) => [
      index + 1,
      order.orderId || order.id,
      `${order.date || ''}${order.time ? `, ${order.time}` : ""}`,
      order.customerName || 'N/A',
      order.customerPhone || 'N/A',
      order.restaurant || 'N/A',
      order.total || formatMoney(order.totalAmount || 0),
      (order.payment?.status === "paid" || order.payment?.status === "captured" || order.payment?.status === "settled" ? "Paid" :
       order.payment?.status === "cod_pending" ? "COD Pending" :
       order.payment?.status === "refunded" ? "Refunded" :
       order.payment?.status === "failed" ? "Failed" :
       order.paymentStatus || 'N/A'),
      order.orderStatus || 'N/A',
      order.deliveryType || 'N/A'
    ])
  }
  
  // Helper function to escape HTML and format cell values
  const escapeHtml = (value) => {
    if (value === null || value === undefined) return ''
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  
  // Create HTML table for better Excel compatibility with UTF-8 encoding
  const htmlContent = `
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          table { 
            border-collapse: collapse; 
            width: 100%; 
            font-family: Arial, sans-serif;
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 8px; 
            text-align: left; 
          }
          th { 
            background-color: #3b82f6; 
            color: white; 
            font-weight: bold; 
            text-align: center;
          }
          td { 
            white-space: nowrap; 
          }
          tr:nth-child(even) {
            background-color: #f9fafb;
          }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                ${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </body>
    </html>
  `
  
  const blob = new Blob([htmlContent], { type: "application/vnd.ms-excel;charset=utf-8" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.xls`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const exportToPDF = async (orders, filename = "orders") => {
  if (!orders || orders.length === 0) {
    alert("No data to export")
    return
  }

  try {
    // Dynamic import of jsPDF and autoTable for instant download
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    
    // Detect order structure
    const firstOrder = orders[0]
    const isSubscription = firstOrder?.subscriptionId
    const isOrderDetectDelivery = firstOrder?.userName && firstOrder?.orderDate // OrderDetectDelivery format
    
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    })
    setupPdfFonts(doc)

    // Add title
    doc.setFontSize(16)
    doc.setTextColor(30, 30, 30)
    const title = filename.charAt(0).toUpperCase() + filename.slice(1).replace(/_/g, ' ')
    doc.text(title, 148, 15, { align: 'center' })
    
    // Add export info
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    const exportDate = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    doc.text(`Exported on: ${exportDate} | Total Records: ${orders.length}`, 148, 22, { align: 'center' })
    
    let headers, tableData
    
    if (isSubscription) {
      headers = [["SI", "Subscription ID", "Order Type", "Duration", "Restaurant", "Customer Name", "Customer Phone", "Status", "Total Orders", "Delivered"]]
      tableData = orders.map((order, index) => [
        index + 1,
        order.subscriptionId || 'N/A',
        order.orderType || 'N/A',
        order.duration || 'N/A',
        order.restaurant || 'N/A',
        order.customerName || 'N/A',
        order.customerPhone || 'N/A',
        order.status || 'N/A',
        order.totalOrders || 0,
        order.delivered || 'N/A'
      ])
    } else if (isOrderDetectDelivery) {
      // OrderDetectDelivery format - includes delivery boy info and payment details
      headers = [["SI", "Order ID", "Order Date", "Customer Name", "Restaurant Name", "Delivery Boy", "Status", "Packaging", "Delivery", "Platform", "Total", "Payment"]]
      tableData = orders.map((order, index) => {
        const originalOrder = order.originalOrder || {}
        const pricing = originalOrder.pricing || {}
        const packagingFee = Number(pricing.packagingFee ?? originalOrder.packagingFee ?? order.packagingFee ?? 0)
        const deliveryFee = Number(pricing.deliveryFee ?? originalOrder.deliveryCharge ?? originalOrder.deliveryFee ?? 0)
        const platformFee = Number(pricing.platformFee ?? originalOrder.platformFee ?? order.platformFee ?? 0)
        const totalAmount = pricing.total || originalOrder.totalAmount || originalOrder.total || 0
        const s = String(originalOrder.payment?.status || "").toLowerCase()
        let paymentStatus = originalOrder.paymentStatus || 'N/A'
        if (s === "paid" || s === "captured" || s === "settled") paymentStatus = "Paid"
        else if (s === "cod_pending") paymentStatus = "COD Pending"
        else if (s === "refunded") paymentStatus = "Refunded"
        else if (s === "failed") paymentStatus = "Failed"
        
        return [
          order.sl || index + 1,
          order.orderId || 'N/A',
          `${order.orderDate || ''}${order.orderTime ? ` ${order.orderTime}` : ''}`,
          order.userName || 'N/A',
          order.restaurantName || 'N/A',
          order.deliveryBoyName || 'N/A',
          order.status || 'N/A',
          formatMoney(packagingFee),
          formatMoney(deliveryFee),
          formatMoney(platformFee),
          totalAmount > 0 ? formatMoney(totalAmount) : 'N/A',
          paymentStatus
        ]
      })
    } else {
      headers = ["SI", "Order ID", "Order Date", "Customer Name", "Customer Phone", "Restaurant", "Total Amount", "Payment Status", "Order Status", "Delivery Type"]
      tableData = orders.map((order, index) => {
        const amount =
          order.totalAmount ??
          order.total ??
          order.pricing?.total ??
          0
        return [
          index + 1,
          order.orderId || order.id || 'N/A',
          `${order.date || ''}${order.time ? `, ${order.time}` : ""}` || 'N/A',
          order.customerName || 'N/A',
          order.customerPhone || 'N/A',
          order.restaurant || 'N/A',
          amount ? formatMoney(amount) : 'N/A',
          (order.payment?.status === "paid" || order.payment?.status === "captured" || order.payment?.status === "settled" ? "Paid" :
           order.payment?.status === "cod_pending" ? "COD Pending" :
           order.payment?.status === "refunded" ? "Refunded" :
           order.payment?.status === "failed" ? "Failed" :
           order.paymentStatus || 'N/A'),
          order.orderStatus || 'N/A',
          order.deliveryType || 'N/A'
        ]
      })
    }

    // Add table using autoTable
    autoTable(doc, {
      head: headers,
      body: tableData,
      startY: 28,
      styles: {
        font: 'Roboto',
        fontSize: 7,
        cellPadding: 2,
      },
      headStyles: {
        font: 'Roboto',
        fillColor: [59, 130, 246],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8
      },
      bodyStyles: {
        font: 'Roboto',
        fontSize: 7,
        textColor: [30, 30, 30]
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 12 }, // SI
      },
      margin: { top: 28, left: 10, right: 10 },
    })

    // Save the PDF instantly
    const fileTimestamp = new Date().toISOString().split("T")[0]
    doc.save(`${filename}_${fileTimestamp}.pdf`)
  } catch (error) {
    debugError("Error loading PDF library:", error)
    alert("Failed to load PDF library. Please try again.")
  }
}

export const exportToJSON = (orders, filename = "orders") => {
  const jsonContent = JSON.stringify(orders, null, 2)
  const blob = new Blob([jsonContent], { type: "application/json" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.json`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

