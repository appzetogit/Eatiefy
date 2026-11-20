import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { FoodDeliveryWithdrawal } from '../models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryCashDeposit } from '../models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { getDeliveryCashLimitSettings } from '../../admin/services/admin.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { createRazorpayOrder, getRazorpayKeyId, isRazorpayConfigured, verifyPaymentSignature, fetchRazorpayPayment, assertRazorpayPaymentMatches } from '../../orders/helpers/razorpay.helper.js';
import { config } from '../../../../config/env.js';

/**
 * Enhanced wallet fetch for delivery partners.
 * Integrates:
 * 1. Historical orders (earnings)
 * 2. Admin bonuses
 * 3. Withdrawals (pending/payout)
 * 4. Cash collected vs limit
 */
export const getDeliveryPartnerWalletEnhanced = async (deliveryPartnerId) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Invalid delivery partner ID');
    }

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const partner = await FoodDeliveryPartner.findById(partnerId).lean();
    if (!partner) throw new ValidationError('Delivery partner not found');

    const [cashLimitSettings, earningsAgg, cashCollectedAgg, cashDepositsAgg, pendingCashAgg, bonusAgg, withdrawalAgg, withdrawalsList, depositList] = await Promise.all([
        // The rider's own zone limits (zone override, else the default).
        getDeliveryCashLimitSettings({ zoneId: partner.zoneId }),
        // 1. Total Earnings from Delivered Orders
        FoodOrder.aggregate([
            { $match: { 'dispatch.deliveryPartnerId': partnerId, orderStatus: 'delivered' } },
            { $group: { _id: null, totalEarned: { $sum: { $ifNull: ['$riderEarning', 0] } } } }
        ]),
        // 2. Gross cash collected (COD orders)
        FoodOrder.aggregate([
            { 
                $match: { 
                    'dispatch.deliveryPartnerId': partnerId, 
                    orderStatus: 'delivered', 
                    'payment.method': 'cash'
                } 
            },
            { $group: { _id: null, cashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } } } }
        ]),
        // 3. Cash deposits (deduct from cash-in-hand)
        FoodDeliveryCashDeposit.aggregate([
            {
                $match: {
                    deliveryPartnerId: partnerId,
                    status: 'Completed'
                }
            },
            { $group: { _id: null, depositedCash: { $sum: { $ifNull: ['$amount', 0] } } } }
        ]),
        // 3b. Pending manual cash submissions (awaiting admin confirmation)
        FoodDeliveryCashDeposit.aggregate([
            {
                $match: {
                    deliveryPartnerId: partnerId,
                    status: 'Pending',
                    paymentMethod: 'cash',
                },
            },
            { $group: { _id: null, pendingCash: { $sum: { $ifNull: ['$amount', 0] } } } },
        ]),
        // 4. Admin Bonuses
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: partnerId } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } }
        ]),
        // 5. Withdrawal Aggregates (Approved vs Pending)
        FoodDeliveryWithdrawal.aggregate([
            { $match: { deliveryPartnerId: partnerId } },
            { 
                $group: { 
                    _id: null, 
                    totalWithdrawn: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] } },
                    pendingWithdrawals: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } }
                } 
            }
        ]),
        // 6. Recent Withdrawals for History
        FoodDeliveryWithdrawal.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
        FoodDeliveryCashDeposit.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean()
    ]);

    const totalEarned = Number(earningsAgg?.[0]?.totalEarned) || 0;
    const grossCashCollected = Number(cashCollectedAgg?.[0]?.cashCollected) || 0;
    const totalDepositedCash = Number(cashDepositsAgg?.[0]?.depositedCash) || 0;
    const pendingCashSubmission = Number(pendingCashAgg?.[0]?.pendingCash) || 0;
    const cashInHand = Math.max(0, grossCashCollected - totalDepositedCash);
    const availableToDeposit = Math.max(0, cashInHand - pendingCashSubmission);
    const totalBonus = Number(bonusAgg?.[0]?.total) || 0;
    const totalWithdrawn = Number(withdrawalAgg?.[0]?.totalWithdrawn) || 0;
    const pendingWithdrawals = Number(withdrawalAgg?.[0]?.pendingWithdrawals) || 0;

    const totalCashLimit = Number(cashLimitSettings.deliveryCashLimit) || 0;
    const deliveryWithdrawalLimit = Number(cashLimitSettings.deliveryWithdrawalLimit) || 100;

    // Everything credited to the partner, and everything already claimed against it.
    // Pending requests count as claimed so the partner cannot request the same money twice.
    const totalCredited = totalEarned + totalBonus;
    const totalCommitted = totalWithdrawn + pendingWithdrawals;

    // Kept unclamped: a negative value means more has been claimed than earned, which is
    // the signal callers need to detect an overdraw. `pocketBalance` stays clamped for display.
    const netBalance = totalCredited - totalCommitted;
    const pocketBalance = Math.max(0, netBalance);

    // Most recent approved withdrawal for "Last Payout" on Pocket
    const lastApprovedWithdrawal = (withdrawalsList || []).find((w) => w.status === 'approved') || null;
    const lastPayout = lastApprovedWithdrawal
        ? {
            amount: Number(lastApprovedWithdrawal.amount) || 0,
            date: lastApprovedWithdrawal.processedAt || lastApprovedWithdrawal.createdAt,
            id: lastApprovedWithdrawal._id,
          }
        : null;

    // Fetch transactions for UI (Orders, Bonuses, Withdrawals)
    const [ordersTx] = await Promise.all([
        FoodOrder.find({ 'dispatch.deliveryPartnerId': partnerId, orderStatus: 'delivered' })
            .sort({ createdAt: -1 })
            .select('orderId riderEarning payment orderStatus createdAt')
            .limit(20)
            .lean(),
    ]);

    const transactions = [
        ...(ordersTx || []).map(o => ({
            id: o._id,
            type: 'payment',
            amount: o.riderEarning || 0,
            status: 'Completed',
            date: o.createdAt,
            description: o.payment?.method === 'cash' ? 'COD delivery earning' : 'Online delivery earning',
            orderId: o.orderId
        })),
        ...(withdrawalsList || []).map(w => ({
            id: w._id,
            type: 'withdrawal',
            amount: w.amount,
            status: w.status === 'pending' ? 'Pending' : (w.status === 'approved' ? 'Completed' : 'Rejected'),
            date: w.createdAt,
            processedAt: w.processedAt || null,
            failureReason: w.rejectionReason || null,
            description: `Withdrawal Request - ${w.paymentMethod}`,
            payoutMethod: w.paymentMethod
        })),
        ...(depositList || []).map(d => ({
            id: d._id,
            type: 'deposit',
            amount: d.amount,
            status: d.status || 'Pending',
            date: d.createdAt,
            description: 'Cash limit settlement',
            paymentMethod: d.paymentMethod || 'cash',
            razorpayPaymentId: d.razorpayPaymentId || '',
            razorpayOrderId: d.razorpayOrderId || ''
        }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
        totalBalance: totalCredited, // Gross lifetime earnings
        pocketBalance, // Available to withdraw (never negative)
        netBalance, // Unclamped; negative means more claimed than earned
        totalCredited, // Earnings + bonuses
        totalCommitted, // Approved payouts + money held by pending requests
        cashInHand, // COD to be deposited/deducted
        totalWithdrawn, // Actually paid out
        pendingWithdrawals, // In process — held, not yet paid
        lastPayout,
        totalEarned,
        totalBonus,
        totalCashLimit,
        availableCashLimit: Math.max(0, totalCashLimit - cashInHand),
        pendingCashSubmission,
        availableToDeposit,
        deliveryWithdrawalLimit,
        transactions: transactions.slice(0, 50)
    };
};

/**
 * Submits a new withdrawal request for a delivery partner.
 */
export const requestDeliveryWithdrawal = async (deliveryPartnerId, payload) => {
    const { amount, bankDetails, paymentMethod = 'bank_transfer' } = payload;

    if (!amount || amount < 1) throw new ValidationError('Invalid amount');

    const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
    if (amount < wallet.deliveryWithdrawalLimit) {
        throw new ValidationError(`Minimum withdrawal amount is ₹${wallet.deliveryWithdrawalLimit}`);
    }
    if (amount > wallet.pocketBalance) {
        throw new ValidationError(
            wallet.pendingWithdrawals > 0
                ? `Insufficient balance. ₹${wallet.pendingWithdrawals} of your earnings is already held by pending withdrawal requests.`
                : 'Insufficient balance for this withdrawal'
        );
    }

    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId).lean();
    if (!partner) throw new ValidationError('Delivery partner not found');

    const withdrawal = await FoodDeliveryWithdrawal.create({
        deliveryPartnerId,
        amount,
        paymentMethod,
        bankDetails: bankDetails || {
            accountNumber: partner.bankAccountNumber,
            ifscCode: partner.bankIfscCode,
            bankName: partner.bankName,
            accountHolderName: partner.bankAccountHolderName
        },
        upiId: partner.upiId,
        upiQrCode: partner.upiQrCode,
        status: 'pending'
    });

    // The balance check above reads before this insert, so two requests fired at once
    // could each see the same balance and both pass. Re-total afterwards — the sum now
    // includes this row — and undo our own request if it pushed the partner overdrawn.
    // Without this, a double-tap can create withdrawals that exceed real earnings and
    // then permanently pin the pocket balance to zero.
    const verified = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
    if (verified.pocketBalance < 0 || verified.totalCommitted > verified.totalCredited) {
        await FoodDeliveryWithdrawal.deleteOne({ _id: withdrawal._id, status: 'pending' });
        throw new ValidationError('Insufficient balance for this withdrawal');
    }

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        const partnerName = partner?.name || 'Delivery partner';
        const formattedAmount = Number(amount).toLocaleString('en-IN');
        void notifyAdminsSafely({
            title: 'New Withdrawal Request',
            body: `${partnerName} requested a withdrawal of ₹${formattedAmount}.`,
            link: '/admin/food/delivery-withdrawal',
            idempotencyKey: `delivery_withdrawal:${String(withdrawal._id)}`,
            data: {
                type: 'delivery_withdrawal',
                subType: 'delivery',
                id: String(withdrawal._id),
                deliveryPartnerId: String(deliveryPartnerId),
                amount: String(amount),
                link: '/admin/food/delivery-withdrawal'
            }
        });
    } catch (notifErr) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of delivery withdrawal request:', notifErr?.message || notifErr);
    }

    return withdrawal;
};

