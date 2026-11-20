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
        // Intentionally NO default: the unique index below is `sparse`, which only
        // skips documents where the field is MISSING. A stored `null` is still
        // indexed, so the second wallet to log any key-less transaction (admin
        // credit, referral reward, top-up) hit E11000 and the credit failed.
        idempotencyKey: { type: String }
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

