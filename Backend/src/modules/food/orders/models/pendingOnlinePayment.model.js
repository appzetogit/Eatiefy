import mongoose from 'mongoose';

/**
 * Durable backing store for Razorpay order intents created in
 * `initiateOnlinePayment` before any `FoodOrder` row exists. Previously this
 * lived only in a process-local `Map`, which a PM2 restart/crash between the
 * customer being charged and the order being created would silently wipe —
 * money taken, no order, no error anywhere. The webhook-driven recovery path
 * (`createOrderFromPendingIntent`) now reads from here so it survives restarts.
 */
const pendingOnlinePaymentSchema = new mongoose.Schema(
    {
        razorpayOrderId: { type: String, required: true, unique: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, required: true },
        dto: { type: Object, required: true },
        consumedAt: { type: Date, default: null },
    },
    { collection: 'food_pending_online_payments', timestamps: true }
);

// TTL: auto-expire 30 minutes after creation, matching the old in-memory cleanup window.
pendingOnlinePaymentSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 60 });

export const PendingOnlinePayment = mongoose.model('PendingOnlinePayment', pendingOnlinePaymentSchema);
