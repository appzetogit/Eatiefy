import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  Plus,
  Minus,
  Star,
  Clock,
  Utensils,
  Store,
  ChevronRight,
  ShoppingBag,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useCart } from "@food/context/CartContext"
import { isVegMenuItem } from "@food/utils/vegMode"
import {
  buildCartLineId,
  getFoodDisplayPrice,
  getFoodVariants,
  hasFoodVariants,
} from "@food/utils/foodVariants"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import { isModuleAuthenticated } from "@food/utils/auth"
import { toast } from "sonner"
import SafeImage from "@food/components/SafeImage"

const FOOD_IMAGE_FALLBACK = dishFallbackImage
const RUPEE_SYMBOL = "₹"

export default function DishDetailModal({
  isOpen,
  dish,
  onClose,
  onAddToCart,
}) {
  const navigate = useNavigate()
  const { addToCart, getCartItem, isOutOfService } = useCart()
  const [selectedVariantId, setSelectedVariantId] = useState("")
  const [quantity, setQuantity] = useState(1)

  const variants = dish ? getFoodVariants(dish) : []
  const hasVariants = variants.length > 0

  useEffect(() => {
    if (dish && hasVariants) {
      setSelectedVariantId(variants[0]?.id || variants[0]?._id || "")
    } else {
      setSelectedVariantId("")
    }
    setQuantity(1)
  }, [dish])

  if (!isOpen || !dish) return null

  const isVeg = isVegMenuItem(dish)
  const selectedVariant = hasVariants
    ? variants.find(
        (v) =>
          String(v.id || v._id) === String(selectedVariantId)
      ) || variants[0]
    : null

  const currentPrice = selectedVariant
    ? Number(selectedVariant.price || 0)
    : Number(getFoodDisplayPrice(dish) || dish.price || 0)

  const originalPrice = dish.originalPrice && dish.originalPrice > currentPrice ? dish.originalPrice : null

  const resolvedLineItemId = buildCartLineId(
    dish.id || dish._id || "",
    selectedVariant?.id || selectedVariant?._id || ""
  )
  const inCartItem = getCartItem(resolvedLineItemId)
  const currentCartQty = inCartItem?.quantity || 0

  const handleAdd = async (e) => {
    if (onAddToCart) {
      onAddToCart(dish, e, selectedVariant, quantity)
      onClose()
      return
    }

    if (!isModuleAuthenticated("user")) {
      toast.error("Please login to add items to cart")
      navigate("/food/user/auth/login", {
        state: { from: window.location.pathname },
      })
      return
    }

    if (isOutOfService) {
      toast.error("You are outside the service zone.")
      return
    }

    const cartItem = {
      id: resolvedLineItemId,
      lineItemId: resolvedLineItemId,
      itemId: dish.id || dish._id,
      name: dish.name,
      price: currentPrice,
      variantId: selectedVariant?.id || selectedVariant?._id || "",
      variantName: selectedVariant?.name || "",
      variantPrice: currentPrice,
      image: dish.image,
      restaurant: dish.restaurantName || dish.restaurant || "Restaurant",
      restaurantId: dish.restaurantId || dish.restaurant?._id || dish.restaurant?.id || undefined,
      description: dish.description || "",
      originalPrice: originalPrice || currentPrice,
      foodType: dish.foodType,
      isVeg,
      // The cart reads how many to add from the item itself.
      quantity,
    }

    const res = await addToCart(cartItem, null)
    if (res?.ok !== false) {
      toast.success(`Added ${dish.name} to cart!`)
      onClose()
    } else if (res?.cancelled) {
      // User declined the replace prompt - dismiss quietly, it isn't an error.
      onClose()
    } else if (res?.error) {
      toast.error(res.error)
    }
  }

  const handleNavigateRestaurant = () => {
    onClose()
    const rId =
      dish.restaurantId ||
      dish.restaurant?.restaurantId ||
      dish.restaurant?._id ||
      dish.restaurant?.id ||
      dish.restaurantSlug
    if (rId) {
      navigate(`/food/user/restaurants/${rId}`)
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-lg bg-white dark:bg-[#181818] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] z-10 border border-gray-100 dark:border-gray-800"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md text-white flex items-center justify-center transition-all duration-200 active:scale-90"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Dish Image Banner */}
          <div className="relative w-full h-56 sm:h-64 bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0">
            <SafeImage
              src={dish.image}
              fallbackSrc={FOOD_IMAGE_FALLBACK}
              alt={dish.name}
              loading="eager"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

            {/* Badges Over Image */}
            <div className="absolute bottom-3 left-4 flex items-center gap-2">
              <div className="bg-white/95 dark:bg-[#2e2e2e]/95 backdrop-blur-md px-2.5 py-1 rounded-full shadow-md flex items-center gap-1 text-gray-900 dark:text-white text-xs font-black">
                <Star className="w-3.5 h-3.5 fill-[#24963F] text-[#24963F]" />
                <span>{dish.rating || 4.2}</span>
              </div>
              {dish.isRecommended && (
                <div className="bg-[#24963F] text-white text-[11px] font-black px-2.5 py-1 rounded-full shadow-md">
                  Recommended
                </div>
              )}
            </div>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Title & Diet Type */}
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-4 h-4 border-2 rounded flex items-center justify-center p-[2px] bg-white ${
                        isVeg ? "border-[#15803D]" : "border-red-600"
                      }`}
                    >
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: isVeg ? "#15803D" : "#dc2626" }}
                      />
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        isVeg ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
                      }`}
                    >
                      {isVeg ? "Pure Veg" : "Non-Veg"}
                    </span>
                  </div>
                  <h1 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white tracking-tight leading-snug">
                    {dish.name}
                  </h1>
                </div>

                {/* Price Display */}
                <div className="text-right flex-shrink-0">
                  <div className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">
                    {RUPEE_SYMBOL}
                    {Math.round(currentPrice)}
                  </div>
                  {originalPrice && (
                    <div className="text-xs font-semibold text-gray-400 line-through">
                      {RUPEE_SYMBOL}
                      {Math.round(originalPrice)}
                    </div>
                  )}
                </div>
              </div>

              {/* Restaurant Link */}
              {(dish.restaurantName || dish.restaurant) && (
                <button
                  type="button"
                  onClick={handleNavigateRestaurant}
                  className="mt-2.5 flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 hover:text-[#24963F] dark:hover:text-[#24963F] transition-colors group"
                >
                  <Store className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#24963F]" />
                  <span>{dish.restaurantName || dish.restaurant?.name || "Restaurant"}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
                </button>
              )}
            </div>

            {/* Preparation time if available */}
            {dish.preparationTime && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                <span>Prep time: {String(dish.preparationTime).trim()}</span>
              </div>
            )}

            {/* Description */}
            {dish.description && (
              <div className="pt-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                  Description
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  {dish.description}
                </p>
              </div>
            )}

            {/* Variants / Customisations */}
            {hasVariants && (
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">Quantity</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Select any 1 option</p>
                  </div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2.5 py-0.5 rounded-full border border-red-200/60 dark:border-red-800/40">
                    Required
                  </span>
                </div>
                <div className="space-y-2.5">
                  {variants.map((v) => {
                    const vId = v.id || v._id
                    const isSelected = String(selectedVariantId) === String(vId)
                    return (
                      <button
                        key={vId}
                        type="button"
                        onClick={() => setSelectedVariantId(vId)}
                        className={`w-full flex items-center justify-between p-3.5 sm:p-4 rounded-2xl border transition-all text-left cursor-pointer ${
                          isSelected
                            ? "border-red-500 bg-red-50/50 dark:border-red-500/70 dark:bg-red-950/20 shadow-sm ring-1 ring-red-500/20"
                            : "border-gray-200 dark:border-gray-700/80 bg-white dark:bg-[#1e1e1e] hover:border-gray-300 dark:hover:border-gray-600"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                              isSelected
                                ? "border-red-500 bg-white dark:bg-[#1e1e1e]"
                                : "border-gray-400 dark:border-gray-500"
                            }`}
                          >
                            {isSelected && (
                              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                            )}
                          </div>
                          <span
                            className={`text-sm sm:text-base ${
                              isSelected
                                ? "font-bold text-gray-900 dark:text-white"
                                : "font-semibold text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {v.name}
                          </span>
                        </div>
                        <span
                          className={`text-sm sm:text-base font-bold ${
                            isSelected ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {RUPEE_SYMBOL}{Math.round(v.price)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sticky Bottom Actions */}
          <div className="border-t border-gray-100 dark:border-gray-800 p-4 bg-gray-50/80 dark:bg-neutral-900/80 backdrop-blur-md flex items-center gap-3">
            {/* Stepper Quantity */}
            <div className="flex items-center justify-between border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-neutral-800 rounded-2xl px-2 h-12 gap-3 shadow-sm flex-shrink-0">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#24963F] disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
              >
                <Minus className="w-4 h-4 stroke-[3]" />
              </button>
              <span className="text-sm font-black text-gray-900 dark:text-white min-w-[20px] text-center select-none">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#24963F] hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
              </button>
            </div>

            {/* Add to Cart Button */}
            <button
              type="button"
              onClick={handleAdd}
              className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-[#24963F] to-[#1E7D34] hover:from-[#1E7D34] hover:to-[#176329] text-white font-black text-sm sm:text-base shadow-lg shadow-green-600/20 flex items-center justify-between px-5 transition-all active:scale-[0.98]"
            >
              <span className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4" />
                Add to Cart
              </span>
              <span>
                {RUPEE_SYMBOL}
                {Math.round(currentPrice * quantity)}
              </span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
