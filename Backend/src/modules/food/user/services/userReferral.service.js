import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';
import { FoodReferralLog } from '../../admin/models/referralLog.model.js';
import { creditReferralReward } from './userWallet.service.js';

/**
 * Commission-mode user referral payout: referrer earns `referralCommissionPercent`
 * of the referee's item subtotal, paid the moment the referee's first order is
 * delivered - not at signup, so a cancelled/never-paid first order pays nothing.
 *
 * The unique (refereeId, role) index on FoodReferralLog means at most one row
 * exists per referee; the atomic findOneAndUpdate below only succeeds once, so
 * this is safe to call from every order-delivery transition without double-pay.
 */
export const payUserReferralCommissionOnDelivery = async (order) => {
    try {
        const userId = order?.userId;
        if (!userId) return;

        const subtotal = Number(order?.pricing?.subtotal) || 0;
        if (subtotal <= 0) return;

        const settingsDoc = await FoodReferralSettings.findOne({ isActive: true })
            .sort({ createdAt: -1 })
            .lean();
        const percent = Math.max(0, Number(settingsDoc?.referralCommissionPercent) || 0);
        if (percent <= 0) return;

        const rewardAmount = Math.round(subtotal * (percent / 100));
        if (rewardAmount <= 0) return;

        // Claim the pending referral for this referee. Returns null if there is
        // none, or it was already claimed by a concurrent/earlier delivery.
        const log = await FoodReferralLog.findOneAndUpdate(
            { refereeId: userId, role: 'USER', status: 'pending' },
            { $set: { rewardAmount, creditedOrderId: order._id } },
            { new: true }
        );
        if (!log) return;

        const limit = Math.max(0, Number(settingsDoc?.referralLimitUser) || 0);
        const referrer = await FoodUser.findById(log.referrerId).select('_id referralCount').lean();

        if (!referrer || (limit > 0 && Number(referrer.referralCount || 0) >= limit)) {
            await FoodReferralLog.updateOne(
                { _id: log._id },
                { $set: { status: 'rejected', reason: !referrer ? 'referrer_not_found' : 'limit_reached' } }
            );
            return;
        }

        await FoodReferralLog.updateOne({ _id: log._id }, { $set: { status: 'credited' } });

        await Promise.all([
            FoodUser.updateOne({ _id: log.referrerId }, { $inc: { referralCount: 1 } }),
            creditReferralReward(log.referrerId, rewardAmount, {
                role: 'USER',
                refereeId: String(userId),
                referralLogId: String(log._id),
                orderId: String(order._id)
            })
        ]);
    } catch (e) {
        // Never fail an order-delivery transition due to a referral error.
    }
};

export const getUserReferralStats = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const [user, wallet, settingsDoc] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode shortReferralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()
    ]);

    const commissionPercent = Math.max(0, Number(settingsDoc?.referralCommissionPercent) || 0);

    return {
        referralCount: Number(user?.referralCount) || 0,
        totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
        rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0),
        commissionPercent,
        shortReferralCode: user?.shortReferralCode || ''
    };
};

export const getUserReferralDetails = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }

    const oid = new mongoose.Types.ObjectId(id);
    const [user, wallet, settingsDoc, logs] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode shortReferralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean(),
        FoodReferralLog.find({ referrerId: oid, role: 'USER' })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean()
    ]);

    const refereeIds = Array.from(
        new Set(
            (Array.isArray(logs) ? logs : [])
                .map((log) => String(log?.refereeId || ''))
                .filter(Boolean)
        )
    )
        .filter((value) => mongoose.Types.ObjectId.isValid(value))
        .map((value) => new mongoose.Types.ObjectId(value));

    const referees = refereeIds.length
        ? await FoodUser.find({ _id: { $in: refereeIds } })
            .select('_id name phone profileImage')
            .lean()
        : [];

    const refereeMap = new Map(referees.map((entry) => [String(entry._id), entry]));

    const invitedFriends = (Array.isArray(logs) ? logs : []).map((log) => {
        const referee = refereeMap.get(String(log?.refereeId || ''));
        const rawPhone = String(referee?.phone || '');
        const maskedPhone = rawPhone
            ? `${rawPhone.slice(0, Math.min(3, rawPhone.length))}${'*'.repeat(Math.max(rawPhone.length - 5, 0))}${rawPhone.slice(-2)}`
            : '';

        return {
            id: String(log?._id || ''),
            refereeId: String(log?.refereeId || ''),
            name: String(referee?.name || '').trim() || 'Friend',
            phone: maskedPhone,
            profileImage: String(referee?.profileImage || '').trim() || '',
            status: String(log?.status || 'pending'),
            reason: String(log?.reason || ''),
            rewardAmount: Math.max(0, Number(log?.rewardAmount) || 0),
            earnedAmount: String(log?.status || '') === 'credited' ? Math.max(0, Number(log?.rewardAmount) || 0) : 0,
            invitedAt: log?.createdAt || null
        };
    });

    const totalInvited = invitedFriends.length;
    const creditedCount = invitedFriends.filter((entry) => entry.status === 'credited').length;
    const pendingCount = invitedFriends.filter((entry) => entry.status === 'pending').length;
    const rejectedCount = invitedFriends.filter((entry) => entry.status === 'rejected').length;

    return {
        stats: {
            referralCount: Number(user?.referralCount) || 0,
            totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
            rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0),
            commissionPercent: Math.max(0, Number(settingsDoc?.referralCommissionPercent) || 0),
            shortReferralCode: user?.shortReferralCode || '',
            totalInvited,
            creditedCount,
            pendingCount,
            rejectedCount
        },
        invitedFriends
    };
};
