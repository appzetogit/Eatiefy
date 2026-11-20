// Export utility functions for reports
export const exportReportsToCSV = (data, headers, filename = "report") => {
  const rows = data.map((item, index) => {
    return headers.map(header => {
      const value = item[header.key] || item[header] || ""
      return typeof value === 'object' ? JSON.stringify(value) : value
    })
  })
  
  const headerRow = headers.map(h => typeof h === 'string' ? h : h.label).join(",")
  const csvContent = [
    headerRow,
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
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

export const exportReportsToExcel = (data, headers, filename = "report") => {
  const rows = data.map((item) => {
    return headers.map(header => {
      const value = item[header.key] || item[header] || ""
      return typeof value === 'object' ? JSON.stringify(value) : value
    })
  })
  
  const headerRow = headers.map(h => typeof h === 'string' ? h : h.label).join("\t")
  const csvContent = [
    headerRow,
    ...rows.map(row => row.join("\t"))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "application/vnd.ms-excel" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.xls`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const exportReportsToPDF = (data, headers, filename = "report", title = "Report") => {
  const headerRow = headers.map(h => typeof h === 'string' ? h : h.label)
  const escapeHtml = (unsafe) => String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 10px; }
        th { background-color: #f2f2f2; font-weight: bold; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        h1 { text-align: center; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <p>Generated on: ${new Date().toLocaleString()}</p>
      <table>
        <thead>
          <tr>
            ${headerRow.map(h => `<th>${h}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${data.map(item => {
            const cells = headers.map(header => {
              const raw = (item && (item[header.key] !== undefined ? item[header.key] : item[header])) ?? ""
              const normalized = (raw === null || raw === undefined || String(raw).trim() === "") ? "0" : raw
              return `<td>${escapeHtml(String(normalized))}</td>`
            })
            return `<tr>${cells.join("")}</tr>`
          }).join("")}
        </tbody>
      </table>
    </body>
    </html>
  `
  
  const printWindow = window.open("", "_blank")
  printWindow.document.write(htmlContent)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
    printWindow.close()
  }, 250)
}

export const exportReportsToJSON = (data, filename = "report") => {
  const jsonContent = JSON.stringify(data, null, 2)
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

// Specific export functions for Transaction Report
export const exportTransactionReportToCSV = (transactions, filename = "transaction_report") => {
  const headers = [
    "SI",
    "Order ID",
    "Restaurant",
    "Customer Name",
    "Total Item Amount",
    "Restaurant Base",
    "Admin Pricing",
    "Packaging Charge",
    "Restaurant Commission",
    "Coupon Discount",
    "VAT/Tax",
    "Delivery Charge",
    "Platform Fee",
    "Order Amount",
    "Status"
  ]
  const rows = transactions.map((transaction, index) => [
    index + 1,
    transaction.orderId || "N/A",
    transaction.restaurant || "N/A",
    transaction.customerName || "N/A",
    Number(transaction.totalItemAmount || 0).toFixed(2),
    Number(transaction.restaurantBaseAmount ?? transaction.totalItemAmount ?? 0).toFixed(2),
    Number(transaction.adminMarkup || 0).toFixed(2),
    Number(transaction.packagingCharge ?? transaction.packagingFee ?? 0).toFixed(2),
    Number(transaction.restaurantCommission || 0).toFixed(2),
    Number(transaction.couponDiscount || 0).toFixed(2),
    Number(transaction.vatTax || 0).toFixed(2),
    Number(transaction.deliveryCharge || 0).toFixed(2),
    Number(transaction.platformFee || 0).toFixed(2),
    Number(transaction.orderAmount || 0).toFixed(2),
    transaction.status || transaction.orderStatus || "N/A"
  ])
  
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
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

export const exportTransactionReportToExcel = (transactions, filename = "transaction_report") => {
  const headers = [
    "SI",
    "Order ID",
    "Restaurant",
    "Customer Name",
    "Total Item Amount",
    "Restaurant Base",
    "Admin Pricing",
    "Packaging Charge",
    "Restaurant Commission",
    "Coupon Discount",
    "VAT/Tax",
    "Delivery Charge",
    "Platform Fee",
    "Order Amount",
    "Status"
  ]
  const rows = transactions.map((transaction, index) => [
    index + 1,
    transaction.orderId || "N/A",
    transaction.restaurant || "N/A",
    transaction.customerName || "N/A",
    Number(transaction.totalItemAmount || 0).toFixed(2),
    Number(transaction.restaurantBaseAmount ?? transaction.totalItemAmount ?? 0).toFixed(2),
    Number(transaction.adminMarkup || 0).toFixed(2),
    Number(transaction.packagingCharge ?? transaction.packagingFee ?? 0).toFixed(2),
    Number(transaction.restaurantCommission || 0).toFixed(2),
    Number(transaction.couponDiscount || 0).toFixed(2),
    Number(transaction.vatTax || 0).toFixed(2),
    Number(transaction.deliveryCharge || 0).toFixed(2),
    Number(transaction.platformFee || 0).toFixed(2),
    Number(transaction.orderAmount || 0).toFixed(2),
    transaction.status || transaction.orderStatus || "N/A"
  ])
  
  const csvContent = [
    headers.join("\t"),
    ...rows.map(row => row.join("\t"))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "application/vnd.ms-excel" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.xls`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const exportTransactionReportToPDF = (transactions, filename = "transaction_report") => {
  const headers = [
    "SI",
    "Order ID",
    "Restaurant",
    "Customer Name",
    "Total Item Amount",
    "Restaurant Base",
    "Admin Pricing",
    "Packaging Charge",
    "Restaurant Commission",
    "Coupon Discount",
    "VAT/Tax",
    "Delivery Charge",
    "Platform Fee",
    "Order Amount",
    "Status"
  ]
  const escapeHtml = (unsafe) => String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const fmtNum = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? `₹${n.toFixed(2)}` : '₹0.00'
  }

  let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Transaction Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 15px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 7px; }
        th, td { border: 1px solid #ddd; padding: 4px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        h1 { text-align: center; }
      </style>
    </head>
    <body>
      <h1>Transaction Report</h1>
      <p>Generated on: ${new Date().toLocaleString()}</p>
      <table>
        <thead>
          <tr>
            ${headers.map(h => `<th>${h}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${transactions.map((transaction, index) => {
            const orderId = transaction.orderId || 'N/A'
            const restaurant = transaction.restaurant || 'N/A'
            const customerName = transaction.customerName || 'N/A'
            const totalItemAmount = fmtNum(transaction.totalItemAmount)
            const restaurantBase = fmtNum(transaction.restaurantBaseAmount ?? transaction.totalItemAmount)
            const adminPricing = fmtNum(transaction.adminMarkup || 0)
            const packagingCharge = fmtNum(transaction.packagingCharge ?? transaction.packagingFee ?? 0)
            const restaurantCommission = fmtNum(transaction.restaurantCommission || 0)
            const couponDiscount = fmtNum(transaction.couponDiscount)
            const vatTax = fmtNum(transaction.vatTax)
            const deliveryCharge = fmtNum(transaction.deliveryCharge)
            const platformFee = fmtNum(transaction.platformFee || 0)
            const orderAmount = fmtNum(transaction.orderAmount)
            const status = transaction.status || transaction.orderStatus || 'N/A'
            return `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(String(orderId))}</td>
              <td>${escapeHtml(String(restaurant))}</td>
              <td>${escapeHtml(String(customerName))}</td>
              <td>${totalItemAmount}</td>
              <td>${restaurantBase}</td>
              <td>${adminPricing}</td>
              <td>${packagingCharge}</td>
              <td>${restaurantCommission}</td>
              <td>${couponDiscount}</td>
              <td>${vatTax}</td>
              <td>${deliveryCharge}</td>
              <td>${platformFee}</td>
              <td>${orderAmount}</td>
              <td>${escapeHtml(String(status))}</td>
            </tr>
          `}).join("")}
        </tbody>
      </table>
    </body>
    </html>
  `
  
  const printWindow = window.open("", "_blank")
  printWindow.document.write(htmlContent)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
    printWindow.close()
  }, 250)
}

export const exportTransactionReportToJSON = (transactions, filename = "transaction_report") => {
  const jsonContent = JSON.stringify(transactions, null, 2)
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