export const createDeliveryCashDepositOrder = async (deliveryPartnerId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount < 1) {
        throw new ValidationError('Amount must be at least ₹1');
    }
    if (amount > 500000) {
        throw new ValidationError('Maximum deposit is ₹5,00,000');
    }

    const { availableToDeposit } = await getDepositCapacity(deliveryPartnerId);
    if (amount > availableToDeposit) {
        throw new ValidationError('Deposit amount cannot exceed cash in hand');
    }

    const amountPaise = Math.round(amount * 100);
    const receipt = `cash_deposit_${String(deliveryPartnerId).slice(-8)}_${Date.now()}`;

    if (!isRazorpayConfigured()) {
        if (config.nodeEnv === 'production') {
            throw new ValidationError('Payment gateway is not configured');
        }
        return {
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId: `order_dev_${Date.now()}`,
                amount: amountPaise,
                currency: 'INR'
            }
        };
    }

    const order = await createRazorpayOrder(amountPaise, 'INR', receipt);
    return {
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(order.id),
            amount: Number(order.amount) || amountPaise,
            currency: order.currency || 'INR'
        }
    };
};

export const verifyDeliveryCashDepositPayment = async (deliveryPartnerId, payload = {}) => {
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();
    const amount = Number(payload?.amount);

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');
    if (!Number.isFinite(amount) || amount < 1) throw new ValidationError('amount is required');

    const existing = await FoodDeliveryCashDeposit.findOne({
        deliveryPartnerId,
        $or: [
            { razorpayPaymentId: paymentId },
            { razorpayOrderId: orderId }
        ]
    }).lean();

    if (existing?.status === 'Completed') {
        return { deposit: existing, wallet: await getDeliveryPartnerWalletEnhanced(deliveryPartnerId) };
    }

    const { availableToDeposit } = await getDepositCapacity(deliveryPartnerId);
    if (amount > availableToDeposit) {
        throw new ValidationError('Deposit amount cannot exceed cash in hand');
    }

    if (!isRazorpayConfigured()) {
        if (config.nodeEnv === 'production') {
            throw new ValidationError('Payment gateway is not configured');
        }
    } else {
        const isValid = verifyPaymentSignature(orderId, paymentId, signature);
        if (!isValid) {
            throw new ValidationError('Payment verification failed');
        }
        try {
            const rzPayment = await fetchRazorpayPayment(paymentId);
            assertRazorpayPaymentMatches(rzPayment, {
                orderId,
                amountPaise: Math.round(amount * 100),
            });
        } catch (err) {
            throw new ValidationError(err?.message || 'Payment verification failed');
        }
    }

    const deposit = existing
        ? await FoodDeliveryCashDeposit.findByIdAndUpdate(
            existing._id,
            {
                $set: {
                    amount,
                    paymentMethod: isRazorpayConfigured() ? 'razorpay' : 'cash',
                    status: 'Completed',
                    razorpayOrderId: orderId,
                    razorpayPaymentId: paymentId
                }
            },
            { new: true }
        )
        : await FoodDeliveryCashDeposit.create({
            deliveryPartnerId,
            amount,
            paymentMethod: isRazorpayConfigured() ? 'razorpay' : 'cash',
            status: 'Completed',
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId
        });

    return {
        deposit,
        wallet: await getDeliveryPartnerWalletEnhanced(deliveryPartnerId)
    };
};

