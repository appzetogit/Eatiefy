const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// Export utility functions for deliveryman data

const money = (value) => (Number(value) || 0).toFixed(2)

/**
 * One definition of the delivery-partner export columns, shared by CSV, Excel
 * and PDF so the three files always carry the same data (incl. wallet figures).
 * Wallet numbers come from the wallet summary the list page already loaded.
 */
const DELIVERYMAN_EXPORT_COLUMNS = [
  { header: "SI", value: (dm, i) => dm.sl || i + 1 },
  { header: "Name", value: (dm) => dm.name || "N/A" },
  { header: "Phone", value: (dm) => dm.phone || "N/A" },
  { header: "Email", value: (dm) => dm.email || "N/A" },
  { header: "Zone", value: (dm) => dm.zone || dm.zoneName || "N/A" },
  { header: "Total Orders", value: (dm) => dm.totalOrders || 0 },
  { header: "Status", value: (dm) => dm.status || "N/A" },
  { header: "Pocket Balance", money: true, value: (dm) => dm.pocketBalance },
  { header: "Cash In Hand", money: true, value: (dm) => dm.cashInHand },
  { header: "Total Cash Limit", money: true, value: (dm) => dm.walletSummary?.totalCashLimit },
  { header: "Remaining Cash Limit", money: true, value: (dm) => dm.remainingCashLimit },
  { header: "Total Earning", money: true, value: (dm) => dm.totalEarning },
  { header: "Bonus", money: true, value: (dm) => dm.bonus },
  { header: "Total Withdrawn", money: true, value: (dm) => dm.totalWithdrawn },
]

const buildDeliverymanExportTable = (deliverymen, { currencyLabel = "INR" } = {}) => {
  const headers = DELIVERYMAN_EXPORT_COLUMNS.map((c) => (c.money ? `${c.header} (${currencyLabel})` : c.header))
  const rows = deliverymen.map((dm, index) =>
    DELIVERYMAN_EXPORT_COLUMNS.map((c) => {
      const v = c.value(dm, index)
      return c.money ? money(v) : v
    }),
  )
  return { headers, rows }
}

const triggerDownload = (blob, fileName) => {
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", fileName)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const exportDeliverymenToCSV = (deliverymen, filename = "deliverymen") => {
  const { headers, rows } = buildDeliverymanExportTable(deliverymen)
  const csvContent = [
    headers.map((h) => `"${h}"`).join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ].join("\n")
  // BOM so Excel reads UTF-8 names correctly.
  triggerDownload(
    new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" }),
    `${filename}_${new Date().toISOString().split("T")[0]}.csv`,
  )
}

export const exportDeliverymenToExcel = (deliverymen, filename = "deliverymen") => {
  const { headers, rows } = buildDeliverymanExportTable(deliverymen)
  // HTML table with a UTF-8 header: opens as a real sheet in Excel (one cell per
  // value) instead of tab-separated text in a single column.
  const htmlContent = `<html><head><meta charset="utf-8">
<style>
  table { border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background-color: #f1f5f9; font-weight: bold; }
</style></head><body>
<table>
<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>
</table></body></html>`
  triggerDownload(
    new Blob([htmlContent], { type: "application/vnd.ms-excel;charset=utf-8" }),
    `${filename}_${new Date().toISOString().split("T")[0]}.xls`,
  )
}

export const exportDeliverymenToPDF = (deliverymen, filename = "deliverymen") => {
  if (!deliverymen || deliverymen.length === 0) {
    alert("No data to export")
    return
  }

  try {
    // Dynamic import of jsPDF and autoTable for instant download
    import('jspdf').then(({ default: jsPDF }) => {
      import('jspdf-autotable').then(({ default: autoTable }) => {
        // 14 columns: A4 landscape is too tight, so use A3 landscape.
        const doc = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a3'
        })

        doc.setFontSize(16)
        doc.text('Delivery Partners Report', 14, 15)

        doc.setFontSize(10)
        const exportDate = new Date().toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
        doc.text(`Exported on: ${exportDate} | Total Records: ${deliverymen.length} | Amounts in Rs.`, 14, 22)

        // The built-in PDF font has no rupee glyph, so amounts are labelled "Rs.".
        const { headers, rows } = buildDeliverymanExportTable(deliverymen, { currencyLabel: "Rs." })

        autoTable(doc, {
          head: [headers],
          body: rows,
          startY: 28,
          styles: {
            fontSize: 8,
            cellPadding: 2,
            overflow: 'linebreak',
          },
          headStyles: {
            fillColor: [241, 245, 249],
            textColor: [15, 23, 42],
            fontStyle: 'bold',
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          columnStyles: {
            0: { cellWidth: 12 },  // SI
            3: { cellWidth: 50 },  // Email
            5: { halign: 'right' },
            7: { halign: 'right' },
            8: { halign: 'right' },
            9: { halign: 'right' },
            10: { halign: 'right' },
            11: { halign: 'right' },
            12: { halign: 'right' },
            13: { halign: 'right' },
          },
          margin: { top: 28, left: 10, right: 10 },
        })

        const fileTimestamp = new Date().toISOString().split("T")[0]
        doc.save(`${filename}_${fileTimestamp}.pdf`)
      }).catch((error) => {
        debugError("Error loading jspdf-autotable:", error)
        alert("Failed to load PDF library. Please try again.")
      })
    }).catch((error) => {
      debugError("Error loading jsPDF:", error)
      alert("Failed to load PDF library. Please try again.")
    })
  } catch (error) {
    debugError("PDF export error:", error)
    alert("Failed to export PDF. Please try again.")
  }
}

