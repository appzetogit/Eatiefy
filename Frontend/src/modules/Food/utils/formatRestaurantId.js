/**
 * Short, human-friendly restaurant id (e.g. REST422829).
 *
 * Restaurants carry either a long Mongo ObjectId (24 hex chars) or a generated
 * id such as "REST-1768045396242-2829". Both are far too long for a dialog, so
 * this keeps the last 6 digits - the same result the Restaurants list shows,
 * so an admin sees one id for one restaurant across screens.
 */
export const formatRestaurantId = (id) => {
  if (!id) return "REST000000"

  const idString = String(id)
  // "REST-1768045396242-2829" / "1768045396242-2829": the last segment first.
  const parts = idString.split(/[-.]/)
  let lastDigits = ""

  const lastPart = parts[parts.length - 1]
  const lastPartDigits = lastPart.match(/\d+/g)
  if (lastPartDigits?.length) {
    lastDigits = lastPartDigits.join("").slice(-6).padStart(6, "0")
  } else {
    const allDigits = parts.join("").match(/\d+/g)
    if (allDigits?.length) lastDigits = allDigits.join("").slice(-6).padStart(6, "0")
  }

  // No digits anywhere: fall back to a stable hash so the id stays deterministic.
  if (!lastDigits) {
    const hash = idString.split("").reduce((acc, char) => (((acc << 5) - acc) + char.charCodeAt(0)) | 0, 0)
    lastDigits = Math.abs(hash).toString().slice(-6).padStart(6, "0")
  }

  return `REST${lastDigits}`
}

export default formatRestaurantId