async function getPendingCashSubmissionTotal(deliveryPartnerId) {
    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const agg = await FoodDeliveryCashDeposit.aggregate([
        {
            $match: {
                deliveryPartnerId: partnerId,
                status: 'Pending',
                paymentMethod: 'cash',
            },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } },
    ]);
    return Number(agg?.[0]?.total) || 0;
}

async function getDepositCapacity(deliveryPartnerId) {
    const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
    const pendingCashSubmission = await getPendingCashSubmissionTotal(deliveryPartnerId);
    const availableToDeposit = Math.max(0, wallet.cashInHand - pendingCashSubmission);
    return { wallet, pendingCashSubmission, availableToDeposit };
}

export const submitCashDepositByHand = async (deliveryPartnerId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount < 1) {
        throw new ValidationError('Amount must be at least ₹1');
    }
    if (amount > 500000) {
        throw new ValidationError('Maximum deposit is ₹5,00,000');
    }

    const { wallet, pendingCashSubmission, availableToDeposit } = await getDepositCapacity(deliveryPartnerId);
    if (amount > availableToDeposit) {
        const suffix = pendingCashSubmission > 0
            ? ` (₹${pendingCashSubmission} already pending admin confirmation)`
            : '';
        throw new ValidationError(`Deposit amount cannot exceed cash in hand (₹${availableToDeposit})${suffix}`);
    }

    const deposit = await FoodDeliveryCashDeposit.create({
        deliveryPartnerId,
        amount,
        paymentMethod: 'cash',
        status: 'Pending',
    });

    const capacityAfter = await getDepositCapacity(deliveryPartnerId);

    return {
        deposit: deposit.toObject(),
        wallet: {
            ...capacityAfter.wallet,
            pendingCashSubmission: capacityAfter.pendingCashSubmission,
            availableToDeposit: capacityAfter.availableToDeposit,
        },
        pendingCashSubmission: capacityAfter.pendingCashSubmission,
        availableToDeposit: capacityAfter.availableToDeposit,
    };
};