export const exportDeliverymenToJSON = (deliverymen, filename = "deliverymen") => {
  const jsonContent = JSON.stringify(deliverymen, null, 2)
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

// Export utilities for reviews
export const exportReviewsToCSV = (reviews, filename = "deliveryman_reviews") => {
  const headers = ["SI", "Deliveryman", "Customer", "Review", "Rating"]
  const rows = reviews.map((review) => [
    review.sl,
    review.deliveryman,
    review.customer,
    review.review,
    review.rating
  ])
  
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

export const exportReviewsToExcel = (reviews, filename = "deliveryman_reviews") => {
  const headers = ["SI", "Deliveryman", "Customer", "Review", "Rating"]
  const rows = reviews.map((review) => [
    review.sl,
    review.deliveryman,
    review.customer,
    review.review,
    review.rating
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

export const exportReviewsToPDF = (reviews, filename = "deliveryman_reviews") => {
  const headers = ["SI", "Deliveryman", "Customer", "Review", "Rating"]
  
  let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Deliveryman Reviews Report</title>
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
      <h1>Deliveryman Reviews Report</h1>
      <p>Generated on: ${new Date().toLocaleString()}</p>
      <table>
        <thead>
          <tr>
            ${headers.map(h => `<th>${h}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${reviews.map(review => `
            <tr>
              <td>${review.sl}</td>
              <td>${review.deliveryman}</td>
              <td>${review.customer}</td>
              <td>${review.review}</td>
              <td>${review.rating}</td>
            </tr>
          `).join("")}
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

export const exportReviewsToJSON = (reviews, filename = "deliveryman_reviews") => {
  const jsonContent = JSON.stringify(reviews, null, 2)
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

// Export utilities for bonus transactions
export const exportBonusToCSV = (transactions, filename = "deliveryman_bonus") => {
  const headers = ["S.No", "Transaction ID", "Delivery Boy ID", "Deliveryman", "Bonus", "Reference", "Created At"]
  const rows = transactions.map((transaction) => [
    transaction.sl,
    transaction.transactionId,
    transaction.deliveryId || 'N/A',
    transaction.deliveryman,
    transaction.bonus,
    transaction.reference,
    transaction.createdAt
  ])
  
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

// Helper function to format bonus amount properly (remove superscript and special characters)
const formatBonusForExport = (transaction) => {
  // First priority: use raw amount value if available
  if (transaction.amount !== undefined && transaction.amount !== null && !isNaN(transaction.amount)) {
    const amount = parseFloat(transaction.amount)
    return `?${amount.toFixed(2)}`
  }
  
  // Second priority: clean and extract from bonus string
  if (transaction.bonus) {
    // Remove all superscript/special characters and unwanted text
    let cleaned = transaction.bonus.toString()
      .replace(/¹/g, '') // Remove superscript 1
      .replace(/[¹²³45678?°]/g, '') // Remove all superscript numbers
      .replace(/[\u2070-\u207F\u2080-\u208F]/g, '') // Remove all superscript Unicode ranges
      .replace(/[^\d.-]/g, '') // Keep only digits, dots, and minus signs
      .trim()
    
    // Extract numeric value
    const numericMatch = cleaned.match(/[\d.]+/)
    if (numericMatch) {
      const amount = parseFloat(numericMatch[0])
      if (!isNaN(amount)) {
        return `?${amount.toFixed(2)}`
      }
    }
  }
  
  return '?0.00'
}

export const exportBonusToExcel = (transactions, filename = "deliveryman_bonus") => {
  if (!transactions || transactions.length === 0) {
    alert("No data to export")
    return
  }

  const headers = ["S.No", "Transaction ID", "Delivery Boy ID", "Deliveryman", "Bonus", "Reference", "Created At"]
  const rows = transactions.map((transaction) => [
    transaction.sl || 'N/A',
    transaction.transactionId || 'N/A',
    transaction.deliveryId || 'N/A',
    transaction.deliveryman || 'N/A',
    formatBonusForExport(transaction),
    transaction.reference || 'N/A',
    transaction.createdAt || 'N/A'
  ])
  
  // Create HTML table for better Excel compatibility with UTF-8 encoding
  const htmlContent = `
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              ${headers.map(h => `<th>${h}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `<tr>${row.map(cell => `<td>${String(cell).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`).join("")}</tr>`).join("")}
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

export const exportBonusToPDF = (transactions, filename = "deliveryman_bonus") => {
  if (!transactions || transactions.length === 0) {
    alert("No data to export")
    return
  }

  try {
    // Dynamic import of jsPDF and autoTable for instant download
    import('jspdf').then(({ default: jsPDF }) => {
      import('jspdf-autotable').then(({ default: autoTable }) => {
        const doc = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4'
        })

        // Add title
        doc.setFontSize(16)
        doc.text('Deliveryman Bonus Transactions Report', 14, 15)
        
        // Add export info
        doc.setFontSize(10)
        const exportDate = new Date().toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
        doc.text(`Exported on: ${exportDate} | Total Records: ${transactions.length}`, 14, 22)

        // Prepare table data - ensure bonus is properly formatted
        const tableData = transactions.map((transaction) => {
          // ALWAYS use raw amount value - don't rely on formatted bonus string
          let bonusAmount = '?0.00'
          
          // First priority: Use raw numeric amount from transaction.amount
          if (transaction.amount !== undefined && transaction.amount !== null) {
            const numAmount = typeof transaction.amount === 'string' 
              ? parseFloat(transaction.amount.replace(/[^\d.-]/g, ''))
              : parseFloat(transaction.amount)
            if (!isNaN(numAmount)) {
              bonusAmount = `?${numAmount.toFixed(2)}`
            }
          } 
          // Second priority: Extract number from bonus string and rebuild
          else if (transaction.bonus) {
            // Extract only numeric part (digits and decimal point)
            const numericPart = String(transaction.bonus).replace(/[^\d.-]/g, '')
            const numAmount = parseFloat(numericPart)
            if (!isNaN(numAmount) && numAmount > 0) {
              bonusAmount = `?${numAmount.toFixed(2)}`
            }
          }
          
          return [
            transaction.sl || 'N/A',
            transaction.transactionId || 'N/A',
            transaction.deliveryId || 'N/A',
            transaction.deliveryman || 'N/A',
            bonusAmount,
            transaction.reference || 'N/A',
            transaction.createdAt || 'N/A'
          ]
        })

        // Add table using autoTable
        autoTable(doc, {
          head: [["S.No", "Transaction ID", "Delivery Boy ID", "Deliveryman", "Bonus", "Reference", "Created At"]],
          body: tableData,
          startY: 28,
          styles: {
            fontSize: 7,
            cellPadding: 2,
          },
          headStyles: {
            fillColor: [241, 245, 249],
            textColor: [15, 23, 42],
            fontStyle: 'bold',
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          columnStyles: {
            0: { cellWidth: 12 }, // SI
            1: { cellWidth: 40 }, // Transaction ID
            2: { cellWidth: 30 }, // Delivery Boy ID
            3: { cellWidth: 35 }, // Deliveryman
            4: { cellWidth: 20 }, // Bonus
            5: { cellWidth: 35 }, // Reference
            6: { cellWidth: 35 }, // Created At
          },
          margin: { top: 28, left: 14, right: 14 },
        })

        // Save the PDF instantly
        const fileTimestamp = new Date().toISOString().split("T")[0]
        doc.save(`${filename}_${fileTimestamp}.pdf`)
      }).catch((error) => {
        debugError("Error loading jspdf-autotable:", error)
        alert("Failed to load PDF library. Please try again.")
      })
    }).catch((error) => {
      debugError("Error loading jsPDF:", error)
      alert("Failed to load PDF library. Please try again.")
    })
  } catch (error) {
    debugError("PDF export error:", error)
    alert("Failed to export PDF. Please try again.")
  }
}

export const exportBonusToJSON = (transactions, filename = "deliveryman_bonus") => {
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


