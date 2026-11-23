import React from 'react';
import { StickyNote } from 'lucide-react';
import { extractUserNote } from '@/modules/DeliveryV2/components/modals/DeliveryVerificationModal';

/**
 * The customer's note for the restaurant / delivery, shown to the rider.
 * Renders nothing when the order has no note, so it can be dropped into any
 * order screen (offer popup, offer card, accepted-order card) without a guard.
 */
export default function OrderNoteBanner({ order, compact = false, className = '' }) {
  const text = String(extractUserNote(order) || '').trim();
  if (!text) return null;

  if (compact) {
    return (
      <p
        className={`mt-1.5 flex items-start gap-1.5 rounded-lg bg-orange-50 border border-orange-100 px-2 py-1 text-[11px] font-semibold text-orange-800 ${className}`}
      >
        <StickyNote className="w-3.5 h-3.5 mt-px shrink-0 text-orange-500" />
        <span className="line-clamp-2 break-words">Note: {text}</span>
      </p>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-3.5 shadow-sm ${className}`}
    >
      <div className="w-9 h-9 rounded-xl bg-white border border-orange-100 flex items-center justify-center text-orange-500 shrink-0">
        <StickyNote className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600 mb-1">
          Note for restaurant / delivery
        </p>
        <p className="text-sm font-bold text-gray-900 leading-snug break-words">"{text}"</p>
      </div>
    </div>
  );
}
