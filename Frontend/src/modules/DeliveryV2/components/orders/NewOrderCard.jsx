import React, { useMemo } from 'react';
import {
  ChefHat,
  ChevronDown,
  Clock,
  Loader2,
  Lock,
  MapPin,
  Package,
  Volume2,
  VolumeX,
  Phone,
  Navigation,
} from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { computePickupMetrics, formatPickupRouteSummary } from '@/modules/DeliveryV2/utils/pickupMetrics';
import OrderNoteBanner from '@/modules/DeliveryV2/components/orders/OrderNoteBanner';
import { getEatiefyIncentiveBreakdown, formatEatiefyIncentiveLine } from '@/modules/DeliveryV2/utils/earningBreakdown';
import { formatOrderAddress } from '@food/utils/orderAddress';
import { toast } from 'sonner';

/** Time / distance cell — live values or locating state (shared with NewOrderModal). */
export function PickupMetricsValue({ metrics, label, unit, className = '' }) {
  const isReady = metrics?.isReady;

  return (
    <div className={className}>
      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{label}</span>
      {isReady ? (
        <p className="text-sm font-bold text-gray-900 tabular-nums">
          {unit === 'km'
            ? `${Number(metrics.distanceKm).toFixed(1)} km`
            : `${metrics.etaMins} mins`}
        </p>
      ) : (
        <p className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
          <span>Locating…</span>
        </p>
      )}
    </div>
  );
}

export default function NewOrderCard({
  order,
  onAccept,
  onReject,
  acceptDisabled = false,
  disabledMessage = 'Complete an active order to accept more',
  expanded = false,
  onToggle,
  isMuted = false,
  onToggleMute,
}) {
  const riderLocation = useDeliveryStore((state) => state.riderLocation);

  const metrics = useMemo(
    () => computePickupMetrics(order, riderLocation),
    [order, riderLocation],
  );
  const routeSummary = formatPickupRouteSummary(metrics);

  if (!order) return null;

  const earnings =
    order.earnings ||
    order.riderEarning ||
    order.pricing?.total ||
    (order.orderAmount ? order.orderAmount * 0.1 : 0);
  const incentiveBreakdown = getEatiefyIncentiveBreakdown(order, order.earnings || order.riderEarning);
  const displayId = order?.orderId || order?.displayOrderId || order?._id;
  const restaurantName =
    order.restaurantName ||
    order.restaurant_name ||
    order.restaurantId?.restaurantName ||
    order.restaurantId?.name ||
    'Restaurant';
  const restaurantAddress =
    order.restaurantAddress ||
    order.restaurant_address ||
    order.restaurantId?.addressLine1 ||
    order.restaurantId?.location?.address ||
    'Address not available';
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
  const customerAddress =
    order.customerAddress ||
    order.customer_address ||
    formatOrderAddress(deliveryAddress) ||
    (customerLocation?.lat != null && customerLocation?.lng != null
      ? `Lat ${Number(customerLocation.lat).toFixed(5)}, Lng ${Number(customerLocation.lng).toFixed(5)}`
      : 'Location not available');
  const customerName =
    order.userId?.name || order.customerName || order.user?.name || 'Customer';
  const customerPhone = order.userId?.phone || order.customerPhone || order.user?.phone || '';

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
    <div
      className={`bg-white rounded-2xl border transition-all overflow-hidden ${
        expanded ? 'border-blue-200 shadow-lg shadow-blue-500/10' : 'border-gray-100 shadow-sm'
      }`}
    >
      <div className="flex items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={() => onToggle?.()}
          className="flex flex-1 min-w-0 items-center gap-3 text-left active:scale-[0.99] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-[#15498b] text-white flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              New Order #{displayId}
            </p>
            <p className="text-sm font-bold text-gray-950 truncate">{restaurantName}</p>
            <p
              className={`text-[11px] font-semibold mt-0.5 ${
                metrics.isReady ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              ₹{Number(earnings || 0).toFixed(2)} · {routeSummary}
            </p>
            {incentiveBreakdown && (
              <p className="text-[10px] font-semibold text-emerald-700 mt-0.5">
                {formatEatiefyIncentiveLine(incentiveBreakdown)}
              </p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {acceptDisabled ? (
            <span className="rounded-full bg-gray-100 border border-gray-200 p-1.5 text-gray-500">
              <Lock className="w-3.5 h-3.5" />
            </span>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleMute?.();
            }}
            className={`rounded-full p-2 transition-colors ${
              isMuted
                ? 'bg-red-50 text-red-600 border border-red-200'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            aria-label={isMuted ? 'Unmute order alerts' : 'Mute order alerts'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onToggle?.()}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 transition-colors"
            aria-label={expanded ? 'Collapse order' : 'Expand order'}
          >
            <ChevronDown
              className={`w-5 h-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          <div className="flex gap-3">
            <div className="flex flex-col items-center gap-1.5 mt-2">
              <div className="w-4 h-4 rounded-full bg-green-500 border-4 border-green-50" />
              <div className="w-0.5 h-12 border-l-2 border-dashed border-gray-100" />
              <div className="w-4 h-4 rounded-full bg-blue-500 border-4 border-blue-50" />
            </div>
            <div className="flex-1 space-y-4">
              <div className="flex justify-between items-start">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-green-600">
                    <ChefHat className="w-3.5 h-3.5" />
                    <span>Restaurant Pickup</span>
                  </div>
                  <p className="text-gray-950 font-bold text-sm leading-tight">{restaurantName}</p>
                  <p className="text-gray-500 text-xs">{restaurantAddress}</p>
                </div>
                <div className="flex gap-1.5 shrink-0 mt-1">
                  <button
                    type="button"
                    onClick={handleCallRestaurant}
                    className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100 active:scale-95 transition-all shadow-sm"
                    aria-label="Call restaurant"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNavigateToRestaurant}
                    className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-md active:scale-95 transition-all"
                    aria-label="Navigate to restaurant"
                  >
                    <Navigation className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-start">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-blue-600">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Customer Drop</span>
                  </div>
                  <p className="text-gray-950 font-bold text-sm leading-tight">{customerName}</p>
                  {customerPhone ? <p className="text-gray-500 text-xs">{customerPhone}</p> : null}
                  <p className="text-gray-500 text-xs line-clamp-2">{customerAddress}</p>
                </div>
                <div className="flex gap-1.5 shrink-0 mt-1">
                  <button
                    type="button"
                    onClick={handleCallCustomer}
                    className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100 active:scale-95 transition-all shadow-sm"
                    aria-label="Call customer"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNavigateToCustomer}
                    className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-md active:scale-95 transition-all"
                    aria-label="Navigate to customer"
                  >
                    <Navigation className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <OrderNoteBanner order={order} />

          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-orange-500" />
              <PickupMetricsValue metrics={metrics} label="Time" unit="min" />
            </div>
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              <PickupMetricsValue metrics={metrics} label="Distance" unit="km" />
            </div>
          </div>

          {acceptDisabled ? (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2">
              <Lock className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
              <p className="text-sm font-semibold text-amber-800">{disabledMessage}</p>
            </div>
          ) : (
            <ActionSlider
              label="Slide to Accept"
              onConfirm={() => onAccept?.(order)}
              color="bg-black"
              successLabel="Order Accepted"
            />
          )}

          <button
            type="button"
            onClick={() => onReject?.(order)}
            className="w-full text-gray-400 font-bold text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors py-2"
          >
            Pass this task
          </button>
        </div>
      ) : null}
    </div>
  );
}
