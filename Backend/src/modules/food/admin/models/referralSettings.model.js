import mongoose from 'mongoose';

const referralSettingsSchema = new mongoose.Schema(
    {
        referralRewardUser: { type: Number, min: 0, default: 0 },
        // Commission-based user referral: referrer earns this % of the referee's
        // first DELIVERED order's item subtotal, paid out at delivery (not signup).
        referralCommissionPercent: { type: Number, min: 0, max: 100, default: 0 },
        referralRewardDelivery: { type: Number, min: 0, default: 0 },
        referralLimitUser: { type: Number, min: 0, default: 0 },
        referralLimitDelivery: { type: Number, min: 0, default: 0 },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_referral_settings', timestamps: true }
);

referralSettingsSchema.index({ isActive: 1, createdAt: -1 });

export const FoodReferralSettings = mongoose.model('FoodReferralSettings', referralSettingsSchema);

