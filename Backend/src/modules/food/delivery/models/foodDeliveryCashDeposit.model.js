import mongoose from 'mongoose';

const foodDeliveryCashDepositSchema = new mongoose.Schema({
    deliveryPartnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FoodDeliveryPartner',
        required: true,
        index: true
    },
    // Negative only for an admin correction that RAISES a rider's cash in hand
    // (see updateDeliveryPartnerWallet); riders can only submit positive amounts.
    amount: {
        type: Number,
        required: true,
        validate: {
            validator: (v) => Number.isFinite(v) && v !== 0,
            message: 'Amount must be a non-zero number'
        }
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'razorpay', 'upi', 'bank_transfer'],
        default: 'cash'
    },
    status: {
        type: String,
        enum: ['Pending', 'Completed', 'Failed'],
        default: 'Pending',
        index: true
    },
    razorpayOrderId: {
        type: String,
        default: ''
    },
    razorpayPaymentId: String,
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    adminNote: String,
    confirmationAction: {
        type: String,
        enum: ['received', 'not_received'],
        default: undefined,
    }
}, { 
    collection: 'food_delivery_cash_deposits', 
    timestamps: true 
});

foodDeliveryCashDepositSchema.index({ createdAt: -1 });
foodDeliveryCashDepositSchema.index({ paymentMethod: 1, status: 1, createdAt: -1 });

export const FoodDeliveryCashDeposit = mongoose.model('FoodDeliveryCashDeposit', foodDeliveryCashDepositSchema);
