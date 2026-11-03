import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['addition', 'deduction', 'refund'],
            required: true
        },
        amount: { type: Number, required: true },
        status: { type: String, default: 'Completed' }, // UI expects "Completed"
        description: { type: String, default: '' },
        metadata: { type: Object, default: {} },
        razorpayOrderId: { type: String, default: null },
        razorpayPaymentId: { type: String, default: null },
        razorpaySignature: { type: String, default: null },
        // Globally unique key (e.g. `order_payment:${orderId}`) used to make wallet
        // credits/deductions idempotent against retries and concurrent requests.
        idempotencyKey: { type: String, default: null }
    },
    { timestamps: true }
);

// Multikey unique index: enforces idempotencyKey uniqueness across every
// transaction in every wallet document (null values excluded via `sparse`).
walletTransactionSchema.index(
    { 'idempotencyKey': 1 },
    { unique: true, sparse: true }
);

const userWalletSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
        balance: { type: Number, default: 0 },
        referralEarnings: { type: Number, default: 0 },
        transactions: { type: [walletTransactionSchema], default: [] }
    },
    { collection: 'food_user_wallets', timestamps: true }
);

export const FoodUserWallet = mongoose.model('FoodUserWallet', userWalletSchema);

