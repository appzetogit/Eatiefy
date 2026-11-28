import React from 'react';
import { ChevronRight, Package } from 'lucide-react';
import OrderNoteBanner from '@/modules/DeliveryV2/components/orders/OrderNoteBanner';
import {
  resolveOrderKey,
  mapDeliveryPhaseToTripStatus,
  useDeliveryStore,
} from '@/modules/DeliveryV2/store/useDeliveryStore';

const phaseLabel = (order, session) => {
  const tripStatus = session?.tripStatus || mapDeliveryPhaseToTripStatus(order);
  switch (tripStatus) {
    case 'REACHED_PICKUP':
      return 'At Pickup';
    case 'PICKED_UP':
      return 'Delivering';
    case 'REACHED_DROP':
      return 'At Drop';
    case 'COMPLETED':
      return 'Completed';
    default:
      return 'Picking Up';
  }
};

export default function AcceptedOrderCard({ order, focused = false, onSelect }) {
  const orderId = resolveOrderKey(order);
  const session = useDeliveryStore((state) =>
    orderId ? state.orderSessions[orderId] : null,
  );
  const displayId = order?.orderId || order?.displayOrderId || orderId;
  const restaurantName =
    order?.restaurantName ||
    order?.restaurantId?.restaurantName ||
    order?.restaurantId?.name ||
    'Restaurant';

  return (
    <button
      type="button"
      onClick={() => onSelect?.(order)}
      className={`w-full text-left rounded-2xl border p-4 transition-all active:scale-[0.98] ${
        focused
          ? 'border-[#15498b]/35 bg-[#e7effa] shadow-md shadow-[#15498b]/10'
          : 'border-gray-100 bg-white hover:border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 !bg-[#15498b] !text-white shadow-sm">
            <Package className="w-5 h-5" strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Order #{displayId}
            </p>
            <p className="text-sm font-bold text-gray-950 truncate">{restaurantName}</p>
            <p className="text-[11px] font-semibold !text-[#15498b] mt-0.5">
              {phaseLabel(order, session)}
            </p>
            <OrderNoteBanner order={order} compact />
          </div>
        </div>
        <ChevronRight
          className={`w-5 h-5 shrink-0 ${focused ? '!text-[#15498b]' : 'text-gray-300'}`}
        />
      </div>
    </button>
  );
}
