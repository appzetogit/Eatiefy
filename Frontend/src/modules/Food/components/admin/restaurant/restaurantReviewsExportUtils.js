// Utility functions for exporting restaurant reviews

const escapeHtml = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const escapeCsv = (value) => {
  const str = String(value ?? "")
  return `"${str.replace(/"/g, '""')}"`
}

const formatDateTime = (dateString) => {
  if (!dateString) return "N/A"
  try {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return String(dateString)
    const day = date.getDate().toString().padStart(2, "0")
    const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()
    const year = date.getFullYear()
    const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
    return `${day} ${month} ${year}, ${time}`
  } catch {
    return String(dateString)
  }
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

const RESTAURANT_REVIEW_COLUMNS = [
  { header: "SI", value: (r, i) => r.sl || i + 1 },
  { header: "Order ID", value: (r) => r.orderId || "N/A" },
  { header: "Restaurant", value: (r) => r.restaurant || "N/A" },
  { header: "Customer", value: (r) => r.customer || "N/A" },
  { header: "Review", value: (r) => r.review || "No review" },
  { header: "Rating", value: (r) => r.rating || 0 },
  { header: "Date & Time", value: (r) => formatDateTime(r.date || r.submittedAt || r.createdAt) },
]

export const exportRestaurantReviewsToCSV = (reviews, filename = "restaurant_reviews") => {
  const headers = RESTAURANT_REVIEW_COLUMNS.map((c) => c.header)
  const rows = reviews.map((r, i) =>
    RESTAURANT_REVIEW_COLUMNS.map((c) => escapeCsv(c.value(r, i))),
  )

  const csvContent = [headers.map(escapeCsv).join(","), ...rows.map((row) => row.join(","))].join("\n")

  // Prepend UTF-8 BOM (\uFEFF) so Excel and spreadsheet apps decode emojis & unicode correctly
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" })
  triggerDownload(blob, `${filename}_${new Date().toISOString().split("T")[0]}.csv`)
}

export const exportRestaurantReviewsToExcel = (reviews, filename = "restaurant_reviews") => {
  const headers = RESTAURANT_REVIEW_COLUMNS.map((c) => c.header)
  const rows = reviews.map((r, i) =>
    RESTAURANT_REVIEW_COLUMNS.map((c) => escapeHtml(c.value(r, i))),
  )

  const htmlContent = `<html><head><meta charset="utf-8">
<style>
  table { border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background-color: #f1f5f9; font-weight: bold; }
</style></head><body>
<table>
<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody>
</table></body></html>`

  const blob = new Blob([htmlContent], { type: "application/vnd.ms-excel;charset=utf-8" })
  triggerDownload(blob, `${filename}_${new Date().toISOString().split("T")[0]}.xls`)
}

export const exportRestaurantReviewsToPDF = (reviews, filename = "restaurant_reviews") => {
  if (!reviews || reviews.length === 0) {
    alert("No data to export")
    return
  }

  const headers = RESTAURANT_REVIEW_COLUMNS.map((c) => c.header)
  const rows = reviews.map((r, i) =>
    RESTAURANT_REVIEW_COLUMNS.map((c) => escapeHtml(c.value(r, i))),
  )

  const printWindow = window.open("", "_blank")
  if (!printWindow) {
    alert("Popup blocked. Please allow popups to export PDF.")
    return
  }

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Restaurant Reviews Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; color: #1e293b; }
    h1 { text-align: center; font-size: 18px; margin-bottom: 4px; }
    p.date { text-align: center; font-size: 11px; color: #64748b; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background-color: #f8fafc; font-weight: 600; font-size: 10px; text-transform: uppercase; color: #475569; }
    tr:nth-child(even) { background-color: #f8fafc; }
  </style>
</head>
<body>
  <h1>Restaurant Reviews Report</h1>
  <p class="date">Generated on: ${new Date().toLocaleString()}</p>
  <table>
    <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  </table>
</body>
</html>`

  printWindow.document.write(htmlContent)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
    printWindow.close()
  }, 350)
}

export const exportRestaurantReviewsToJSON = (reviews, filename = "restaurant_reviews") => {
  const data = reviews.map((r, i) => ({
    sl: r.sl || i + 1,
    orderId: r.orderId || "N/A",
    restaurant: r.restaurant || "N/A",
    customer: r.customer || "N/A",
    review: r.review || "",
    rating: r.rating || 0,
    date: r.date || r.submittedAt || r.createdAt || "N/A",
  }))
  const jsonContent = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" })
  triggerDownload(blob, `${filename}_${new Date().toISOString().split("T")[0]}.json`)
}
