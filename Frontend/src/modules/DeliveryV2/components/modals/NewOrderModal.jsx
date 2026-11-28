import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, MapPin, FastForward, Clock, Phone, ChefHat, ChevronDown, Volume2, VolumeX, Navigation } from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { useRoadPickupMetrics } from '@/modules/DeliveryV2/hooks/useRoadPickupMetrics';
import { PickupMetricsValue } from '@/modules/DeliveryV2/components/orders/NewOrderCard';
import OrderNoteBanner from '@/modules/DeliveryV2/components/orders/OrderNoteBanner';
import { toast } from 'sonner';
import { getEatiefyIncentiveBreakdown, formatEatiefyIncentiveLine } from '@/modules/DeliveryV2/utils/earningBreakdown';
import { formatOrderAddress } from '@food/utils/orderAddress';

/**
 * NewOrderModal - Ported to Original 1:1 Theme with Slider Accept.
 * Matches the Zomato/Swiggy style Green Header + White Card.
 */
export const NewOrderModal = ({ order, onAccept, onReject, onMinimize, isMuted = false, onToggleMute }) => {
  const { riderLocation } = useDeliveryStore();

  const metrics = useRoadPickupMetrics(order, riderLocation);

  if (!order) return null;

  const earnings = order.earnings || order.riderEarning || (order.orderAmount ? order.orderAmount * 0.1 : 0);
  const incentiveBreakdown = getEatiefyIncentiveBreakdown(order, earnings);
  const restaurantName = order.restaurantName || order.restaurant_name || (order.restaurantId?.name) || 'Restaurant';
  const restaurantAddress = order.restaurantAddress || order.restaurant_address || (order.restaurantId?.location?.address) || 'Address not available';
  const restaurantPhone =
    order.restaurantPhone ||
    order.restaurant_phone ||
    order.restaurantId?.primaryContactNumber ||
    order.restaurantId?.ownerPhone ||
    order.restaurantId?.phone ||
    '';
  const deliveryAddress = order?.deliveryAddress || {};

  const geoCoords =
    Array.isArray(deliveryAddress?.location?.coordinates) &&
    deliveryAddress.location.coordinates.length >= 2
      ? {
          lng: deliveryAddress.location.coordinates[0],
          lat: deliveryAddress.location.coordinates[1],
        }
      : null;

  const customerLocation = order.customerLocation || order.deliveryLocation || geoCoords || null;
  const customerName =
    order.customerName ||
    order.userId?.name ||
    order.user?.name ||
    order.deliveryAddress?.fullName ||
    order.deliveryAddress?.name ||
    'Customer';
  const customerPhone =
    order.customerPhone ||
    order.userPhone ||
    order.userId?.phone ||
    order.user?.phone ||
    order.deliveryAddress?.phone ||
    '';

  const customerAddress =
    order.customerAddress ||
    order.customer_address ||
    formatOrderAddress(deliveryAddress) ||
    (customerLocation?.lat != null && customerLocation?.lng != null
      ? `Lat ${Number(customerLocation.lat).toFixed(5)}, Lng ${Number(customerLocation.lng).toFixed(5)}`
      : 'Location not available');

  const handleCallRestaurant = () => {
    const num = String(restaurantPhone || '').replace(/\D/g, '');
    if (!num) {
      toast.error('Restaurant phone number not available');
      return;
    }
    window.location.href = `tel:${num}`;
  };

  const handleNavigateToRestaurant = () => {
    const restCoords = order.restaurantLocation || order.restaurantId?.location || null;
    const lat = parseFloat(restCoords?.lat ?? restCoords?.latitude);
    const lng = parseFloat(restCoords?.lng ?? restCoords?.longitude);
    let mapsUrl;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    } else if (restaurantAddress) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(restaurantAddress)}&travelmode=driving`;
    } else {
      toast.error('Restaurant location not available');
      return;
    }
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCallCustomer = () => {
    const num = String(customerPhone || '').replace(/\D/g, '');
    if (!num) {
      toast.error('Customer phone number not available');
      return;
    }
    window.location.href = `tel:${num}`;
  };

  const handleNavigateToCustomer = () => {
    const lat = parseFloat(customerLocation?.lat ?? customerLocation?.latitude);
    const lng = parseFloat(customerLocation?.lng ?? customerLocation?.longitude);
    let mapsUrl;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    } else if (customerAddress) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(customerAddress)}&travelmode=driving`;
    } else {
      toast.error('Customer location not available');
      return;
    }
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-1000 bg-black/60 flex items-end justify-center p-0"
    >
      <motion.div 
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[3rem] overflow-hidden shadow-[0_-20px_60px_rgba(0,0,0,0.5)] flex flex-col pt-1 sm:pt-2"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center pb-1.5 pt-1 bg-white relative z-10 rounded-t-3xl sm:rounded-t-[3rem] -mb-1">
          <button onClick={onMinimize} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
             <ChevronDown className="w-6 h-6 text-gray-400 stroke-3" />
          </button>
        </div>

        {/* Header Ribbon (Old Green Style) */}
        <div 
          className="p-4 sm:p-8 flex justify-between items-center text-white border-b border-white/10"
          style={{ background: 'linear-gradient(33deg, #15498b 0%, #000000 100%)' }}
        >
          <div>
            <p className="text-white/80 text-[10px] font-bold uppercase tracking-widest mb-1">Incoming Request</p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tighter">₹{Number(earnings || 0).toFixed(2)}</h2>
            {incentiveBreakdown && (
              <p className="text-[11px] sm:text-xs font-semibold text-emerald-300 mt-1">
                {formatEatiefyIncentiveLine(incentiveBreakdown)}
              </p>
            )}
          </div>
          {onToggleMute && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute();
              }}
              className={`rounded-full p-2.5 transition-colors border ${
                isMuted
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
              }`}
              aria-label={isMuted ? 'Unmute order alerts' : 'Mute order alerts'}
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          )}
        </div>

        {/* Info Body */}
        <div className="p-4 sm:p-8 pb-6 sm:pb-12 space-y-5 sm:space-y-10 overflow-y-auto max-h-[78vh]">
          <div className="flex gap-3 sm:gap-6">
            <div className="flex flex-col items-center gap-1.5 mt-2 py-1">
              <div className="w-5 h-5 rounded-full bg-green-500 border-4 border-green-50 shadow-lg shadow-green-500/20" />
              <div className="w-0.5 h-16 bg-dashed border-l-2 border-gray-100" />
              <div className="w-5 h-5 rounded-full bg-blue-500 border-4 border-blue-50 shadow-lg shadow-blue-500/20" />
            </div>
            <div className="flex-1 space-y-5 sm:space-y-10">
              <div className="flex justify-between items-start">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-2 mb-2 font-bold text-[10px] uppercase tracking-widest text-green-600">
                    <ChefHat className="w-4 h-4" />
                    <span>Restaurant Pickup</span>
                  </div>
                  <p className="text-gray-950 font-bold text-base sm:text-xl leading-tight">{restaurantName}</p>
                  <p className="text-gray-500 text-sm font-medium leading-relaxed">{restaurantAddress}</p>
                </div>
                <div className="flex gap-2 shrink-0 mt-1">
                  <button
                    type="button"
                    onClick={handleCallRestaurant}
                    className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100 active:scale-95 transition-all shadow-sm"
                    aria-label="Call restaurant"
                  >
                    <Phone className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNavigateToRestaurant}
                    className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-md active:scale-95 transition-all"
                    aria-label="Navigate to restaurant"
                  >
                    <Navigation className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-start">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-2 mb-2 font-bold text-[10px] uppercase tracking-widest text-blue-600">
                    <MapPin className="w-4 h-4" />
                    <span>Customer Drop</span>
                  </div>
                  <p className="text-gray-950 font-bold text-base sm:text-xl leading-tight">{customerName}</p>
                  {customerPhone ? <p className="text-gray-500 text-sm font-medium">{customerPhone}</p> : null}
                  <p className="text-gray-500 text-sm font-medium line-clamp-2">{customerAddress}</p>
                </div>
                <div className="flex gap-2 shrink-0 mt-1">
                  <button
                    type="button"
                    onClick={handleCallCustomer}
                    className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100 active:scale-95 transition-all shadow-sm"
                    aria-label="Call customer"
                  >
                    <Phone className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNavigateToCustomer}
                    className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-md active:scale-95 transition-all"
                    aria-label="Navigate to customer"
                  >
                    <Navigation className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

           <OrderNoteBanner order={order} />

           <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
             <div className="p-3 sm:p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-2.5 sm:gap-3">
               <Clock className="w-5 h-5 text-orange-500" />
               <PickupMetricsValue metrics={metrics} label="Time" unit="min" />
             </div>
             <div className="p-3 sm:p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-2.5 sm:gap-3">
               <MapPin className="w-5 h-5 text-gray-400" />
               <PickupMetricsValue metrics={metrics} label="Distance" unit="km" />
             </div>
          </div>

        {/* Action Area */}
          <div className="space-y-4 sm:space-y-6 pt-1 sm:pt-2">
            <ActionSlider 
              label="Slide to Accept" 
              onConfirm={() => onAccept(order)} 
              color="bg-black"
              successLabel="Order Accepted ✓"
            />

            <button 
              onClick={onReject}
              className="w-full text-gray-400 font-bold text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors py-2 active:scale-95"
            >
              Pass this task
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