export async function notifyDeliveryPartnerCashDepositStatus(deliveryPartnerId, { amount, status, wallet }) {
    const partnerId = String(deliveryPartnerId);
    const amt = Number(amount) || 0;
    const availableLimit = Number(wallet?.availableCashLimit) || 0;
    const cashInHand = Number(wallet?.cashInHand) || 0;

    let title = 'Cash Deposit Update';
    let body = '';
    let category = 'cash_deposit';

    if (status === 'Completed') {
        title = 'Cash Deposit Confirmed';
        body = cashInHand <= 0
            ? `Your cash deposit of ₹${amt.toLocaleString('en-IN')} has been confirmed. Your cash limit has been fully restored.`
            : `Your cash deposit of ₹${amt.toLocaleString('en-IN')} has been confirmed. Your available cash limit is now ₹${availableLimit.toLocaleString('en-IN')}.`;
    } else if (status === 'Failed') {
        title = 'Cash Not Received';
        body = `The admin has not received ₹${amt.toLocaleString('en-IN')} in cash. Please submit it again.`;
        category = 'cash_deposit_rejected';
    } else {
        return;
    }

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        const { createInboxNotifications } = await import('../../../../core/notifications/notification.service.js');

        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: partnerId },
            {
                sendToAllDevices: true,
                title,
                body,
                data: {
                    type: category,
                    amount: String(amt),
                    status: String(status),
                    availableCashLimit: String(availableLimit),
                    cashInHand: String(cashInHand),
                    link: '/food/delivery/pocket',
                },
            },
        );

        await createInboxNotifications({
            notifications: [{
                ownerType: 'DELIVERY_PARTNER',
                ownerId: partnerId,
                title,
                message: body,
                link: '/food/delivery/pocket',
                category,
                source: 'ORDER_UPDATE',
                metadata: {
                    amount: amt,
                    status,
                    availableCashLimit: availableLimit,
                    cashInHand,
                },
            }],
        });
    } catch (err) {
        console.error('Failed to send cash deposit notification:', err?.message || err);
    }
}
