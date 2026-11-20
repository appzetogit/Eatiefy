import { useState, useCallback, useEffect } from "react"
import Cropper from "react-easy-crop"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@food/components/ui/dialog"
import { Button } from "@food/components/ui/button"
import { toast } from "sonner"

// Utility to create the cropped image
const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener("load", () => resolve(image))
    image.addEventListener("error", (error) => reject(error))
    image.setAttribute("crossOrigin", "anonymous")
    image.src = url
  })

function getRadianAngle(degreeValue) {
  return (degreeValue * Math.PI) / 180
}

async function getCroppedImg(imageSrc, pixelCrop, rotation = 0) {
  const image = await createImage(imageSrc)
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")

  if (!ctx) {
    return null
  }

  // Calculate bounding box of the rotated image
  const boundingBox = {
    width: image.width,
    height: image.height,
  }

  // set canvas size to match the bounding box
  canvas.width = boundingBox.width
  canvas.height = boundingBox.height

  // translate canvas context to a central location to allow rotating and flipping around the center
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(getRadianAngle(rotation))
  ctx.translate(-image.width / 2, -image.height / 2)

  // draw image
  ctx.drawImage(image, 0, 0)

  const croppedCanvas = document.createElement("canvas")
  const croppedCtx = croppedCanvas.getContext("2d")

  if (!croppedCtx) {
    return null
  }

  // Set the size of the cropped canvas
  croppedCanvas.width = pixelCrop.width
  croppedCanvas.height = pixelCrop.height

  // Circular clipping path
  croppedCtx.beginPath()
  croppedCtx.arc(
    pixelCrop.width / 2,
    pixelCrop.height / 2,
    pixelCrop.width / 2,
    0,
    Math.PI * 2
  )
  croppedCtx.closePath()
  croppedCtx.clip()

  // Draw the cropped image onto the new canvas
  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  )

  // As a blob
  return new Promise((resolve) => {
    croppedCanvas.toBlob((file) => {
      resolve(file)
    }, "image/jpeg", 0.85)
  })
}

export function ImageCropper({ isOpen, onClose, imageFile, onCropComplete }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  
  // Create object URL from file
  const [imageSrc, setImageSrc] = useState(null)
  
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    // Always start from a clean state: a stale crop area from the previous
    // photo made Save crop the wrong region (or throw) for the next one.
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setIsSaving(false)
    if (imageFile) {
      const objectUrl = URL.createObjectURL(imageFile)
      setImageSrc(objectUrl)
      return () => URL.revokeObjectURL(objectUrl)
    }
    setImageSrc(null)
  }, [imageFile])

  const handleCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleSave = async () => {
    if (isSaving || !croppedAreaPixels) return
    setIsSaving(true)
    try {
      const croppedImageBlob = await getCroppedImg(imageSrc, croppedAreaPixels, 0)
      if (croppedImageBlob) {
        // Convert blob to File object
        const file = new File([croppedImageBlob], imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") + "-cropped.png" : "cropped-image.png", {
          type: "image/png",
          lastModified: Date.now(),
        })
        onCropComplete(file)
      } else {
        toast.error("Could not crop this photo. Please try another one.")
      }
    } catch (e) {
      console.error(e)
      toast.error("Could not crop this photo. Please try another one.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[calc(100%-2rem)] rounded-2xl p-0 overflow-hidden bg-white dark:bg-[#242424]">
        <DialogHeader className="p-4 pb-0 border-b border-gray-100 dark:border-gray-800">
          <DialogTitle className="text-lg font-bold text-gray-900 dark:text-white">Crop Profile Photo</DialogTitle>
        </DialogHeader>
        <div className="relative w-full h-[350px] bg-black">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          )}
        </div>
        <div className="p-4 bg-white dark:bg-[#242424] flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => onClose?.()} className="rounded-xl">Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || !croppedAreaPixels} className="rounded-xl bg-[#DC2626] hover:bg-[#991B1B] text-white">{isSaving ? "Saving..." : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
