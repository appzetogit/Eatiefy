import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { createRazorpayOrder, getRazorpayKeyId, isRazorpayConfigured, verifyPaymentSignature, fetchRazorpayPayment, assertRazorpayPaymentMatches } from '../../orders/helpers/razorpay.helper.js';
import { config } from '../../../../config/env.js';

const ensureWallet = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const existing = await FoodUserWallet.findOne({ userId: oid });
    if (existing) return existing;
    return FoodUserWallet.create({ userId: oid, balance: 0, transactions: [] });
};

/**
 * Atomically applies a signed balance delta plus a transaction-log entry in a
 * single `findOneAndUpdate`, instead of load → mutate-in-memory → `.save()`.
 * That read-modify-write pattern let two concurrent calls (a retry racing the
 * original request, a refund racing a deduction) both read the same balance
 * and have the second `.save()` silently clobber the first — balance *and*
 * transaction log, since `.save()` replaces the whole document.
 *
 * `idempotencyKey`, when given, is enforced by a unique sparse index on
 * `transactions.idempotencyKey`: a duplicate call (same key) hits a Mongo
 * E11000 error instead of applying the delta twice, and is treated as
 * "already applied" rather than an error.
 */
const applyWalletDelta = async (userId, { delta, referralDelta = 0, type, description, metadata, idempotencyKey, requireSufficientBalance = false }) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);

    const filter = { userId: oid };
    if (requireSufficientBalance) {
        filter.balance = { $gte: -delta };
    }

    const update = {
        $inc: { balance: delta, ...(referralDelta ? { referralEarnings: referralDelta } : {}) },
        $push: {
            transactions: {
                $each: [{
                    type,
                    amount: Math.abs(delta),
                    status: 'Completed',
                    description,
                    metadata: metadata || {},
                    idempotencyKey: idempotencyKey || null
                }],
                $position: 0
            }
        },
        $setOnInsert: { userId: oid }
    };

    // Never upsert when a sufficient-balance guard is in the filter: Mongo ignores
    // `$gte` when building the upserted document, so it would happily create a
    // brand-new wallet with a negative balance instead of failing the deduction.
    const upsert = !requireSufficientBalance;

    let updated;
    try {
        updated = await FoodUserWallet.findOneAndUpdate(filter, update, { new: true, upsert });
    } catch (err) {
        if (err?.code === 11000 && idempotencyKey) {
            // Already applied by a previous/concurrent call with the same key.
            return { wallet: await getUserWallet(userId), alreadyApplied: true };
        }
        if (err?.code === 11000 && upsert) {
            // Lost the upsert race against a concurrent wallet-creation call; retry once.
            updated = await FoodUserWallet.findOneAndUpdate(filter, update, { new: true, upsert: true });
        } else {
            throw err;
        }
    }

    if (!updated) {
        throw new ValidationError('Insufficient wallet balance');
    }

    return { wallet: await getUserWallet(userId) };
};

export const creditReferralReward = async (userId, amountInr, metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }
    const { wallet } = await applyWalletDelta(userId, {
        delta: amount,
        referralDelta: amount,
        type: 'addition',
        description: 'Referral reward',
        metadata: { source: 'referral_reward', ...(metadata || {}) },
        idempotencyKey: metadata?.idempotencyKey
    });
    return { wallet };
};

export const getUserWallet = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const wallet = await FoodUserWallet.findOne({ userId: oid });
    if (!wallet) {
        return { balance: 0, referralEarnings: 0, transactions: [] };
    }
    // Return newest first (UI expects recent transactions on top)
    const tx = Array.isArray(wallet.transactions) ? [...wallet.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
    return {
        balance: Number(wallet.balance) || 0,
        referralEarnings: Number(wallet.referralEarnings) || 0,
        transactions: tx.map((t) => ({
            id: String(t._id),
            _id: t._id,
            type: t.type,
            amount: Number(t.amount) || 0,
            status: t.status || 'Completed',
            description: t.description || '',
            date: t.createdAt,
            createdAt: t.createdAt,
            metadata: t.metadata || {}
        }))
    };
};

export const createWalletTopupOrder = async (userId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0');
    }
    if (amount > 50000) {
        throw new ValidationError('Maximum amount is 50,000');
    }

    const amountPaise = Math.round(amount * 100);

    if (!isRazorpayConfigured()) {
        if (config.nodeEnv === 'production') {
            throw new ValidationError('Payment gateway is not configured');
        }
        // Dev fallback: return a compatible shape without writing to DB.
        const orderId = `order_dev_${Date.now()}`;
        return {
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId,
                amount: amountPaise,
                currency: 'INR'
            }
        };
    }

    const receipt = `wallet_topup_${String(userId).slice(-8)}_${Date.now()}`;
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

export const verifyWalletTopupPayment = async (userId, payload) => {
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();
    const amount = Number(payload?.amount);

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('amount is required');

    const wallet = await ensureWallet(userId);
    const existing = wallet.transactions.find((t) => String(t.razorpayOrderId || '') === orderId);
    if (existing && String(existing.status).toLowerCase() === 'completed') {
        return { wallet: await getUserWallet(userId) };
    }

    if (!isRazorpayConfigured()) {
        if (config.nodeEnv === 'production') {
            throw new ValidationError('Payment gateway is not configured');
        }
        // Dev-only: accept without gateway
    } else {
        const ok = verifyPaymentSignature(orderId, paymentId, signature);
        if (!ok) {
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

    // Store ONLY after payment is verified.
    wallet.transactions.unshift({
        type: 'addition',
        amount,
        status: 'Completed',
        description: isRazorpayConfigured() ? 'Wallet top-up' : 'Wallet top-up (dev)',
        metadata: { source: 'wallet_topup', mode: isRazorpayConfigured() ? 'razorpay' : 'dev' },
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature
    });

    wallet.balance = Number(wallet.balance || 0) + amount;
    await wallet.save();

    return { wallet: await getUserWallet(userId) };
};

export const creditWalletBalance = async (userId, amountInr, description = 'Wallet credit', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Invalid credit amount');
    }

    const { wallet } = await applyWalletDelta(userId, {
        delta: amount,
        type: 'addition',
        description,
        metadata: { source: 'wallet_credit', ...(metadata || {}) },
        idempotencyKey: metadata?.idempotencyKey
    });
    return { wallet };
};

export const deductWalletBalance = async (userId, amountInr, description = 'Order payment', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Invalid deduction amount');
    }

    const { wallet } = await applyWalletDelta(userId, {
        delta: -amount,
        type: 'deduction',
        description,
        metadata: { source: 'order_payment', ...(metadata || {}) },
        idempotencyKey: metadata?.idempotencyKey,
        requireSufficientBalance: true
    });
    return { wallet };
};

export const refundWalletBalance = async (userId, amountInr, description = 'Order refund', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }

    const { wallet } = await applyWalletDelta(userId, {
        delta: amount,
        type: 'refund',
        description,
        metadata: { source: 'order_refund', ...(metadata || {}) },
        idempotencyKey: metadata?.idempotencyKey
    });
    return { wallet };
};

